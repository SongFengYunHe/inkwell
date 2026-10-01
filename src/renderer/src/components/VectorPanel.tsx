import { useEffect, useState } from 'react'
import type { LibrarySettings, VectorIndexStatus, VectorRecallHit } from '@shared/types'
import { BUTTON_GHOST, BUTTON_PRIMARY, INPUT_CLASS } from './ui'
import { useAppStore } from '../stores/appStore'

/**
 * A3 向量检索（RAG）面板：索引状态 / 重建 / 试检索。
 * 检索默认关闭——它会为每章额外调用一次 embedding，属于「愿意付这个成本」才开的能力。
 */
export default function VectorPanel() {
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const [status, setStatus] = useState<VectorIndexStatus | null>(null)
  const [settings, setSettings] = useState<LibrarySettings | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [probe, setProbe] = useState('')
  const [hits, setHits] = useState<VectorRecallHit[]>([])

  const refresh = async (): Promise<void> => {
    const next = await window.inkwell.library.settings()
    setSettings(next)
    if (activeProjectId !== null) setStatus(await window.inkwell.vector.status(activeProjectId))
  }

  useEffect(() => {
    void refresh()
  }, [activeProjectId])

  const toggle = async (enabled: boolean): Promise<void> => {
    setBusy(true)
    try {
      const next = await window.inkwell.library.saveSettings({ ragSearch: enabled })
      setSettings(next)
      setMessage(enabled ? '已开启：生成正文时会检索相关回忆' : '已关闭向量检索')
      if (activeProjectId !== null) setStatus(await window.inkwell.vector.status(activeProjectId))
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const rebuild = async (): Promise<void> => {
    if (activeProjectId === null) return
    setBusy(true)
    setMessage('正在重建索引（每章一次 embedding 调用）…')
    try {
      const result = await window.inkwell.vector.rebuild(activeProjectId)
      setMessage(`索引完成：${result.chapters} 章 / ${result.chunks} 块（跳过 ${result.skipped} 章无正文）`)
      setStatus(await window.inkwell.vector.status(activeProjectId))
    } catch (err) {
      setMessage('重建失败：' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setBusy(false)
    }
  }

  const clear = async (): Promise<void> => {
    if (activeProjectId === null) return
    setBusy(true)
    try {
      await window.inkwell.vector.clear(activeProjectId)
      setHits([])
      setMessage('已清空该项目的向量索引')
      setStatus(await window.inkwell.vector.status(activeProjectId))
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const runProbe = async (): Promise<void> => {
    if (activeProjectId === null || !probe.trim()) return
    setBusy(true)
    setMessage('')
    try {
      setHits(await window.inkwell.vector.query({ projectId: activeProjectId, text: probe, limit: 5 }))
    } catch (err) {
      setHits([])
      setMessage('检索失败：' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-medium text-stone-700">向量检索（RAG）</h2>
        <p className="mt-1 text-xs text-stone-400">
          把已写章节切成块并向量化，写作时按当前细纲召回「相关回忆」，补足真相文件里没有的细节原文。
        </p>

        <label className="mt-4 flex items-center gap-2 text-xs text-stone-600">
          <input
            type="checkbox"
            checked={settings?.ragSearch ?? false}
            disabled={busy}
            onChange={(e) => void toggle(e.target.checked)}
            className="accent-amber-500"
          />
          写作时启用向量检索（每章额外一次 embedding 调用）
        </label>

        {activeProjectId === null ? (
          <p className="mt-4 rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-500">
            请先打开一个项目，再回来重建索引。
          </p>
        ) : (
          <>
            <dl className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-stone-200 p-3 text-xs">
              <div>
                <dt className="text-stone-400">embedder 端点</dt>
                <dd className={status?.embedderAvailable ? 'text-emerald-700' : 'text-amber-700'}>
                  {status?.embedderAvailable ? '已配置' : '未配置（请在「角色-模型路由」里给「向量」选端点）'}
                </dd>
              </div>
              <div>
                <dt className="text-stone-400">模型</dt>
                <dd className="break-all text-stone-700">{status?.model || '—'}</dd>
              </div>
              <div>
                <dt className="text-stone-400">已索引</dt>
                <dd className="text-stone-700">{status?.chapters ?? 0} 章 / {status?.chunks ?? 0} 块</dd>
              </div>
              <div>
                <dt className="text-stone-400">维度 / 更新时间</dt>
                <dd className="text-stone-700">
                  {status?.dim || '—'} · {status?.updatedAt ? new Date(status.updatedAt).toLocaleString('zh-CN') : '—'}
                </dd>
              </div>
            </dl>

            <div className="mt-4 flex items-center gap-3">
              <button type="button" onClick={() => void rebuild()} disabled={busy} className={BUTTON_PRIMARY}>
                重建索引
              </button>
              <button type="button" onClick={() => void clear()} disabled={busy} className={BUTTON_GHOST}>
                清空索引
              </button>
            </div>

            <div className="mt-4 flex gap-2">
              <input
                value={probe}
                onChange={(e) => setProbe(e.target.value)}
                placeholder="试检索：输入一段文本，看看能召回哪些段落"
                className={INPUT_CLASS}
              />
              <button type="button" onClick={() => void runProbe()} disabled={busy || !probe.trim()} className={BUTTON_GHOST}>
                试检索
              </button>
            </div>

            {hits.length > 0 && (
              <ul className="mt-3 space-y-2">
                {hits.map((hit) => (
                  <li key={hit.chapterNo + '-' + hit.chunkIdx} className="rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600">
                    <span className="mr-2 text-[11px] text-stone-400">
                      第 {hit.chapterNo} 章 · {hit.score.toFixed(3)}
                    </span>
                    {hit.text.slice(0, 160)}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {message && <p className="mt-3 text-xs text-stone-500">{message}</p>}
      </section>
    </div>
  )
}
