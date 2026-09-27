import { useEffect } from 'react'
import Bookshelf from './pages/Bookshelf'
import Workspace from './pages/Workspace'
import { useAppStore } from './stores/appStore'

export default function App() {
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const error = useAppStore((s) => s.error)
  const clearError = useAppStore((s) => s.clearError)
  const loadProjects = useAppStore((s) => s.loadProjects)

  useEffect(() => {
    void loadProjects()
  }, [loadProjects])

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
      {activeProjectId === null ? <Bookshelf /> : <Workspace />}
    </div>
  )
}