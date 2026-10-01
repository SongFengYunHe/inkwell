import { useState } from 'react'
import type { StyleAuditReport } from '@shared/types'
import { BUTTON_GHOST } from './ui'

/**
 * M10：文风一致性体检。
 * 确定性指标（不花钱）先给出 0–100 与逐项偏离；勾选「模型复核」再让审稿模型指出最不像的段落。
 */
export default function StyleAuditPanel({
  projectId,
  chapterNo,
  hasContent
}: {
  projectId: number
  chapterNo: number
  hasContent: boolean
}) {
  const [report, setReport] = useState<StyleAuditReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [useModel, setUseModel] = useState(false)
  const [message, setMessage] = useState('')

  const run = async (): Promise<void> => {
    setBusy(true)
    setMessage('')
    try {
      const next = await window.inkwell.style.audit({ projectId, chapterNo, useModel })
      setReport(next)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const scoreClass = (score: number): string => {
    if (score >= 80) return 'text-emerald-700'
    if (score >= 60) return 'text-amber-700'
    return 'text-red-600'
  }

  return (
    <div className='flex flex-col gap-2'>
      <div className='flex flex-wrap items-center gap-3 text-xs text-stone-500'>
        <button
          type='button'
          onClick={() => void run()}
          disabled={busy || !hasContent}
          className={BUTTON_GHOST + ' px-3 py-1.5 text-xs'}
        >
          {busy ? '文风体检中…' : '文风体检'}
        </button>
        <label className='flex items-center gap-1.5'>
          <input
            type='checkbox'
            checked={useModel}
            onChange={(e) => setUseModel(e.target.checked)}
            className='accent-amber-500'
          />
          含模型复核（会调用审稿模型）
        </label>
        {report && (
          <span className='text-stone-600'>
            贴合度 <b className={scoreClass(report.score)}>{report.score}</b> / 100
          </span>
        )}
        {message && <span className='text-red-600'>{message}</span>}
      </div>

      {report && report.checks.length > 0 && (
        <details className='rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600'>
          <summary className='cursor-pointer select-none'>文风逐项（{report.checks.length}）</summary>
          <ul className='mt-2 space-y-1'>
            {report.checks.map((check) => (
              <li key={check.dimension} className='flex flex-wrap items-baseline gap-2'>
                <span className={scoreClass(check.score) + ' w-10 shrink-0 text-right'}>{check.score}</span>
                <span className='shrink-0 text-stone-500'>{check.dimension}</span>
                <span className='min-w-0 text-stone-700'>{check.detail}</span>
                <span className='text-stone-400'>实测 {check.actual}｜期望 {check.expected}</span>
              </li>
            ))}
          </ul>
          {report.modelNotes.length > 0 && (
            <div className='mt-2 border-t border-stone-200 pt-2'>
              <p className='text-stone-500'>模型复核：</p>
              <ul className='mt-1 list-disc pl-5'>
                {report.modelNotes.map((note, index) => (
                  <li key={index}>{note}</li>
                ))}
              </ul>
            </div>
          )}
        </details>
      )}
    </div>
  )
}
