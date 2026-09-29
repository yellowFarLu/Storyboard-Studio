# 分镜工坊（Storyboard Studio）

一句话创作目标 → Agent 自主规划 → 三幕大纲 → 第一幕分镜脚本。面向短剧/短视频创作者的 **AI 创作 Agent**。

> 笔试实操项目：做一个你认为值得做的 AI 故事创作产品

## 线上地址

- 产品线上链接：**https://storyboard-studio-2026.pages.dev**
- 说明：已接入 DeepSeek（deepseek-chat）真实模型，可直接体验"目标 → Agent 全流程 → 大纲 → 分镜"完整路径。

## 产品定位

短剧/短视频创作者写分镜耗时且缺少结构化工具。分镜工坊把"从创意到分镜"交给一个 AI Agent：输入一句话创作目标，Agent 按 PERO 架构工作：Plan（LLM 多节点规划）→ Execute（每个节点以 ReAct 方式执行：Reason→Act→Observe，生成类节点经规则校验不合格即交回 LLM 自纠）→ Reflect（LLM 质量评审）→ Optimize（基于反思优化分镜并再次校验），产出可编辑的三幕大纲与第一幕逐镜分镜脚本，从 0 到 1 快速验证一个故事是否"值得拍"。

## 问题定义与关键选择

**目标用户**：个人/小团队的短剧与竖屏短视频创作者（短剧是目前平台补贴与广告变现的热点赛道）。

**核心问题**：从"一句话点子"到"可开拍的分镜表"是全流程最耗时、最缺工具的环节——既要故事结构（三幕、反转），又要拍摄语言（镜头、景别、时长、字幕）。多数人靠纯手写或套模板，缺乏结构与节奏校验。

**关键选择（取舍记录）**：

| 选择 | 为什么这样选 | 放弃了什么 |
|---|---|---|
| 短剧分镜方向 | 热点赛道、产出结构化（表格）、一条路径可在笔试时限内走通 | 动画/漫画/互动叙事（需要额外生成能力） |
| Agent 形态（PERO） | 体现 AI 的规划与反思能力，过程可见、可被追问，贴合"AI 如何参与产品"考察点 | 单次"点子→分镜"直出（更快但无过程价值） |
| 纯前端 + Cloudflare Pages Functions | 0 服务器成本、免备案、密钥存 Secret 不进前端与仓库 | 自建后端（维护、备案成本） |
| 第一幕分镜 | 完整走通"一条重要用户路径"，文档明确"不需要成片" | 二、三幕分镜、画面预览（列入下一步） |
| 工具 Mock | 笔试时限内无真实数据源凭据；按文档要求如实标注 | 真实搜索/热度 API（列入下一步） |

## Agent 能力（PERO 架构）

```
用户目标 + 记忆
   │
   ▼
P  Plan            LLM 生成创作计划（步骤动作白名单；Worker 校验并修正依赖顺序）
   │
   ▼
E  Execute(ReAct)  每个节点以 ReAct 执行：
                   生成类节点（大纲/分镜）→ LLM 产出 → 规则校验(Observe)
                   → 不合格交回 LLM 自纠（Reason→Act）→ 再校验，最多自纠 1 轮
                   工具节点（热度/素材/结构检查）→ 调用 → 结果观察
   │
   ▼
R  Reflect         LLM 对大纲+分镜+结构检查做质量评审（评分/优点/问题/改进建议）
   │
   ▼
O  Optimize        基于反思的问题与建议，LLM 产出优化版分镜并再次结构校验
                   （Reflexion 闭环；前端提供 原版/优化版 对比）
   │
   ▼
   产出：三幕大纲 + 第一幕分镜（原版+优化版）+ 结构检查报告 + 反思报告
```

- **记忆**：用户创作偏好（localStorage 本地模拟长期记忆）注入规划与生成 Prompt，支持增删；未接数据库/向量记忆（已标注）
- **工具注册表**：

| 工具 | 真实/ Mock | 说明 |
|---|---|---|
| 题材热度查询 lookup_trend | **Mock** | 内置示例数据，未接真实数据源 |
| 素材搜索 search_materials | **Mock** | 内置示例素材库，未接真实搜索引擎 |
| 大纲生成 gen_outline | 真实 | DeepSeek 大模型 |
| 分镜生成 gen_board | 真实 | DeepSeek 大模型 |
| 结构检查 check_structure | 真实 | 本地规则引擎（镜头数/总时长/景别/钩子/台词密度） |

- **过程可见**：前端实时展示计划步骤状态、工具调用日志（Mock 徽标）、ReAct 循环轨迹（每个生成节点的 Reason→Act→Observe 与自纠轮次）、反思报告、优化对比条（原版/优化版切换）

## 功能

- **Agent 全流程（PERO）**：一句话目标 → 规划 → 执行（ReAct 自纠）→ 反思 → 优化 → 产出大纲与分镜（原版/优化版）
- **可编辑**：大纲与分镜表格单元格直接编辑；分镜支持增删镜头
- **任务历史**：最近任务与产出持久化到 localStorage，刷新页面可恢复查看；运行中断标记「已中断」并可一键重新生成
- **导出**：一键复制 Markdown / 导出 `.md`（含 Agent 质量评审分）
- **容错**：AI 输出 JSON 自动清洗与校验；规划失败自动使用默认计划；反思失败自动兜底
- **产品体验（产品经理视角打磨）**：首屏「关于本产品」说明（为什么做/目标用户/关键取舍/AI 参与）；未开工空状态引导；分镜表 ↔ 「脚本预览」可读剧本一键切换；编辑/增删镜头后结构检查实时刷新；导出 JSON（含大纲/分镜/校验/评审/优化，供后续制作工具接入）
- **业界对标能力（调研 LTX Studio / Boords / StudioBinder / 海马轻帆后补充）**：
  - **运镜字段**（对标 LTX Shot Breakdown 的 camera direction、Boords Shot Specs）：分镜表新增「运镜」列（固定/推/拉/摇/移/跟/升/降/环绕/手持），生成 prompt 强制输出、后端结构与前端编辑均白名单校验、脚本预览/Markdown/CSV 全链路携带
  - **场景分组统计**（对标 Boords Shot List 场景聚合、海马轻帆场次统计）：按场景聚合镜头数与时长，供拍摄计划参考
  - **导出 CSV**（对标 Boords spreadsheet export）：分镜转拍摄表（含运镜），Excel 可直接打开
- **密钥安全**：API Key 仅存于 Pages Secret，前端与仓库均不可见

## 技术架构

```
浏览器（纯前端静态站，无框架）
   │  POST /api/agent/run（SSE 流式事件）
   ▼
Cloudflare Pages Function（functions/api/agent/run.js）
   │  PERO：plan → execute（每节点 ReAct + 工具）→ reflect → optimize
   ▼
大模型 API（默认 DeepSeek deepseek-chat，可换 SiliconFlow 等）
```

- 前端：原生 HTML/CSS/JavaScript，单页应用，无构建步骤；fetch + ReadableStream 手工解析 SSE 帧
- 后端：Cloudflare Pages Functions（Workers 运行时），API Key 存放于 Secret 环境变量（`LLM_API_KEY`），**前端不暴露密钥**
- 部署：Cloudflare Pages（一个项目同时承载静态站点与 Functions）

## 技术选型与版本（已核实）

| 组件 | 选型 | 版本/依据 |
|---|---|---|
| 运行时 | Node.js | 22.23.2（本机实测） |
| 包管理 | npm | 10.9.8（本机实测） |
| 部署工具 | wrangler（Cloudflare CLI） | 4.142.0（npm 安装） |
| 托管 | Cloudflare Pages + Pages Functions | 项目 storyboard-studio-2026，production branch=main |
| 大模型 | DeepSeek deepseek-chat | OpenAI 兼容接口，`LLM_API_BASE=https://api.deepseek.com/v1` |
| 前端 | 原生 HTML/CSS/JS 单页 | 零构建依赖 |

> 结构与节奏参数（镜头数 8-12、单集时长 60-90s、每镜 3-8s、景别白名单、纯画面镜头占比阈值等）全部集中在 `functions/api/agent/run.js` 顶部常量与系统提示中，可调参数便于实验，不散落各处。

## 目录结构

```
storyboard-studio/
├── public/                  # 静态站点（前端）
│   ├── index.html           # Agent 工作台页面
│   ├── style.css
│   └── app.js               # SSE 解析、Agent 流程、记忆面板
├── functions/
│   └── api/
│       ├── generate.js      # 基础生成接口（大纲/分镜）
│       └── agent/
│           └── run.js       # Agent 接口：PERO 循环 + 工具注册表 + SSE
├── wrangler.toml            # Pages 配置（vars: LLM_API_BASE / LLM_MODEL）
├── package.json
└── README.md
```

## 本地运行

前置要求：Node.js ≥ 18。

```bash
npm install          # 安装 wrangler
npm run dev          # 启动本地服务 http://localhost:8788
```

- 未配置 `LLM_API_KEY` 时，Agent 的工具（Mock）与结构检查可演示，LLM 生成步骤会明确报错提示
- 本地联调可将 Key 写入项目根 `.dev.vars`（已被 .gitignore 排除，不入库）

## 部署到 Cloudflare Pages

```bash
# 1. 登录（浏览器授权一次）
npx wrangler login

# 2. 配置模型 Key（Secret，不写入代码仓库）
npx wrangler pages secret put LLM_API_KEY
# 输入 DeepSeek 等平台的 API Key

# 3. 部署
npx wrangler pages deploy public --project-name storyboard-studio-2026 --branch main
```

部署完成后会输出线上地址，如 `https://storyboard-studio-2026.pages.dev`。

### 更换模型（可选）

`wrangler.toml` 中可配置 OpenAI 兼容接口：

```toml
[vars]
LLM_API_BASE = "https://api.deepseek.com/v1"        # DeepSeek 默认
LLM_MODEL = "deepseek-chat"
# 例：换 SiliconFlow 免费模型
# LLM_API_BASE = "https://api.siliconflow.cn/v1"
# LLM_MODEL = "Qwen/Qwen2.5-7B-Instruct"
```

## 完成边界（真实可用 vs Mock vs 未完成）

**真实可用：**

- PERO 全循环（LLM 多节点规划、真实大纲/分镜生成 + ReAct 自纠、本地规则结构检查、LLM 质量反思、Reflexion 优化闭环与原版/优化版对比）
- SSE 过程实时展示；大纲/分镜编辑、增删镜头、复制与导出 Markdown
- 任务历史：localStorage 持久化任务快照，刷新恢复、中断标记、重新生成（服务端无任务队列，属本地持久化）

**Mock（已在前端与本文档明确标注）：**

- 题材热度查询、素材搜索：内置示例数据，未接真实数据源
- 创作记忆：localStorage 本地模拟，未接数据库/向量记忆

**当前未完成（下一步优先级）：**

1. 第二、三幕的分镜生成（当前以第一幕演示完整路径）
2. 真实素材检索（接入搜索/资料 API 替换 Mock）
3. 跨会话云端记忆（接入向量存储，实现"记得用户所有历史创作"）
4. 分镜脚本的图片/视频预览与运镜建议
5. Agent 反思后的自动迭代优化（Reflexion 闭环）

## 验证记录（本地 + 线上实测）

**本地（localhost:8788）：**

- 首页 HTTP 200；Agent 全流程 SSE 事件序列完整：`plan → lookup_trend → search_materials → gen_outline → gen_board → check_structure → reflect → done`
- 示例"菜市场卖鱼的姑娘其实是隐退的顶级大厨，前东家来踢馆"：真实生成 12 镜头分镜，结构检查发现 1 项问题（总时长 51s 低于 60s 下限），LLM 质量评审 72/100（含具体优点/问题/改进建议）
- 示例"便利贴"题材：真实生成 12 镜头分镜 + 结构检查 1 项问题 + 真实评审成功
- 记忆注入生效：`memoryUsed:["喜欢强反转结局"]` 出现在最终事件
- 任务历史实测：任务完成后刷新页面，产出（大纲/分镜/评审）完整恢复，徽标显示「已恢复」；运行中刷新，任务标记「已中断」并保留已生成部分，可一键重新生成

**线上（https://storyboard-studio-2026.pages.dev）：**

- 首页 HTTP 200（约 7.9KB）；`POST /api/agent/run` 返回 `text/event-stream`，完整 15 个事件、真实模型生成大纲与 12 镜头分镜
- 部署修正记录：Pages Functions 路由 = 函数文件路径（`functions/api/agent/run.js` ↔ `/api/agent/run`）；非交互终端部署需 `script -q /dev/null` 包装；需 `--branch main` 才绑定生产环境

## 测试记录（正向/逆向用例，本地 + 线上实测）

**正向（通过，本地+线上实测）：** 完整 PERO 流程（Plan 规划/Execute ReAct 自纠/Reflect/Optimize）；记忆注入生效；任务历史恢复（含优化条/ReAct 轨迹）；原版/优化版 tabs 切换；脚本预览切换（可读剧本渲染）；导出 JSON（含大纲/分镜/校验/评审/优化）；复制 Markdown；导出 .md；编辑单元格/增删镜头后结构检查实时刷新（60s→24s 告警→恢复通过）；刷新后任务恢复；任务历史查看/删除/重新生成；运行中断标记；**运镜字段**：真实模型生成 12 镜含 运镜（固定/推/拉/移/手持，白名单内）、快照数据 10 种运镜前端渲染直通、编辑合法运镜「推」生效且校验通过、脚本预览/Markdown 携带运镜；**场景分组统计**：按场景聚合（筒子楼院子 2镜10s + 周砚秋家中 10镜50s 正确）；**导出 CSV**：生成含运镜列的拍摄表（Excel 可直接打开）。

**逆向（通过，本地+线上实测）：** 空输入/短输入拦截；运行中防并发提交；非法时长（0/11/abc 均校验回退并提示）；非法景别（白名单回退）；**非法运镜（如「航拍」白名单外，还原为原值并提示）**；GET 405、非 JSON 415、非法 JSON 400、空目标 400、短目标 400、超长 body 413；memory 非数组容错；localStorage 损坏自动清理恢复；空分镜导出提示。

**发现并修复的问题：**

1. API 非 POST 请求（GET）原先因 SPA 回退返回 200 HTML —— 已为 `/api/agent/run` 与 `/api/generate` 增加 `onRequest` 拦截，统一返回 405 JSON（本地+线上已验证）
2. localStorage 写入损坏数据时虽被 try/catch 兜底但不清理 —— 已加固为解析失败自动写回合法默认值，避免反复失败
3. PERO v2 升级中：`model` 变量在 for 循环块内声明、循环外引用导致 ReferenceError ×3 —— 已提升为函数级变量；done 事件简版 reactLogs 覆盖前端 SSE 过程收集的详细轨迹 —— 已改为仅在服务端轨迹含 phase 明细时才覆盖
4. 添加镜头（addRow）未刷新结构检查 —— 已补 `refreshChecksLocal()` 与脚本预览联动
5. 空状态引导原先置于隐藏的 Agent 面板内（用户看不到）—— 已移至首屏 hero 区步骤条下方
6. 部署目录误用 `wrangler pages deploy .` 导致静态资源落在 `/public/` 子路径、根路径 404 —— 已改 `deploy public` 并重部署验证

> 说明：复制 Markdown 在自动化测试环境因无用户手势被剪贴板 API 拒绝（权限 granted），代码有失败兜底提示；导出 .md 共用同一 Markdown 生成函数已验证通过。

## 风险与降级（如实说明）

1. **模型输出稳定性**：DeepSeek 输出偶发不合法 JSON，已实现 `parseJsonLoose` 清洗（代码块剥离/截取首个 JSON）与字段兜底
2. **LLM 规划失败**：规划解析失败时自动回退默认计划（题材→素材→大纲→分镜→检查），依赖修正逻辑保证大纲先于分镜
3. **LLM 接口异常**：任一步骤失败时 SSE 推送 `error` 事件并在前端明确提示，不静默降级
4. **反思失败兜底**：Reflect 异常时返回结构化空壳（score:null + 提示语），不影响已生成的大纲/分镜
5. **请求限制**：请求体上限 64KB、超时 100s，防止异常输入打爆资源
6. **Mock 边界**：题材热度/素材搜索为内置示例数据；本地记忆为 localStorage 模拟——均已在前端、本文档、代码注释三处一致标注

## AI 参与开发说明

本项目由人类设定产品方向与验收标准，使用 AI 编程助手完成主要代码编写，包括：Agent 循环（PERO）实现、SSE 协议与前端解析、工具注册表与 Mock 数据、页面交互。人工重点处理了：

- 修复 AI 生成的代码中字符串引号未转义导致的语法错误
- 修正 Pages Functions 路由路径（函数文件路径 ↔ URL 映射）
- 补充模型输出 JSON 的清洗与字段兜底逻辑（应对模型输出不稳定）
- 设计并实现"Agent 修正步骤依赖顺序"（大纲必须先于分镜）与反思失败兜底
- 验证并修正产品交互细节（分镜表编辑约束、时长校验等）

## 安全说明

- API Key 只通过 `wrangler pages secret` 写入 Cloudflare 环境变量，不入库、不出现在前端代码
- 本地 `.dev.vars` 已被 .gitignore 排除
- 未提交、未暴露任何真实密钥或商业敏感数据
