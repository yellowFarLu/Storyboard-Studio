/**
 * 分镜工坊 - Agent 工作台（Cloudflare Pages Function）
 *
 * 架构：PERO（Plan → Execute[ReAct] → Reflect → Optimize）
 * - Plan：LLM 多节点规划，生成任务计划列表（Plan-And-Execute 的规划优点）
 * - Execute：每个节点以 ReAct 方式执行（Reason → Act → Observe 循环）：
 *     生成类节点（大纲/分镜）先由 LLM 产出，再经规则校验（Observe），
 *     不合格则把校验反馈交回 LLM 自纠（Reason → Act），最多自纠 1 轮，
 *     保留大模型在每个节点的智能决策能力
 * - Reflect：LLM 对产出做质量评审（评分/优点/问题/建议）
 * - Optimize：基于 Reflect 的问题与建议，LLM 产出优化后的分镜并再次校验
 *     （Reflexion 闭环），前端提供原版/优化版对比
 *
 * 工具注册表（真实能力边界如实标注）：
 * - lookup_trend     爆款题材热度查询 → Mock（内置示例数据，未接真实数据源）
 * - search_materials 创作素材搜索     → Mock（内置示例素材，未接真实搜索引擎）
 * - gen_outline      LLM 生成三幕大纲  → 真实（DeepSeek，ReAct 自纠）
 * - gen_board        LLM 生成第一幕分镜 → 真实（DeepSeek，ReAct 自纠）
 * - check_structure  分镜结构检查      → 真实（本地规则引擎）
 *
 * 记忆：来自前端的用户偏好（localStorage 持久化），注入规划与生成的 Prompt。
 *       当前为本地模拟长期记忆，未接数据库/向量记忆（README 已标注）。
 *
 * 安全：API Key 仅存在于 Secret 环境变量；仅 POST；请求体限长。
 */

const MAX_BODY_BYTES = 64 * 1024;
const MAX_FIX_ROUNDS = 1; // 生成节点 ReAct 自纠最大轮数

const TOOL_WHITELIST = ["lookup_trend", "search_materials", "gen_outline", "gen_board", "check_structure"];

/* ==================== SSE 辅助 ==================== */
function sseEvent(controller, encoder, event, data) {
  controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}

/* ==================== LLM 调用 ==================== */
async function callLLM(env, messages, temperature = 0.7) {
  const apiKey = env.LLM_API_KEY || "";
  if (!apiKey) {
    throw new Error("未配置 LLM_API_KEY");
  }
  const apiBase = (env.LLM_API_BASE || "https://api.deepseek.com/v1").replace(/\/+$/, "");
  const model = env.LLM_MODEL || "deepseek-chat";
  const resp = await fetch(`${apiBase}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, temperature, max_tokens: 2048, stream: false }),
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`模型服务错误(${resp.status}): ${text.slice(0, 200)}`);
  }
  const data = JSON.parse(text);
  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) throw new Error("模型未返回内容");
  return { content, model };
}

/** 容错解析模型输出 JSON */
function parseJsonLoose(text) {
  if (!text || typeof text !== "string") throw new Error("模型返回为空");
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const firstOpen = s.search(/[{[]/);
  const lastClose = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  if (firstOpen === -1 || lastClose <= firstOpen) throw new Error("模型输出中未找到有效 JSON");
  s = s.slice(firstOpen, lastClose + 1);
  return JSON.parse(s);
}

/* ==================== Prompt 模板 ==================== */
const PLAN_SYSTEM = `你是一位短剧创作 Agent 的规划器。根据用户的创作目标与记忆，产出一份 4-6 步的创作计划。
可用动作（只能从以下选择，可重复使用）：
- lookup_trend：查询短剧爆款题材热度（用于题材定位）
- search_materials：搜索创作参考素材（用于灵感补充）
- gen_outline：生成三幕大纲
- gen_board：生成第一幕分镜脚本
- check_structure：检查分镜脚本是否符合拍摄规范
要求：
- 一个动作只能用一次；gen_outline 和 gen_board 必须各出现一次。
- 严格只输出 JSON：{"steps":[{"action":"lookup_trend","note":"这一步做什么"}]}
- 不要输出任何其他文字。`;

const OUTLINE_SYSTEM = `你是一位资深的短剧编剧与策划。根据用户目标、记忆与工具观察结果，产出可直接指导分镜创作的短剧三幕大纲。
要求：快节奏、强钩子、反转合理，符合短视频竖屏短剧（单集1-2分钟）的叙事习惯；世界观、人物、冲突具体有画面感。
严格只输出 JSON 对象：
{"logline":"一句话梗概","worldview":"世界观（1-2句）","protagonist":{"name":"主角名","desc":"特征（1-2句）"},"conflict":"核心冲突（1-2句）","acts":[{"title":"第一幕·钩子","beats":["节拍1","节拍2","节拍3"]},{"title":"第二幕·升级","beats":["..."]},{"title":"第三幕·反转","beats":["..."]}]}`;

const BOARD_SYSTEM = `你是一位专业的短视频短剧分镜师。根据三幕大纲为【第一幕】撰写分镜脚本。
要求：竖屏9:16，单集60-90秒，每镜3-8秒；开场前3秒必须有强钩子；台词口语化、字幕简洁有力；景别只用 远景/全景/中景/近景/特写。
严格只输出 JSON 数组（8-12个镜头）：
[{"scene":"场景","scale":"景别","action":"画面动作描述","dialogue":"台词（无则空串）","caption":"字幕建议","duration":5}]`;

const REFLECT_SYSTEM = `你是短剧创作质量评审。对给定的大纲与分镜脚本做客观评审，严格只输出 JSON：
{"score":0-100的整数,"strengths":["优点1","优点2"],"issues":["问题1","问题2"],"suggestions":["改进建议1","改进建议2"]}
评审维度：开场钩子强度、节奏与总时长、人物动机清晰度、镜头可拍摄性、字幕/台词质量。`;

const OPTIMIZE_SYSTEM = `你是短剧分镜优化师。基于质量评审的问题与建议，对第一幕分镜脚本做针对性优化。
要求：保持 JSON 数组格式（8-12个镜头，不允许超过12个），字段与原来一致（scene/scale/action/dialogue/caption/duration）；竖屏9:16，单集60-90秒，每镜3-8秒；开场前3秒必须有强钩子；景别只用 远景/全景/中景/近景/特写。
严格只输出 JSON：{"summary":"优化说明（1-2句，说明改了什么）","board":[分镜数组]}`;

/* ==================== Mock 工具（内置示例数据，未接真实数据源） ==================== */
function mockLookupTrend(idea) {
  const rows = [
    { tag: "复仇逆袭", heat: 92, note: "近30天站内高热，反转爽感强，完播率高" },
    { tag: "隐世高手", heat: 88, note: "身份反差是核心钩子，适合3秒开场" },
    { tag: "职场打工人", heat: 85, note: "共鸣强、传播广，适合情绪向内容" },
    { tag: "AI 题材", heat: 81, note: "科技新鲜感，但需避免硬科普" },
    { tag: "家庭伦理", heat: 76, note: "长尾流量好，但开篇钩子设计难度高" },
  ];
  const hit = rows.find((r) => idea.includes(r.tag.slice(0, 2))) || rows[0];
  return {
    summary: `题材热度分析：推荐「${hit.tag}」方向（热度 ${hit.heat}/100）`,
    detail: [hit, rows.find((r) => r !== hit) || rows[1]].slice(0, 2),
    mock: true,
  };
}

function mockSearchMaterials(idea) {
  const items = [
    { title: "爆款三秒钩子公式", desc: "「反常动作 + 身份反差 + 后果压迫」三要素开场，前3秒必须让用户停下手指。" },
    { title: "反转结构参考", desc: "第一幕埋钩，第二幕升级压迫，第三幕揭露真相完成情绪释放。" },
    { title: "竖屏分镜节奏", desc: "单镜3-8秒，特写用于情绪点，全景用于场景建立，字幕控制在每屏10字内。" },
  ];
  return { summary: "已检索到 3 条创作参考素材（示例库）", items, mock: true };
}

/* ==================== 真实工具：分镜结构检查（本地规则引擎） ==================== */
function checkStructure(board) {
  const issues = [];
  const total = (board || []).reduce((s, r) => s + (Number(r.duration) || 0), 0);
  const count = (board || []).length;
  const validScales = ["远景", "全景", "中景", "近景", "特写"];

  if (count < 8) issues.push(`镜头数偏少（${count} 个），建议 8-12 个以保证节奏`);
  if (count > 12) issues.push(`镜头数偏多（${count} 个），单集建议控制在 12 个以内`);
  if (total < 60) issues.push(`总时长 ${total}s 低于单集目标下限 60s，建议补充镜头`);
  if (total > 90) issues.push(`总时长 ${total}s 超过单集目标上限 90s，建议精简`);
  const noDialogue = (board || []).filter((r) => !(r.dialogue || "").trim()).length;
  if (count > 0 && noDialogue / count > 0.7) issues.push(`纯画面镜头占比 ${Math.round((noDialogue / count) * 100)}%，注意叙事信息密度`);
  const badScale = (board || []).filter((r) => !validScales.includes(r.scale));
  if (badScale.length) issues.push(`存在非法景别：${badScale.map((r) => r.scale).join("、")}`);
  const first = (board || [])[0];
  if (!first || (!first.action && !first.dialogue)) issues.push("第一镜缺少强钩子（建议以冲突动作或反常画面开场）");

  return {
    passed: issues.length === 0,
    totalDuration: total,
    shotCount: count,
    issues,
    mock: false,
  };
}

/** 大纲轻量校验（ReAct 的 Observe 用） */
function checkOutline(outline) {
  const issues = [];
  if (!outline || !outline.logline) issues.push("缺少一句话梗概（logline）");
  const acts = (outline && outline.acts) || [];
  if (acts.length !== 3) issues.push(`三幕结构不完整（当前 ${acts.length} 幕，应为 3 幕）`);
  if (acts.length === 3 && acts.some((a) => !a.beats || a.beats.length < 2)) issues.push("部分幕的节拍过少（每幕建议至少 2 个节拍）");
  return issues;
}

/* ==================== ReAct 执行：生成类节点 ==================== */
/** 生成三幕大纲（ReAct：Reason → Act → Observe → 自纠） */
async function genOutlineReAct(env, controller, encoder, goal, memoryText, toolObs) {
  const reactLog = [];
  let outline = null;
  let issues = [];
  let model = "";

  for (let round = 0; round <= MAX_FIX_ROUNDS; round++) {
    const isFix = round > 0;
    sseEvent(controller, encoder, "stage", {
      step: "react", tool: "gen_outline", round, phase: "reason",
      text: isFix ? "依据校验反馈重新构思大纲结构" : "根据目标与工具观察构思三幕大纲",
    });
    const user = `用户目标：${goal}\n${memoryText ? `记忆：\n${memoryText}\n` : ""}${toolObs ? `工具观察：\n${toolObs}\n` : ""}${isFix ? `\n上一版大纲的校验问题（需修正）：\n${issues.join("\n")}\n请输出修正后的完整大纲 JSON。` : "请输出三幕大纲 JSON。"}`;
    const llmOut = await callLLM(env, [{ role: "system", content: OUTLINE_SYSTEM }, { role: "user", content: user }], 0.8);
    model = llmOut.model;
    outline = normalizeOutline(parseJsonLoose(llmOut.content));

    // Observe
    issues = checkOutline(outline);
    sseEvent(controller, encoder, "stage", {
      step: "react", tool: "gen_outline", round, phase: "act",
      text: `已生成大纲（logline：${(outline.logline || "").slice(0, 30)}…）`,
    });
    sseEvent(controller, encoder, "stage", {
      step: "react", tool: "gen_outline", round, phase: "observe",
      text: issues.length ? `大纲校验发现 ${issues.length} 项问题（${issues[0]}）` : "大纲校验通过（三幕结构完整）",
    });
    reactLog.push({ round, issues: issues.length });
    if (!issues.length) break;
  }

  return { outline, model, reactLog, fixed: reactLog.length > 1 };
}

/** 生成第一幕分镜（ReAct：Reason → Act → Observe → 自纠） */
async function genBoardReAct(env, controller, encoder, outline, goal, memoryText) {
  const reactLog = [];
  let board = null;
  let checks = null;
  let model = "";

  for (let round = 0; round <= MAX_FIX_ROUNDS; round++) {
    const isFix = round > 0;
    sseEvent(controller, encoder, "stage", {
      step: "react", tool: "gen_board", round, phase: "reason",
      text: isFix ? "依据结构校验反馈调整镜头设计" : "依据三幕大纲设计第一幕分镜",
    });
    const user = `三幕大纲：\n${JSON.stringify(outline, null, 2)}\n${memoryText ? `记忆：\n${memoryText}\n` : ""}${isFix ? `\n当前分镜的结构问题（需修正）：\n${checks.issues.join("\n")}\n请输出修正后的完整分镜 JSON 数组。` : "请为第一幕输出分镜脚本 JSON 数组。"}`;
    const llmOut = await callLLM(env, [{ role: "system", content: BOARD_SYSTEM }, { role: "user", content: user }], 0.8);
    model = llmOut.model;
    board = normalizeBoard(parseJsonLoose(llmOut.content));

    // Observe
    checks = checkStructure(board);
    sseEvent(controller, encoder, "stage", {
      step: "react", tool: "gen_board", round, phase: "act",
      text: `已生成 ${board.length} 个镜头（总时长 ${checks.totalDuration}s）`,
    });
    sseEvent(controller, encoder, "stage", {
      step: "react", tool: "gen_board", round, phase: "observe",
      text: checks.passed ? "结构校验通过（镜头数与时长符合规范）" : `结构校验发现 ${checks.issues.length} 项问题（${checks.issues[0]}）`,
    });
    reactLog.push({ round, issues: checks.issues.length });
    if (checks.passed) break;
  }

  return { board, checks, model, reactLog, fixed: reactLog.length > 1 };
}

/* ==================== Optimize：Reflexion 闭环 ==================== */
async function optimizeBoard(env, controller, encoder, outline, board, checks, reflection) {
  sseEvent(controller, encoder, "stage", { step: "optimize", status: "running", message: "Agent 正在基于反思结果优化分镜…" });
  let model = "";
  try {
    const user = `三幕大纲：\n${JSON.stringify(outline, null, 2)}\n\n第一幕分镜：\n${JSON.stringify(board, null, 2)}\n\n结构检查：\n${JSON.stringify(checks)}\n\n质量评审问题：\n${reflection.issues.join("\n")}\n\n改进建议：\n${reflection.suggestions.join("\n")}\n\n请根据以上问题与建议，输出优化后的第一幕分镜脚本。`;
    const llmOut = await callLLM(env, [{ role: "system", content: OPTIMIZE_SYSTEM }, { role: "user", content: user }], 0.6);
    model = llmOut.model;
    const raw = parseJsonLoose(llmOut.content);
    const optimizedBoard = normalizeBoard(Array.isArray(raw) ? raw : raw.board);
    const summary = typeof raw.summary === "string" ? raw.summary : (Array.isArray(raw) ? "已根据评审建议优化分镜" : "");
    const newChecks = checkStructure(optimizedBoard);
    sseEvent(controller, encoder, "stage", {
      step: "optimize", status: "done", summary,
      optimizedCount: optimizedBoard.length,
      optimizedDuration: newChecks.totalDuration,
      issuesBefore: checks.issues.length,
      issuesAfter: newChecks.issues.length,
      passed: newChecks.passed,
      model,
    });
    return { optimizedBoard, newChecks, summary, model };
  } catch (e) {
    sseEvent(controller, encoder, "stage", { step: "optimize", status: "failed", message: `优化失败：${e.message}（保留原版分镜）` });
    return { optimizedBoard: board, newChecks: checks, summary: "", model: "", failed: true };
  }
}

/* ==================== 计划生成与修正 ==================== */
async function buildPlan(env, goal, memoryText) {
  const user = `用户目标：${goal}\n${memoryText ? `用户的创作记忆（偏好）：${memoryText}` : ""}`;
  try {
    const { content } = await callLLM(env, [
      { role: "system", content: PLAN_SYSTEM },
      { role: "user", content: user },
    ], 0.4);
    const raw = parseJsonLoose(content);
    let steps = Array.isArray(raw.steps) ? raw.steps.filter((s) => s && TOOL_WHITELIST.includes(s.action)) : [];
    // 去重
    steps = steps.filter((s, i) => steps.findIndex((x) => x.action === s.action) === i);
    // 自动补齐关键步骤
    if (!steps.some((s) => s.action === "gen_outline")) steps.push({ action: "gen_outline", note: "生成三幕大纲" });
    if (!steps.some((s) => s.action === "gen_board")) steps.push({ action: "gen_board", note: "生成第一幕分镜脚本" });
    // 依赖顺序修正：gen_outline 必须在 gen_board 前；check_structure 必须在 gen_board 后
    const fixed = [];
    const out = steps.find((s) => s.action === "gen_outline");
    const brd = steps.find((s) => s.action === "gen_board");
    const chk = steps.find((s) => s.action === "check_structure");
    const pre = steps.filter((s) => s.action !== "gen_outline" && s.action !== "gen_board" && s.action !== "check_structure");
    if (pre.length) fixed.push(...pre);
    if (out) fixed.push(out);
    if (brd) fixed.push(brd);
    if (chk) fixed.push(chk);
    return { steps: fixed, adjusted: JSON.stringify(steps) !== JSON.stringify(fixed), modelPlan: raw };
  } catch {
    // 规划失败兜底：默认计划
    return {
      steps: [
        { action: "lookup_trend", note: "查询爆款题材热度" },
        { action: "search_materials", note: "搜索创作参考素材" },
        { action: "gen_outline", note: "生成三幕大纲" },
        { action: "gen_board", note: "生成第一幕分镜脚本" },
        { action: "check_structure", note: "检查分镜结构规范" },
      ],
      adjusted: false,
      modelPlan: null,
      fallback: true,
    };
  }
}

/* ==================== 主入口 ==================== */
export async function onRequest(context) {
  if (context.request.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "仅支持 POST 请求" }), {
      status: 405,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  return onRequestPost(context);
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return new Response(JSON.stringify({ ok: false, error: "仅支持 JSON 请求" }), {
      status: 415, headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return new Response(JSON.stringify({ ok: false, error: "请求体过大" }), {
      status: 413, headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ ok: false, error: "请求体不是合法 JSON" }), {
      status: 400, headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  const goal = typeof body.goal === "string" ? body.goal.trim() : "";
  if (goal.length < 4) {
    return new Response(JSON.stringify({ ok: false, error: "创作目标至少 4 个字" }), {
      status: 400, headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  const memory = Array.isArray(body.memory) ? body.memory.filter((m) => typeof m === "string" && m.trim()) : [];
  const memoryText = memory.map((m) => `· ${m}`).join("\n");

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // ===== P: Plan（多节点规划，Plan-And-Execute） =====
        sseEvent(controller, encoder, "stage", { step: "plan", status: "running", message: "Agent 正在规划创作路径…" });
        const planResult = await buildPlan(env, goal, memoryText);
        const plan = planResult.steps.map((s, i) => ({ id: i + 1, ...s, status: "pending" }));
        sseEvent(controller, encoder, "stage", {
          step: "plan", status: "done", plan,
          adjusted: planResult.adjusted, fallback: !!planResult.fallback,
          message: planResult.adjusted ? "Agent 修正了步骤依赖顺序（大纲必须先于分镜）" : "计划已确认",
        });

        let outline = null;
        let board = null;
        let checks = null;
        let outlineModel = "";
        let boardModel = "";
        const toolLogs = [];
        const reactLogs = { gen_outline: [], gen_board: [] };

        // ===== E: Execute（每节点 ReAct） =====
        for (const step of plan) {
          sseEvent(controller, encoder, "stage", { step: "tool", tool: step.action, status: "running", message: `执行：${step.note || step.action}` });
          try {
            if (step.action === "lookup_trend") {
              sseEvent(controller, encoder, "stage", { step: "react", tool: step.action, round: 0, phase: "reason", text: "规划决策：先定位爆款题材方向" });
              const r = mockLookupTrend(goal);
              toolLogs.push({ tool: "lookup_trend", status: "done", mock: true, summary: r.summary });
              sseEvent(controller, encoder, "stage", { step: "react", tool: step.action, round: 0, phase: "act", text: "调用 lookup_trend" });
              sseEvent(controller, encoder, "stage", { step: "observe", tool: step.action, status: "done", mock: true, summary: r.summary, detail: r.detail });
            } else if (step.action === "search_materials") {
              sseEvent(controller, encoder, "stage", { step: "react", tool: step.action, round: 0, phase: "reason", text: "规划决策：检索参考素材补充灵感" });
              const r = mockSearchMaterials(goal);
              toolLogs.push({ tool: "search_materials", status: "done", mock: true, summary: r.summary });
              sseEvent(controller, encoder, "stage", { step: "react", tool: step.action, round: 0, phase: "act", text: "调用 search_materials" });
              sseEvent(controller, encoder, "stage", { step: "observe", tool: step.action, status: "done", mock: true, summary: r.summary, detail: r.items });
            } else if (step.action === "gen_outline") {
              const obs = toolLogs.filter((l) => l.mock).map((l) => l.summary).join("；");
              const r = await genOutlineReAct(env, controller, encoder, goal, memoryText, obs);
              outline = r.outline;
              outlineModel = r.model;
              reactLogs.gen_outline = r.reactLog;
              toolLogs.push({ tool: "gen_outline", status: "done", mock: false, summary: `大纲已生成${r.fixed ? "（自纠 1 轮后通过）" : ""}：${(outline.logline || "").slice(0, 40)}…` });
              sseEvent(controller, encoder, "stage", { step: "observe", tool: step.action, status: "done", mock: false, summary: "三幕大纲已生成", model: outlineModel });
            } else if (step.action === "gen_board") {
              if (!outline) throw new Error("缺少大纲，无法生成分镜");
              const r = await genBoardReAct(env, controller, encoder, outline, goal, memoryText);
              board = r.board;
              checks = r.checks;
              boardModel = r.model;
              reactLogs.gen_board = r.reactLog;
              toolLogs.push({ tool: "gen_board", status: "done", mock: false, summary: `分镜已生成：${board.length} 个镜头${r.fixed ? "（自纠 1 轮后通过）" : ""}` });
              sseEvent(controller, encoder, "stage", { step: "observe", tool: step.action, status: "done", mock: false, summary: `第一幕分镜已生成（${board.length} 个镜头）`, model: boardModel });
            } else if (step.action === "check_structure") {
              if (!board) throw new Error("缺少分镜，无法检查结构");
              sseEvent(controller, encoder, "stage", { step: "react", tool: step.action, round: 0, phase: "reason", text: "规划决策：对分镜做结构校验" });
              checks = checkStructure(board);
              toolLogs.push({ tool: "check_structure", status: "done", mock: false, summary: checks.passed ? "结构检查通过" : `结构检查发现 ${checks.issues.length} 项问题` });
              sseEvent(controller, encoder, "stage", { step: "react", tool: step.action, round: 0, phase: "act", text: "运行结构检查规则引擎" });
              sseEvent(controller, encoder, "stage", { step: "observe", tool: step.action, status: "done", mock: false, summary: checks.passed ? "结构检查通过" : `发现 ${checks.issues.length} 项问题`, detail: checks.issues });
            }
            const p = plan.find((x) => x.action === step.action);
            if (p) p.status = "done";
          } catch (e) {
            const p = plan.find((x) => x.action === step.action);
            if (p) p.status = "failed";
            toolLogs.push({ tool: step.action, status: "failed", mock: false, summary: e.message });
            sseEvent(controller, encoder, "stage", { step: "error", tool: step.action, message: `步骤失败：${e.message}` });
            throw e;
          }
        }

        if (!outline || !board) throw new Error("Agent 未能产出大纲或分镜");

        // ===== R: Reflect（质量评审） =====
        sseEvent(controller, encoder, "stage", { step: "reflect", status: "running", message: "Agent 正在对产出做质量评审…" });
        let reflection;
        try {
          const user = `大纲：\n${JSON.stringify(outline)}\n\n分镜：\n${JSON.stringify(board)}\n\n结构检查：${JSON.stringify(checks || {})}\n请输出评审 JSON。`;
          const { content } = await callLLM(env, [{ role: "system", content: REFLECT_SYSTEM }, { role: "user", content: user }], 0.3);
          reflection = normalizeReflection(parseJsonLoose(content));
        } catch {
          reflection = {
            score: 0, strengths: ["产出完整，路径可走通"], issues: ["自动评审失败，未获得模型级评价"],
            suggestions: ["可重新生成或手动调整"], fallback: true,
          };
        }
        sseEvent(controller, encoder, "stage", { step: "reflect", status: "done", reflection });

        // ===== O: Optimize（Reflexion 闭环） =====
        const opt = await optimizeBoard(env, controller, encoder, outline, board, checks, reflection);

        // ===== done =====
        sseEvent(controller, encoder, "done", {
          ok: true,
          plan,
          outline,
          board: opt.optimizedBoard,          // 展示版 = 优化版
          originalBoard: board,               // 对比用
          checks: opt.newChecks,
          reflection,
          optimization: {
            summary: opt.summary,
            originalDuration: checks.totalDuration,
            optimizedDuration: opt.newChecks.totalDuration,
            originalIssues: checks.issues.length,
            optimizedIssues: opt.newChecks.issues.length,
            failed: !!opt.failed,
            model: opt.model || boardModel,
          },
          reactLogs,
          toolLogs,
          memoryUsed: memoryText ? memory : [],
        });
      } catch (e) {
        sseEvent(controller, encoder, "error", { message: e.message || "Agent 执行失败" });
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

/* ==================== 规范化 ==================== */
function normalizeOutline(raw) {
  const acts = Array.isArray(raw.acts) && raw.acts.length === 3 ? raw.acts : [];
  return {
    logline: typeof raw.logline === "string" ? raw.logline : "",
    worldview: typeof raw.worldview === "string" ? raw.worldview : "",
    protagonist: raw.protagonist && typeof raw.protagonist === "object"
      ? { name: String(raw.protagonist.name || ""), desc: String(raw.protagonist.desc || "") }
      : { name: "", desc: "" },
    conflict: typeof raw.conflict === "string" ? raw.conflict : "",
    acts: acts.map((a, i) => ({
      title: a && typeof a.title === "string" ? a.title : `第${["一", "二", "三"][i] || i + 1}幕`,
      beats: Array.isArray(a && a.beats) ? a.beats.map((b) => String(b)) : [],
    })),
  };
}

function normalizeBoard(raw) {
  if (!Array.isArray(raw)) throw new Error("分镜数据格式错误");
  return raw
    .filter((r) => r && typeof r === "object")
    .map((r, i) => ({
      id: i + 1,
      scene: String(r.scene || "未指定"),
      scale: String(r.scale || "中景"),
      action: String(r.action || ""),
      dialogue: String(r.dialogue || ""),
      caption: String(r.caption || ""),
      duration: Math.min(10, Math.max(1, Number(r.duration) || 5)),
    }));
}

function normalizeReflection(raw) {
  return {
    score: Math.min(100, Math.max(0, Number(raw.score) || 0)),
    strengths: Array.isArray(raw.strengths) ? raw.strengths.map(String) : [],
    issues: Array.isArray(raw.issues) ? raw.issues.map(String) : [],
    suggestions: Array.isArray(raw.suggestions) ? raw.suggestions.map(String) : [],
    fallback: false,
  };
}
