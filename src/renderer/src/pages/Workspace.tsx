import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { PasteImportDialog } from '../components/DropZone'
import BookAuditPanel from '../components/BookAuditPanel'
import BriefPanel from '../components/BriefPanel'
import ChapterAuditPanel from '../components/ChapterAuditPanel'
import ChapterNav from '../components/ChapterNav'
import DraftPanel from '../components/DraftPanel'
import ExportDialog from '../components/ExportDialog'
import MemoryPanel from '../components/MemoryPanel'
import OutlinePanel from '../components/OutlinePanel'
import PipelineBar from '../components/PipelineBar'
import ThemeToggle from '../components/ThemeToggle'
import WizardBanner from '../components/WizardBanner'
import { registerCommands, runCommand } from '../commands'
import { readHabits, readPins, sortWithPins, togglePin } from '../habits'
import {
  applyPreset,
  DEFAULT_LAYOUT,
  DOCK_LABEL,
  inferStage,
  normalizeLayout,
  parseLayout,
  PRESETS,
  serializeLayout,
  TAB_LABEL,
  type DockPanelId,
  type PresetKey,
  type WorkspaceLayout,
  type WorkspaceTabKey
} from '../layout'
import { isTypingContext, matchesShortcut } from '../shortcuts'
import { useAppStore } from '../stores/appStore'
import { Badge, Button, cn, IconButton, Splitter, Tabs, toast } from '../components/ui'

const DOCK_IDS: DockPanelId[] = ['memory', 'audit']

/** 头部下拉菜单：点击外部 / Esc 关闭（统一交互，不再各页自画） */
function HeaderMenu({ label, children }: { label: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <Button size="sm" variant="secondary" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {label} <span aria-hidden="true">▾</span>
      </Button>
      {open && (
        <div className="animate-fade-in absolute right-0 top-full z-30 mt-1 w-64 rounded-panel border border-ink-border bg-ink-surface p-1 shadow-overlay">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

function MenuItem({
  active = false,
  onClick,
  children
}: {
  active?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'transition-ink flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs',
        active ? 'bg-amber-50 text-amber-800' : 'text-ink-muted hover:bg-ink-surface-2'
      )}
    >
      {children}
    </button>
  )
}

/**
 * 工作区（M13-B Dock 化）。
 *
 * 布局 = 「章节栏（可折叠加宽可换边）+ 主区面板 Tabs（可拖拽重排）+ 右侧辅助 Dock」，
 * 按项目记忆在 ui_pref；三套预设一键切换；可选「跟随写作阶段」自动前置相关面板。
 * 注意：正文面板始终挂载（只切显隐），否则切 Tab / 进专注模式会丢未保存的稿子。
 */
export default function Workspace() {
  const projects = useAppStore((s) => s.projects)
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const briefs = useAppStore((s) => s.briefs)
  const drafts = useAppStore((s) => s.drafts)
  const focusMode = useAppStore((s) => s.focusMode)
  const toggleFocusMode = useAppStore((s) => s.toggleFocusMode)
  const backToBookshelf = useAppStore((s) => s.backToBookshelf)
  const setView = useAppStore((s) => s.setView)
  const openMigration = useAppStore((s) => s.openMigration)
  const currentChapterNo = useAppStore((s) => s.currentChapterNo)
  const setCurrentChapter = useAppStore((s) => s.setCurrentChapter)
  const auditCurrent = useAppStore((s) => s.auditCurrent)
  const openImportReview = useAppStore((s) => s.openImportReview)
  const prefs = useAppStore((s) => s.prefs)
  const prefsLoaded = useAppStore((s) => s.prefsLoaded)
  const setPref = useAppStore((s) => s.setPref)
  const recordCommandUse = useAppStore((s) => s.recordCommandUse)

  const [exportOpen, setExportOpen] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [auditOpen, setAuditOpen] = useState(false)

  const project = projects.find((item) => item.id === activeProjectId) ?? null
  const projectId = project?.id ?? null
  const layoutKey = `layout:${projectId ?? 'default'}`

  /* ----------------------------- 布局记忆 ----------------------------- */

  const [layout, setLayout] = useState<WorkspaceLayout>(DEFAULT_LAYOUT)
  const hydratedFor = useRef<number | null>(null)
  const skipPersist = useRef(false)

  // prefs 可能晚于首次渲染到达，因此等它读过一次后再恢复布局（只恢复一次）
  useEffect(() => {
    if (projectId === null || !prefsLoaded || hydratedFor.current === projectId) return
    skipPersist.current = true
    setLayout(parseLayout(prefs[layoutKey]) ?? DEFAULT_LAYOUT)
    hydratedFor.current = projectId
  }, [prefs, prefsLoaded, layoutKey, projectId])

  // 防抖落库：拖拽调宽时不要每像素一次 IPC
  useEffect(() => {
    if (projectId === null || hydratedFor.current !== projectId) return
    if (skipPersist.current) {
      skipPersist.current = false
      return
    }
    const timer = window.setTimeout(() => setPref(layoutKey, serializeLayout(layout)), 350)
    return () => window.clearTimeout(timer)
  }, [layout, layoutKey, projectId, setPref])

  const update = useCallback((patch: Partial<WorkspaceLayout>) => {
    setLayout((prev) => normalizeLayout({ ...prev, ...patch }))
  }, [])

  const applyPresetLayout = useCallback((key: Exclude<PresetKey, 'custom'>) => {
    setLayout((prev) => applyPreset(prev, key))
  }, [])

  /* ----------------------------- 阶段自适应 ----------------------------- */

  const stage = useMemo(
    () => (project ? inferStage({ project, briefs, drafts }) : null),
    [project, briefs, drafts]
  )
  const lastStage = useRef<string | null>(null)

  const applyStage = useCallback(() => {
    if (!stage) return
    setLayout((prev) =>
      normalizeLayout({
        ...prev,
        activeTab: stage.suggestTab,
        ...(stage.suggestRight && stage.suggestRight.length > 0
          ? { right: stage.suggestRight, rightCollapsed: false, activeRight: stage.suggestRight[0] ?? null }
          : {})
      })
    )
  }, [stage])

  // 只在「阶段发生跃迁」时自动前置；首次加载不抢占用户记住的布局
  useEffect(() => {
    if (!stage) return
    if (lastStage.current === null || lastStage.current === stage.stage) {
      lastStage.current = stage.stage
      return
    }
    lastStage.current = stage.stage
    if (layout.followStage) applyStage()
  }, [stage, layout.followStage, applyStage])

  /* ----------------------------- 命令注册 ----------------------------- */

  const invoke = useCallback(
    async (id: string): Promise<void> => {
      recordCommandUse(id)
      const ok = await runCommand(id)
      if (!ok) toast.warning('该动作在当前上下文不可用')
    },
    [recordCommandUse]
  )

  useEffect(
    () =>
      registerCommands({
        'tab:brief': () => update({ activeTab: 'brief' }),
        'tab:outline': () => update({ activeTab: 'outline' }),
        'tab:draft': () => update({ activeTab: 'draft' }),
        'tab:memory': () =>
          setLayout((prev) =>
            prev.right.includes('memory')
              ? normalizeLayout({ ...prev, rightCollapsed: false, activeRight: 'memory' })
              : normalizeLayout({ ...prev, activeTab: 'memory' })
          ),
        'preset:focus': () => applyPresetLayout('focus'),
        'preset:compare': () => applyPresetLayout('compare'),
        'preset:research': () => applyPresetLayout('research'),
        'layout:reset': () => {
          setLayout(DEFAULT_LAYOUT)
          setPref(layoutKey, serializeLayout(DEFAULT_LAYOUT))
        },
        focusMode: () => toggleFocusMode(),
        'audit:chapter': () => auditCurrent(),
        'audit:book': () => setAuditOpen(true),
        export: () => setExportOpen(true)
      }),
    [update, applyPresetLayout, toggleFocusMode, auditCurrent, layoutKey, setPref]
  )

  /* ----------------------------- 工作区快捷键 ----------------------------- */

  const chapterNos = useMemo(() => {
    const numbers = new Set<number>()
    briefs.forEach((item) => numbers.add(item.chapterNo))
    drafts.forEach((item) => numbers.add(item.chapterNo))
    return [...numbers].sort((a, b) => a - b)
  }, [briefs, drafts])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isTypingContext(event.target)) return
      const bindings: Array<[string, string]> = [
        ['Ctrl+Shift+1', 'tab:brief'],
        ['Ctrl+Shift+2', 'tab:outline'],
        ['Ctrl+Shift+3', 'tab:draft'],
        ['Ctrl+Shift+4', 'tab:memory'],
        ['Alt+1', 'preset:focus'],
        ['Alt+2', 'preset:compare'],
        ['Alt+3', 'preset:research'],
        ['Alt+F', 'focusMode']
      ]
      for (const [keys, id] of bindings) {
        if (matchesShortcut(event, keys)) {
          event.preventDefault()
          void invoke(id)
          return
        }
      }
      if (matchesShortcut(event, 'Alt+↑') || matchesShortcut(event, 'Alt+↓')) {
        const dir = matchesShortcut(event, 'Alt+↑') ? -1 : 1
        const target =
          dir < 0
            ? [...chapterNos].reverse().find((no) => no < currentChapterNo)
            : chapterNos.find((no) => no > currentChapterNo)
        if (target !== undefined) {
          event.preventDefault()
          setCurrentChapter(target)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [invoke, chapterNos, currentChapterNo, setCurrentChapter])

  /* ----------------------------- 工具栏（习惯排序 + pin 上浮） ----------------------------- */

  const toolbarActions = useMemo(
    () => [
      { id: 'audit:book', label: '全书体检', onClick: () => setAuditOpen(true) },
      { id: 'export', label: '导出', onClick: () => setExportOpen(true) },
      { id: 'migration', label: '迁移向导', onClick: openMigration },
      { id: 'settings', label: '设置', onClick: () => setView('settings') }
    ],
    [openMigration, setView]
  )
  const profile = useMemo(() => readHabits(prefs), [prefs])
  const pins = useMemo(() => readPins(prefs, 'toolbar'), [prefs])
  const toolbar = useMemo(() => sortWithPins(toolbarActions, profile, pins), [toolbarActions, profile, pins])

  const toggleToolbarPin = useCallback(
    (id: string) => {
      setPref('pin:toolbar', JSON.stringify(togglePin(pins, id)))
    },
    [pins, setPref]
  )

  if (!project) {
    return <div className="flex flex-1 items-center justify-center text-sm text-ink-muted">加载项目…</div>
  }

  const writtenChapters = new Set(drafts.filter((item) => item.wordCount > 0).map((item) => item.chapterNo)).size
  const dockExpanded = layout.right.length > 0 && !layout.rightCollapsed

  /* ----------------------------- 区块 ----------------------------- */

  const navNode =
    layout.navCollapsed ? (
      <div
        className={cn(
          'flex w-8 shrink-0 flex-col items-center gap-1 bg-stone-50/60 py-2',
          layout.navSide === 'left' ? 'border-r' : 'border-l',
          'border-stone-200'
        )}
      >
        <IconButton label="展开章节栏" onClick={() => update({ navCollapsed: false })} className="text-xs">
          {layout.navSide === 'left' ? '⟩' : '⟨'}
        </IconButton>
      </div>
    ) : (
      <>
        <ChapterNav
          side={layout.navSide}
          style={{ width: layout.navWidth }}
          className="shrink-0"
          onCollapse={() => update({ navCollapsed: true })}
        />
        <Splitter
          side={layout.navSide === 'left' ? 'right' : 'left'}
          label="调整章节栏宽度"
          onDrag={(delta) => update({ navWidth: layout.navWidth + (layout.navSide === 'left' ? delta : -delta) })}
        />
      </>
    )

  const dockNode = !focusMode && (
    <div className="flex min-h-0 shrink-0">
      {dockExpanded && (
        <>
          <Splitter
            side="right"
            label="调整辅助面板宽度"
            onDrag={(delta) => update({ rightWidth: layout.rightWidth - delta })}
          />
          <section
            style={{ width: layout.rightWidth }}
            className="flex min-h-0 shrink-0 flex-col border-l border-stone-200 bg-white"
          >
            <div className="flex items-center gap-1 border-b border-stone-200 px-2 py-1.5">
              {layout.right.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => update({ activeRight: id })}
                  className={cn(
                    'transition-ink rounded-lg px-2.5 py-1 text-xs',
                    layout.activeRight === id ? 'bg-ink-surface-2 font-medium text-ink-text' : 'text-ink-muted hover:bg-ink-surface-2'
                  )}
                >
                  {DOCK_LABEL[id]}
                </button>
              ))}
              <div className="ml-auto flex items-center gap-1">
                {layout.activeRight === 'memory' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    title="把记忆面板移回主区 Tab"
                    onClick={() =>
                      update({
                        right: layout.right.filter((id) => id !== 'memory'),
                        tabs: [...layout.tabs, 'memory'],
                        activeTab: 'memory'
                      })
                    }
                  >
                    移回主区
                  </Button>
                )}
                <IconButton label="收起辅助面板" onClick={() => update({ rightCollapsed: true })}>
                  ⟩
                </IconButton>
              </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {layout.activeRight === 'memory' ? <MemoryPanel /> : <ChapterAuditPanel />}
            </div>
          </section>
        </>
      )}
      <div
        className={cn(
          'flex w-9 shrink-0 flex-col items-center gap-1 bg-stone-50/60 py-2',
          dockExpanded ? 'border-l border-stone-200' : ''
        )}
      >
        {DOCK_IDS.map((id) => {
          const active = layout.right.includes(id) && dockExpanded && layout.activeRight === id
          return (
            <button
              key={id}
              type="button"
              title={active ? `收起「${DOCK_LABEL[id]}」` : `展开「${DOCK_LABEL[id]}」`}
              onClick={() => {
                if (active) update({ rightCollapsed: true })
                else
                  setLayout((prev) =>
                    normalizeLayout({
                      ...prev,
                      right: prev.right.includes(id) ? prev.right : [...prev.right, id],
                      rightCollapsed: false,
                      activeRight: id
                    })
                  )
              }}
              className={cn(
                'transition-ink flex h-16 w-6 items-center justify-center rounded-lg text-xs leading-tight',
                active ? 'bg-ink-surface-2 font-medium text-ink-text' : 'text-ink-muted hover:bg-ink-surface-2'
              )}
              style={{ writingMode: 'vertical-rl' }}
            >
              {DOCK_LABEL[id]}
            </button>
          )
        })}
      </div>
    </div>
  )

  const tabItems = layout.tabs.map((key) => ({ key, label: TAB_LABEL[key] }))

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!focusMode && (
        <header className="flex items-center gap-3 border-b border-stone-200 bg-white px-5 py-3">
          <Button size="sm" variant="secondary" onClick={backToBookshelf}>
            ← 书架
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-base font-medium">{project.name}</h1>
            <p className="truncate text-xs text-ink-subtle">
              {project.genre || '未设题材'} · 计划 {project.totalChapters} 章 · 已填细纲 {briefs.length} 章 · 已生成{' '}
              {writtenChapters} 章
            </p>
          </div>

          {stage && (
            <button
              type="button"
              title={`${stage.hint}（点击按此阶段调整布局）`}
              onClick={applyStage}
              className="transition-ink ml-2 hidden items-center gap-1.5 rounded-lg px-2 py-1 hover:bg-ink-surface-2 lg:flex"
            >
              <Badge tone="primary">{stage.label}</Badge>
              <span className="text-xs text-ink-subtle">建议：{TAB_LABEL[stage.suggestTab]}</span>
            </button>
          )}

          <div className="ml-auto flex items-center gap-2" onContextMenu={(event) => event.preventDefault()}>
            <span className="hidden text-[11px] text-ink-subtle xl:inline">右键工具栏可固定</span>
            {toolbar.map((item) => (
              <Button
                key={item.id}
                size="sm"
                variant="secondary"
                title={pins.includes(item.id) ? '已固定；右键取消固定' : '右键固定到最前'}
                onClick={() => {
                  item.onClick()
                  recordCommandUse(item.id)
                }}
                onContextMenu={(event) => {
                  event.preventDefault()
                  toggleToolbarPin(item.id)
                }}
                className={pins.includes(item.id) ? 'border-amber-300 text-amber-700' : undefined}
              >
                {pins.includes(item.id) && <span aria-hidden="true">★</span>}
                {item.label}
              </Button>
            ))}

            <HeaderMenu label="布局">
              {(close) => (
                <>
                  {(Object.keys(PRESETS) as Array<Exclude<PresetKey, 'custom'>>).map((key) => (
                    <MenuItem
                      key={key}
                      active={layout.preset === key}
                      onClick={() => {
                        applyPresetLayout(key)
                        close()
                      }}
                    >
                      <span className="font-medium">{PRESETS[key].label}</span>
                      <span className="ml-auto text-[10px] text-ink-subtle">{PRESETS[key].hint}</span>
                    </MenuItem>
                  ))}
                  <div className="my-1 border-t border-ink-border" />
                  <MenuItem
                    active={layout.followStage}
                    onClick={() => update({ followStage: !layout.followStage })}
                  >
                    <span>{layout.followStage ? '☑' : '☐'} 跟随写作阶段自动前置</span>
                  </MenuItem>
                  <MenuItem onClick={() => update({ navSide: layout.navSide === 'left' ? 'right' : 'left' })}>
                    <span>
                      章节栏移到{layout.navSide === 'left' ? '右侧' : '左侧'}
                    </span>
                  </MenuItem>
                  <MenuItem
                    active={layout.followStage === DEFAULT_LAYOUT.followStage && layout.preset === 'custom'}
                    onClick={() => {
                      setLayout(DEFAULT_LAYOUT)
                      setPref(layoutKey, serializeLayout(DEFAULT_LAYOUT))
                      close()
                    }}
                  >
                    <span>恢复默认布局</span>
                  </MenuItem>
                </>
              )}
            </HeaderMenu>

            <ThemeToggle />
          </div>
        </header>
      )}

      {!focusMode && <WizardBanner />}
      {!focusMode && <PipelineBar />}

      <div className="flex min-h-0 flex-1">
        {layout.navSide === 'left' && navNode}

        <main className={cn('flex min-h-0 flex-1 flex-col bg-stone-100', focusMode ? 'px-6 py-5' : '')}>
          {!focusMode && (
            <Tabs
              items={tabItems}
              value={layout.activeTab}
              onChange={(key: WorkspaceTabKey) => update({ activeTab: key })}
              reorderable
              onReorder={(from, to) => {
                const next = [...layout.tabs]
                const [moved] = next.splice(from, 1)
                if (!moved) return
                next.splice(to, 0, moved)
                update({ tabs: next })
              }}
              ariaLabel="工作区面板"
            />
          )}

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* 正文面板固定挂载、只切显隐：切 Tab / 进专注模式都不会丢未保存的编辑 */}
            <div
              data-drop-zone="draft"
              className={
                focusMode
                  ? 'mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col'
                  : layout.activeTab === 'draft'
                    ? 'flex h-full min-h-0 flex-col p-5'
                    : 'hidden'
              }
            >
              <DraftPanel />
            </div>

            {!focusMode && layout.activeTab !== 'draft' && (
              <div
                className="h-full overflow-y-auto p-5"
                data-drop-zone={layout.activeTab === 'memory' ? undefined : 'outline'}
              >
                {layout.activeTab === 'memory' ? (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          update({
                            tabs: layout.tabs.filter((key) => key !== 'memory'),
                            right: layout.right.includes('memory') ? layout.right : [...layout.right, 'memory'],
                            rightCollapsed: false,
                            activeRight: 'memory'
                          })
                        }
                      >
                        停靠到右侧 ⇥
                      </Button>
                    </div>
                    <MemoryPanel />
                  </div>
                ) : layout.activeTab === 'outline' ? (
                  <OutlinePanel />
                ) : (
                  <div className="rounded-panel border border-stone-200 bg-white p-5 shadow-card">
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-xs text-ink-subtle">可拖入 .md/.docx/.epub 或粘贴文本，自动分层解析</span>
                      <Button size="sm" variant="secondary" onClick={() => setPasteOpen(true)}>
                        粘贴文本导入
                      </Button>
                    </div>
                    <BriefPanel />
                  </div>
                )}
              </div>
            )}
          </div>
        </main>

        {dockNode}
        {layout.navSide === 'right' && navNode}
      </div>

      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
      {auditOpen && <BookAuditPanel projectId={project.id} onClose={() => setAuditOpen(false)} />}
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
