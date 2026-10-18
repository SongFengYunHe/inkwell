/**
 * M13-C 命令注册表（单一事实来源）。
 *
 * 命令面板 / 工具栏 / 快捷键都从同一份 COMMANDS 取元数据，避免三处各写一遍
 * 「有哪些动作、叫什么、绑什么键」而逐渐走样。
 *
 * 执行采用「注册处理器」而非把逻辑塞进常量：
 *   - 全局命令由 App 注册（设置 / 书架 / 主题…）；
 *   - 工作区命令由 Workspace 注册（切面板 / 预设 / 审计 / 导出…）。
 * 未注册的命令在界面上灰显，点它不会静默失败。
 */

export type CommandGroup = '全局' | '工作区' | '动作'

export interface CommandSpec {
  id: string
  label: string
  group: CommandGroup
  /** 面板 / 检索里有更短的说明时用它 */
  hint?: string
}

export const COMMANDS: CommandSpec[] = [
  // 全局
  { id: 'settings', label: '打开设置', group: '全局' },
  { id: 'library', label: '打开书库管理', group: '全局' },
  { id: 'bookshelf', label: '返回书架', group: '全局' },
  { id: 'theme', label: '切换深浅主题', group: '全局' },
  // 工作区：面板
  { id: 'tab:brief', label: '切到「细纲」', group: '工作区' },
  { id: 'tab:outline', label: '切到「设定与大纲」', group: '工作区' },
  { id: 'tab:draft', label: '切到「正文」', group: '工作区' },
  { id: 'tab:memory', label: '切到「记忆」', group: '工作区' },
  // 工作区：布局
  { id: 'preset:focus', label: '布局预设：专注写作', group: '工作区' },
  { id: 'preset:compare', label: '布局预设：对照修订', group: '工作区' },
  { id: 'preset:research', label: '布局预设：素材研究', group: '工作区' },
  { id: 'layout:reset', label: '重置本项目的布局记忆', group: '工作区' },
  { id: 'focusMode', label: '专注模式开关', group: '工作区' },
  // 动作
  { id: 'audit:chapter', label: '运行本章一致性审计', group: '动作' },
  { id: 'audit:book', label: '全书体检', group: '动作' },
  { id: 'export', label: '导出当前项目', group: '动作' },
  { id: 'migration', label: '打开迁移向导', group: '全局' }
]

export const COMMAND_MAP: Record<string, CommandSpec> = Object.fromEntries(
  COMMANDS.map((item) => [item.id, item])
)

/** 工作区命令的 id 前缀，供 Workspace / App 分工注册 */
export function isWorkspaceCommand(id: string): boolean {
  return id.startsWith('tab:') || id.startsWith('preset:') || id.startsWith('layout:') || id === 'focusMode'
}

type CommandHandler = (id: string) => void | Promise<void>

let handlers: Record<string, CommandHandler> = {}

/** 注册一批命令处理器（同名后注册者覆盖前者） */
export function registerCommands(map: Record<string, CommandHandler>): () => void {
  handlers = { ...handlers, ...map }
  return () => {
    const next = { ...handlers }
    for (const key of Object.keys(map)) delete next[key]
    handlers = next
  }
}

export function canRunCommand(id: string): boolean {
  return typeof handlers[id] === 'function'
}

/** 执行命令；未注册则返回 false（调用方据此灰显或提示，不静默吞掉） */
export async function runCommand(id: string): Promise<boolean> {
  const handler = handlers[id]
  if (!handler) return false
  await handler(id)
  return true
}

/** 供快捷键使用的「已注册」判定（避免绑了键却没处理器） */
export function commandIds(): string[] {
  return Object.keys(handlers)
}
