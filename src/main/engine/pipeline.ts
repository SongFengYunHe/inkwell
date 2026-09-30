import type { AuditReport, ChapterDraft } from '@shared/types'
import { getProject, listBriefs, listDrafts, saveDraft } from '../db/repositories'
import { getLatestReview, saveReview } from '../db/memory-repo'
import { listSteps, upsertStep } from '../db/pipeline-repo'
import { buildMessagesFor } from '../prompts/zh-CN'
import { buildChapterContext } from '../llm/context'
import { invokeChat } from '../llm/invoke'
import { auditChapter } from './audit'
import { commitMemory } from './memory'

/** 单章流水线的四个确定性步骤（计划书 §7.1） */
export type PipelineStepKey = 'assemble' | 'draft' | 'audit' | 'memory'

export interface RunChapterOptions {
  runId: number
  projectId: number
  chapterNo: number
  /** Steer：注入到本章的额外要求 / 禁止项 */
  steerGuidance: string
  /** 是否调用 reviewer 模型做语义审计 */
  useModelAudit: boolean
  signal: AbortSignal
  onDelta: (text: string) => void
  onStep: (step: PipelineStepKey, message: string) => void
}

export interface ChapterResult {
  chapterNo: number
  draft: ChapterDraft
  audit: AuditReport | null
  /** 复用了断点前已完成的步骤 */
  resumed: boolean
}

/**
 * 执行单章流水线：装配 → 起草 → 审计 → 记忆。
 * 每步完成后写入 `pipeline_step`；重跑同一 run 时已成功的步骤会被复用（断点恢复）。
 */
export async function runChapter(options: RunChapterOptions): Promise<ChapterResult> {
  const { runId, projectId, chapterNo, signal, onDelta, onStep } = options
  const done = new Set(
    listSteps(runId)
      .filter((step) => step.chapterNo === chapterNo && step.ok)
      .map((step) => step.step)
  )
  let resumed = false

  /* ------------------------------ 1. 装配上下文 ------------------------------ */
  onStep('assemble', `第 ${chapterNo} 章：装配上下文`)
  const bundle = buildChapterContext(projectId, chapterNo)
  if (!bundle) throw new Error(`项目不存在：${projectId}`)
  if (!bundle.brief) throw new Error(`第 ${chapterNo} 章缺少细纲，无法连写`)
  upsertStep(runId, chapterNo, 'assemble', true)

  const guidance = [bundle.context.userGuidance, options.steerGuidance].filter((item) => item.trim()).join('\n')
  const context = { ...bundle.context, userGuidance: guidance }

  /* -------------------------------- 2. 起草 -------------------------------- */
  let draft: ChapterDraft
  const existing = listDrafts(projectId).filter((item) => item.chapterNo === chapterNo && item.content.trim())
  const reusable = done.has('draft') ? existing[0] : undefined

  if (reusable) {
    draft = reusable
    resumed = true
    onStep('draft', `第 ${chapterNo} 章：复用断点前的正文`)
  } else {
    onStep('draft', `第 ${chapterNo} 章：起草正文`)
    const generated = await invokeChat({
      role: 'writer',
      messages: buildMessagesFor('draft', context),
      signal,
      onDelta
    })
    const trimmed = generated.trim()
    if (!trimmed) throw new Error(`第 ${chapterNo} 章生成结果为空`)

    draft = saveDraft({
      projectId,
      chapterNo,
      version: (existing[0]?.version ?? 0) + 1,
      status: 'draft',
      source: 'write',
      content: trimmed
    })
    upsertStep(runId, chapterNo, 'draft', true)
  }

  /* -------------------------------- 3. 审计 -------------------------------- */
  let audit: AuditReport | null = null
  if (done.has('audit')) {
    audit = getLatestReview(projectId, chapterNo)
    resumed = true
  } else {
    onStep('audit', `第 ${chapterNo} 章：一致性审计`)
    const previous = listDrafts(projectId).find((item) => item.chapterNo === chapterNo - 1)?.content ?? ''
    audit = await auditChapter({
      project: bundle.project,
      brief: bundle.brief,
      content: draft.content,
      previousContent: previous,
      useModel: options.useModelAudit,
      signal
    })
    saveReview(projectId, chapterNo, draft.id, audit)
    upsertStep(runId, chapterNo, 'audit', true)
  }

  /* ------------------------------ 4. 记忆回写 ------------------------------ */
  if (done.has('memory')) {
    resumed = true
  } else {
    onStep('memory', `第 ${chapterNo} 章：回写记忆`)
    await commitMemory({
      project: bundle.project,
      chapterNo,
      chapterTitle: bundle.brief.title,
      characters: bundle.brief.characters,
      draft,
      signal
    })
    upsertStep(runId, chapterNo, 'memory', true)
  }

  return { chapterNo, draft, audit, resumed }
}

/** 把既有正文按章重算记忆与真相文件（投影重建，§5.2） */
export async function rebuildMemory(projectId: number, signal?: AbortSignal): Promise<{ chapters: number }> {
  const project = getProject(projectId)
  if (!project) throw new Error(`项目不存在：${projectId}`)

  const drafts = listDrafts(projectId).filter((item) => item.content.trim())
  let chapters = 0
  for (const draft of drafts) {
    if (signal?.aborted) break
    const brief = listBriefs(projectId).find((item) => item.chapterNo === draft.chapterNo) ?? null
    await commitMemory({
      project,
      chapterNo: draft.chapterNo,
      chapterTitle: brief?.title ?? '',
      characters: brief?.characters ?? [],
      draft,
      signal
    })
    chapters += 1
  }
  return { chapters }
}