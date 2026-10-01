import type { BriefFieldKey, ParsedFields } from '@shared/types'
import { LIST_MARKER_RE, matchFieldLabel } from './patterns'

/**
 * 章内字段抽取（计划书 §4.3 ⑤）：
 *   标签匹配优先（`<标签>[：:]` + 别名表）；
 *   后续缩进 / 无序列表行续到当前字段；
 *   未命中内容 → 首段归入 purpose、其余归入 keyEvents，并标记为启发式（预览标黄）。
 */

export function emptyFields(): ParsedFields {
  return {
    purpose: { value: '', heuristic: false },
    keyEvents: { value: '', heuristic: false },
    characters: { value: '', heuristic: false },
    suspenseHook: { value: '', heuristic: false },
    sceneBeats: { value: '', heuristic: false },
    userGuidance: { value: '', heuristic: false },
    notes: { value: '', heuristic: false }
  }
}

export interface ExtractFieldsResult {
  fields: ParsedFields
  /** 未命中标签、由启发式归类的字段 */
  heuristicFields: BriefFieldKey[]
}

function append(fields: ParsedFields, field: BriefFieldKey, text: string): void {
  if (!text.trim()) return
  const current = fields[field].value
  fields[field].value = current ? `${current}\n${text.trim()}` : text.trim()
}

export function extractChapterFields(lines: string[]): ExtractFieldsResult {
  const fields = emptyFields()
  const unmatched: string[] = []
  let currentField: BriefFieldKey | null = null

  for (const line of lines) {
    if (!line.trim()) {
      currentField = null
      continue
    }

    const match = matchFieldLabel(line)
    if (match) {
      append(fields, match.field, match.value)
      currentField = match.field
      continue
    }

    const indented = /^\s/.test(line) && line.trim().length > 0
    if (currentField && (indented || LIST_MARKER_RE.test(line))) {
      append(fields, currentField, line.replace(LIST_MARKER_RE, ''))
      continue
    }

    currentField = null
    unmatched.push(line.trim())
  }

  // 未命中内容：首段归 purpose（若 purpose 已有则顺延到 keyEvents）
  for (const text of unmatched) {
    const target: BriefFieldKey = fields.purpose.value ? 'keyEvents' : 'purpose'
    append(fields, target, text)
    fields[target].heuristic = true
  }

  const heuristicFields = (Object.keys(fields) as BriefFieldKey[]).filter((key) => fields[key].heuristic)
  return { fields, heuristicFields }
}