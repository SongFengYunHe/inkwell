import type { ChapterDraft, GenerateStartInput, GenerationMode } from '@shared/types'
import { saveDraft } from '../db/repositories'
import { buildMessagesFor } from '../prompts/zh-CN'
import { buildChapterContext } from './context'
import { invokeChat } from './invoke'
import { augmentContext } from '../search/recall'
import { indexChapterDraft } from '../search/vector'
import { recordGenerationRevision } from '../db/revision-repo'

const SOURCE_BY_MODE: Record<GenerationMode, string> = {
  draft: 'write',
  continue: 'continue',
  rewrite: 'rewrite',
  polish: 'polish'
}

export interface RunGenerationOptions {
  input: GenerateStartInput
  signal: AbortSignal
  onDelta: (text: string) => void
}

/**
 * 执行一次单章生成（计划书 §7.1 的装配 → 起草部分）。
 * 结果作为新版本写入 chapter_draft，返回落盘后的草稿。
 */
export async function runGeneration(options: RunGenerationOptions): Promise<ChapterDraft> {
  const { input, signal, onDelta } = options

  const bundle = buildChapterContext(input.projectId, input.chapterNo)
  if (!bundle) throw new Error(`项目不存在：${input.projectId}`)

  const { brief, latestDraft, context } = bundle
  if (input.mode === 'draft' && !brief) {
    throw new Error(`第 ${input.chapterNo} 章还没有细纲，请先填写细纲再生成`)
  }
  if (input.mode === 'continue' && !latestDraft?.content.trim()) {
    throw new Error('本章还没有正文，无法续写')
  }
  if (input.mode === 'polish' && !latestDraft?.content.trim()) {
    throw new Error('本章还没有正文，无法润色')
  }

  // A3：按细纲召回相关回忆（不可用时返回原上下文，绝不阻断写作）
  const augmented = await augmentContext(bundle, signal)

  const generated = await invokeChat({
    role: 'writer',
    messages: buildMessagesFor(input.mode, augmented),
    signal,
    onDelta
  })

  const trimmed = generated.trim()
  if (!trimmed) throw new Error('模型没有返回任何内容')

  const content = input.mode === 'continue' ? `${context.existingContent.trim()}\n\n${trimmed}` : trimmed

  const saved = saveDraft({
    projectId: input.projectId,
    chapterNo: input.chapterNo,
    version: (latestDraft?.version ?? 0) + 1,
    status: 'draft',
    source: SOURCE_BY_MODE[input.mode],
    content
  })

  // A5：记一条修订（润色 / 重写）——续写与首次生成也算版本推进
  if (input.mode === 'polish') recordGenerationRevision('polish', latestDraft, saved)
  else if (input.mode === 'rewrite') recordGenerationRevision('rewrite', latestDraft, saved)

  // A3：落盘后增量索引（开关关闭或无 embedder 时自动跳过，失败不影响写作）
  await indexChapterDraft(input.projectId, input.chapterNo, saved.id, saved.content, signal)

  return saved
}