/**
 * 分镜工坊 - Ask-Human 澄清状态注册表（真实 human-in-the-loop 机制）
 *
 * 跨实例可靠版本：澄清状态存储在 Cloudflare KV（强一致 binding ASK_KV）。
 * - run.js 检测到信息缺失时写 `ask:reg:<askId>` 并发出 SSE `ask` 事件，
 *   随后轮询 `ask:ans:<askId>` 等待人类回答；
 * - 前端弹窗收集回答后 POST /api/agent/answer，answer.js 读 reg 校验后写 ans；
 * - run.js 轮询读到 ans 即继续流程（支持一轮任务内多次澄清，≤3 轮）。
 *
 * 相比进程内 Map：生产多实例（多 isolate）下跨请求可靠，
 * 单用户与并发多任务天然隔离（askId 为 UUID）。
 */
export const ASK_REG_PREFIX = "ask:reg:";
export const ASK_ANS_PREFIX = "ask:ans:";

/** 写入澄清登记（answer 侧据此校验存在性与 clientRunId） */
export async function createAsk(env, { askId, clientRunId, rule, timeoutMs }) {
  const ttlSec = Math.max(90, Math.ceil(timeoutMs / 1000) + 120);
  await env.ASK_KV.put(ASK_REG_PREFIX + askId, JSON.stringify({
    clientRunId,
    key: rule.key,
    question: rule.question,
  }), { expirationTtl: ttlSec });
}

/** 读取澄清登记（不存在 = 已超时/已删除/流程已结束） */
export async function readAsk(env, askId) {
  const raw = await env.ASK_KV.get(ASK_REG_PREFIX + askId);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/** 写入人类回答（run 侧轮询读取） */
export async function writeAnswer(env, askId, value) {
  await env.ASK_KV.put(ASK_ANS_PREFIX + askId, JSON.stringify(value), { expirationTtl: 600 });
}

/** 读取人类回答（轮询用） */
export async function readAnswer(env, askId) {
  const raw = await env.ASK_KV.get(ASK_ANS_PREFIX + askId);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/** 删除澄清登记（流程继续/超时后清理） */
export async function deleteAsk(env, askId) {
  try { await env.ASK_KV.delete(ASK_REG_PREFIX + askId); } catch { /* 清理失败不影响主流程 */ }
}
