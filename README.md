# Inkwell

本地优先的 AI 长篇小说生产工作台。核心主张：**只给「大纲 + 每章细纲」，即可自动写完整本书。**

## 当前进度

**M0 · 脚手架与地基 —— 已完成**

- electron-vite + React 19 + TypeScript + Tailwind CSS 4，主进程 / 预加载 / 渲染进程三端打通
- SQLite（better-sqlite3）+ Drizzle ORM；`schema_version` 驱动的迁移
- `project` / `chapter_brief` / `chapter_draft` 三表 CRUD
- 可新建项目、手写总大纲与章节细纲，**重启后数据仍在**（见下方冒烟自检）

## 技术栈

| 层 | 选型 |
|---|---|
| 桌面框架 | Electron 44 |
| 构建 | electron-vite 5 + Vite 7 |
| UI | React 19 + Tailwind CSS 4 + Zustand |
| 数据 | better-sqlite3（N-API）+ Drizzle ORM |
| 校验 | zod（所有 IPC 入参） |

## 快速开始

```bash
npm install          # 安装依赖
npm run dev          # 开发模式（热更新）
npm run typecheck    # 类型检查
npm run build        # 构建到 out/
npm run smoke        # 构建并跑一次持久化自检
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

## 目录结构

```
src/
├─ main/                 # Electron 主进程
│  ├─ index.ts           # 入口：初始化 DB、建窗、注册 IPC
│  ├─ smoke.ts           # --smoke 自检
│  ├─ db/                # schema / migrations / client / repositories
│  └─ ipc/               # IPC handlers（zod 校验）
├─ preload/              # contextBridge 白名单 API
├─ renderer/             # React 界面（书架 / 工作区）
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