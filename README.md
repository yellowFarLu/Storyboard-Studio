# 分镜工坊（Storyboard Studio）

一句话创作目标 → Agent 自主规划 → 三幕大纲 → 第一幕分镜脚本。面向短剧/短视频创作者的 **AI 创作 Agent**。

> 笔试实操项目：做一个你认为值得做的 AI 故事创作产品

## 线上地址

- 产品线上链接：**https://storyboard-studio-2026.pages.dev**
- 说明：已接入 DeepSeek（deepseek-chat）真实模型，可直接体验"目标 → Agent 全流程 → 大纲 → 分镜"完整路径。

## 产品定位

短剧/短视频创作者写分镜耗时且缺少结构化工具。分镜工坊把"从创意到分镜"交给一个 AI Agent：输入一句话创作目标，Agent 自主规划（Plan）、分步执行（Execute，含工具调用）、观察结果（Observe）、反思自评（Reflect），产出可编辑的三幕大纲与第一幕逐镜分镜脚本，从 0 到 1 快速验证一个故事是否"值得拍"。

## Agent 能力（PERO 架构）

```
用户目标 + 记忆
   │
   ▼
P  Plan       LLM 生成创作计划（步骤动作白名单；Worker 校验并修正依赖顺序）
   │
   ▼
E  Execute    按计划逐步执行：LLM 生成 + 工具调用（工具结果回填生成上下文）
   │
   ▼
O  Observe    每步执行结果以 SSE 实时推送前端（过程可见、可追溯）
   │
   ▼
R  Reflect    LLM 对大纲+分镜+结构检查做质量评审（评分/优点/问题/改进建议）
   │
   ▼
   产出：三幕大纲 + 第一幕分镜 + 结构检查报告 + 反思报告
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

- **过程可见**：前端实时展示计划步骤状态、工具调用日志（Mock 徽标）、反思报告，类 RAG 检索过程展示

## 功能

- **Agent 全流程**：一句话目标 → 规划 → 执行 → 观察 → 反思 → 产出大纲与分镜
- **可编辑**：大纲与分镜表格单元格直接编辑；分镜支持增删镜头
- **导出**：一键复制 Markdown / 导出 `.md`（含 Agent 质量评审分）
- **容错**：AI 输出 JSON 自动清洗与校验；规划失败自动使用默认计划；反思失败自动兜底
- **密钥安全**：API Key 仅存于 Pages Secret，前端与仓库均不可见

## 技术架构

```
浏览器（纯前端静态站，无框架）
   │  POST /api/agent/run（SSE 流式事件）
   ▼
Cloudflare Pages Function（functions/api/agent/run.js）
   │  PERO 循环：plan → execute（LLM + 工具）→ observe → reflect
   ▼
大模型 API（默认 DeepSeek deepseek-chat，可换 SiliconFlow 等）
```

- 前端：原生 HTML/CSS/JavaScript，单页应用，无构建步骤；fetch + ReadableStream 手工解析 SSE 帧
- 后端：Cloudflare Pages Functions（Workers 运行时），API Key 存放于 Secret 环境变量（`LLM_API_KEY`），**前端不暴露密钥**
- 部署：Cloudflare Pages（一个项目同时承载静态站点与 Functions）

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

- PERO 全循环（LLM 规划、真实大纲/分镜生成、本地规则结构检查、LLM 质量反思）
- SSE 过程实时展示；大纲/分镜编辑、增删镜头、复制与导出 Markdown

**Mock（已在前端与本文档明确标注）：**

- 题材热度查询、素材搜索：内置示例数据，未接真实数据源
- 创作记忆：localStorage 本地模拟，未接数据库/向量记忆

**当前未完成（下一步优先级）：**

1. 第二、三幕的分镜生成（当前以第一幕演示完整路径）
2. 真实素材检索（接入搜索/资料 API 替换 Mock）
3. 跨会话云端记忆（接入向量存储，实现"记得用户所有历史创作"）
4. 分镜脚本的图片/视频预览与运镜建议
5. Agent 反思后的自动迭代优化（Reflexion 闭环）

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
