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

**M5 · 打磨与增强 —— 已完成**

- **深浅双主题**：顶栏一键切换，选择持久化到本地；首次启动跟随系统偏好
- **专注模式**：正文工具栏点「专注」，隐藏顶栏 / 章节导航 / Tab / 提示，只留正文与字数
- **克制动效与空状态引导**：面板与对话框入场淡入；书架空状态给出三步上手引导
- **题材模板扩充至 30 种**：新建项目选题材自动带出推荐章数与文风建议
- **导入 Vela 工程**：书架「导入 Vela 工程」→ 选 `.vela` 目录或 `vela.db`，按表名与列名容错映射（`project_core` / `blueprints` / `drafts`），导入后可直接继续写作
- **打包与体积**：`electron-builder` NSIS 安装包输出到 `release/`；只保留中英文语言包与 win32-x64 原生二进制，安装包 **≈90MB**（目标 ≤120MB）
- **CI 体积看门狗**：GitHub Actions 构建后核对安装包与解包体积，超标即失败

**M6 · 数据根基与生命周期 —— 已完成**

- **三段式存储**：配置与密钥固定留在 `%APPDATA%\inkwell`（它是指向书库的指针，且密钥加密与当前系统用户绑定）；**书库**（数据库 / 备份 / 导出 / 封面）可放在任意磁盘，含中文路径与 U 盘
- **多书库自由切换**：像工作区一样新建 / 挂载 / 切换 / 重命名 / 重新定位 / 移除，各库数据完全隔离
- **引导式迁移向导**：五步流程（说明 → 选目录 → 目录预检 → 执行 → 校验结果）。用 SQLite 官方 `VACUUM INTO` 取一致快照，迁移后逐表比对行数并跑 `integrity_check`，校验通过才**原子切指针**；任一步失败自动清理半成品、指针不变，**全程可中断可回滚**
- **目录预检**：识别 OneDrive / Dropbox / 坚果云 / iCloud 等同步盘与 UNC 网络盘并强警告，命中时自动降级为 `journal_mode=DELETE`（WAL 在同步盘上易损坏）；空间不足直接阻止
- **软删除 + 回收站**：删除一律先进回收站（默认保留 30 天，可选 7/30/90/永久），到期自动清理；恢复时若章节号被占用会自动排到末尾而不覆盖；界面删除后有 **5 秒撤销**
- **自动备份轮转**：保留最近 10 份 + 每天 1 份（7 天）+ 每周 1 份（4 周）；「一键恢复」前会先把当前库再备份一份
- **干净退出**：`before-quit` 顺序化回收——拒绝新写入 → 中断在途 LLM 请求与连写 → 清所有定时器 → `wal_checkpoint(TRUNCATE)` 关库 → 释放单实例锁；冷启动 RSS < 250MB，退出后无残留进程与 WAL 残档
- **升级不丢数据**：数据库迁移只追加、不改历史条目，且在**事务**中执行；升级前的非空库会**自动生成 `backups/*-pre-migrate-vN.db` 快照**（覆盖安装不会动用户数据，见下文「升级安装」）

**M7 · 内容导入与解析 —— 已完成**

- **拖拽 / 粘贴导入**：`txt` / `md` / `docx` / `epub` / `json` 全覆盖；「粘贴文本导入」走同一套解析管线，适合从网页或聊天记录里拷一段大纲
- **零新增依赖的 ZIP 读取器**：自研实现，支持 `store` 与 `deflate`（真实 docx / epub 均为 deflate）；加密或损坏的包给出明确中文报错，不崩
- **编码探测链**：BOM（UTF-8 / UTF-16LE / BE）优先 → UTF-8 容错试解 → GBK；仍乱码可手动指定 GB18030 / Big5 等
- **大纲分层解析**：把「总纲 + 卷纲 + 逐章细纲」的混合文档自动拆成 卷 → 章 → 章内字段 的树；标题规则与 Markdown `#` 层级对齐合并，层级可人工上移 / 下移 / 拖拽调整
- **章内字段抽取**：按别名表识别 目的 / 关键事件 / 出场角色 / 悬念钩子 / 场景节拍 / 额外要求 / 备注；未命中的内容按启发式归类并在预览里标黄提示
- **必填体检表**：逐章逐字段标出缺项明细，可导出 Markdown 报告；**警告级、不阻断导入**，允许带缺项继续
- **差异预览**：左侧章树带 `新建 / 更新 / 冲突 / 跳过` 徽标，右侧字段级「左旧右新」diff；支持全选 / 只选新建 / 只选更新与逐条开关，底部**只有「仅导入选中项」，没有「一键全量覆盖」**；冲突（同章号已有正文）默认跳过，改「更新」时旧细纲先入回收站
- **可选 AI 辅助解析**：仅对未识别的章内块调用模型（默认关闭，开启时会明确提示「会把文档内容发送给你配置的模型」），失败自动落回启发式结果

**M8 · 检索与统计增强 —— 已完成**

- **全文检索**：FTS5（`trigram` 分词）覆盖 细纲 / 正文 / 记忆 三处，触发器保证写入即索引、软删除即移出；`Ctrl+K` 唤起命令面板，结果按章分组、命中高亮、点击直达；支持 `"短语"` 与 `-排除`
- **中文短词回退**：实测 `trigram` 对 **1–2 个汉字**的查询命中为 0（切不出三元组），因此正向词不足 3 字符时自动回退 `LIKE` 扫描，保证「古剑」这类两字词也能搜到
- **全书一键体检**：把单章审计扩到整本，聚合每章问题与按维度统计的命中数，支持筛选与批量「一键修复选中章」；**默认只跑确定性审计（不花钱不联网）**，需要模型语义审计时先给出 token 预估、二次确认后才启动，且可中止
- **写作目标与进度**：书架显示「今日 N / 目标」进度环与连续达标天数（streak）；字数在草稿保存时按**差值**记账（改写可正可负），目标在设置页可调
- **隐私与后台行为声明**：代码层保证不自启、不驻留、无遥测，并在 README 与设置页「关于」同时列出

> 说明：安装后目录约 336MB，其中 Electron 44 运行时（exe + 共享库 + 语言包）约占 320MB，属框架基线；应用自身的代码与依赖只占约 10MB。长期降体积的路径是迁移 Tauri（见计划书 §9.3）。

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
npm run smoke:m5     # 构建并跑一次 M5 自检（导入 Vela 工程 → 继续写作）
npm run smoke:m6     # 构建并跑一次 M6 自检（多书库隔离 / 迁移含中断回滚 / 软删除回收站 / 备份轮转 / 退出无 WAL 残留）
npm run smoke:m7     # 构建并跑一次 M7 自检（编码探测 / docx+epub 读回 / 大纲分层 / 字段抽取 / 差异预览与落库）
npm run smoke:m8     # 构建并跑一次 M8 自检（FTS5 trigram 实测 / 中英文检索 / 整本审计聚合 / 字数统计）
npm run dist:win     # 打包 Windows 安装包到 release/（NSIS）
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

### Vela 工程导入自检

```powershell
npx electron . --smoke-m5
# 造一个 Vela 形态的库（project_core / blueprints / drafts）→ 导入 → 校验字段映射
#   → 装配上下文 → 在导入的项目上继续写作 → M5_VELA_OK
```

### 数据根基自检

```powershell
npx electron . --smoke-m6
# 覆盖：冷启动 RSS 断言 / 多书库创建与隔离切换 / 迁移（含人为中断后的回滚）/
#   软删除 → 回收站 → 恢复（含章节号冲突自动顺延）→ 彻底删除 / 备份生成与轮转 /
#   关闭后无 WAL 残留 → M6_LIFECYCLE_OK
```

### 导入与解析自检

```powershell
npx electron . --smoke-m7
# 覆盖：UTF-8 / GBK / UTF-16LE / BE 编码探测 / 自造 docx + epub（含 deflate）读回 /
#   三份 fixture 的分层解析（分卷版 / 无分卷版 / 卷章混合版）/ 字段抽取命中率 /
#   差异预览（新建-更新-冲突）/ 提交落库与取消不落库 → M7_IMPORT_OK
```

### 检索与统计自检

```powershell
npx electron . --smoke-m8
# 覆盖：FTS5 trigram 可用性实测 / ≥3 字中文与英文命中 / 1–2 字中文走 LIKE 回退命中 /
#   软删除后从索引移除 / 整本审计聚合自洽 / 字数差值记账与 streak → M8_OK
```

### 打包（Windows）

```powershell
npm run dist:win        # 产物落在 release/（已在 .gitignore 中忽略）
npm run pack:dir        # 只出解包目录，便于快速验证

# 国内网络若拉取 electron-builder 依赖较慢，可先设置镜像：
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR='https://npmmirror.com/mirrors/electron-builder-binaries/'
```

> `release/` 属于构建产物，不入库；安装包约 90MB。

### 升级安装：覆盖安装不会丢数据

**可以放心覆盖安装新版本。** 程序与数据是分开存放的：

| | 位置 |
|---|---|
| 程序（可被覆盖） | `%LOCALAPPDATA%\Programs\Inkwell`（按用户安装，`perMachine: false`） |
| 数据（不会被碰） | `%APPDATA%\inkwell`（配置与密钥）+ 你指定的书库目录（数据库 / 备份 / 导出 / 封面） |

保证来自三处：

1. 打包配置里**没有** `deleteAppDataOnUninstall`（electron-builder 默认 `false`），卸载或覆盖安装都只替换程序文件，不动 `%APPDATA%`；
2. 数据库迁移**只追加、不改历史条目**，且在数据库中**事务执行**，失败整体回滚、`schema_version` 不变；
3. 升级非空库前会**自动快照**到书库的 `backups/inkwell-<时间>-pre-migrate-vN.db`，万一有问题可直接回滚到该文件。

> 若书库放在自定义目录（含移动硬盘 / U 盘），它本来就在 `%APPDATA%` 之外，更不受安装影响。
>
> 唯一要避免的：改动 `package.json` 的 `name`（它决定 `%APPDATA%` 下的目录名）、改动 `appId`。改这两项会让新版去读一个全新的空目录，看起来就像「数据丢了」。

### 上手流程

1. 书架右上「设置」→「官方 API」填 Base URL / 模型名 / API Key →「测试连接」→「保存」
2. 书架新建项目：**填了一句话灵感就会自动生成设定、大纲与全部章节细纲**
3. 工作区「细纲」Tab 可逐章微调，也能点「AI 补全本章细纲」
4. 切到「正文」Tab → 点「生成正文」；不满意可「重写」，写短了可「续写」，文字毛糙可「润色」
5. 点「审稿」看多维审计报告（问题会标出段落），再点「一键修复」自动改掉问题并重审
6. 想整本自动写：点顶栏「从第 N 章连写整本」；运行中可「暂停 / 跳过本章 / 停止」，也能下发 Steer 要求
7. 「记忆」Tab 查看七个真相文件与每章审计报告；误删了记忆可点「从正文重建记忆」
8. 顶栏「导出」选择 TXT / MD / DOCX / EPUB，一键成书（分卷 + 目录）
9. 顶栏可切换**深浅主题**；正文点「专注」进入沉浸写作
10. 已有 Vela 工程：书架点「导入 Vela 工程」，导入后直接接着写
11. **导入大纲**：把 `txt / md / docx / epub` 拖到书架空白区或工作区「细纲」Tab，或点「粘贴文本导入」；解析后在差异预览里逐条勾选再落库
12. **检索与体检**：`Ctrl+K` 全局搜索细纲 / 正文 / 记忆；工作区顶栏「全书体检」聚合全书问题并可批量修复
13. **数据与备份**：设置页「数据与备份」可立即备份 / 恢复 / 打开备份目录；「回收站」可找回误删；书架顶部有今日字数进度环与连续达标天数
14. **换书库 / 迁移**：书架右上「书库」可新建、挂载、切换书库；也可把现有书库迁移到别的磁盘（可中断可回滚）

#### 用外部 Agent 零成本跑完整本

在设置页「Agent 模式（MCP）」点「复制配置」，粘贴到 Agent（TRAE WorkBuddy / Claude Code / Cursor）的 MCP 配置里，
然后让 Agent 循环调用 `inkwell_next_task` → 生成 → `inkwell_save_draft`，直到 `done: true`；
需要既有设定时可先调 `inkwell_memory` 读取七个真相文件。

配置由应用自动生成，分两种形态：

**安装版（推荐，无需另装 Node）** —— 用应用自带的 Electron 运行时执行 `app.asar` 内的入口：

```json
{
  "mcpServers": {
    "inkwell": {
      "command": "<安装目录>\\Inkwell.exe",
      "args": ["<安装目录>\\resources\\app.asar\\out\\main\\mcp.js"],
      "env": { "ELECTRON_RUN_AS_NODE": "1" }
    }
  }
}
```

> 为什么不用 `node`：安装后 `mcp.js` 在 `app.asar` 归档内，普通 Node 读不了 asar；
> 而 Electron 以 `ELECTRON_RUN_AS_NODE=1` 启动时自带 asar 支持，等价于一个 Node 运行时。

**开发版** —— 源码目录里先 `npm run build`，再指向 `out/main/mcp.js`：

```json
{ "mcpServers": { "inkwell": { "command": "node", "args": ["<仓库目录>/out/main/mcp.js"] } } }
```

**排错**：Agent 侧报 `MCP error -32000: Connection closed`，通常是入口路径不可读或运行时不对。
先手动验证（应在 stdout 看到一行 JSON-RPC 响应）：

```powershell
# 安装版
$env:ELECTRON_RUN_AS_NODE='1'
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}' |
  & "E:\Inkwell\Inkwell.exe" "E:\Inkwell\resources\app.asar\out\main\mcp.js"
```

## 目录结构

```
src/
├─ main/                 # Electron 主进程
│  ├─ index.ts           # 入口：书库引导、建窗、注册 IPC、before-quit 顺序化退出
│  ├─ lifecycle.ts       # 资源登记与优雅退出（中断在途请求 / 清定时器 / checkpoint 关库）
│  ├─ smoke.ts           # --smoke 持久化自检
│  ├─ smoke-llm.ts       # --smoke-llm 生成链路自检
│  ├─ smoke-mcp.ts       # --smoke-mcp MCP 协议自检
│  ├─ smoke-m3.ts        # --smoke-m3 连写/记忆/断点续跑自检
│  ├─ smoke-m4.ts        # --smoke-m4 一键修复 / 四种格式导出自检
│  ├─ smoke-m5.ts        # --smoke-m5 导入 Vela 工程自检
│  ├─ smoke-m6.ts        # --smoke-m6 多书库 / 迁移 / 回收站 / 备份 / 退出自检
│  ├─ smoke-m7.ts        # --smoke-m7 编码 / docx+epub / 分层解析 / 差异预览自检
│  ├─ smoke-m8.ts        # --smoke-m8 检索 / 整本审计 / 写作统计自检
│  ├─ smoke/fixtures/    # 分层解析用的 3 份大纲样本
│  ├─ db/                # schema / migrations / client / repositories / memory / pipeline / trash / backup
│  ├─ library/           # 多书库：config / registry / precheck / migrate
│  ├─ engine/            # 确定性引擎：truth / audit / audit-book / memory / rules / fix / pipeline / run
│  ├─ search/            # FTS5 全文检索（fts / query，含中文短词 LIKE 回退）
│  ├─ stat/              # 写作统计与目标（tracker / goal）
│  ├─ export/            # 导出引擎：TXT / MD / DOCX / EPUB + 内置 ZIP 写入器
│  ├─ import/            # 导入引擎：zip-reader / encoding / docx / epub / text + outline 分层解析 + session
│  ├─ providers/         # ChatProvider 抽象 + OpenAI 兼容实现 + 接入配置
│  ├─ llm/               # invoke(路由+记账) / route / usage / context / generate / wizard / brief
│  ├─ mcp/               # MCP Server（stdio）入口与工具实现
│  ├─ bridge/            # 任务单桥（导出 task.md）
│  ├─ prompts/           # 内置提示词模板
│  ├─ security/          # safeStorage 密钥加密
│  └─ ipc/               # IPC handlers（zod 校验）
├─ preload/              # contextBridge 白名单 API
├─ renderer/src/
│  ├─ pages/             # 书架 / 工作区 / 设置 / 书库管理 / 导入预览
│  ├─ components/        # 细纲 / 大纲 / 正文 / 记忆 / 连写条 / 导出 / 主题 / 设置面板
│  │                     #   + 书库：MigrationWizard / TrashPanel / BackupPanel
│  │                     #   + 导入：DropZone / OutlineTree / FieldDiff / ValidationReport
│  │                     #   + M8：SearchPalette / BookAuditPanel / GoalWidget
│  ├─ data/              # 题材模板（30 种）
│  └─ stores/            # zustand
└─ shared/               # 跨进程共享的类型与 IPC 契约
scripts/                 # Git 每轮提交与安全回滚脚本
electron-builder.yml     # 打包配置（NSIS → release/，含体积精简规则）
.github/workflows/       # CI 体积看门狗
LICENSE                  # MIT
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

## 隐私与后台行为

Inkwell 是本地优先的桌面应用，以下四条由代码层保证，并非仅口号：

1. **不联网（除你配置的模型端点）**：应用只在调用你显式配置的模型端点时发起网络请求（BYOK / MCP）。除此之外没有任何遥测、上报或心跳请求，也没有第三方统计 SDK。
2. **不自启**：不调用系统登录项设置（不写开机自启），不做任何常驻注册。
3. **不驻留**：不创建托盘图标、不常驻后台；关闭窗口即彻底退出，退出后任务管理器中无 Inkwell 残留进程。
4. **无遥测**：不采集设备信息、使用统计或崩溃日志上传。「用量」面板只记录本地的模型调用记账，数据全部留在你自己的书库文件里。

> 数据位置：书库（`inkwell.db`）、备份、导出、封面均在你指定的书库目录；API 密钥经系统级加密后仅存本机，随库迁移不会带走密钥。

## 许可

本项目以 [MIT License](LICENSE) 发布。

参考项目（Vela、AI-Novel-Writing-Assistant、InkOS、ainovel-cli、WebNovel Writer 等）仅借鉴设计思路，
未复制其源码；相关权利归各自作者所有。