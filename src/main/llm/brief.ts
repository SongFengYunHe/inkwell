import type { BriefSuggestion } from '@shared/types'
import { getProject } from '../db/repositories'
import { buildBriefExpandMessages } from '../prompts/zh-CN'
import { invokeJson } from './invoke'
import { briefDraftSchema } from './schemas'

export interface ExpandBriefInput {
  projectId: number
  chapterNo: number
  current: {
    title: string
    purpose: string
    keyEvents: string
    characters: string[]
    sceneBeats: string[]
    suspenseHook: string
  }
  signal?: AbortSignal
}

/** 单章细纲 AI 补全 / 强化（计划书 §12 `brief.expand`） */
export async function expandBrief(input: ExpandBriefInput): Promise<BriefSuggestion> {
  const project = getProject(input.projectId)
  if (!project) throw new Error(`项目不存在：${input.projectId}`)

  const draft = await invokeJson(
    {
      role: 'architect',
      messages: buildBriefExpandMessages({
        bookTitle: project.name,
        genre: project.genre,
        coreOutline: project.coreOutline,
        chapterNo: input.chapterNo,
        current: input.current
      }),
      signal: input.signal,
      temperature: 0.75
    },
    (raw) => briefDraftSchema.parse(raw)
  )

  return {
    chapterNo: draft.chapterNo,
    title: draft.title,
    purpose: draft.purpose,
    keyEvents: draft.keyEvents,
    characters: draft.characters,
    sceneBeats: draft.sceneBeats,
    suspenseHook: draft.suspenseHook
  }
}