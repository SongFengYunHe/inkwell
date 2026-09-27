import type { ChapterDraft, GenerateStartInput, GenerationMode } from '@shared/types'
import { getProject, listBriefs, listDrafts, saveDraft } from '../db/repositories'
import { createOpenAiCompatibleProvider } from '../providers/openai-compatible'
import { getActiveProvider } from '../providers/store'
import { buildMessagesFor, type ChapterPromptContext } from '../prompts/zh-CN'

const PREVIOUS_EXCERPT_CHARS = 800

const SOURCE_BY_MODE: Record<GenerationMode, string> = {
  draft: 'write',
  continue: 'continue',
  rewrite: 'rewrite',
  polish: 'polish'
}

/** 取文本末尾若干字符，尽量从段落边界开始，保证前情提要可读 */
function tailExcerpt(content: string, max: number): string {
  const text = content.trim()
  if (text.length <= max) return text
  const slice = text.slice(text.length - max)
  const breakIndex = slice.indexOf('\n')
  return breakIndex >= 0 && breakIndex < slice.length - 1 ? slice.slice(breakIndex + 1) : slice
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

  const active = getActiveProvider()
  if (!active) throw new Error('尚未配置模型接入，请先到「设置」添加一个 OpenAI 兼容端点')

  const project = getProject(input.projectId)
  if (!project) throw new Error(`项目不存在：${input.projectId}`)

  const brief = listBriefs(input.projectId).find((item) => item.chapterNo === input.chapterNo) ?? null
  const drafts = listDrafts(input.projectId)
  const latest = drafts.find((item) => item.chapterNo === input.chapterNo) ?? null
  const previous = drafts.find((item) => item.chapterNo === input.chapterNo - 1) ?? null

  if (input.mode === 'draft' && !brief) {
    throw new Error(`第 ${input.chapterNo} 章还没有细纲，请先填写细纲再生成`)
  }
  if (input.mode === 'continue' && !latest?.content.trim()) {
    throw new Error('本章还没有正文，无法续写')
  }
  if (input.mode === 'polish' && !latest?.content.trim()) {
    throw new Error('本章还没有正文，无法润色')
  }

  const context: ChapterPromptContext = {
    bookTitle: project.name,
    genre: project.genre,
    premise: project.premise,
    worldbuilding: project.worldbuilding,
    protagonist: project.protagonist,
    goldenFinger: project.goldenFinger,
    style: project.style,
    globalGuidance: project.globalGuidance,
    coreOutline: project.coreOutline,
    chapterNo: input.chapterNo,
    chapterTitle: brief?.title ?? '',
    purpose: brief?.purpose ?? '',
    keyEvents: brief?.keyEvents ?? '',
    characters: brief?.characters ?? [],
    sceneBeats: brief?.sceneBeats ?? [],
    suspenseHook: brief?.suspenseHook ?? '',
    userGuidance: brief?.userGuidance ?? '',
    previousExcerpt: previous ? tailExcerpt(previous.content, PREVIOUS_EXCERPT_CHARS) : '',
    existingContent: latest?.content ?? '',
    targetWords: project.wordsPerChapter
  }

  const provider = createOpenAiCompatibleProvider({
    id: String(active.dto.id),
    baseUrl: active.dto.baseUrl,
    apiKey: active.apiKey,
    model: active.dto.model
  })

  let generated = ''
  for await (const chunk of provider.chat(
    { model: active.dto.model, messages: buildMessagesFor(input.mode, context) },
    signal
  )) {
    generated += chunk.delta
    onDelta(chunk.delta)
  }

  const trimmed = generated.trim()
  if (!trimmed) throw new Error('模型没有返回任何内容')

  const content = input.mode === 'continue' ? `${context.existingContent.trim()}\n\n${trimmed}` : trimmed

  return saveDraft({
    projectId: input.projectId,
    chapterNo: input.chapterNo,
    version: (latest?.version ?? 0) + 1,
    status: 'draft',
    source: SOURCE_BY_MODE[input.mode],
    content
  })
}