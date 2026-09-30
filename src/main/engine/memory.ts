import type { ChapterDraft, MemoryChapter, Project } from '@shared/types'
import {
  applyCharacterStates,
  applyThreadUpdates,
  saveMemoryChapter
} from '../db/memory-repo'
import { buildMemoryMessages } from '../prompts/zh-CN'
import { invokeJson } from '../llm/invoke'
import { memoryDraftSchema } from '../llm/schemas'
import { buildTruthSnapshot } from './truth'

export interface CommitMemoryInput {
  project: Project
  chapterNo: number
  chapterTitle: string
  characters: string[]
  draft: ChapterDraft
  signal?: AbortSignal
}

/**
 * 记忆回写（计划书 §7.1 的「记忆回写」步骤）。
 * extractor 角色抽取 → 落 memory_chapter → 投影到角色矩阵与伏笔台账。
 */
export async function commitMemory(input: CommitMemoryInput): Promise<MemoryChapter> {
  const { project, chapterNo, draft } = input
  const snapshot = buildTruthSnapshot(project.id, chapterNo)

  const extracted = await invokeJson(
    {
      role: 'extractor',
      messages: buildMemoryMessages({
        bookTitle: project.name,
        genre: project.genre,
        chapterNo,
        chapterTitle: input.chapterTitle,
        characters: input.characters,
        previousSummary: snapshot.previousSummary,
        characterStates: snapshot.characterStates,
        pendingHooks: snapshot.pendingHooks,
        content: draft.content
      }),
      signal: input.signal,
      temperature: 0.2
    },
    (raw) => memoryDraftSchema.parse(raw)
  )

  const memory = saveMemoryChapter({
    projectId: project.id,
    chapterNo,
    draftId: draft.id,
    summary: extracted.summary,
    characterStates: extracted.characterStates,
    continuityFacts: extracted.continuityFacts,
    threadUpdates: extracted.threadUpdates
  })

  // 投影：角色矩阵当前状态 + 伏笔台账
  applyCharacterStates(project.id, chapterNo, extracted.characterStates)
  applyThreadUpdates(project.id, chapterNo, draft.id, extracted.threadUpdates)

  return memory
}