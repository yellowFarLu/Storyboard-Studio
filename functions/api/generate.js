/**
 * 分镜工坊 - LLM API 代理（Cloudflare Pages Function）
 *
 * 职责：
 * 1. 接收前端的生成请求（outline 三幕大纲 / storyboard 分镜脚本）
 * 2. 组装 prompt，转发到 OpenAI 兼容的 LLM API（默认 DeepSeek）
 * 3. 解析并校验模型输出 JSON，做容错处理
 * 4. 未配置 LLM_API_KEY 时返回内置示例数据（mock 模式，isMock: true）
 *
 * 安全说明：
 * - API Key 只存放在 Pages 项目的 Secret 环境变量中（LLM_API_KEY），
 *   前端不可见，也不会写入代码仓库。
 * - 仅允许 POST；限制请求体大小；对上游错误做兜底返回。
 */

const MAX_BODY_BYTES = 64 * 1024; // 64KB

const SYSTEM_OUTLINE = `你是一位资深的短剧编剧与策划。你的任务是根据创作者的一句话故事点子，产出一份可直接指导分镜创作的短剧三幕大纲。
要求：
- 快节奏、强钩子、反转合理，符合短视频竖屏短剧（单集1-2分钟）的叙事习惯。
- 世界观、人物、冲突都要具体、有画面感，避免空泛套话。
- 严格只输出一个 JSON 对象，不要输出任何其他文字、解释或 markdown 代码块标记。

输出 JSON 结构如下：
{
  "logline": "一句话故事梗概",
  "worldview": "世界观设定（1-2句）",
  "protagonist": { "name": "主角名", "desc": "身份与性格特征（1-2句）" },
  "conflict": "核心冲突（1-2句）",
  "acts": [
    { "title": "第一幕·钩子", "beats": ["节拍1", "节拍2", "节拍3"] },
    { "title": "第二幕·升级", "beats": ["节拍1", "节拍2", "节拍3"] },
    { "title": "第三幕·反转", "beats": ["节拍1", "节拍2", "节拍3"] }
  ]
}`;

const SYSTEM_STORYBOARD = `你是一位专业的短视频短剧分镜师。根据给定的三幕大纲，为【第一幕】撰写可直接拍摄的分镜脚本。
要求：
- 竖屏 9:16 短视频，单集时长约 60-90 秒，全镜头总时长控制在 60-90 秒。
- 每个镜头 3-8 秒；开场前 3 秒必须有强钩子（冲突、悬念或反转苗头）。
- 台词口语化、短句；字幕建议简洁有力、能抓眼球。
- 景别只用：远景 / 全景 / 中景 / 近景 / 特写。
- 严格只输出一个 JSON 数组，不要输出任何其他文字、解释或 markdown 代码块标记。

输出 JSON 数组，每个元素结构：
{
  "scene": "场景地点",
  "scale": "景别",
  "action": "画面动作描述（具体、可拍摄）",
  "dialogue": "台词（无台词则为空字符串）",
  "caption": "字幕建议",
  "duration": 5
}
数组长度为 8-12 个镜头。`;

/** 从模型输出中提取并解析 JSON（容忍 markdown 代码块包裹） */
function parseJsonLoose(text) {
  if (!text || typeof text !== "string") {
    throw new Error("模型返回为空");
  }
  let s = text.trim();
  // 去掉 ```json ... ``` 代码块
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // 截取第一个 { 或 [ 到最后一个 } 或 ]
  const firstOpen = s.search(/[{[]/);
  const lastClose = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  if (firstOpen === -1 || lastClose <= firstOpen) {
    throw new Error("模型输出中未找到有效 JSON");
  }
  s = s.slice(firstOpen, lastClose + 1);
  return JSON.parse(s);
}

/** 规范化大纲结构，字段缺失时给出兜底 */
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

/** 规范化分镜数组 */
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

/** 内置示例数据（mock 模式，无 API Key 时使用，便于本地预览与演示） */
function mockResult(type) {
  if (type === "outline") {
    return {
      logline: "被裁的程序员老周继承了一家濒临倒闭的影视公司，必须在30天内做出爆款短剧，否则公司将被对家收购。",
      worldview: "当代都市，短视频内容行业。传统影视公司被流量时代碾压，爆款逻辑与艺术坚持激烈碰撞。",
      protagonist: { name: "老周", desc: "38岁失业程序员，冷静理性，不懂创作却擅长数据分析和拆解爆款公式。" },
      conflict: "用数据逻辑做创作 vs 内容创作本身的反直觉；公司存亡与个人尊严的双重压力。",
      acts: [
        { title: "第一幕·钩子", beats: ["老周收到裁员通知的当天，接到舅舅电话被告知继承影视公司", "到公司发现账上只剩3万、核心编剧集体离职", "对家老板当面嘲讽：三个月内买下公司，让老周滚蛋"] },
        { title: "第二幕·升级", beats: ["老周用 A/B 测试和数据分析重写剧本，第一集意外小爆", "爆款引发对家打压：挖角、断流、抄袭风波", "内部矛盾爆发：老编剧拒绝按数据改戏，团队濒临解散"] },
        { title: "第三幕·反转", beats: ["老周发现对家爆款的底层数据造假，掌握关键证据", "他放弃用证据要挟，转而做出一部真正打动人的作品", "剧集大爆，公司保住了，老周也明白了创作的本质"] },
      ],
    };
  }
  return [
    { scene: "写字楼工位", scale: "近景", action: "老周盯着屏幕上红色“优化”按钮，咖啡杯重重砸在桌上", dialogue: "第38次优化，还是过不了面审。", caption: "程序员的天塌了", duration: 4 },
    { scene: "工位", scale: "特写", action: "手机震动，老周看到来电显示“舅舅”，犹豫后接起", dialogue: "喂？……什么？继承影视公司？", caption: "命运的转折", duration: 4 },
    { scene: "废弃影视公司办公室", scale: "全景", action: "老周走进堆满杂物的办公室，几个员工面面相觑，墙上挂满泛黄海报", dialogue: "这就是我的公司？", caption: "新老板上任", duration: 5 },
    { scene: "办公室", scale: "中景", action: "财务递上报表，老周翻看，脸色越来越难看", dialogue: "账上……就剩3万了？", caption: "钱呢？！", duration: 4 },
    { scene: "办公室", scale: "近景", action: "编剧团队集体收拾东西准备离开，老周伸手拦住", dialogue: "等等！给我三天时间，我会证明这家公司还有救。", caption: "别走！", duration: 5 },
    { scene: "办公室白板前", scale: "中景", action: "老周在白板上写满数据公式和流量曲线，员工们围观", dialogue: "爆款不是玄学，是数据。", caption: "程序员式创作", duration: 6 },
    { scene: "办公室", scale: "特写", action: "老周按下发布键，屏幕上播放量数字疯狂跳动", dialogue: "破百万了！", caption: "第一集爆了", duration: 5 },
    { scene: "对家公司大楼", scale: "全景", action: "对家老板把手机狠狠拍在桌上，冷笑", dialogue: "有点意思……那就玩大点。", caption: "麻烦来了", duration: 5 },
  ];
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // 只接受 JSON POST
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return json({ ok: false, error: "仅支持 JSON 请求" }, 415);
  }
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return json({ ok: false, error: "请求体过大" }, 413);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "请求体不是合法 JSON" }, 400);
  }

  const type = body && body.type;
  if (type !== "outline" && type !== "storyboard") {
    return json({ ok: false, error: "type 必须为 outline 或 storyboard" }, 400);
  }
  if (type === "outline") {
    const idea = typeof body.idea === "string" ? body.idea.trim() : "";
    if (!idea || idea.length < 4) return json({ ok: false, error: "故事点子至少 4 个字" }, 400);
    if (idea.length > 2000) return json({ ok: false, error: "故事点子过长" }, 400);
  }
  if (type === "storyboard") {
    const outline = body.outline;
    if (!outline || typeof outline !== "object") return json({ ok: false, error: "缺少大纲数据" }, 400);
  }

  // mock 模式：未配置 key 时返回示例数据
  const apiKey = env.LLM_API_KEY || "";
  if (!apiKey) {
    return json({ ok: true, data: mockResult(type), isMock: true, model: "mock" });
  }

  const apiBase = (env.LLM_API_BASE || "https://api.deepseek.com/v1").replace(/\/+$/, "");
  const model = env.LLM_MODEL || "deepseek-chat";

  let messages;
  if (type === "outline") {
    messages = [
      { role: "system", content: SYSTEM_OUTLINE },
      { role: "user", content: `故事点子：${body.idea}\n目标：竖屏短剧第一集的三幕大纲。` },
    ];
  } else {
    messages = [
      { role: "system", content: SYSTEM_STORYBOARD },
      { role: "user", content: `三幕大纲：\n${JSON.stringify(body.outline, null, 2)}\n请为第一幕输出分镜脚本。` },
    ];
  }

  let upstream;
  try {
    const resp = await fetch(`${apiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.8,
        max_tokens: 2048,
        stream: false,
      }),
    });

    const text = await resp.text();
    if (!resp.ok) {
      return json({ ok: false, error: `模型服务错误(${resp.status}): ${text.slice(0, 300)}` }, 502);
    }
    const data = JSON.parse(text);
    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) {
      return json({ ok: false, error: "模型未返回内容" }, 502);
    }
    upstream = content;
  } catch (e) {
    return json({ ok: false, error: `调用模型服务失败：${e.message}` }, 502);
  }

  // 解析并规范化模型输出
  try {
    const raw = parseJsonLoose(upstream);
    const data = type === "outline" ? normalizeOutline(raw) : normalizeBoard(raw);
    const usage = { input_tokens: 0, output_tokens: 0 };
    return json({ ok: true, data, isMock: false, model });
  } catch (e) {
    return json({ ok: false, error: `AI 输出解析失败：${e.message}（可点击"重新生成"重试）` }, 502);
  }
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
