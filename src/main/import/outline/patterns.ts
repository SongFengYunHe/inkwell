import type { BriefFieldKey } from '@shared/types'

/**
 * 大纲分层解析的识别规则（计划书 §4.3），全部集中于此便于测试。
 */

/** 字段中文名（预览 / 体检表列头） */
export const FIELD_LABELS: Record<BriefFieldKey, string> = {
  purpose: '本章目的',
  keyEvents: '关键事件',
  characters: '出场角色',
  suspenseHook: '悬念钩子',
  sceneBeats: '场景节拍',
  userGuidance: '额外要求',
  notes: '备注'
}

/** 默认必填字段（计划书 §4.4：章节号/标题为结构字段，其余前四项必填） */
export const DEFAULT_REQUIRED_FIELDS: BriefFieldKey[] = ['purpose', 'keyEvents', 'characters', 'suspenseHook']

/** 字段别名表（中英别名，计划书 §4.3 ⑤） */
export const FIELD_ALIASES: Record<BriefFieldKey, string[]> = {
  purpose: ['本章目的', '本章目标', '写作目的', '目的', '目标', 'goal'],
  keyEvents: ['关键事件', '主要事件', '关键剧情', '情节点', '事件', '情节', '剧情', 'events'],
  characters: ['出场角色', '出场人物', '涉及角色', '角色', '人物', 'characters'],
  suspenseHook: ['结尾钩子', '悬念钩子', '钩子悬念', '悬念', '钩子', 'hook'],
  sceneBeats: ['场景节拍', '场景', '场面', '节拍', 'beats', 'scenes'],
  userGuidance: ['额外要求', '特别要求', '注意事项', '要求', '约束', 'guidance'],
  notes: ['备注', '注释', '说明', '补充', 'notes']
}

export interface AliasEntry {
  alias: string
  field: BriefFieldKey
}

/** 别名表展开并按长度降序排列（优先匹配更长的标签，如「本章目的」先于「目的」） */
export const ALIAS_ENTRIES: AliasEntry[] = Object.entries(FIELD_ALIASES)
  .flatMap(([field, aliases]) => aliases.map((alias) => ({ alias, field: field as BriefFieldKey })))
  .sort((a, b) => b.alias.length - a.alias.length)

/** 行形如 `<标签>[：:] 内容` */
export const LABEL_PREFIX_RE = /^\s*([^：:\n]{1,12}?)\s*[：:]\s*(.*)$/

/** 列表 / 缩进行标记（用于续行归并） */
export const LIST_MARKER_RE = /^\s*(?:[-*•‧·①-⑩]|\d+[\.、)])\s*/

export const MARKDOWN_HEADING_RE = /^(#{1,6})\s+(.*\S)\s*$/
const VOLUME_TITLE_RE = /^第[一二三四五六七八九十百千零〇\d]+[卷部篇]/
const VOLUME_ALT_RE = /^卷[一二三四五六七八九十\d]+/
const CHAPTER_TITLE_RE = /^第[一二三四五六七八九十百千零〇\d]+[章节回]/
const CHAPTER_EN_RE = /^Chapter\s+\d+/i
const PART_EN_RE = /^Part\s+[IVXLC]+/i
const SPECIAL_TITLE_RE = /^(楔子|序章|序幕|序言|序|尾声|终章|后记|番外)/

export interface FieldLabelMatch {
  field: BriefFieldKey
  value: string
}

/**
 * 行首标签匹配：`<标签>[：:]<内容>`，标签命中别名表则赋给对应字段。
 * 匹配不到返回 null。
 */
export function matchFieldLabel(line: string): FieldLabelMatch | null {
  const match = LABEL_PREFIX_RE.exec(line)
  if (!match) return null
  const label = match[1].trim()
  if (!label) return null
  const lower = label.toLowerCase()
  for (const entry of ALIAS_ENTRIES) {
    if (entry.alias.toLowerCase() === lower) {
      return { field: entry.field, value: match[2].trim() }
    }
  }
  return null
}

export interface HeadingInfo {
  kind: 'volume' | 'chapter' | 'special'
  text: string
  /** Markdown 标题的 `#` 数量；非 Markdown 为 null */
  markdownLevel: number | null
}

/** 判断 `第X章` 后面的余下部分是否像标题（避免把「第一章的内容…」当标题） */
function looksLikeTitleRest(rest: string, full: string): boolean {
  if (rest.length === 0) return true
  const first = rest[0]
  if (/[\s：:、，,\-—．.·）)]/.test(first)) return true
  // 直接接中文：标题通常较短
  if (/[\u4e00-\u9fff]/.test(first)) return full.length <= 30
  return true
}

/** 特殊标题（楔子/序章…）需短，且不含句末标点 */
function isSpecialTitle(text: string): boolean {
  return SPECIAL_TITLE_RE.test(text) && text.length <= 20 && !/[。！？!?]/.test(text)
}

/** 行分类：标题行 → HeadingInfo；内容行 → null */
export function classifyHeading(line: string): HeadingInfo | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  // Markdown 标题：`#` 数量即层级
  const md = MARKDOWN_HEADING_RE.exec(trimmed)
  if (md) {
    const level = md[1].length
    const text = md[2].trim()
    if (isSpecialTitle(text)) return { kind: 'special', text, markdownLevel: level }
    if (VOLUME_TITLE_RE.test(text) || VOLUME_ALT_RE.test(text)) return { kind: 'volume', text, markdownLevel: level }
    // 骨架以 `#` 层级为准：一级为卷，二级及以下为章
    return { kind: level === 1 ? 'volume' : 'chapter', text, markdownLevel: level }
  }

  if (isSpecialTitle(trimmed)) return { kind: 'special', text: trimmed, markdownLevel: null }

  const volume = VOLUME_TITLE_RE.exec(trimmed) ?? VOLUME_ALT_RE.exec(trimmed)
  if (volume && looksLikeTitleRest(trimmed.slice(volume[0].length), trimmed)) {
    return { kind: 'volume', text: trimmed, markdownLevel: null }
  }

  const chapter = CHAPTER_TITLE_RE.exec(trimmed)
  if (chapter && looksLikeTitleRest(trimmed.slice(chapter[0].length), trimmed)) {
    return { kind: 'chapter', text: trimmed, markdownLevel: null }
  }
  if (CHAPTER_EN_RE.test(trimmed) || PART_EN_RE.test(trimmed)) {
    return { kind: 'chapter', text: trimmed, markdownLevel: null }
  }

  return null
}

const CN_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9
}
const CN_UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000 }

/** 中文数字转整数（「二十三」→23）；无法解析返回 null */
export function chineseToNumber(input: string): number | null {
  const text = input.trim()
  if (!text) return null
  if (/^\d+$/.test(text)) return Number(text)

  let total = 0
  let section = 0
  let number = 0
  for (const char of text) {
    if (char in CN_DIGITS) {
      number = CN_DIGITS[char]
    } else if (char in CN_UNITS) {
      const unit = CN_UNITS[char]
      if (number === 0) number = 1
      section += number * unit
      number = 0
    } else if (char === '万') {
      total += (section + number) * 10000
      section = 0
      number = 0
    } else {
      return null
    }
  }
  const result = total + section + number
  return result > 0 ? result : null
}

/** 从标题文本尝试解析章节号 */
export function parseChapterNo(text: string): number | null {
  const cn = /第([一二三四五六七八九十百千零〇\d]+)[章节回]/.exec(text)
  if (cn) return chineseToNumber(cn[1])
  const en = /^Chapter\s+(\d+)/i.exec(text.trim())
  if (en) return Number(en[1])
  return null
}

/** 从标题文本尝试解析卷号 */
export function parseVolumeNo(text: string): number | null {
  const cn = /第([一二三四五六七八九十百千零〇\d]+)[卷部篇]/.exec(text)
  if (cn) return chineseToNumber(cn[1])
  const alt = /^卷([一二三四五六七八九十\d]+)/.exec(text.trim())
  if (alt) return chineseToNumber(alt[1])
  return null
}