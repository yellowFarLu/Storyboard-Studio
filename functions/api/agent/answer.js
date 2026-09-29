/**
 * 分镜工坊 - 人类澄清回答接口（真实 human-in-the-loop）
 *
 * 前端在收到 run.js 的 `ask` 事件（SSE）后展示澄清弹窗，人类回答后
 * POST 本接口 {clientRunId, askId, answer}，本接口从 askRegistry 找到
 * run.js 挂起的 Promise 并 resolve，Agent 流程继续。
 *
 * 逆向校验：GET 405 / 非 JSON 415 / 坏 JSON 400 / 缺字段 400 /
 * askId 不存在或已超时 404 / clientRunId 不匹配 400。
 */
import { askRegistry } from "../../shared/ask-state.js";

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
  const { request } = context;
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return new Response(JSON.stringify({ ok: false, error: "仅支持 JSON 请求" }), {
      status: 415, headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 64 * 1024) {
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
  const clientRunId = typeof body.clientRunId === "string" ? body.clientRunId : "";
  const askId = typeof body.askId === "string" ? body.askId : "";
  const answer = typeof body.answer === "string" ? body.answer.trim() : "";
  if (!clientRunId || !askId || !answer) {
    return new Response(JSON.stringify({ ok: false, error: "缺少 clientRunId/askId/answer 字段" }), {
      status: 400, headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  const entry = askRegistry.get(askId);
  if (!entry) {
    return new Response(JSON.stringify({ ok: false, error: "澄清不存在或已超时/流程已结束" }), {
      status: 404, headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  if (entry.clientRunId !== clientRunId) {
    return new Response(JSON.stringify({ ok: false, error: "clientRunId 与澄清不匹配" }), {
      status: 400, headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  entry.resolve({ key: entry.key, question: entry.question, answer, answeredBy: "human" });
  return new Response(JSON.stringify({ ok: true, answered: true }), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
