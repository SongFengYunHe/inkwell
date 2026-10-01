import { useCallback, useEffect, useState } from 'react'
import type { BackupInfo, LibrarySettings } from '@shared/types'
import { BUTTON_GHOST, BUTTON_PRIMARY } from './ui'

function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const REASON_LABEL: Record<string, string> = {
  startup: '启动自动',
  interval: '定时自动',
  migrate: '迁移前',
  manual: '手动',
  'pre-restore': '恢复前保护'
}

export default function BackupPanel() {
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [settings, setSettings] = useState<LibrarySettings | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const refresh = useCallback(async (): Promise<void> => {
    setBackups(await window.inkwell.backup.list())
  }, [])

  useEffect(() => {
    void refresh()
    void window.inkwell.library.settings().then(setSettings)
  }, [refresh])

  const createNow = async (): Promise<void> => {
    setBusy(true)
    try {
      const info = await window.inkwell.backup.create()
      setMessage(`已备份：${info.name}（${formatBytes(info.bytes)}）`)
      await refresh()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const restore = async (item: BackupInfo): Promise<void> => {
    if (!window.confirm(`将用「${item.name}」覆盖当前书库，恢复前会自动再备份一份当前数据。确定恢复？`)) return
    setBusy(true)
    try {
      await window.inkwell.backup.restore(item.name)
      setMessage('已恢复。若正文未刷新，请重新打开项目。')
      await refresh()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (item: BackupInfo): Promise<void> => {
    setBusy(true)
    try {
      await window.inkwell.backup.remove(item.name)
      await refresh()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const toggleSetting = async (patch: Partial<LibrarySettings>): Promise<void> => {
    const before = settings
    setMessage('')
    try {
      const next = await window.inkwell.library.saveSettings(patch)
      setSettings(next)
    } catch (err) {
      // 保存失败时把复选框回滚到落盘状态，避免「界面看着生效、实际没保存」
      setSettings(before)
      setMessage(`设置保存失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const clearCache = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.inkwell.app.clearCache()
      setMessage(`已清理运行时缓存，释放 ${formatBytes(result.freedBytes)}`)
    } catch (err) {
      setMessage(`清理缓存失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white p-4">
        <div>
          <h2 className="text-sm font-medium text-stone-700">数据与备份</h2>
          <p className="mt-1 text-xs text-stone-400">
            备份使用 SQLite 一致快照，可在任意磁盘保存。轮转策略：保留最近 10 份 + 每天 1 份（7 天）+ 每周 1 份（4 周）。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void window.inkwell.backup.reveal()} className={BUTTON_GHOST}>
            打开所在目录
          </button>
          <button type="button" onClick={() => void createNow()} disabled={busy} className={BUTTON_PRIMARY}>
            立即备份
          </button>
        </div>
      </section>

      {message && <p className="rounded-lg bg-stone-100 px-3 py-2 text-xs text-stone-600">{message}</p>}

      {backups.length === 0 ? (
        <p className="rounded-xl border border-dashed border-stone-300 px-4 py-10 text-center text-sm text-stone-400">
          还没有备份
        </p>
      ) : (
        <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 bg-white">
          {backups.map((item) => (
            <li key={item.name} className="flex items-center gap-4 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-stone-700">{formatTime(item.createdAt)}</p>
                <p className="text-[11px] text-stone-400">
                  {REASON_LABEL[item.reason] ?? item.reason} · {formatBytes(item.bytes)} · {item.name}
                </p>
              </div>
              <button type="button" onClick={() => void restore(item)} disabled={busy} className={BUTTON_GHOST}>
                恢复
              </button>
              <button
                type="button"
                onClick={() => void remove(item)}
                disabled={busy}
                className="text-xs text-stone-400 transition hover:text-red-600"
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      )}

      <section className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-4">
        <h3 className="text-sm font-medium text-stone-700">偏好</h3>
        <label className="flex items-center gap-2 text-sm text-stone-600">
          <input
            type="checkbox"
            checked={settings?.autoBackup ?? true}
            onChange={(e) => void toggleSetting({ autoBackup: e.target.checked })}
            className="size-4 accent-amber-500"
          />
          自动备份（启动后 60 秒首次，之后每 6 小时一次）
        </label>
        <label className="flex items-center gap-2 text-sm text-stone-600">
          <input
            type="checkbox"
            checked={settings?.cleanCacheOnQuit ?? false}
            onChange={(e) => void toggleSetting({ cleanCacheOnQuit: e.target.checked })}
            className="size-4 accent-amber-500"
          />
          退出时清理 Electron 运行时缓存
        </label>
        <div className="pt-1">
          <button type="button" onClick={() => void clearCache()} className={BUTTON_GHOST}>
            立即清理运行时缓存
          </button>
        </div>
      </section>
    </div>
  )
}