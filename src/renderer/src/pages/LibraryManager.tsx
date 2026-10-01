import { useCallback, useEffect, useState } from 'react'
import type { LibraryInfo, LibraryPrecheck } from '@shared/types'
import ThemeToggle from '../components/ThemeToggle'
import { useAppStore } from '../stores/appStore'
import { BUTTON_GHOST, BUTTON_PRIMARY, INPUT_CLASS } from '../components/ui'

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '未知'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export default function LibraryManager() {
  const setView = useAppStore((s) => s.setView)
  const loadBootstrap = useAppStore((s) => s.loadBootstrap)
  const loadProjects = useAppStore((s) => s.loadProjects)
  const openMigration = useAppStore((s) => s.openMigration)
  const bootstrap = useAppStore((s) => s.bootstrap)

  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [precheck, setPrecheck] = useState<LibraryPrecheck | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void loadBootstrap()
  }, [loadBootstrap])

  const refresh = useCallback(async (): Promise<void> => {
    await loadBootstrap()
    await loadProjects()
  }, [loadBootstrap, loadProjects])

  const activeLibrary = bootstrap?.libraries.find((item) => item.id === bootstrap.activeLibraryId) ?? null
  const legacyIsActive =
    Boolean(bootstrap?.legacyDbPath && activeLibrary && bootstrap.legacyDbPath.startsWith(activeLibrary.path))

  const pickFolder = async (): Promise<void> => {
    const picked = await window.inkwell.app.pickFolder()
    if (!picked) return
    setPath(picked)
    setPrecheck(await window.inkwell.library.precheck(picked))
  }

  const doCreate = async (): Promise<void> => {
    if (!name.trim() || !path.trim()) return
    setBusy(true)
    setMessage('')
    try {
      const target = await window.inkwell.library.precheck(path)
      if (target.blockingError) {
        setMessage(target.blockingError)
        return
      }
      if (target.warnings.length > 0 && !window.confirm(`${target.warnings.join('\n')}\n\n仍然继续？`)) return
      await window.inkwell.library.create({ name: name.trim(), path: path.trim() })
      setName('')
      setPath('')
      setPrecheck(null)
      await refresh()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const doAdd = async (): Promise<void> => {
    if (!path.trim()) return
    setBusy(true)
    setMessage('')
    try {
      await window.inkwell.library.add({ name: name.trim() || '挂载的书库', path: path.trim() })
      setName('')
      setPath('')
      setPrecheck(null)
      await refresh()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const doSwitch = async (item: LibraryInfo): Promise<void> => {
    setBusy(true)
    setMessage('')
    try {
      await window.inkwell.library.switch(item.id)
      await refresh()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const doRename = async (item: LibraryInfo): Promise<void> => {
    const next = window.prompt('新的书库名称', item.name)
    if (!next?.trim()) return
    await window.inkwell.library.rename({ id: item.id, name: next.trim() })
    await refresh()
  }

  const doLocate = async (item: LibraryInfo): Promise<void> => {
    const picked = await window.inkwell.app.pickFolder()
    if (!picked) return
    setMessage('')
    try {
      await window.inkwell.library.locate({ id: item.id, path: picked })
      await refresh()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    }
  }

  const doRemove = async (item: LibraryInfo): Promise<void> => {
    const deleteFiles = window.confirm(
      `从列表移除「${item.name}」？\n\n「确定」= 连同磁盘文件一起删除（不可恢复）\n「取消」= 仅从列表移除，文件保留`
    )
    setBusy(true)
    try {
      await window.inkwell.library.remove({ id: item.id, deleteFiles })
      await refresh()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const purgeLegacy = async (): Promise<void> => {
    if (!window.confirm('将永久删除原 userData 目录中的旧数据库文件。确认迁移后的书库一切正常后再操作。确定继续？')) return
    setBusy(true)
    try {
      const result = await window.inkwell.library.purgeLegacy()
      setMessage(`已清理旧数据，释放 ${formatBytes(result.freedBytes)}`)
      await refresh()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-4 border-b border-stone-200 bg-white px-5 py-3">
        <button type="button" onClick={() => setView('bookshelf')} className={BUTTON_GHOST}>
          ← 返回
        </button>
        <div>
          <h1 className="text-base font-medium">书库</h1>
          <p className="text-xs text-stone-400">书库可放在任意磁盘；切换书库不会影响其他书库的数据。</p>
        </div>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          {bootstrap?.needsAttention && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{bootstrap.attentionMessage}</p>
          )}
          {message && <p className="rounded-lg bg-stone-100 px-3 py-2 text-xs text-stone-600">{message}</p>}

          <section className="rounded-xl border border-stone-200 bg-white p-4">
            <h2 className="text-sm font-medium text-stone-700">当前书库</h2>
            {activeLibrary ? (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-stone-700">
                    {activeLibrary.name}
                    {activeLibrary.schemaVersion !== null && (
                      <span className="ml-2 text-[11px] text-stone-400">schema v{activeLibrary.schemaVersion}</span>
                    )}
                  </p>
                  <p className="truncate text-[11px] text-stone-400">{activeLibrary.path}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void window.inkwell.app.openPath(activeLibrary.path)}
                    className={BUTTON_GHOST}
                  >
                    打开目录
                  </button>
                  <button type="button" onClick={() => setView('settings')} className={BUTTON_GHOST}>
                    备份与回收站
                  </button>
                </div>
              </div>
            ) : (
              <p className="mt-2 text-sm text-stone-400">当前没有可用的书库。</p>
            )}
          </section>

          <section className="rounded-xl border border-stone-200 bg-white p-4">
            <h2 className="text-sm font-medium text-stone-700">全部书库</h2>
            <ul className="mt-2 divide-y divide-stone-100">
              {(bootstrap?.libraries ?? []).map((item) => {
                const active = item.id === bootstrap?.activeLibraryId
                return (
                  <li key={item.id} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 truncate text-sm text-stone-700">
                        {item.name}
                        {active && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800">当前</span>}
                        {!item.available && (
                          <span className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] text-red-700">文件缺失</span>
                        )}
                      </p>
                      <p className="truncate text-[11px] text-stone-400">{item.path}</p>
                    </div>
                    {!active && item.available && (
                      <button type="button" onClick={() => void doSwitch(item)} disabled={busy} className={BUTTON_GHOST}>
                        切换
                      </button>
                    )}
                    {!item.available && (
                      <button type="button" onClick={() => void doLocate(item)} className={BUTTON_GHOST}>
                        重新定位
                      </button>
                    )}
                    <button type="button" onClick={() => void doRename(item)} className="text-xs text-stone-400 hover:text-stone-700">
                      重命名
                    </button>
                    <button
                      type="button"
                      onClick={() => void doRemove(item)}
                      className="text-xs text-stone-400 transition hover:text-red-600"
                    >
                      移除
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>

          <section className="rounded-xl border border-stone-200 bg-white p-4">
            <h2 className="text-sm font-medium text-stone-700">新建 / 挂载书库</h2>
            <div className="mt-3 flex flex-col gap-3">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="书库名称（挂载时可留空，自动读取）"
                className={INPUT_CLASS}
              />
              <div className="flex gap-2">
                <input
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder="目标目录，如 D:\Inkwell书库"
                  className={INPUT_CLASS}
                />
                <button type="button" onClick={() => void pickFolder()} className={BUTTON_GHOST}>
                  浏览…
                </button>
              </div>
              {precheck && (
                <p className="text-[11px] text-stone-400">
                  可写：{precheck.writable ? '是' : '否'} · 可用空间 {formatBytes(precheck.freeBytes)}
                  {precheck.hasDatabase && ' · 已存在 inkwell.db（请用「挂载」）'}
                  {precheck.syncProvider && ` · 检测到同步盘：${precheck.syncProvider}`}
                  {precheck.networkPath && ' · 网络盘'}
                </p>
              )}
              {precheck?.blockingError && <p className="text-xs text-red-600">{precheck.blockingError}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void doCreate()}
                  disabled={busy || !name.trim() || !path.trim()}
                  className={BUTTON_PRIMARY}
                >
                  新建空书库
                </button>
                <button type="button" onClick={() => void doAdd()} disabled={busy || !path.trim()} className={BUTTON_GHOST}>
                  挂载已有书库
                </button>
              </div>
            </div>
          </section>

          {bootstrap?.legacyDbExists && bootstrap.legacyDbPath && (
            <section className="rounded-xl border border-stone-200 bg-white p-4">
              <h2 className="text-sm font-medium text-stone-700">旧数据（userData）</h2>
              <p className="mt-1 break-all text-[11px] text-stone-400">{bootstrap.legacyDbPath}</p>
              <p className="mt-2 text-xs text-stone-500">
                迁移不会删除旧数据。确认新书库一切正常后，可清理以释放空间。
              </p>
              <div className="mt-3 flex items-center gap-2">
                <button type="button" onClick={openMigration} className={BUTTON_GHOST}>
                  迁移到其他位置
                </button>
                <button
                  type="button"
                  onClick={() => void window.inkwell.app.openPath(bootstrap.legacyDbPath as string)}
                  className={BUTTON_GHOST}
                >
                  打开所在目录
                </button>
                <button
                  type="button"
                  onClick={() => void purgeLegacy()}
                  disabled={busy || legacyIsActive}
                  title={legacyIsActive ? '当前书库仍指向旧位置，无法清理' : undefined}
                  className="text-xs text-stone-400 transition hover:text-red-600 disabled:opacity-40"
                >
                  清理旧数据
                </button>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}