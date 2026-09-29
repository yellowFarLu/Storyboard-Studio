/**
 * 分镜工坊 - 跨会话云端记忆同步（Cloudflare Pages Function + KV）
 *
 * 能力：以「匿名设备 ID」为维度，把任务快照与创作记忆备份到 Cloudflare KV（免费额度），
 *       实现跨会话 / 跨设备的云端恢复。
 *
 * 边界（如实标注）：
 * - 匿名设备 ID 由浏览器生成（localStorage 持久化），无登录/账号体系；不同设备需同一设备 ID 才能互通，
 *   因此跨设备恢复仅在「用户主动沿用同一设备 ID」时成立（演示/备份为主，非完整账号体系）。
 * - 浏览器 localStorage 是本地主数据；KV 是云备份。启动时本地为空且云端有数据时恢复云端。
 *
 * 接口：
 * - GET  /api/sync?device=<id>            拉取该设备的云端快照 { tasks, memory, updatedAt }
 * - POST /api/sync  body { device, tasks, memory }  保存快照（单 key，请求体限长）
 *
 * 安全：仅 POST；JSON；请求体限长；device 长度限制（防滥用）。
 */

const MAX_BODY_BYTES = 256 * 1024; // 任务快照可能含多幕分镜，放宽到 256KB
const MAX_DEVICE_LEN = 64;

function json(res, status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const device = (url.searchParams.get("device") || "").slice(0, MAX_DEVICE_LEN);
  const kv = env.STORY_KV;

  if (request.method === "GET") {
    if (!device) return json(null, 400, { ok: false, error: "缺少 device 参数" });
    try {
      const raw = await kv.get("sync:" + device);
      if (!raw) return json(null, 200, { ok: true, data: null });
      return json(null, 200, { ok: true, data: JSON.parse(raw) });
    } catch (e) {
      return json(null, 500, { ok: false, error: e.message });
    }
  }

  if (request.method !== "POST") {
    return json(null, 405, { ok: false, error: "仅支持 GET/POST" });
  }
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return json(null, 415, { ok: false, error: "仅支持 JSON 请求" });
  }
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return json(null, 413, { ok: false, error: "请求体过大" });
  }
  let body;
  try { body = await request.json(); } catch {
    return json(null, 400, { ok: false, error: "请求体不是合法 JSON" });
  }
  const dev = typeof body.device === "string" ? body.device.trim().slice(0, MAX_DEVICE_LEN) : "";
  if (!dev) return json(null, 400, { ok: false, error: "缺少 device" });
  const tasks = Array.isArray(body.tasks) ? body.tasks : [];
  const memory = Array.isArray(body.memory) ? body.memory.filter((m) => typeof m === "string" && m.trim()) : [];

  try {
    const payload = JSON.stringify({ tasks, memory, updatedAt: Date.now() });
    await kv.put("sync:" + dev, payload);
    return json(null, 200, { ok: true, tasks: tasks.length, memory: memory.length });
  } catch (e) {
    return json(null, 500, { ok: false, error: e.message });
  }
}
