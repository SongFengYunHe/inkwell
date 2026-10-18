/**
 * M13-C 习惯画像（纯本地，不上传）。
 *
 * 落库键（ui_pref 表）：
 *   cmd:usage  —— JSON：命令 id → 使用次数
 *   cmd:recent —— JSON：命令 id 数组，最近使用在前
 *
 * 排序权重 = 频次 × 最近（recency 用「在 recent 列表中的位置」衰减）。
 * 目的：常用动作自动上浮，减少鼠标行程与查找成本。
 */

export const HABIT_USAGE_KEY = 'cmd:usage'
export const HABIT_RECENT_KEY = 'cmd:recent'
export const HABIT_RECENT_MAX = 20

export interface HabitProfile {
  usage: Record<string, number>
  recent: string[]
}

function safeParse<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function readHabits(prefs: Record<string, string>): HabitProfile {
  const usage = safeParse<Record<string, number>>(prefs[HABIT_USAGE_KEY], {})
  const recent = safeParse<string[]>(prefs[HABIT_RECENT_KEY], [])
  return {
    usage: usage && typeof usage === 'object' ? usage : {},
    recent: Array.isArray(recent) ? recent : []
  }
}

/** 0 表示从未使用；数值越大越「顺手」 */
export function habitScore(profile: HabitProfile, id: string): number {
  const count = profile.usage[id] ?? 0
  const index = profile.recent.indexOf(id)
  const recency = index < 0 ? 0 : (HABIT_RECENT_MAX - index) / HABIT_RECENT_MAX
  if (count === 0 && recency === 0) return 0
  // 频次为主，最近使用为辅（避免只用过一次的动作压过常用动作）
  return count * (1 + recency)
}

/** 稳定排序：同分时保持原有顺序（内置顺序即「默认推荐顺序」） */
export function sortByHabit<T extends { id: string }>(items: T[], profile: HabitProfile): T[] {
  return items
    .map((item, index) => ({ item, index, score: habitScore(profile, item.id) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item)
}

/** 置顶（pin）：用户显式固定的动作永远排在最前，顺序按 pin 列表 */
export function readPins(prefs: Record<string, string>, scope: string): string[] {
  const pins = safeParse<string[]>(prefs[`pin:${scope}`], [])
  return Array.isArray(pins) ? pins : []
}

export function togglePin(pins: string[], id: string): string[] {
  return pins.includes(id) ? pins.filter((item) => item !== id) : [...pins, id]
}

/** pin 优先 → 习惯排序 */
export function sortWithPins<T extends { id: string }>(items: T[], profile: HabitProfile, pins: string[]): T[] {
  const pinned = pins
    .map((id) => items.find((item) => item.id === id))
    .filter((item): item is T => item !== undefined)
  const rest = sortByHabit(
    items.filter((item) => !pins.includes(item.id)),
    profile
  )
  return [...pinned, ...rest]
}
