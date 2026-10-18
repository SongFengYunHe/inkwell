import { useCallback, useEffect, useState } from 'react'
import Bookshelf from './pages/Bookshelf'
import ImportReview from './pages/ImportReview'
import LibraryManager from './pages/LibraryManager'
import Settings from './pages/Settings'
import Workspace from './pages/Workspace'
import DropZone from './components/DropZone'
import MigrationWizard from './components/MigrationWizard'
import SearchPalette from './components/SearchPalette'
import ShortcutHelp from './components/ShortcutHelp'
import { ConfirmHost, toast, ToastHost } from './components/ui'
import { registerCommands, runCommand } from './commands'
import { isTypingContext, matchesShortcut } from './shortcuts'
import { useAppStore } from './stores/appStore'

export default function App() {
  const view = useAppStore((s) => s.view)
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const error = useAppStore((s) => s.error)
  const clearError = useAppStore((s) => s.clearError)
  const notice = useAppStore((s) => s.notice)
  const clearNotice = useAppStore((s) => s.clearNotice)
  const theme = useAppStore((s) => s.theme)
  const toggleTheme = useAppStore((s) => s.toggleTheme)
  const focusMode = useAppStore((s) => s.focusMode)
  const setView = useAppStore((s) => s.setView)
  const loadProjects = useAppStore((s) => s.loadProjects)
  const loadBootstrap = useAppStore((s) => s.loadBootstrap)
  const loadPrefs = useAppStore((s) => s.loadPrefs)
  const backToBookshelf = useAppStore((s) => s.backToBookshelf)
  const openMigration = useAppStore((s) => s.openMigration)
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

  /** M8：Ctrl+K 唤起命令面板；M13-C：`?` 唤起快捷键速查 */
  const [searchOpen, setSearchOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)

  useEffect(() => {
    void loadBootstrap()
    void loadProjects()
    void loadPrefs()
  }, [loadBootstrap, loadProjects, loadPrefs])

  // 深浅主题：切换 <html> 上的 dark 类（颜色由 global.css 统一重映射）
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  // M14-A 动效预算：专注模式下降级动画（系统级 prefers-reduced-motion 已在 global.css 兜底）
  useEffect(() => {
    document.documentElement.classList.toggle('motion-lite', focusMode)
  }, [focusMode])

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

  /* ---------------------- M13-A：把 store 的提示统一桥接为 toast ---------------------- */

  useEffect(() => {
    if (!error) return
    toast.error(error)
    clearError()
  }, [error, clearError])

  useEffect(() => {
    if (!notice) return
    toast.success(notice)
    clearNotice()
  }, [notice, clearNotice])

  // 撤销提示 5 秒后自动消失（store 侧）→ toast 承载展示
  useEffect(() => {
    if (!undo) return
    toast.action(undo.message, { label: '撤销', onClick: () => void runUndo() }, 6000)
    const timer = window.setTimeout(() => dismissUndo(), 6000)
    return () => window.clearTimeout(timer)
  }, [undo, runUndo, dismissUndo])

  /* ---------------------- M13-C：全局命令注册与快捷键 ---------------------- */

  const invoke = useCallback(
    async (id: string): Promise<void> => {
      const ok = await runCommand(id)
      if (!ok) toast.warning('该动作在当前上下文不可用')
    },
    []
  )

  useEffect(
    () =>
      registerCommands({
        settings: () => setView('settings'),
        library: () => setView('library'),
        bookshelf: () => backToBookshelf(),
        theme: () => toggleTheme(),
        migration: () => openMigration()
      }),
    [setView, backToBookshelf, toggleTheme, openMigration]
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (matchesShortcut(event, 'Ctrl+K')) {
        event.preventDefault()
        setSearchOpen((open) => !open)
        return
      }
      if (matchesShortcut(event, 'Ctrl+Shift+D')) {
        event.preventDefault()
        void invoke('theme')
        return
      }
      if (matchesShortcut(event, 'Ctrl+,')) {
        event.preventDefault()
        void invoke('settings')
        return
      }
      if (matchesShortcut(event, 'Ctrl+B')) {
        event.preventDefault()
        void invoke('bookshelf')
        return
      }
      if (matchesShortcut(event, 'Ctrl+/')) {
        event.preventDefault()
        setHelpOpen((open) => !open)
        return
      }
      // 单键 `?`：输入框内不触发，否则写正文时会误触
      if (matchesShortcut(event, '?') && !isTypingContext(event.target)) {
        event.preventDefault()
        setHelpOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [invoke])

  /** 拖拽落点路由：逐个文件交给 store 分流，汇总成败供重试（useCallback 稳定引用，
   *  否则每次渲染都会让 DropZone 的 window 监听器摘挂一次，拖拽中途可能失效） */
  const handleDropPaths = useCallback(
    async (paths: string[], target: string): Promise<Array<{ path: string; ok: boolean }>> => {
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
    },
    [dropImport]
  )

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
      <div className="min-h-0 flex-1">{page}</div>

      {migrationOpen && <MigrationWizard />}
      <DropZone onDropPaths={handleDropPaths} />
      {importSession && <ImportReview />}
      {searchOpen && <SearchPalette onClose={() => setSearchOpen(false)} />}
      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}

      {/* M13-A：提示与确认的唯一出口（各页不再自画横幅 / window.confirm） */}
      <ToastHost />
      <ConfirmHost />
    </div>
  )
}
