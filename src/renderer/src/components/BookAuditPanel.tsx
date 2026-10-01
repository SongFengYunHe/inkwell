import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AuditCheck, BookAuditEstimate, BookAuditProgress, BookAuditSummary } from '@shared/types'

const SEVERITY_LABEL: Record<AuditCheck['severity'], string> = { info: '提示', warn: '警告', error: '严重' }
const SEVERITY_CLASS: Record<AuditCheck['severity'], string> = {
  info: 'bg-stone-100 text-stone-500',
  warn: 'bg-amber-100 text-amber-700',
  error: 'bg-red-100 text-red-700'
}

/**
 * 全书一键体检面板（M8 §5.2）。
 * - 默认跑确定性审计（零成本、不联网）；
 * - 勾选「模型语义审计」时先给出 token 预估并要求确认，运行中可中止；
 * - 支持「只看严重 / 只看某维度」筛选与批量一键修复选中章。
 */
export default function BookAuditPanel({ projectId, onClose }: { projectId: number; onClose: () => void }) {
  const [summary, setSummary] = useState<BookAuditSummary | null>(null)
  const [progress, setProgress] = useState<BookAuditProgress | null>(null)
  const [running, setRunning] = useState(false)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [useModel, setUseModel] = useState(false)
  const [estimate, setEstimate] = useState<BookAuditEstimate | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filterSevere, setFilterSevere] = useState(false)
  const [filterDim, setFilterDim] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [fixing, setFixing] = useState(false)

  useEffect(() => {
    return window.inkwell.audit.onEvent((event) => {
      if (event.type === 'progress') {
        setProgress(event.progress)
        return
      }
      if (event.type === 'done') {
        setSummary(event.summary)
        setProgress(null)
        setRunning(false)
        setTaskId(null)
        return
      }
      setError(event.message)
      setProgress(null)
      setRunning(false)
      setTaskId(null)
    })
  }, [])

  const startAudit = useCallback(
    async (withModel: boolean, confirm: boolean) => {
      setError(null)
      setEstimate(null)
      const result = await window.inkwell.audit.book({ projectId, useModel: withModel, confirm })
      if (result.needsConfirm) {
        setEstimate(result.estimate)
        return
      }
      setTaskId(result.taskId)
      setRunning(true)
      setProgress(null)
    },
    [projectId]
  )

  // 打开面板即跑一次确定性体检（零成本）
  useEffect(() => {
    void startAudit(false, true)
  }, [startAudit])

  const dimensions = summary?.dimensions ?? []
  const maxFailed = Math.max(1, ...dimensions.map((item) => item.failed))

  const visibleChapters = useMemo(() => {
    if (!summary) return []
    return summary.chapters.filter((chapter) => {
      const failed = chapter.report.checks.filter(
        (check) => !check.passed && (filterDim ? check.dimension === filterDim : true)
      )
      if (filterDim) return failed.length > 0
      if (filterSevere) return failed.some((check) => check.severity === 'error')
      return true
    })
  }, [summary, filterDim, filterSevere])

  const toggleSelect = (chapterNo: number): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(chapterNo)) next.delete(chapterNo)
      else next.add(chapterNo)
      return next
    })
  }

  const allVisibleSelected = visibleChapters.length > 0 && visibleChapters.every((c) => selected.has(c.chapterNo))

  const toggleAll = (): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) for (const chapter of visibleChapters) next.delete(chapter.chapterNo)
      else for (const chapter of visibleChapters) next.add(chapter.chapterNo)
      return next
    })
  }

  const fixSelected = async (): Promise<void> => {
    const targets = [...selected]
    if (targets.length === 0) return
    setFixing(true)
    setError(null)
    try {
      for (const chapterNo of targets) {
        await window.inkwell.draft.fix({ projectId, chapterNo, useModel: false })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setFixing(false)
      setSelected(new Set())
      await startAudit(false, true)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-stone-900/40 px-4 py-8">
      <div className="flex h-full max-h-[86vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="flex items-center gap-3 border-b border-stone-200 px-5 py-3">
          <h2 className="text-base font-medium">全书一键体检</h2>
          <span className="text-xs text-stone-400">默认仅跑确定性审计（不联网、零成本）</span>
          <div className="ml-auto flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-stone-500">
              <input
                type="checkbox"
                checked={useModel}
                onChange={(event) => setUseModel(event.target.checked)}
                className="accent-amber-500"
              />
              模型语义审计
            </label>
            <button
              type="button"
              onClick={() => void startAudit(useModel, useModel ? false : true)}
              disabled={running || fixing}
              className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-stone-700 disabled:opacity-40"
            >
              {running ? '体检中…' : '重新体检'}
            </button>
            {running && (
              <button
                type="button"
                onClick={() => taskId && void window.inkwell.audit.abort(taskId)}
                className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm text-stone-600 transition hover:bg-stone-50"
              >
                中止
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm text-stone-600 transition hover:bg-stone-50"
            >
              关闭
            </button>
          </div>
        </header>

        {error && <div className="border-b border-red-200 bg-red-50 px-5 py-2 text-xs text-red-700">{error}</div>}

        {estimate && (
          <div className="flex items-center gap-4 border-b border-amber-200 bg-amber-50 px-5 py-3 text-xs text-amber-800">
            <span>
              模型语义审计将逐章调用审稿模型：共 <b>{estimate.chapters}</b> 章，预估提示词约{' '}
              <b>{estimate.promptTokens.toLocaleString()}</b> tokens，合计约{' '}
              <b>{estimate.estTotalTokens.toLocaleString()}</b> tokens。
            </span>
            <button
              type="button"
              onClick={() => void startAudit(true, true)}
              className="ml-auto shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 font-medium text-stone-900 transition hover:bg-amber-400"
            >
              我了解，开始
            </button>
            <button type="button" onClick={() => setEstimate(null)} className="shrink-0 text-amber-700 underline">
              取消
            </button>
          </div>
        )}

        {progress && (
          <div className="border-b border-stone-200 bg-stone-50 px-5 py-2">
            <div className="flex justify-between text-[11px] text-stone-500">
              <span>{progress.message}</span>
              <span>
                {progress.done}/{progress.total}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-stone-200">
              <div
                className="h-full bg-amber-500 transition-all"
                style={{ width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          {/* 左：维度统计 + 筛选 */}
          <aside className="w-72 shrink-0 overflow-y-auto border-r border-stone-200 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-medium text-stone-600">
                维度命中（共 {summary?.totalIssues ?? 0} 处问题）
              </span>
            </div>
            {dimensions.length === 0 ? (
              <p className="text-xs text-stone-400">暂无数据</p>
            ) : (
              <div className="space-y-1.5">
                {dimensions.map((item) => (
                  <button
                    key={item.dimension}
                    type="button"
                    onClick={() => setFilterDim((prev) => (prev === item.dimension ? '' : item.dimension))}
                    className={`flex w-full flex-col gap-0.5 rounded-lg px-2 py-1 text-left transition ${
                      filterDim === item.dimension ? 'bg-amber-50' : 'hover:bg-stone-50'
                    }`}
                  >
                    <div className="flex justify-between text-[11px]">
                      <span className="truncate text-stone-600">{item.dimension}</span>
                      <span className={item.failed > 0 ? 'text-red-600' : 'text-stone-400'}>
                        {item.failed}/{item.total}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-stone-100">
                      <div
                        className={`h-full ${item.failed > 0 ? 'bg-red-400' : 'bg-stone-300'}`}
                        style={{ width: `${(item.failed / maxFailed) * 100}%` }}
                      />
                    </div>
                  </button>
                ))}
              </div>
            )}

            <label className="mt-4 flex items-center gap-1.5 text-xs text-stone-500">
              <input
                type="checkbox"
                checked={filterSevere}
                onChange={(event) => setFilterSevere(event.target.checked)}
                className="accent-amber-500"
              />
              只看严重（error）
            </label>

            {selected.size > 0 && (
              <button
                type="button"
                onClick={() => void fixSelected()}
                disabled={fixing}
                className="mt-4 w-full rounded-lg bg-stone-900 px-3 py-2 text-xs font-medium text-white transition hover:bg-stone-700 disabled:opacity-40"
              >
                {fixing ? '修复中…' : `一键修复选中 ${selected.size} 章`}
              </button>
            )}
          </aside>

          {/* 右：按章问题清单 */}
          <section className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="mb-2 flex items-center gap-3 text-xs text-stone-500">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleAll}
                  className="accent-amber-500"
                />
                全选当前列表
              </label>
              <span>共 {visibleChapters.length} 章</span>
            </div>

            {visibleChapters.length === 0 ? (
              <p className="px-1 py-6 text-center text-xs text-stone-400">没有符合条件的章节。</p>
            ) : (
              <div className="space-y-2">
                {visibleChapters.map((chapter) => {
                  const issues = chapter.report.checks.filter(
                    (check) => !check.passed && (filterDim ? check.dimension === filterDim : true)
                  )
                  return (
                    <div key={chapter.chapterNo} className="rounded-xl border border-stone-200 p-3">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selected.has(chapter.chapterNo)}
                          onChange={() => toggleSelect(chapter.chapterNo)}
                          className="accent-amber-500"
                        />
                        <span className="text-sm font-medium text-stone-700">
                          第 {chapter.chapterNo} 章
                          {chapter.title ? ` · ${chapter.title}` : ''}
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] ${
                            chapter.report.passed ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                          }`}
                        >
                          {chapter.report.passed ? '通过' : `${issues.length} 处问题`}
                        </span>
                        <span className="ml-auto text-[11px] text-stone-400">评分 {chapter.report.score}</span>
                      </div>
                      {issues.length > 0 && (
                        <ul className="mt-2 space-y-1 pl-6">
                          {issues.map((check, index) => (
                            <li key={index} className="flex items-start gap-2 text-xs text-stone-600">
                              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${SEVERITY_CLASS[check.severity]}`}>
                                {SEVERITY_LABEL[check.severity]}
                              </span>
                              <span className="shrink-0 text-stone-500">{check.dimension}</span>
                              <span className="min-w-0">
                                {check.detail}
                                {check.paragraph !== undefined && (
                                  <span className="ml-1 text-stone-400">（第 {check.paragraph + 1} 段）</span>
                                )}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}