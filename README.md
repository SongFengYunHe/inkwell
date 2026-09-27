# Inkwell

本地优先的 AI 长篇小说生产工作台。核心主张：**只给「大纲 + 每章细纲」，即可自动写完整本书。**

## 当前进度

**M0 · 脚手架与地基 —— 已完成**

- electron-vite + React 19 + TypeScript + Tailwind CSS 4，主进程 / 预加载 / 渲染进程三端打通
- SQLite（better-sqlite3）+ Drizzle ORM；`schema_version` 驱动的迁移
- `project` / `chapter_brief` / `chapter_draft` 三表 CRUD
- 可新建项目、手写总大纲与章节细纲，**重启后数据仍在**（见下方冒烟自检）

**M1 · 最小可用闭环（手动单章）—— 已完成**

- 接入单一 OpenAI 兼容端点（BYOK）；密钥经 Electron `safeStorage` 加密后仅存本地
- 设置页支持预设快速填充（OpenAI / DeepSeek / 通义 / Ollama）、连接测试与启停
- 正文阅读器编辑器：生成 / 续写 / 重写 / 润色 / 停止，流式输出实时上屏
- 按细纲装配上下文（作品设定 + 总大纲 + 本章细纲 + 上一章结尾节选）生成单章，结果按版本落盘
- 工作区改为「章节导航 + 细纲 / 设定与大纲 / 正文」三栏布局

**M1.5 · 一句话成书入口 —— 已完成**

- 新建向导：填一句话灵感 → AI 生成设定 + 总大纲 + 逐章细纲（分批生成、可中断、可续跑）
- 细纲「AI 补全」：按总大纲补全/强化单章细纲，先出建议再由你确认落库

**M2 · 接入层三件套 —— 已完成**

- **RoleRouter**：5 个创作角色（架构 / 写作 / 审稿 / 抽取 / 向量）分别映射到「端点 + 模型」，支持 fallback 链与并发上限
- **用量记账**：每次调用写入 `llm_call`（tokens / 耗时 / 成功失败），设置页有仪表盘
- **官方预设**：OpenAI / DeepSeek / Kimi / 通义 / 智谱 / Gemini / Ollama 一键填充
- **方式 B · MCP Server**：本机 stdio MCP，6 个工具，外部 Agent 用自身免费额度驱动整本创作
- **方式 C · 自定义反代**：自定义请求头 + 严格限速 + 风险确认（未确认不允许保存）
- **任务单桥**：导出 `chapter_0001.task.md`（含完整提示词），把产出的正文粘回即可落盘

## 技术栈

| 层 | 选型 |
|---|---|
| 桌面框架 | Electron 44 |
| 构建 | electron-vite 5 + Vite 7 |
| UI | React 19 + Tailwind CSS 4 + Zustand |
| 数据 | better-sqlite3（N-API）+ Drizzle ORM |
| 校验 | zod（所有 IPC 入参） |
| Agent 接入 | @modelcontextprotocol/sdk（stdio MCP Server） |

## 快速开始

```bash
npm install          # 安装依赖
npm run dev          # 开发模式（热更新）
npm run typecheck    # 类型检查
npm run build        # 构建到 out/
npm run smoke        # 构建并跑一次持久化自检
npm run smoke:llm    # 构建并跑一次「细纲 → 流式生成 → 落盘」端到端自检（本地假端点，无需 API Key）
npm run smoke:mcp    # 构建并以真实 MCP 协议拉起 MCP Server，模拟 Agent 自动写完 5 章
```

> **国内网络**：若 `npm install` 后 Electron 二进制下载失败，先设置镜像再重试：
>
> ```powershell
> $env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
> node node_modules/electron/install.js
> ```

### 持久化自检

```powershell
npx electron . --smoke   # 第一次：写入项目 + 大纲 + 细纲 → FIRST_RUN_OK
npx electron . --smoke   # 第二次：重启后读回校验   → PERSISTENCE_OK
```

自检使用独立的临时 userData 目录，不会污染真实数据。

### 生成链路自检

```powershell
npx electron . --smoke-llm
# 起一个本地 OpenAI 兼容假端点，验证：向导(大纲+细纲) → 按细纲生成 → 续写 → 重写 → 细纲扩写
#   全部通过时输出 PIPELINE_OK
```

### MCP 协议自检

```powershell
npx electron . --smoke-mcp
# 以真实 MCP 协议（stdio）拉起 out/main/mcp.js，扮演外部 Agent 走
#   status → next_task → save_draft ×5，并校验落盘与进度推进 → MCP_PIPELINE_OK
```

### 上手流程

1. 书架右上「设置」→「官方 API」填 Base URL / 模型名 / API Key →「测试连接」→「保存」
2. 书架新建项目：**填了一句话灵感就会自动生成设定、大纲与全部章节细纲**
3. 工作区「细纲」Tab 可逐章微调，也能点「AI 补全本章细纲」
4. 切到「正文」Tab → 点「生成正文」；不满意可「重写」，写短了可「续写」，文字毛糙可「润色」

#### 用外部 Agent 零成本跑完整本

1. 先执行一次 `npm run build` 生成 `out/main/mcp.js`
2. 在设置页「Agent 模式（MCP）」复制给出的 `mcpServers` 配置，粘贴到 Agent（TRAE WorkBuddy / Claude Code / Cursor）的 MCP 配置里
3. 让 Agent 循环调用 `inkwell_next_task` → 生成 → `inkwell_save_draft`，直到 `done: true`

## 目录结构

```
src/
├─ main/                 # Electron 主进程
│  ├─ index.ts           # 入口：初始化 DB、建窗、注册 IPC
│  ├─ smoke.ts           # --smoke 持久化自检
│  ├─ smoke-llm.ts       # --smoke-llm 生成链路自检
│  ├─ smoke-mcp.ts       # --smoke-mcp MCP 协议自检
│  ├─ db/                # schema / migrations / client / repositories
│  ├─ providers/         # ChatProvider 抽象 + OpenAI 兼容实现 + 接入配置
│  ├─ llm/               # invoke(路由+记账) / route / usage / context / generate / wizard / brief
│  ├─ mcp/               # MCP Server（stdio）入口与工具实现
│  ├─ bridge/            # 任务单桥（导出 task.md）
│  ├─ prompts/           # 内置提示词模板
│  ├─ security/          # safeStorage 密钥加密
│  └─ ipc/               # IPC handlers（zod 校验）
├─ preload/              # contextBridge 白名单 API
├─ renderer/src/
│  ├─ pages/             # 书架 / 工作区 / 设置
│  ├─ components/        # 章节导航 / 细纲 / 大纲 / 正文 / 设置各面板
│  └─ stores/            # zustand
└─ shared/               # 跨进程共享的类型与 IPC 契约
scripts/                 # Git 每轮提交与安全回滚脚本
```

## Git 工作流：每轮自动提交 + 安全回滚

每一轮开发结束都走一次「提交 + 快照」，任何一轮都可安全回滚：

```powershell
# 提交本轮改动，并自动打 snapshot/<时间>-<短SHA> 快照标签
powershell -File scripts/git-round.ps1 -Message "M1: 单章生成闭环"

# 需要时回滚到某个快照（回滚前会自动备份当前状态为 rescue/*，动作可逆）
powershell -File scripts/git-rollback.ps1 -Tag snapshot/20260927-120000-abc1234

# 查看所有快照
git tag -l "snapshot/*" --sort=-creatordate
```

回滚机制的安全性来自：**回滚前先把当前 HEAD 备份成 `rescue/<时间>-<SHA>` 标签**，
因此没有不可恢复的操作——回滚错了可以再 `git reset --hard rescue/...` 回来。

## 许可

待定