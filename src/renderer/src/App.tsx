import { useEffect } from 'react'
import Bookshelf from './pages/Bookshelf'
import Settings from './pages/Settings'
import Workspace from './pages/Workspace'
import { useAppStore } from './stores/appStore'

export default function App() {
  const view = useAppStore((s) => s.view)
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const error = useAppStore((s) => s.error)
  const clearError = useAppStore((s) => s.clearError)
  const loadProjects = useAppStore((s) => s.loadProjects)
  const handleGenerateEvent = useAppStore((s) => s.handleGenerateEvent)
  const handleWizardEvent = useAppStore((s) => s.handleWizardEvent)

  useEffect(() => {
    void loadProjects()
  }, [loadProjects])

  // 订阅主进程的流式生成事件（StrictMode 下会订阅-退订-再订阅，无副作用）
  useEffect(() => {
    return window.inkwell.generate.onEvent(handleGenerateEvent)
  }, [handleGenerateEvent])

  useEffect(() => {
    return window.inkwell.wizard.onEvent(handleWizardEvent)
  }, [handleWizardEvent])

  const page =
    view === 'settings' ? (
      <Settings />
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
      <div className="min-h-0 flex-1">{page}</div>
    </div>
  )
}