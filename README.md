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
- **方式 B · MCP Server**：本机 stdio MCP，7 个工具，外部 Agent 用自身免费额度驱动整本创作
- **自定义端点**：除官方预设外，也可接入任意 OpenAI 兼容的第三方端点（默认关闭，需在设置中手动开启）
- **任务单桥**：导出 `chapter_0001.task.md`（含完整提示词），把产出的正文粘回即可落盘

**M3 · 全自动整本 + 一致性记忆 —— 已完成**

- **连写队列**：从任意一章起「连写整本」，逐章跑「装配 → 起草 → 审计 → 记忆」四步状态机
- **断点恢复**：每章每步进度落库 `pipeline_step`；中途停止或崩溃后点「继续连写」即可从断点续跑，已完成步骤自动复用
- **Steer 实时干预**：运行中注入「本章要求 / 禁止项」，对后续章节生效；同时支持暂停、跳过当前章
- **逐章验收开关**：可选「每章生成后暂停」，人工决定「通过，继续」或「重写本章」
- **七个真相文件**：世界状态 / 角色矩阵 / 待处理伏笔 / 章节摘要链 / 支线板 / 时间线 / 资源账本；写作前自动装配进上下文，为长篇一致性兜底
- **记忆回写**：每章落盘后由抽取角色生成摘要、角色状态与伏笔进展，投影到角色矩阵与伏笔台账（支持一键从正文重建）
- **精简审计（14 项确定性维度 + 模型语义审计）**：字数 / Markdown / 标题行 / AI 腔 / 角色覆盖 / 关键事件 / 钩子呼应 / 段落节奏 / 重复句 / 与上章重复 / 口头禅密度 / 收尾段 / 排比堆砌 / 标点规范，另叠加 OOC、设定冲突、时间线、伏笔断线、称谓一致性等语义维度；命中的维度会给出**具体段落序号**
- **记忆面板**：工作区新增「记忆」Tab，可视化七个真相文件与逐章审计报告
- **MCP 同步增强**：`inkwell_next_task` 的上下文自动带上真相文件，新增 `inkwell_memory` 工具，`inkwell_save_draft` 落盘后顺带回写记忆

**M4 · 质量与产出 —— 已完成**

- **一键修复（审计 → 定点修复 → 重审闭环）**：正文工具栏「一键修复」先跑确定性规则，再让审稿模型只改问题句段（长度校验防整章重写），落为新版本并自动重审，界面给出「修复前后评分」对比；无可修项时不新增版本
- **反 AI 味确定性规则**：删除句首套话（总而言之 / 综上所述 / 由此可见…）、压缩重复标点（！！！→！、。。→。）、省略号规范化、叠词压缩（非常非常→非常）、空白整理；另有排比同构检测
- **导出 TXT / MD / DOCX / EPUB**：按卷分章、自动生成目录；未写章节自动跳过并提示；导出目录默认落在「文档 / Inkwell 导出 / 书名」，可一键打开
- **零新增依赖**：DOCX 与 EPUB 的 ZIP 容器由内置写入器生成

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
npm run smoke:m3     # 构建并跑一次 M3 端到端自检（连写整本 / 记忆回写 / 断点续跑 / Steer）
npm run smoke:m4     # 构建并跑一次 M4 端到端自检（一键修复闭环 / 四种格式导出）
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

### 连写与记忆自检

```powershell
npx electron . --smoke-m3
# 起一个本地假端点，跑：向导出细纲 → 连写整本（装配/起草/审计/记忆）
#   → 校验七个真相文件与角色/伏笔投影 → 中途中断 → 从断点续跑写完全本
#   全部通过时输出 M3_PIPELINE_OK
```

### 修复与导出自检

```powershell
npx electron . --smoke-m4
# 覆盖：反 AI 味确定性规则 → 审计可定位段落 → 一键修复（含模型定点修复、重审）
#   → 导出 TXT/MD/DOCX/EPUB（并用内置 ZIP 读取器回读校验容器结构）
#   全部通过时输出 M4_EXPORT_OK
```

### 上手流程

1. 书架右上「设置」→「官方 API」填 Base URL / 模型名 / API Key →「测试连接」→「保存」
2. 书架新建项目：**填了一句话灵感就会自动生成设定、大纲与全部章节细纲**
3. 工作区「细纲」Tab 可逐章微调，也能点「AI 补全本章细纲」
4. 切到「正文」Tab → 点「生成正文」；不满意可「重写」，写短了可「续写」，文字毛糙可「润色」
5. 点「审稿」看多维审计报告（问题会标出段落），再点「一键修复」自动改掉问题并重审
6. 想整本自动写：点顶栏「从第 N 章连写整本」；运行中可「暂停 / 跳过本章 / 停止」，也能下发 Steer 要求
7. 「记忆」Tab 查看七个真相文件与每章审计报告；误删了记忆可点「从正文重建记忆」
8. 顶栏「导出」选择 TXT / MD / DOCX / EPUB，一键成书（分卷 + 目录）

#### 用外部 Agent 零成本跑完整本

1. 先执行一次 `npm run build` 生成 `out/main/mcp.js`
2. 在设置页「Agent 模式（MCP）」复制给出的 `mcpServers` 配置，粘贴到 Agent（TRAE WorkBuddy / Claude Code / Cursor）的 MCP 配置里
3. 让 Agent 循环调用 `inkwell_next_task` → 生成 → `inkwell_save_draft`，直到 `done: true`
4. 需要用既有设定时，可先调 `inkwell_memory` 读取七个真相文件，避免前后矛盾

## 目录结构

```
src/
├─ main/                 # Electron 主进程
│  ├─ index.ts           # 入口：初始化 DB、建窗、注册 IPC
│  ├─ smoke.ts           # --smoke 持久化自检
│  ├─ smoke-llm.ts       # --smoke-llm 生成链路自检
│  ├─ smoke-mcp.ts       # --smoke-mcp MCP 协议自检
│  ├─ smoke-m3.ts        # --smoke-m3 连写/记忆/断点续跑自检
│  ├─ smoke-m4.ts        # --smoke-m4 一键修复 / 四种格式导出自检
│  ├─ db/                # schema / migrations / client / repositories / memory / pipeline
│  ├─ engine/            # 确定性引擎：truth(真相文件) / audit(审计) / memory(回写) / rules(去AI味) / fix(一键修复) / pipeline / run(连写队列)
│  ├─ export/            # 导出引擎：TXT / MD / DOCX / EPUB + 内置 ZIP 写入器
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
│  ├─ components/        # 章节导航 / 细纲 / 大纲 / 正文 / 记忆 / 连写控制条 / 导出对话框 / 设置各面板
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