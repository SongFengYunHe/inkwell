import type { ChapterPromptContext } from '../prompts/zh-CN'
import type { ChapterContextBundle } from '../llm/context'
import { getSettings } from '../library/registry'
import { embedderConfigured } from '../llm/embed'
import { indexStatus, searchVectors } from './vector'

/**
 * A3：写作时的「相关回忆」召回。
 *
 * 与真相文件（角色矩阵 / 伏笔 / 摘要链）互补：
 *   - 真相文件是「结构化事实」，保证不写错；
 *   - 向量召回是「细节原文」，保证不写丢（比如某个道具的描写方式、某句口头禅）。
 *
 * 任何一步不可用（开关关闭 / 没有 embedder / 索引为空 / 端点报错）都静默返回空串，
 * 绝不能让向量检索成为写作链路的新故障点。
 */

const MIN_SCORE = 0.35

export async function recallForChapter(
  projectId: number,
  chapterNo: number,
  queryText: string,
  signal?: AbortSignal
): Promise<string> {
  try {
    if (!getSettings().ragSearch) return ''
    if (!embedderConfigured()) return ''
    if (indexStatus(projectId).chunks === 0) return ''
    const query = queryText.trim()
    if (!query) return ''

    const hits = await searchVectors(projectId, query, { limit: 4, beforeChapter: chapterNo }, signal)
    const useful = hits.filter((hit) => hit.score >= MIN_SCORE)
    if (useful.length === 0) return ''
    return useful
      .map((hit) => `（第 ${hit.chapterNo} 章 · 相似度 ${hit.score.toFixed(2)}）${hit.text}`)
      .join('\n')
  } catch (error) {
    console.warn('[inkwell] 向量召回失败（不影响写作）：', error instanceof Error ? error.message : error)
    return ''
  }
}

/**
 * 用「本章细纲」拼检索 query，并返回补全后的提示词上下文。
 * 生成 / 连写 / MCP 三条链路共用，保证行为一致。
 */
export async function augmentContext(
  bundle: ChapterContextBundle,
  signal?: AbortSignal
): Promise<ChapterPromptContext> {
  const context = bundle.context
  const queryText = [context.chapterTitle, context.purpose, context.keyEvents, context.characters.join('、')]
    .filter((part) => part.trim())
    .join(' ')
    .slice(0, 600)
  const recalled = await recallForChapter(bundle.project.id, context.chapterNo, queryText, signal)
  return recalled ? { ...context, recalledMemories: recalled } : context
}
