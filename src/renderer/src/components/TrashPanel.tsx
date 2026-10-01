import { useCallback, useEffect, useState } from 'react'
import type { TrashItem, TrashRetention } from '@shared/types'
import { useAppStore } from '../stores/appStore'
import { BUTTON_GHOST } from './ui'

const RETENTION_OPTIONS: Array<{ value: TrashRetention; label: string }> = [
  { value: 7, label: '保留 7 天' },
  { value: 30, label: '保留 30 天（默认）' },
  { value: 90, label: '保留 90 天' },
  { value: 0, label: '永久保留' }
]

function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function TrashPanel() {
  const loadProjects = useAppStore((s) => s.loadProjects)
  const [items, setItems] = useState<TrashItem[]>([])
  const [retention, setRetention] = useState<TrashRetention>(30)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setItems(await window.inkwell.trash.list())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void refresh()
    void window.inkwell.library.settings().then((settings) => setRetention(settings.trashRetentionDays))
  }, [refresh])

  const restore = async (item: TrashItem): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const result = await window.inkwell.trash.restore({ kind: item.kind, id: item.id })
      if (result.chapterNo && item.chapterNo && result.chapterNo !== item.chapterNo) {
        setError(`原章节号已被占用，已恢复到第 ${result.chapterNo} 章`)
      }
      await refresh()
      await loadProjects()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const purge = async (item: TrashItem): Promise<void> => {
    setBusy(true)
    try {
      await window.inkwell.trash.purge({ kind: item.kind, id: item.id })
      await refresh()
      await loadProjects()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const empty = async (): Promise<void> => {
    if (!window.confirm('清空回收站会永久删除其中全部内容，无法恢复。确定继续？')) return
    setBusy(true)
    try {
      const result = await window.inkwell.trash.empty()
      setError(`已彻底删除 ${result.removed} 项`)
      await refresh()
      await loadProjects()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const changeRetention = async (value: TrashRetention): Promise<void> => {
    setRetention(value)
    await window.inkwell.library.saveSettings({ trashRetentionDays: value })
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white p-4">
        <div>
          <h2 className="text-sm font-medium text-stone-700">回收站</h2>
          <p className="mt-1 text-xs text-stone-400">
            删除操作都是软删除，会先进入这里；到期自动清理，也可随时手动清空。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={retention}
            onChange={(e) => void changeRetention(Number(e.target.value) as TrashRetention)}
            className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-amber-500"
          >
            {RETENTION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => void empty()} disabled={busy || items.length === 0} className={BUTTON_GHOST}>
            清空回收站
          </button>
        </div>
      </section>

      {error && <p className="rounded-lg bg-stone-100 px-3 py-2 text-xs text-stone-600">{error}</p>}

      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-stone-300 px-4 py-10 text-center text-sm text-stone-400">
          回收站是空的
        </p>
      ) : (
        <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 bg-white">
          {items.map((item) => (
            <li key={`${item.kind}-${item.id}`} className="flex items-center gap-4 px-4 py-3">
              <span className="rounded bg-stone-100 px-2 py-0.5 text-[11px] text-stone-500">
                {item.kind === 'project' ? '项目' : '章节'}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-stone-700">
                  {item.kind === 'chapter' ? `${item.projectName} · ${item.title}` : item.title}
                </p>
                <p className="text-[11px] text-stone-400">
                  删除于 {formatTime(item.deletedAt)}
                  {item.kind === 'chapter' && item.draftCount > 0 && ` · 连带 ${item.draftCount} 篇正文`}
                  {item.expiresAt ? ` · ${formatTime(item.expiresAt)} 自动清理` : ' · 永久保留'}
                </p>
              </div>
              <button type="button" onClick={() => void restore(item)} disabled={busy} className={BUTTON_GHOST}>
                恢复
              </button>
              <button
                type="button"
                onClick={() => void purge(item)}
                disabled={busy}
                className="text-xs text-stone-400 transition hover:text-red-600"
              >
                彻底删除
              </button>
            </li>
          ))}
        </ul>
      )}

      {items.length > 0 && (
        <p className="text-xs text-stone-400">
          共 {items.length} 项。恢复章节时，若原章节号已被占用会自动排到末尾，不会覆盖现有内容。
        </p>
      )}
    </div>
  )
}