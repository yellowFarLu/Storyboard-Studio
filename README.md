# 分镜工坊（Storyboard Studio）

一句话故事点子 → 三幕大纲 → 第一幕分镜脚本。面向短剧/短视频创作者的 AI 故事创作工具。

> 笔试实操项目：做一个你认为值得做的 AI 故事创作产品

## 线上地址

- 产品线上链接：**https://storyboard-studio-2026.pages.dev**
- 说明：已接入 DeepSeek（deepseek-chat）真实模型，可直接体验"点子 → 三幕大纲 → 第一幕分镜"完整路径。

## 产品定位

短剧/短视频创作者写分镜耗时且缺少结构化工具。分镜工坊让创作者输入一句话点子，AI 先生成三幕大纲，再产出第一幕的逐镜分镜脚本（场景、景别、画面动作、台词、字幕建议、时长），支持直接编辑、重新生成、复制与导出 Markdown，从 0 到 1 快速验证一个故事是否"值得拍"。

## 功能

- **点子 → 三幕大纲**：输入一句话故事点子，生成世界观、主角、核心冲突与三幕节拍（钩子/升级/反转）
- **大纲 → 第一幕分镜**：将大纲转为 8–12 个镜头的分镜脚本，含场景、景别、画面动作、台词、字幕建议、时长
- **可编辑**：大纲与分镜表格单元格均支持直接编辑；分镜支持增删镜头
- **导出**：一键复制 Markdown / 导出 `.md` 文件
- **容错**：AI 输出 JSON 自动清洗与校验；未配置 API Key 时自动进入内置示例数据（mock）模式，便于预览

## 技术架构

```
浏览器（纯前端静态站，无框架）
   │  POST /api/generate
   ▼
Cloudflare Pages Function（functions/api/generate.js）
   │  OpenAI 兼容接口
   ▼
大模型 API（默认 DeepSeek deepseek-chat，可换 SiliconFlow 等）
```

- 前端：原生 HTML/CSS/JavaScript，单页应用，无构建步骤
- 后端：Cloudflare Pages Functions（Workers 运行时），API Key 存放在 Pages 项目 Secret 环境变量（`LLM_API_KEY`），**前端不暴露密钥**
- 部署：Cloudflare Pages（一个项目同时承载静态站点与 Functions）

## 目录结构

```
storyboard-studio/
├── public/                  # 静态站点（前端）
│   ├── index.html
│   ├── style.css
│   └── app.js
├── functions/
│   └── api/
│       └── generate.js      # LLM API 代理（Pages Function）
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

未配置 `LLM_API_KEY` 时自动使用内置示例数据（mock 模式，界面会标注"演示数据"），可完整体验产品流程。

## 部署到 Cloudflare Pages

```bash
# 1. 登录（浏览器授权一次）
npx wrangler login

# 2. 配置模型 Key（Secret，不写入代码仓库）
npx wrangler pages secret put LLM_API_KEY
# 输入 DeepSeek 等平台的 API Key

# 3. 部署
npm run deploy       # 或 npx wrangler pages deploy public --project-name storyboard-studio
```

部署完成后会输出线上地址，如 `https://storyboard-studio.pages.dev`。

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

## 完成边界（真实可用 vs 未完成）

**真实可用：**

- 点子 → 三幕大纲 → 第一幕分镜的完整生成链路（接入真实大模型 API）
- 大纲与分镜的编辑、重新生成、添加/删除镜头、复制与导出 Markdown

**当前未完成（下一步优先级）：**

1. 第二、三幕的分镜生成（当前以第一幕演示完整路径）
2. 分镜脚本的图片/视频预览与运镜建议
3. 剧本/项目库存储与多人协作
4. 生成结果的流式输出与更细粒度的进度反馈

## AI 参与开发说明

本项目由人类设定产品方向与验收标准，使用 AI 编程助手完成主要代码编写，包括：页面结构与交互、LLM 代理与 JSON 容错解析、mock 数据设计。人工重点处理了：

- 修复 AI 生成的代码中字符串引号未转义导致的语法错误
- 补充模型输出 JSON 的清洗与字段兜底逻辑（应对模型输出不稳定）
- 验证并修正产品交互细节（分镜表编辑约束、时长校验等）

## 安全说明

- API Key 只通过 `wrangler pages secret` 写入 Cloudflare 环境变量，不入库、不出现在前端代码
- 未提交、未暴露任何真实密钥或商业敏感数据
