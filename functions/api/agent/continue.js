/**
 * 分镜工坊 - 基于历史分镜续写【第二幕】（Cloudflare Pages Function）
 *
 * 能力：接收 创作目标 + 三幕大纲 + 已完成分镜（来自历史任务恢复），
 *       调用 LLM（DeepSeek）按 act 参数续写【第二幕】或【第三幕】分镜（8-12 镜 / 60-90s），
 *       经本地规则校验（Observe），不合格交回 LLM 自纠最多 1 轮（与 run.js 一致）。
 *
 * 真实能力边界：
 * - gen_act2  续写分镜生成（第二幕/第三幕） → 真实（DeepSeek，ReAct 自纠）
 * - check     分镜结构检查   → 真实（本地规则引擎，与 run.js check_structure 同规则）
 *
 * 安全：与 run.js 一致——仅 POST；JSON；请求体限长；Key 仅存 Secret。
 */

const MAX_BODY_BYTES = 64 * 1024;
const MAX_FIX_ROUNDS = 1;

/* ==================== LLM 调用（与 run.js 同实现） ==================== */
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

/** 容错解析模型输出 JSON（与 run.js 同实现） */
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

/** 归一化分镜数组（与 run.js 同实现） */
function normalizeBoard(raw) {
  if (!Array.isArray(raw)) throw new Error("分镜数据格式错误");
  return raw
    .filter((r) => r && typeof r === "object")
    .map((r, i) => ({
      id: i + 1,
      scene: String(r.scene || "未指定"),
      scale: String(r.scale || "中景"),
      camera: String(r.camera || "固定"),
      action: String(r.action || ""),
      dialogue: String(r.dialogue || ""),
      caption: String(r.caption || ""),
      duration: Math.min(10, Math.max(1, Number(r.duration) || 5)),
    }));
}

/* ==================== 真实工具：分镜结构检查（本地规则引擎，与 run.js 同规则） ==================== */
function checkStructure(board) {
  const issues = [];
  const total = (board || []).reduce((s, r) => s + (Number(r.duration) || 0), 0);
  const count = (board || []).length;
  const validScales = ["远景", "全景", "中景", "近景", "特写"];

  if (count < 8) issues.push(`镜头数偏少（${count} 个），建议 8-12 个以保证节奏`);
  if (count > 12) issues.push(`镜头数偏多（${count} 个），单幕建议控制在 12 个以内`);
  if (total < 60) issues.push(`总时长 ${total}s 低于单幕目标下限 60s，建议补充镜头`);
  if (total > 90) issues.push(`总时长 ${total}s 超过单幕目标上限 90s，建议精简`);
  const noDialogue = (board || []).filter((r) => !(r.dialogue || "").trim()).length;
  if (count > 0 && noDialogue / count > 0.7) issues.push(`纯画面镜头占比 ${Math.round((noDialogue / count) * 100)}%，注意叙事信息密度`);
  const badScale = (board || []).filter((r) => !validScales.includes(r.scale));
  if (badScale.length) issues.push(`存在非法景别：${badScale.map((r) => r.scale).join("、")}`);
  const validCams = ["固定", "推", "拉", "摇", "移", "跟", "升", "降", "环绕", "手持"];
  const badCam = (board || []).filter((r) => r.camera && !validCams.includes(r.camera));
  if (badCam.length) issues.push(`存在非法运镜：${badCam.map((r) => r.camera).join("、")}`);
  const first = (board || [])[0];
  if (!first || (!first.action && !first.dialogue)) issues.push("第二幕第一镜缺少钩子（建议以冲突动作或反常画面开场）");

  return {
    passed: issues.length === 0,
    totalDuration: total,
    shotCount: count,
    issues,
    mock: false,
  };
}

/* ==================== Prompt 模板 ==================== */
function actSystem(act) {
  if (act === "第三幕") {
    return `你是一位专业的短视频短剧分镜师。用户已完成第一幕与第二幕分镜脚本，请基于第二幕结尾与三幕大纲，为【第三幕·反转】续写分镜脚本。
要求：
- 承接第二幕结尾的悬念与危机，完成第三幕的叙事任务「真相揭露、反转落地、情绪释放收束」，结局要给出明确的剧情收口；
- 竖屏9:16，单幕60-90秒，每镜3-8秒；第三幕第一镜前3秒要延续第二幕结尾的钩子；
- 台词口语化、字幕简洁有力（每屏10字内）；场景与人物必须与前两幕一致，不得凭空换人；
- 景别只用 远景/全景/中景/近景/特写；运镜只用 固定/推/拉/摇/移/跟/升/降/环绕/手持（无特殊运镜用固定）。
严格只输出 JSON 数组（8-12个镜头），不要输出任何其他文字：
[{"scene":"场景","scale":"景别","camera":"运镜","action":"画面动作描述","dialogue":"台词（无则空串）","caption":"字幕建议","duration":5}]`;
  }
  return `你是一位专业的短视频短剧分镜师。用户已完成【第一幕】分镜脚本，请基于第一幕结尾与三幕大纲，为【第二幕·升级】续写分镜脚本。
要求：
- 承接第一幕结尾的情境、人物状态与悬念，推进冲突升级（第二幕的叙事任务是「升级压迫、埋设第三幕反转的伏笔」）；
- 竖屏9:16，单幕60-90秒，每镜3-8秒；第二幕第一镜前3秒要延续第一幕结尾的钩子；
- 台词口语化、字幕简洁有力（每屏10字内）；场景与人物必须与第一幕一致，不得凭空换人；
- 景别只用 远景/全景/中景/近景/特写；运镜只用 固定/推/拉/摇/移/跟/升/降/环绕/手持（无特殊运镜用固定）。
严格只输出 JSON 数组（8-12个镜头），不要输出任何其他文字：
[{"scene":"场景","scale":"景别","camera":"运镜","action":"画面动作描述","dialogue":"台词（无则空串）","caption":"字幕建议","duration":5}]`;
}

/* ==================== ReAct 生成第二幕（生成 → 规则校验 → 自纠最多 1 轮） ==================== */
async function genAct2ReAct(env, act, goal, outline, prevBoard, memoryText) {
  const reactLog = [];
  let shots = null;
  let checks = null;
  let model = "";

  for (let round = 0; round <= MAX_FIX_ROUNDS; round++) {
    const isFix = round > 0;
    const user = `创作目标：${goal}\n\n三幕大纲：\n${JSON.stringify(outline || {}, null, 2)}\n\n已完成分镜（供承接）：\n${JSON.stringify(prevBoard, null, 2)}\n${memoryText ? `\n记忆（用户创作偏好）：\n${memoryText}\n` : ""}${isFix ? `\n上一版${act}分镜的结构问题（需修正）：\n${checks.issues.join("\n")}\n请输出修正后的完整${act}分镜 JSON 数组。` : `\n请为${act}输出分镜脚本 JSON 数组。`}`;
    const llmOut = await callLLM(env, [{ role: "system", content: actSystem(act) }, { role: "user", content: user }], 0.8);
    model = llmOut.model;
    shots = normalizeBoard(parseJsonLoose(llmOut.content));

    // Observe
    checks = checkStructure(shots);
    reactLog.push({ round, issues: checks.issues.length });
    if (checks.passed) break;
  }

  return { shots, checks, model, reactLog, fixed: reactLog.length > 1 };
}

/* ==================== 入口 ==================== */
export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "仅支持 POST 请求" }), {
      status: 405,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

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
  if (!Array.isArray(body.board) || !body.board.length) {
    return new Response(JSON.stringify({ ok: false, error: "缺少第一幕分镜（board 需为非空数组）" }), {
      status: 400, headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  const act = body.act === "第三幕" ? "第三幕" : "第二幕";
  const outline = body.outline && typeof body.outline === "object" ? body.outline : null;
  const memory = Array.isArray(body.memory) ? body.memory.filter((m) => typeof m === "string" && m.trim()) : [];
  const memoryText = memory.map((m) => `· ${m}`).join("\n");

  const prevBoard = normalizeBoard(body.board);

  try {
    const { shots, checks, model, reactLog, fixed } = await genAct2ReAct(env, act, goal, outline, prevBoard, memoryText);
    return new Response(JSON.stringify({
      ok: true,
      act,
      shots,
      checks,
      model,
      fixed,
      totalShots: prevBoard.length + shots.length,
      prevCount: prevBoard.length,
      actCount: shots.length,
      reactLog,
    }), { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
  } catch (e) {
    const isModelError = /模型服务错误|模型未返回|未配置/.test(e.message);
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: isModelError ? 502 : 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
