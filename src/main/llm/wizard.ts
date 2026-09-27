import type { WizardProgress } from '@shared/types'
import { getProject, listBriefs, saveBrief, updateProject } from '../db/repositories'
import { buildBriefBatchMessages, buildOutlineMessages } from '../prompts/zh-CN'
import { invokeJson, type LlmRole } from './invoke'
import { normalizeBriefBatch, outlineDraftSchema } from './schemas'

/** 每批生成的细纲章数：太小则调用次数多，太大则单次输出过长易截断 */
const BRIEF_BATCH_SIZE = 15
const ARCHITECT_ROLE: LlmRole = 'architect'

export interface RunWizardOptions {
  projectId: number
  signal: AbortSignal
  onProgress: (progress: WizardProgress) => void
}

export interface WizardResult {
  briefsCreated: number
}

/**
 * 新建向导：一句话灵感 → 设定 + 总大纲 → 逐章细纲（计划书 §3.1 / §8.1）。
 * 细纲按批生成，已有细纲的章节不重复生成，可从断点继续。
 */
export async function runWizard(options: RunWizardOptions): Promise<WizardResult> {
  const { projectId, signal, onProgress } = options

  const project = getProject(projectId)
  if (!project) throw new Error(`项目不存在：${projectId}`)
  if (!project.premise.trim()) throw new Error('请先填写一句话灵感，向导需要它才能展开')

  onProgress({ phase: 'outline', message: '正在生成设定与总大纲…', completed: 0, total: 1 })

  const outline = await invokeJson(
    {
      role: ARCHITECT_ROLE,
      messages: buildOutlineMessages({
        bookTitle: project.name,
        genre: project.genre,
        totalChapters: project.totalChapters,
        wordsPerChapter: project.wordsPerChapter,
        premise: project.premise
      }),
      signal,
      temperature: 0.85
    },
    (raw) => outlineDraftSchema.parse(raw)
  )

  updateProject({
    id: projectId,
    worldbuilding: outline.worldbuilding,
    protagonist: outline.protagonist,
    goldenFinger: outline.goldenFinger,
    style: outline.style,
    coreOutline: outline.coreOutline
  })

  onProgress({ phase: 'outline', message: '设定与总大纲已生成', completed: 1, total: 1 })

  const refreshed = getProject(projectId)
  if (!refreshed) throw new Error('项目在生成过程中丢失')

  const total = refreshed.totalChapters
  const existing = listBriefs(projectId)
  const titles = existing.map((item) => ({ chapterNo: item.chapterNo, title: item.title }))
  const startChapter = existing.length > 0 ? Math.max(...existing.map((item) => item.chapterNo)) + 1 : 1

  let briefsCreated = 0
  onProgress({
    phase: 'briefs',
    message: startChapter > total ? '细纲已齐备' : `正在生成第 ${startChapter} 章起的细纲…`,
    completed: 0,
    total
  })

  for (let from = startChapter; from <= total; from += BRIEF_BATCH_SIZE) {
    if (signal.aborted) throw new Error('已停止生成')

    const to = Math.min(from + BRIEF_BATCH_SIZE - 1, total)
    const drafts = await invokeJson(
      {
        role: ARCHITECT_ROLE,
        messages: buildBriefBatchMessages({
          bookTitle: refreshed.name,
          genre: refreshed.genre,
          premise: refreshed.premise,
          worldbuilding: refreshed.worldbuilding,
          protagonist: refreshed.protagonist,
          goldenFinger: refreshed.goldenFinger,
          style: refreshed.style,
          coreOutline: refreshed.coreOutline,
          fromChapter: from,
          toChapter: to,
          previousTitles: titles.slice(-6)
        }),
        signal,
        temperature: 0.85
      },
      normalizeBriefBatch
    )

    for (const draft of drafts) {
      // 丢弃模型越界或重复的章节
      if (draft.chapterNo < from || draft.chapterNo > to) continue
      if (titles.some((item) => item.chapterNo === draft.chapterNo)) continue

      saveBrief({
        projectId,
        chapterNo: draft.chapterNo,
        title: draft.title,
        purpose: draft.purpose,
        keyEvents: draft.keyEvents,
        characters: draft.characters,
        sceneBeats: draft.sceneBeats,
        suspenseHook: draft.suspenseHook
      })
      titles.push({ chapterNo: draft.chapterNo, title: draft.title })
      briefsCreated += 1
    }

    onProgress({
      phase: 'briefs',
      message: `已生成到第 ${to} 章`,
      completed: Math.min(titles.length, total),
      total
    })
  }

  const summary = `完成：总大纲 + ${briefsCreated} 章细纲`
  onProgress({ phase: 'done', message: summary, completed: total, total })
  return { briefsCreated }
}