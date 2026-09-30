/**
 * 反 AI 味确定性规则与定点修复（计划书 §7.1 步骤 5、§4.2「去AI味」）。
 * 全部为确定性文本处理：不调用模型、可解释、可复现。
 */
import type { StyleChange } from '@shared/types'

export type { StyleChange }

/** 空洞套话：作为句首插入语时直接删除（含其后紧跟的逗号） */
export const FILLER_PHRASES = [
  '总而言之',
  '综上所述',
  '由此可见',
  '换句话说',
  '不得不提的是',
  '值得一提的是',
  '众所周知',
  '值得注意的是',
  '需要注意的是',
  '总的来说'
]

/** 需要压缩的叠词 */
const DOUBLED_WORDS = ['非常', '真的', '忽然', '突然', '渐渐', '慢慢', '默默', '静静', '微微', '缓缓']

export interface StyleResult {
  content: string
  changes: StyleChange[]
}

/** 把段落切成句子（保留原顺序，用于排比检测） */
function sentences(text: string): string[] {
  return text
    .split(/[。！？!?；;\n]/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
}

/** 删除句首套话：仅在「句首 + 紧跟逗号」时删除，避免误伤正文语义 */
function stripFillers(content: string): { text: string; changes: StyleChange[] } {
  const changes: StyleChange[] = []
  let text = content
  for (const phrase of FILLER_PHRASES) {
    const pattern = new RegExp(`(^|[。！？!?\\n])${phrase}[，,、]`, 'g')
    const matched = text.match(pattern)
    if (!matched) continue
    text = text.replace(pattern, '$1')
    changes.push({ rule: '删除句首套话', before: phrase, after: '（删除）', count: matched.length })
  }
  return { text, changes }
}

/** 省略号规范化：。。。 / ... / ··· → …… */
function normalizeEllipsis(content: string): { text: string; changes: StyleChange[] } {
  const pattern = /(?:。{3,}|\.{3,}|·{3,}|…{2,})/g
  const matched = content.match(pattern)
  if (!matched) return { text: content, changes: [] }
  return {
    text: content.replace(pattern, '……'),
    changes: [{ rule: '省略号规范化', before: matched[0], after: '……', count: matched.length }]
  }
}

/** 重复标点压缩：！！→！ 。。→。 ，，→， */
function compressPunctuation(content: string): { text: string; changes: StyleChange[] } {
  const rules: Array<[RegExp, string, string]> = [
    [/([！？!?]){2,}/g, '$1', '重复感叹/问号压缩'],
    [/。(?=。)/g, '', '重复句号压缩'],
    [/，{2,}/g, '，', '重复逗号压缩']
  ]
  let text = content
  const changes: StyleChange[] = []
  for (const [pattern, replacement, rule] of rules) {
    const matched = text.match(pattern)
    if (!matched) continue
    text = text.replace(pattern, replacement)
    changes.push({ rule, before: matched[0], after: replacement === '' ? '（合并）' : replacement, count: matched.length })
  }
  return { text, changes }
}

/** 叠词压缩：非常非常→非常、的的→的 */
function compressDoubled(content: string): { text: string; changes: StyleChange[] } {
  let text = content
  const changes: StyleChange[] = []

  const doubledPattern = new RegExp(`(${DOUBLED_WORDS.join('|')})\\1`, 'g')
  const doubledMatched = text.match(doubledPattern)
  if (doubledMatched) {
    text = text.replace(doubledPattern, '$1')
    changes.push({ rule: '叠词压缩', before: doubledMatched[0], after: doubledMatched[0].slice(0, 2), count: doubledMatched.length })
  }

  const particlePattern = /([的地得了])\1/g
  const particleMatched = text.match(particlePattern)
  if (particleMatched) {
    text = text.replace(particlePattern, '$1')
    changes.push({ rule: '助词重复压缩', before: particleMatched[0], after: particleMatched[0][0], count: particleMatched.length })
  }

  return { text, changes }
}

/** 空白整理：去行尾空格、折叠 3 行以上空行为 1 行 */
function tidyWhitespace(content: string): { text: string; changes: StyleChange[] } {
  const before = content
  let text = content
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const changes: StyleChange[] = []
  if (text !== before.trim()) changes.push({ rule: '空白整理', before: '多余空行 / 行尾空格', after: '（整理）', count: 1 })
  return { text, changes }
}

/**
 * 确定性「去 AI 味」定点修复：只做安全的局部替换，不改动情节与信息量。
 * 返回修复后文本与逐条变更记录。
 */
export function applyStyleRules(content: string): StyleResult {
  const steps = [stripFillers, normalizeEllipsis, compressPunctuation, compressDoubled, tidyWhitespace]
  let text = content
  const changes: StyleChange[] = []

  for (const step of steps) {
    const result = step(text)
    text = result.text
    changes.push(...result.changes)
  }

  return { content: text, changes }
}

/**
 * 排比 / 同构堆砌检测（只报告，不自动改写）。
 * 返回存在 3 句以上「同一引导词」的段落序号（从 0 开始）。
 */
export function detectParallelism(content: string): number[] {
  const paragraphs = content.split(/\n+/).map((item) => item.trim()).filter(Boolean)
  const hits: number[] = []

  paragraphs.forEach((paragraph, index) => {
    const list = sentences(paragraph)
    if (list.length < 3) return
    const counters = new Map<string, number>()
    for (const sentence of list) {
      const opener = sentence.slice(0, 2)
      if (opener.length < 2) continue
      counters.set(opener, (counters.get(opener) ?? 0) + 1)
    }
    if ([...counters.values()].some((count) => count >= 3)) hits.push(index)
  })

  return hits
}

/** 套话命中计数（供审计维度复用） */
export function countFillers(content: string): number {
  return FILLER_PHRASES.reduce((total, phrase) => total + (content.split(phrase).length - 1), 0)
}