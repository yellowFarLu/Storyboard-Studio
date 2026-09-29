/**
 * 分镜工坊 - Ask-Human 澄清状态注册表（真实 human-in-the-loop 机制）
 *
 * run.js 在检测到创作信息缺失时发出 `ask` 事件并把 Promise 挂到本注册表，
 * 前端弹窗收集人类回答后调用 /api/agent/answer，answer.js 从注册表找到对应
 * Promise 并 resolve，run.js 的澄清循环继续执行（支持一轮任务内多次澄清）。
 *
 * 说明：本注册表为进程内（isolate 级）状态，单实例部署下可靠；
 * 生产多实例水平扩展时需迁移到 Durable Object（README 已如实标注）。
 */
export const askRegistry = new Map(); // askId -> { resolve, clientRunId, key, question }
