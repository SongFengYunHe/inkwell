import { useState } from 'react'
import { PasteImportDialog } from '../components/DropZone'
import BriefPanel from '../components/BriefPanel'
import ChapterNav from '../components/ChapterNav'
import DraftPanel from '../components/DraftPanel'
import ExportDialog from '../components/ExportDialog'
import MemoryPanel from '../components/MemoryPanel'
import OutlinePanel from '../components/OutlinePanel'
import PipelineBar from '../components/PipelineBar'
import ThemeToggle from '../components/ThemeToggle'
import WizardBanner from '../components/WizardBanner'
import { useAppStore } from '../stores/appStore'

type Tab = 'brief' | 'outline' | 'draft' | 'memory'

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'brief', label: '细纲' },
  { key: 'outline', label: '设定与大纲' },
  { key: 'draft', label: '正文' },
  { key: 'memory', label: '记忆' }
]

export default function Workspace() {
  const projects = useAppStore((s) => s.projects)
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const briefs = useAppStore((s) => s.briefs)
  const drafts = useAppStore((s) => s.drafts)
  const loading = useAppStore((s) => s.loading)
  const currentChapterNo = useAppStore((s) => s.currentChapterNo)
  const backToBookshelf = useAppStore((s) => s.backToBookshelf)
  const setView = useAppStore((s) => s.setView)
  const focusMode = useAppStore((s) => s.focusMode)
  const setFocusMode = useAppStore((s) => s.setFocusMode)

  const [tab, setTab] = useState<Tab>('brief')
  const [exportOpen, setExportOpen] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const openImportReview = useAppStore((s) => s.openImportReview)

  const project = projects.find((item) => item.id === activeProjectId) ?? null
  if (!project) {
    return <div className="flex flex-1 items-center justify-center text-sm text-stone-400">加载项目…</div>
  }

  const writtenChapters = new Set(drafts.filter((item) => item.content.trim()).map((item) => item.chapterNo)).size

  // 专注模式（M5）：只保留正文，隐藏顶栏 / 章节导航 / Tab / 提示
  if (focusMode) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-stone-100 px-6 py-5">
        <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="truncate text-xs text-stone-400">
              {project.name} · 第 {currentChapterNo} 章
            </span>
            <button
              type="button"
              onClick={() => setFocusMode(false)}
              className="rounded-lg border border-stone-200 px-3 py-1.5 text-xs text-stone-600 transition hover:bg-stone-50"
            >
              退出专注
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <DraftPanel focus />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-4 border-b border-stone-200 bg-white px-5 py-3">
        <button
          type="button"
          onClick={backToBookshelf}
          className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm text-stone-600 transition hover:bg-stone-50"
        >
          ← 书架
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-base font-medium">{project.name}</h1>
          <p className="truncate text-xs text-stone-400">
            {project.genre || '未设题材'} · 计划 {project.totalChapters} 章 · 已填细纲 {briefs.length} 章 · 已生成{' '}
            {writtenChapters} 章
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-stone-400">{loading ? '处理中…' : ''}</span>
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setExportOpen(true)}
            className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm text-stone-600 transition hover:bg-stone-50"
          >
            导出
          </button>
          <button
            type="button"
            onClick={() => setView('settings')}
            className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm text-stone-600 transition hover:bg-stone-50"
          >
            设置
          </button>
        </div>
      </header>

      <WizardBanner />
      <PipelineBar />

      <div className="flex min-h-0 flex-1">
        <ChapterNav />

        <main className="flex min-h-0 flex-1 flex-col bg-stone-100">
          <nav className="flex gap-1 border-b border-stone-200 bg-white px-4">
            {TABS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                className={`-mb-px border-b-2 px-3 py-2.5 text-sm transition ${
                  tab === item.key
                    ? 'border-amber-500 font-medium text-stone-900'
                    : 'border-transparent text-stone-500 hover:text-stone-700'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="min-h-0 flex-1 overflow-hidden">
            {tab === 'draft' ? (
              <div data-drop-zone="draft" className="flex h-full min-h-0 flex-col p-5">
                <DraftPanel />
              </div>
            ) : (
              <div
                className="h-full overflow-y-auto p-5"
                data-drop-zone={tab === 'memory' ? undefined : 'outline'}
              >
                {tab === 'memory' ? (
                  <MemoryPanel />
                ) : (
                  <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
                    {tab === 'outline' ? (
                      <OutlinePanel />
                    ) : (
                      <>
                        <div className="mb-3 flex items-center justify-between">
                          <span className="text-xs text-stone-400">可拖入 .md/.docx/.epub 或粘贴文本，自动分层解析</span>
                          <button
                            type="button"
                            onClick={() => setPasteOpen(true)}
                            className="rounded-lg border border-stone-200 px-3 py-1.5 text-xs text-stone-600 transition hover:bg-stone-50"
                          >
                            粘贴文本导入
                          </button>
                        </div>
                        <BriefPanel />
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </main>
      </div>

      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
      {pasteOpen && (
        <PasteImportDialog
          onClose={() => setPasteOpen(false)}
          onSubmit={(text) => {
            setPasteOpen(false)
            void openImportReview({ text, kind: 'manual', projectId: activeProjectId ?? undefined })
          }}
        />
      )}
    </div>
  )
}