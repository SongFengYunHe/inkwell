import type { PipelineRun, PipelineStatus, PipelineStep } from '@shared/types'
import { and, asc, desc, eq, gte } from 'drizzle-orm'
import { getDb } from './client'
import { pipelineRun, pipelineStep } from './schema'

type RunRow = typeof pipelineRun.$inferSelect
type StepRow = typeof pipelineStep.$inferSelect

function toRunDto(row: RunRow): PipelineRun {
  return {
    id: row.id,
    projectId: row.projectId,
    fromCh: row.fromCh,
    toCh: row.toCh,
    status: row.status as PipelineStatus,
    cursor: row.cursor,
    requireAccept: row.requireAccept,
    steerGuidance: row.steerGuidance,
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

function toStepDto(row: StepRow): PipelineStep {
  return {
    id: row.id,
    runId: row.runId,
    chapterNo: row.chapterNo,
    step: row.step,
    ok: row.ok,
    attempt: row.attempt,
    error: row.error,
    updatedAt: row.updatedAt
  }
}

export interface CreateRunInput {
  projectId: number
  fromCh: number
  toCh: number
  requireAccept: boolean
}

export function createRun(input: CreateRunInput): PipelineRun {
  const now = Date.now()
  return toRunDto(
    getDb()
      .insert(pipelineRun)
      .values({
        projectId: input.projectId,
        fromCh: input.fromCh,
        toCh: input.toCh,
        status: 'running',
        cursor: input.fromCh,
        requireAccept: input.requireAccept,
        steerGuidance: '',
        error: '',
        createdAt: now,
        updatedAt: now
      })
      .returning()
      .get()
  )
}

export function getRun(id: number): PipelineRun | null {
  const row = getDb().select().from(pipelineRun).where(eq(pipelineRun.id, id)).get()
  return row ? toRunDto(row) : null
}

export function latestRun(projectId: number): PipelineRun | null {
  const row = getDb()
    .select()
    .from(pipelineRun)
    .where(eq(pipelineRun.projectId, projectId))
    .orderBy(desc(pipelineRun.id))
    .limit(1)
    .get()
  return row ? toRunDto(row) : null
}

export interface RunPatch {
  status?: PipelineStatus
  cursor?: number
  steerGuidance?: string
  error?: string
}

export function updateRun(id: number, patch: RunPatch): PipelineRun {
  const merged: Record<string, unknown> = { updatedAt: Date.now() }
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) merged[key] = value
  }
  const row = getDb().update(pipelineRun).set(merged).where(eq(pipelineRun.id, id)).returning().get()
  if (!row) throw new Error(`连写任务不存在：${id}`)
  return toRunDto(row)
}

/** 启动时把上次遗留的 running 任务标记为 interrupted，供用户手动续跑 */
export function markStaleRunsInterrupted(): number {
  const stale = getDb().select().from(pipelineRun).where(eq(pipelineRun.status, 'running')).all()
  for (const row of stale) {
    updateRun(row.id, { status: 'interrupted', error: '应用退出导致中断，可从断点继续' })
  }
  return stale.length
}

/* -------------------------------- 步骤进度 -------------------------------- */

export function upsertStep(runId: number, chapterNo: number, step: string, ok: boolean, error = ''): PipelineStep {
  const db = getDb()
  const now = Date.now()
  const existing = db
    .select()
    .from(pipelineStep)
    .where(
      and(eq(pipelineStep.runId, runId), eq(pipelineStep.chapterNo, chapterNo), eq(pipelineStep.step, step))
    )
    .get()

  if (existing) {
    return toStepDto(
      db
        .update(pipelineStep)
        .set({ ok, error, attempt: existing.attempt + 1, updatedAt: now })
        .where(eq(pipelineStep.id, existing.id))
        .returning()
        .get()
    )
  }
  return toStepDto(
    db
      .insert(pipelineStep)
      .values({ runId, chapterNo, step, ok, attempt: 1, error, updatedAt: now })
      .returning()
      .get()
  )
}

export function listSteps(runId: number): PipelineStep[] {
  return getDb()
    .select()
    .from(pipelineStep)
    .where(eq(pipelineStep.runId, runId))
    .orderBy(asc(pipelineStep.chapterNo), asc(pipelineStep.id))
    .all()
    .map(toStepDto)
}

/** 清除某章及其之后的步骤记录（重写 / 回退时使用） */
export function clearStepsFrom(runId: number, chapterNo: number): void {
  getDb()
    .delete(pipelineStep)
    .where(and(eq(pipelineStep.runId, runId), gte(pipelineStep.chapterNo, chapterNo)))
    .run()
}