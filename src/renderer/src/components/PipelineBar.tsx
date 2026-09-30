import { useState } from 'react'
import { useAppStore } from '../stores/appStore'
import { BUTTON_GHOST, BUTTON_PRIMARY, INPUT_CLASS } from './ui'

/** 连写控制条：全自动整本 / 断点续跑 / 暂停 / Steer / 逐章验收（计划书 §7.4） */
export default function PipelineBar() {
  const projects = useAppStore((s) => s.projects)
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const briefs = useAppStore((s) => s.briefs)
  const pipeline = useAppStore((s) => s.pipeline)
  const lastRun = useAppStore((s) => s.lastRun)
  const pipelineNotice = useAppStore((s) => s.pipelineNotice)
  const clearPipelineNotice = useAppStore((s) => s.clearPipelineNotice)
  const currentChapterNo = useAppStore((s) => s.currentChapterNo)
  const startPipeline = useAppStore((s) => s.startPipeline)
  const resumePipeline = useAppStore((s) => s.resumePipeline)
  const pausePipeline = useAppStore((s) => s.pausePipeline)
  const abortPipeline = useAppStore((s) => s.abortPipeline)
  const skipPipeline = useAppStore((s) => s.skipPipeline)
  const acceptPipeline = useAppStore((s) => s.acceptPipeline)
  const rejectPipeline = useAppStore((s) => s.rejectPipeline)
  const steerPipeline = useAppStore((s) => s.steerPipeline)

  const [requireAccept, setRequireAccept] = useState(false)
  const [steer, setSteer] = useState('')

  const project = projects.find((item) => item.id === activeProjectId) ?? null
  if (!project) return null

  const running = pipeline !== null
  const awaiting = pipeline?.run?.status === 'awaiting_accept'
  const briefedChapters = briefs.length
  const canStart = briefedChapters > 0 && !running

  const canResume =
    !running && lastRun !== null && lastRun.status !== 'done' && lastRun.status !== 'running'

  return (
    <div className="border-b border-stone-200 bg-white px-5 py-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-xs font-medium text-stone-500">连写</span>

        {running ? (
          <>
            <span className="text-stone-700">{pipeline.message}</span>
            {pipeline.run && (
              <span className="text-xs text-stone-400">
                进度 {Math.max(0, (pipeline.run.cursor ?? 1) - pipeline.run.fromCh)}/
                {Math.max(1, pipeline.run.toCh - pipeline.run.fromCh + 1)} 章
              </span>
            )}

            {awaiting ? (
              <>
                <button type="button" onClick={() => void acceptPipeline()} className={BUTTON_PRIMARY}>
                  通过，继续
                </button>
                <button type="button" onClick={() => void rejectPipeline()} className={BUTTON_GHOST}>
                  重写本章
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => void pausePipeline()} className={BUTTON_GHOST}>
                  暂停
                </button>
                <button type="button" onClick={() => void skipPipeline()} className={BUTTON_GHOST}>
                  跳过本章
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => void abortPipeline()}
              className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600 transition hover:bg-red-50"
            >
              停止
            </button>

            <div className="ml-auto flex items-center gap-2">
              <input
                value={steer}
                onChange={(event) => setSteer(event.target.value)}
                placeholder="Steer：注入后续章节的要求 / 禁止项"
                className={`${INPUT_CLASS} w-72 py-1.5`}
              />
              <button
                type="button"
                disabled={!steer.trim()}
                onClick={() => {
                  void steerPipeline(steer.trim())
                  setSteer('')
                }}
                className={BUTTON_GHOST}
              >
                下发
              </button>
            </div>
          </>
        ) : (
          <>
            <span className="text-xs text-stone-400">
              已填细纲 {briefedChapters} 章 · 计划 {project.totalChapters} 章
            </span>
            <label className="flex items-center gap-1 text-xs text-stone-500">
              <input
                type="checkbox"
                checked={requireAccept}
                onChange={(event) => setRequireAccept(event.target.checked)}
              />
              逐章验收
            </label>
            <button
              type="button"
              disabled={!canStart}
              onClick={() => void startPipeline({ fromCh: currentChapterNo, requireAccept })}
              className={BUTTON_PRIMARY}
            >
              从第 {currentChapterNo} 章连写整本
            </button>
            {canResume && (
              <button type="button" onClick={() => void resumePipeline()} className={BUTTON_GHOST}>
                继续连写（断点：第 {lastRun.cursor} 章）
              </button>
            )}
            {briefedChapters === 0 && <span className="text-xs text-amber-700">请先生成细纲</span>}
          </>
        )}

        {pipelineNotice && (
          <button
            type="button"
            onClick={clearPipelineNotice}
            className="ml-auto text-xs text-stone-400 hover:text-stone-600"
          >
            {pipelineNotice} ✕
          </button>
        )}
      </div>
    </div>
  )
}