import type { ParsedTree } from '@shared/types'
import { buildTree, normalizeLines } from './build-tree'

/**
 * 大纲解析管线串联（计划书 §4.3 ①–④）：归一化 → 分层 → 建树。
 * 字段抽取（⑤）在建树时逐章完成；⑥ LLM 兜底见 ./llm.ts（默认关闭）。
 */
export function parseOutline(text: string): ParsedTree {
  return buildTree(normalizeLines(text))
}

export function parseOutlineLines(lines: string[]): ParsedTree {
  return buildTree(lines)
}

export { buildTree, normalizeLines } from './build-tree'
export { extractChapterFields, emptyFields } from './extract-fields'
export { validateTree, exportValidationMarkdown } from './validate'
export * from './patterns'