import type { PipelineEvent, PipelineRun } from '@shared/types'
import { clearStepsFrom, getRun, listSteps, updateRun, upsertStep } from '../db/pipeline-repo'
import { runChapter, type PipelineStepKey } from './pipeline'

type Decision = 'accept' | 'reject' | 'abort'

interface PipelineControl {
  runId: number
  /** 用户点了「停止」 */
  aborted: boolean
  /** 用户点了「暂停」：当前章写完后停下 */
  pauseRequested: boolean
  skipRequested: boolean
  steerGuidance: string
  /** 当前章的 AbortController，用于暂停 / 停止时中断在途请求 */
  currentAbort: AbortController | null
  /** 逐章验收的决策等待 */
  decision: ((value: Decision) => void) | null
  status: PipelineRun['status']
}

const controls = new Map<string, PipelineControl>()

export interface RunPipelineOptions {
  requestId: string
  run: PipelineRun
  /** 是否用 reviewer 模型补充语义审计 */
  useModelAudit: boolean
  emit: (event: PipelineEvent) => void
}

function emitProgress(
  options: RunPipelineOptions,
  run: PipelineRun,
  chapterNo: number,
  step: string,
  message: string
): void {
  options.emit({ requestId: options.requestId, type: 'progress', run, chapterNo, step, message })
}

/** 等待逐章验收决策；被暂停 / 停止时也会被唤醒 */
function waitDecision(control: PipelineControl): Promise<Decision> {
  return new Promise<Decision>((resolve) => {
    control.decision = resolve
  })
}

/**
 * 连写队列主循环（计划书 §7.4）：
 * 逐章跑「装配 → 起草 → 审计 → 记忆」，每章结束推进 cursor；
 * 支持暂停 / 继续、Steer 注入、逐章验收、跳过，以及崩溃后的断点续跑。
 */
export async function runPipeline(options: RunPipelineOptions): Promise<void> {
  const { requestId, emit, useModelAudit } = options
  let run = options.run

  const control: PipelineControl = {
    runId: run.id,
    aborted: false,
    pauseRequested: false,
    skipRequested: false,
    steerGuidance: run.steerGuidance,
    currentAbort: null,
    decision: null,
    status: 'running'
  }
  controls.set(requestId, control)

  let written = 0

  try {
    let chapter = run.cursor
    while (chapter <= run.toCh) {
      if (control.aborted) break

      // 暂停：在章节边界干净退出，cursor 停在当前章，可随时继续
      if (control.pauseRequested) {
        run = updateRun(run.id, { status: 'paused', cursor: chapter })
        control.status = 'paused'
        emitProgress(options, run, chapter, 'paused', `已暂停，下一章：第 ${chapter} 章`)
        return
      }

      // 跳过当前章
      if (control.skipRequested) {
        control.skipRequested = false
        upsertStep(run.id, chapter, 'skip', true)
        run = updateRun(run.id, { cursor: chapter + 1 })
        emitProgress(options, run, chapter, 'skip', `已跳过第 ${chapter} 章`)
        chapter += 1
        continue
      }

      // 断点恢复提示
      const completed = new Set(
        listSteps(run.id)
          .filter((step) => step.chapterNo === chapter && step.ok)
          .map((step) => step.step)
      )
      if (completed.size > 0) {
        emitProgress(options, run, chapter, 'resume', `第 ${chapter} 章：从断点续跑（已完成 ${completed.size} 步）`)
      }

      const abort = new AbortController()
      control.currentAbort = abort

      const result = await runChapter({
        runId: run.id,
        projectId: run.projectId,
        chapterNo: chapter,
        steerGuidance: control.steerGuidance,
        useModelAudit,
        signal: abort.signal,
        onDelta: () => undefined,
        onStep: (step: PipelineStepKey, message: string) => {
          const current = getRun(run.id)
          emitProgress(options, current ?? run, chapter, step, message)
        }
      })

      run = updateRun(run.id, { cursor: chapter + 1 })
      written += 1
      emit({ requestId, type: 'chapter_done', run, chapterNo: chapter, audit: result.audit })

      // 逐章验收：暂停等待用户确认
      if (run.requireAccept) {
        run = updateRun(run.id, { status: 'awaiting_accept' })
        control.status = 'awaiting_accept'
        emit({ requestId, type: 'awaiting_accept', run, chapterNo: chapter })

        const decision = await waitDecision(control)
        control.decision = null

        if (decision === 'abort') {
          if (control.aborted) break
          // 暂停发生在等待验收期间：干净退出，保留 cursor
          run = updateRun(run.id, { status: 'paused', cursor: chapter })
          control.status = 'paused'
          emitProgress(options, run, chapter, 'paused', `已暂停，下一章：第 ${chapter} 章`)
          return
        }
        if (decision === 'reject') {
          // 重写本章：清掉步骤与生成记录后重跑
          clearStepsFrom(run.id, chapter)
          written -= 1
          control.status = 'running'
          run = updateRun(run.id, { status: 'running', cursor: chapter })
          emitProgress(options, run, chapter, 'retry', `第 ${chapter} 章：按你的意见重写`)
          continue
        }
        control.status = 'running'
        run = updateRun(run.id, { status: 'running' })
      }

      chapter += 1
    }

    if (control.aborted) {
      run = updateRun(run.id, { status: 'aborted', error: '已停止' })
      control.status = 'aborted'
      emit({ requestId, type: 'error', run, message: '已停止' })
      return
    }

    run = updateRun(run.id, { status: 'done', cursor: run.toCh + 1, error: '' })
    control.status = 'done'
    emit({ requestId, type: 'done', run, written })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (control.pauseRequested && !control.aborted) {
      run = updateRun(run.id, { status: 'paused', error: '' })
      control.status = 'paused'
      emitProgress(options, run, run.cursor, 'paused', '已暂停')
      return
    }
    const status = control.aborted ? 'aborted' : 'failed'
    control.status = status
    run = updateRun(run.id, { status, error: control.aborted ? '已停止' : message })
    emit({ requestId, type: 'error', run, message: control.aborted ? '已停止' : message })
  } finally {
    controls.delete(requestId)
  }
}

/* ------------------------------ 运行期控制指令 ------------------------------ */

export function pausePipeline(requestId: string): boolean {
  const control = controls.get(requestId)
  if (!control) return false
  control.pauseRequested = true
  control.currentAbort?.abort()
  control.decision?.('abort')
  return true
}

export function abortPipeline(requestId: string): boolean {
  const control = controls.get(requestId)
  if (!control) return false
  control.aborted = true
  control.currentAbort?.abort()
  control.decision?.('abort')
  return true
}

export function steerPipeline(requestId: string, guidance: string): boolean {
  const control = controls.get(requestId)
  if (!control) return false
  control.steerGuidance = guidance
  return true
}

export function skipPipeline(requestId: string): boolean {
  const control = controls.get(requestId)
  if (!control) return false
  control.skipRequested = true
  return true
}

export function acceptPipeline(requestId: string): boolean {
  const control = controls.get(requestId)
  if (!control?.decision) return false
  control.decision('accept')
  return true
}

export function rejectPipeline(requestId: string): boolean {
  const control = controls.get(requestId)
  if (!control?.decision) return false
  control.decision('reject')
  return true
}

export function isPipelineRunning(requestId: string): boolean {
  return controls.has(requestId)
}

/** 取某个请求标识当前关联的 run id（用于把 Steer 落库） */
export function getControlRunId(requestId: string): number | null {
  return controls.get(requestId)?.runId ?? null
}