import type { ParsedChapter, ParsedTree } from '@shared/types'
import { buildImportExtractMessages } from '../../prompts/zh-CN'
import { invokeJson } from '../../llm/invoke'

/**
 * LLM 兜底解析（计划书 §4.3 ⑥，可选，默认关闭）：
 *   - 仅对「未命中的章内块」调用（purpose / keyEvents 被启发式归类的章）；
 *   - 只填充空字段或启发式字段，不改动已命中的字段；
 *   - 逐章调用带进度；任何失败都落回启发式结果，绝不阻断导入。
 */

interface ExtractJson {
  purpose: string
  keyEvents: string
  characters: string[]
  sceneBeats: string[]
  suspenseHook: string
}

function asText(value: unknown): string {
  if (value === undefined || value === null) return ''
  return String(value)
}

function asArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => asText(item).trim()).filter(Boolean)
  const text = asText(value).trim()
  if (!text) return []
  return text
    .split(/[\n,，、;；]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseExtract(raw: unknown): ExtractJson {
  const row = (raw ?? {}) as Record<string, unknown>
  return {
    purpose: asText(row.purpose).trim(),
    keyEvents: asText(row.keyEvents ?? row.key_events).trim(),
    characters: asArray(row.characters),
    sceneBeats: asArray(row.sceneBeats ?? row.scene_beats),
    suspenseHook: asText(row.suspenseHook ?? row.suspense_hook).trim()
  }
}

function needsFallback(chapter: ParsedChapter): boolean {
  return chapter.fields.purpose.heuristic || chapter.fields.keyEvents.heuristic
}

export interface EnrichOptions {
  bookTitle?: string
  signal?: AbortSignal
  onProgress?: (done: number, total: number) => void
}

export async function enrichWithLlm(tree: ParsedTree, options: EnrichOptions = {}): Promise<ParsedTree> {
  try {
    const targets = tree.volumes.flatMap((volume) => volume.chapters).filter(needsFallback)
    if (targets.length === 0) return tree

    let done = 0
    for (const chapter of targets) {
      if (options.signal?.aborted) break
      try {
        const result = await invokeJson(
          {
            role: 'architect',
            signal: options.signal,
            temperature: 0.2,
            messages: buildImportExtractMessages({
              bookTitle: options.bookTitle,
              chapterNo: chapter.chapterNo,
              title: chapter.title,
              rawText: chapter.rawText
            })
          },
          parseExtract
        )

        if (result.purpose && !chapter.fields.purpose.value.trim()) {
          chapter.fields.purpose = { value: result.purpose, heuristic: false }
        }
        if (result.keyEvents && !chapter.fields.keyEvents.value.trim()) {
          chapter.fields.keyEvents = { value: result.keyEvents, heuristic: false }
        }
        if (result.characters.length && !chapter.fields.characters.value.trim()) {
          chapter.fields.characters = { value: result.characters.join('、'), heuristic: false }
        }
        if (result.sceneBeats.length && !chapter.fields.sceneBeats.value.trim()) {
          chapter.fields.sceneBeats = { value: result.sceneBeats.join('\n'), heuristic: false }
        }
        if (result.suspenseHook && !chapter.fields.suspenseHook.value.trim()) {
          chapter.fields.suspenseHook = { value: result.suspenseHook, heuristic: false }
        }
      } catch {
        // 失败不阻断：保留启发式结果
      } finally {
        done += 1
        options.onProgress?.(done, targets.length)
      }
    }
    return tree
  } catch {
    return tree
  }
}