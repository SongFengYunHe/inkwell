import { useEffect } from 'react'
import Bookshelf from './pages/Bookshelf'
import ImportReview from './pages/ImportReview'
import LibraryManager from './pages/LibraryManager'
import Settings from './pages/Settings'
import Workspace from './pages/Workspace'
import DropZone from './components/DropZone'
import MigrationWizard from './components/MigrationWizard'
import { useAppStore } from './stores/appStore'

export default function App() {
  const view = useAppStore((s) => s.view)
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const error = useAppStore((s) => s.error)
  const clearError = useAppStore((s) => s.clearError)
  const notice = useAppStore((s) => s.notice)
  const clearNotice = useAppStore((s) => s.clearNotice)
  const theme = useAppStore((s) => s.theme)
  const loadProjects = useAppStore((s) => s.loadProjects)
  const loadBootstrap = useAppStore((s) => s.loadBootstrap)
  const handleGenerateEvent = useAppStore((s) => s.handleGenerateEvent)
  const handleWizardEvent = useAppStore((s) => s.handleWizardEvent)
  const handlePipelineEvent = useAppStore((s) => s.handlePipelineEvent)
  const undo = useAppStore((s) => s.undo)
  const dismissUndo = useAppStore((s) => s.dismissUndo)
  const runUndo = useAppStore((s) => s.runUndo)
  const migrationOpen = useAppStore((s) => s.migrationOpen)
  const importSession = useAppStore((s) => s.importSession)
  const dropImport = useAppStore((s) => s.dropImport)
  const handleImportEvent = useAppStore((s) => s.handleImportEvent)

  useEffect(() => {
    void loadBootstrap()
    void loadProjects()
  }, [loadBootstrap, loadProjects])

  // 深浅主题：切换 <html> 上的 dark 类（颜色由 global.css 统一重映射）
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  // 订阅主进程的流式生成事件（StrictMode 下会订阅-退订-再订阅，无副作用）
  useEffect(() => {
    return window.inkwell.generate.onEvent(handleGenerateEvent)
  }, [handleGenerateEvent])

  useEffect(() => {
    return window.inkwell.wizard.onEvent(handleWizardEvent)
  }, [handleWizardEvent])

  useEffect(() => {
    return window.inkwell.pipeline.onEvent(handlePipelineEvent)
  }, [handlePipelineEvent])

  useEffect(() => {
    return window.inkwell.import.onEvent(handleImportEvent)
  }, [handleImportEvent])

  // 全局防跳转（Electron 经典坑）：拖入文件时阻止浏览器默认打开行为
  useEffect(() => {
    const prevent = (event: DragEvent): void => event.preventDefault()
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', prevent)
    }
  }, [])

  // 撤销提示 5 秒后自动消失
  useEffect(() => {
    if (!undo) return
    const timer = window.setTimeout(() => dismissUndo(), 5000)
    return () => window.clearTimeout(timer)
  }, [undo, dismissUndo])

  /** 拖拽落点路由：逐个文件交给 store 分流，汇总成败供重试 */
  const handleDropPaths = async (
    paths: string[],
    target: string
  ): Promise<Array<{ path: string; ok: boolean }>> => {
    const results: Array<{ path: string; ok: boolean }> = []
    for (const path of paths) {
      try {
        await dropImport(path, target)
        results.push({ path, ok: true })
      } catch {
        results.push({ path, ok: false })
      }
    }
    return results
  }

  const page =
    view === 'settings' ? (
      <Settings />
    ) : view === 'library' ? (
      <LibraryManager />
    ) : view === 'workspace' && activeProjectId !== null ? (
      <Workspace />
    ) : (
      <Bookshelf />
    )

  return (
    <div className="flex h-full flex-col bg-stone-100 text-stone-800">
      {error && (
        <div className="flex items-center justify-between gap-4 border-b border-red-200 bg-red-50 px-5 py-2 text-sm text-red-700">
          <span>{error}</span>
          <button type="button" onClick={clearError} className="rounded px-2 py-0.5 hover:bg-red-100">
            关闭
          </button>
        </div>
      )}
      {/* 工作区已有自己的 notice 展示，这里只在其他页面兜底显示 */}
      {notice && view !== 'workspace' && (
        <div className="flex items-center justify-between gap-4 border-b border-emerald-200 bg-emerald-50 px-5 py-2 text-sm text-emerald-800">
          <span>{notice}</span>
          <button type="button" onClick={clearNotice} className="rounded px-2 py-0.5 hover:bg-emerald-100/60">
            关闭
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1">{page}</div>

      {undo && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
          <div className="pointer-events-auto flex items-center gap-4 rounded-xl bg-stone-900 px-4 py-2.5 text-sm text-white shadow-lg">
            <span>{undo.message}</span>
            <button
              type="button"
              onClick={() => void runUndo()}
              className="rounded-md bg-amber-500 px-3 py-1 text-xs font-medium text-stone-900 transition hover:bg-amber-400"
            >
              撤销
            </button>
            <button
              type="button"
              onClick={dismissUndo}
              className="text-xs text-stone-400 transition hover:text-white"
            >
              关闭
            </button>
          </div>
        </div>
      )}

      {migrationOpen && <MigrationWizard />}
      <DropZone onDropPaths={handleDropPaths} />
      {importSession && <ImportReview />}
    </div>
  )
}