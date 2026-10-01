import { useEffect, useState } from 'react'
import type { LibrarySettings, UpdateStatus } from '@shared/types'
import { BUTTON_GHOST, BUTTON_PRIMARY } from './ui'

/**
 * A4 自动更新面板（设置 · 关于）。
 * 只自动检查并提示；下载与安装都由用户点按钮触发，应用不会擅自重启。
 */
export default function UpdatePanel() {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [settings, setSettings] = useState<LibrarySettings | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.inkwell.update.status().then(setStatus)
    void window.inkwell.library.settings().then(setSettings)
    return window.inkwell.update.onEvent(setStatus)
  }, [])

  const run = async (task: () => Promise<UpdateStatus | void>): Promise<void> => {
    setBusy(true)
    setMessage('')
    try {
      const next = await task()
      if (next) setStatus(next)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const toggleAuto = async (enabled: boolean): Promise<void> => {
    setBusy(true)
    try {
      setSettings(await window.inkwell.library.saveSettings({ autoUpdate: enabled }))
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const phase = status?.phase ?? 'idle'

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-stone-700">更新</h2>
        <span className="text-xs text-stone-400">当前版本 {status?.currentVersion ?? '—'}</span>
      </div>

      <p className="mt-2 text-xs text-stone-500">
        {status?.supported === false
          ? '开发模式不检查更新：打包安装后，应用会从 GitHub Releases 读取 latest.yml 自动检查。'
          : status?.message || '尚未检查更新。'}
      </p>

      {phase === 'downloading' && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-stone-200">
          <div className="h-full bg-amber-500 transition-all" style={{ width: `${status?.percent ?? 0}%` }} />
        </div>
      )}

      {Boolean(status?.releaseNotes) && (
        <pre className="mt-3 max-h-40 overflow-y-auto rounded-lg bg-stone-50 p-3 text-[11px] whitespace-pre-wrap text-stone-600">
          {status?.releaseNotes}
        </pre>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void run(() => window.inkwell.update.check())}
          disabled={busy || phase === 'checking'}
          className={BUTTON_PRIMARY}
        >
          {phase === 'checking' ? '检查中…' : '检查更新'}
        </button>
        {phase === 'available' && (
          <button type="button" onClick={() => void run(() => window.inkwell.update.download())} disabled={busy} className={BUTTON_GHOST}>
            下载 {status?.version ?? ''}
          </button>
        )}
        {phase === 'downloaded' && (
          <button
            type="button"
            onClick={() => void window.inkwell.update.install()}
            disabled={busy}
            className={BUTTON_GHOST}
          >
            重启并安装
          </button>
        )}
      </div>

      <label className="mt-4 flex items-center gap-2 text-xs text-stone-600">
        <input
          type="checkbox"
          checked={settings?.autoUpdate ?? true}
          disabled={busy}
          onChange={(e) => void toggleAuto(e.target.checked)}
          className="accent-amber-500"
        />
        启动后自动检查更新（只提示，不自动安装）
      </label>

      {message && <p className="mt-2 text-xs text-red-600">{message}</p>}
    </section>
  )
}
