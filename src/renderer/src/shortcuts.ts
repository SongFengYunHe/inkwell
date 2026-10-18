/**
 * M13-C 快捷键规范与速查（单一事实来源）。
 *
 * 修饰键分区（全局统一，禁止各页随意发明）：
 *   Ctrl+*       全局动作
 *   Ctrl+Shift+* 面板 / 布局切换
 *   Alt+*        局部动作（当前面板内）
 *   Esc          统一关闭 / 取消
 *   ?            唤起本速查表
 */

export interface ShortcutSpec {
  id: string
  group: '全局' | '工作区'
  keys: string
  label: string
}

export const SHORTCUTS: ShortcutSpec[] = [
  { id: 'palette', group: '全局', keys: 'Ctrl+K', label: '命令面板（检索 / 跳章 / 操作）' },
  { id: 'help', group: '全局', keys: '?', label: '快捷键速查' },
  { id: 'shortcutHelpAlt', group: '全局', keys: 'Ctrl+/', label: '快捷键速查' },
  { id: 'settings', group: '全局', keys: 'Ctrl+,', label: '打开设置' },
  { id: 'bookshelf', group: '全局', keys: 'Ctrl+B', label: '返回书架' },
  { id: 'theme', group: '全局', keys: 'Ctrl+Shift+D', label: '切换深浅主题' },
  { id: 'panel1', group: '工作区', keys: 'Ctrl+Shift+1', label: '切到「细纲」' },
  { id: 'panel2', group: '工作区', keys: 'Ctrl+Shift+2', label: '切到「设定与大纲」' },
  { id: 'panel3', group: '工作区', keys: 'Ctrl+Shift+3', label: '切到「正文」' },
  { id: 'panel4', group: '工作区', keys: 'Ctrl+Shift+4', label: '切到「记忆」' },
  { id: 'focus', group: '工作区', keys: 'Alt+F', label: '专注模式开关' },
  { id: 'preset1', group: '工作区', keys: 'Alt+1', label: '布局预设：专注写作' },
  { id: 'preset2', group: '工作区', keys: 'Alt+2', label: '布局预设：对照修订' },
  { id: 'preset3', group: '工作区', keys: 'Alt+3', label: '布局预设：素材研究' },
  { id: 'prevChapter', group: '工作区', keys: 'Alt+↑', label: '上一章' },
  { id: 'nextChapter', group: '工作区', keys: 'Alt+↓', label: '下一章' }
]

interface ParsedKeys {
  ctrl: boolean
  shift: boolean
  alt: boolean
  key: string
}

function parseKeys(keys: string): ParsedKeys {
  const parts = keys.split('+').map((part) => part.trim())
  const key = (parts.pop() ?? '').toLowerCase()
  return {
    ctrl: parts.includes('Ctrl'),
    shift: parts.includes('Shift'),
    alt: parts.includes('Alt'),
    key
  }
}

/** 精确匹配（修饰键必须一致），避免 Ctrl+K 与 Ctrl+Shift+K 互相误触 */
export function matchesShortcut(event: KeyboardEvent, keys: string): boolean {
  const spec = parseKeys(keys)
  const ctrl = event.ctrlKey || event.metaKey
  // '?' 的字形自带 Shift，修饰键不参与判定
  if (spec.key === '?') return event.key === '?' && !ctrl && !event.altKey
  if (ctrl !== spec.ctrl || event.shiftKey !== spec.shift || event.altKey !== spec.alt) return false
  // 数字键带 Shift 时 event.key 会变成 '!' / '@'，必须按物理键判定
  if (/^[1-9]$/.test(spec.key)) return event.code === `Digit${spec.key}`
  const key = event.key.toLowerCase()
  if (spec.key === '↑') return key === 'arrowup'
  if (spec.key === '↓') return key === 'arrowdown'
  return key === spec.key
}

/**
 * 是否处于可输入上下文（输入框 / 文本域 / 可编辑元素）。
 * 单键快捷键（如 `?`）必须避开输入，否则写正文时会误触。
 */
export function isTypingContext(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null
  if (!node || typeof node.tagName !== 'string') return false
  const tag = node.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || node.isContentEditable
}
