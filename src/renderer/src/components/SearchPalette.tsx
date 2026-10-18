import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { SearchHit, SearchResult } from '@shared/types'
import { canRunCommand, COMMANDS, runCommand, type CommandSpec } from '../commands'
import { readHabits, readPins, sortWithPins, togglePin } from '../habits'
import { useAppStore } from '../stores/appStore'
import { Badge, cn, EmptyState } from './ui'

/** 命中词用 \u0001 / \u0002 包裹，这里安全地渲染为高亮（不注入 HTML） */
function Highlighted({ text }: { text: string }) {
  const parts = text.split(/(\u0001[^\u0002]*\u0002)/g)
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith('\u0001') && part.endsWith('\u0002') ? (
          <mark key={index} className="rounded bg-amber-200/70 px-0.5 text-stone-900">
            {part.slice(1, -1)}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        )
      )}
    </>
  )
}

const SOURCE_LABEL: Record<SearchHit['source'], string> = {
  brief: '细纲',
  draft: '正文',
  memory: '记忆'
}

type Row =
  | { kind: 'cmd'; key: string; id: string; label: string; group: CommandSpec['group'] }
  | { kind: 'chapter'; key: string; projectId: number; chapterNo: number; title: string }
  | { kind: 'hit'; key: string; projectId: number; chapterNo: number; source: SearchHit['source']; snippet: string }

/**
 * 命令面板（M8 §5.1 + M13-C）。
 *
 * M13-C 增强：空查询时先列「操作命令」，顺序由习惯画像（频次 × 最近）驱动，
 * 支持 pin 固定上浮；并补齐全键盘闭环（↑↓ 选择 / Enter 执行 / Esc 关闭）。
 */
export default function SearchPalette({ onClose }: { onClose: () => void }) {
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const projects = useAppStore((s) => s.projects)
  const briefs = useAppStore((s) => s.briefs)
  const openProject = useAppStore((s) => s.openProject)
  const setCurrentChapter = useAppStore((s) => s.setCurrentChapter)
  const prefs = useAppStore((s) => s.prefs)
  const setPref = useAppStore((s) => s.setPref)
  const recordCommandUse = useAppStore((s) => s.recordCommandUse)

  const [query, setQuery] = useState('')
  const [result, setResult] = useState<SearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // 输入防抖检索
  useEffect(() => {
    const text = query.trim()
    if (!text) {
      setResult(null)
      setLoading(false)
      return
    }
    setLoading(true)
    let cancelled = false
    const timer = window.setTimeout(() => {
      window.inkwell.search
        .query({ query: text, limit: 80 })
        .then((res) => {
          if (!cancelled) setResult(res)
        })
        .catch(() => {
          if (!cancelled) setResult(null)
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 180)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query])

  const projectName = useMemo(() => new Map(projects.map((item) => [item.id, item.name])), [projects])

  /* --------------------------- M13-C：习惯排序 + pin --------------------------- */

  const profile = useMemo(() => readHabits(prefs), [prefs])
  const pins = useMemo(() => readPins(prefs, 'palette'), [prefs])
  const orderedCommands = useMemo(() => sortWithPins(COMMANDS, profile, pins), [profile, pins])

  const text = query.trim().toLowerCase()
  const matchedCommands = useMemo(
    () => (text ? orderedCommands.filter((item) => item.label.toLowerCase().includes(text)) : orderedCommands),
    [orderedCommands, text]
  )

  const rows = useMemo<Row[]>(() => {
    const cmdRows: Row[] = matchedCommands.map((item) => ({
      kind: 'cmd',
      key: `cmd:${item.id}`,
      id: item.id,
      label: item.label,
      group: item.group
    }))
    if (!text) {
      const chapterRows: Row[] = briefs.map((brief) => ({
        kind: 'chapter',
        key: `ch:${brief.projectId}:${brief.chapterNo}`,
        projectId: brief.projectId,
        chapterNo: brief.chapterNo,
        title: brief.title || '（无标题）'
      }))
      return [...cmdRows, ...chapterRows]
    }
    const hitRows: Row[] = (result?.groups ?? []).flatMap((group) =>
      group.hits.map((hit, index) => ({
        kind: 'hit' as const,
        key: `hit:${hit.source}:${group.chapterNo}:${index}`,
        projectId: hit.projectId,
        chapterNo: hit.chapterNo,
        source: hit.source,
        snippet: hit.snippet
      }))
    )
    return [...cmdRows, ...hitRows]
  }, [matchedCommands, text, briefs, result])

  useEffect(() => {
    setCursor((current) => (current >= rows.length ? 0 : current))
  }, [rows.length])

  const jumpTo = async (projectId: number, chapterNo: number): Promise<void> => {
    if (projectId !== activeProjectId) await openProject(projectId)
    setCurrentChapter(chapterNo)
    onClose()
  }

  const activate = async (row: Row | undefined): Promise<void> => {
    if (!row) return
    if (row.kind === 'cmd') {
      recordCommandUse(row.id)
      const ok = await runCommand(row.id)
      if (ok) onClose()
      return
    }
    await jumpTo(row.projectId, row.chapterNo)
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      onClose()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setCursor((current) => (rows.length === 0 ? 0 : (current + 1) % rows.length))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setCursor((current) => (rows.length === 0 ? 0 : (current - 1 + rows.length) % rows.length))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      void activate(rows[cursor])
    }
  }

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const cmdCount = matchedCommands.length
  const cmdRow = (row: Extract<Row, { kind: 'cmd' }>, index: number) => {
    const available = canRunCommand(row.id)
    const pinned = pins.includes(row.id)
    return (
      <div
        key={row.key}
        data-active={index === cursor}
        className={cn(
          'group flex items-center gap-2 rounded-lg px-2',
          index === cursor ? 'bg-ink-surface-2' : 'hover:bg-ink-surface-2'
        )}
      >
        <button
          type="button"
          disabled={!available}
          onClick={() => void activate(row)}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left text-sm',
            available ? 'text-ink-text' : 'text-ink-subtle'
          )}
        >
          <span className="min-w-0 flex-1 truncate">{row.label}</span>
          <Badge tone={row.group === '动作' ? 'warning' : 'neutral'}>{row.group}</Badge>
          {!available && <span className="text-[10px] text-ink-subtle">当前不可用</span>}
        </button>
        <button
          type="button"
          title={pinned ? '取消固定' : '固定到最前'}
          onClick={() => setPref('pin:palette', JSON.stringify(togglePin(pins, row.id)))}
          className={cn(
            'transition-ink shrink-0 rounded px-1 text-xs',
            pinned ? 'text-amber-600' : 'text-ink-subtle opacity-0 group-hover:opacity-100'
          )}
        >
          ★
        </button>
      </div>
    )
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="命令面板"
      className="fixed inset-0 z-50 flex items-start justify-center bg-stone-900/40 px-4 pt-24"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="animate-fade-in flex max-h-[70vh] w-full max-w-2xl flex-col overflow-hidden rounded-panel bg-ink-surface shadow-overlay">
        <div className="flex items-center gap-2 border-b border-ink-border px-4 py-3">
          <span className="text-ink-subtle">🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="搜索操作 / 细纲 / 正文 / 记忆，或输入章号跳转…（支持 &quot;短语&quot; 与 -排除）"
            className="flex-1 bg-transparent text-sm text-ink-text outline-none placeholder:text-ink-subtle"
          />
          <kbd className="rounded border border-ink-border px-1.5 py-0.5 text-[10px] text-ink-subtle">↑↓ 选择</kbd>
          <kbd className="rounded border border-ink-border px-1.5 py-0.5 text-[10px] text-ink-subtle">Esc 关闭</kbd>
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {matchedCommands.length > 0 && (
            <section className="mb-1">
              <div className="px-1 pb-1 text-[11px] uppercase tracking-wide text-ink-subtle">
                操作{pins.length > 0 ? ` · 已固定 ${pins.filter((id) => COMMANDS.some((c) => c.id === id)).length}` : ''}
              </div>
              {matchedCommands.map((item, index) =>
                cmdRow(
                  {
                    kind: 'cmd',
                    key: `cmd:${item.id}`,
                    id: item.id,
                    label: item.label,
                    group: item.group
                  },
                  index
                )
              )}
            </section>
          )}

          {!text && (
            <section>
              <div className="px-1 pb-1 text-[11px] uppercase tracking-wide text-ink-subtle">跳转到章节</div>
              {briefs.length === 0 ? (
                <p className="px-1 py-3 text-xs text-ink-subtle">当前项目还没有细纲，可直接搜索全书内容。</p>
              ) : (
                briefs.map((brief, index) => {
                  const active = cursor === cmdCount + index
                  return (
                    <button
                      key={brief.id}
                      type="button"
                      data-active={active}
                      onClick={() => void jumpTo(brief.projectId, brief.chapterNo)}
                      className={cn(
                        'flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm transition',
                        active ? 'bg-ink-surface-2 text-ink-text' : 'text-ink-muted hover:bg-ink-surface-2'
                      )}
                    >
                      <span className="truncate">
                        第 {brief.chapterNo} 章 · {brief.title || '（无标题）'}
                      </span>
                    </button>
                  )
                })
              )}
            </section>
          )}

          {text && loading && <p className="px-3 py-3 text-xs text-ink-subtle">检索中…</p>}

          {text && !loading && result && result.groups.length === 0 && matchedCommands.length === 0 && (
            <EmptyState title="没有找到匹配内容" description="换个关键词，或清空输入查看全部操作命令。" />
          )}

          {text &&
            result?.groups.map((group, groupIndex) => {
              const before = matchedCommands.length + result.groups
                .slice(0, groupIndex)
                .reduce((total, item) => total + item.hits.length, 0)
              return (
                <section key={`${group.projectId}:${group.chapterNo}`} className="mb-1">
                  <button
                    type="button"
                    onClick={() => void jumpTo(group.projectId, group.chapterNo)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-ink-muted transition hover:bg-ink-surface-2"
                  >
                    <span>第 {group.chapterNo} 章</span>
                    <span className="text-ink-subtle">{projectName.get(group.projectId) ?? `项目 ${group.projectId}`}</span>
                    <span className="ml-auto rounded bg-ink-surface-2 px-1.5 py-0.5 text-[10px] text-ink-muted">
                      {group.hits.length} 处
                    </span>
                  </button>
                  <div className="space-y-0.5 pb-1 pl-3">
                    {group.hits.map((hit, index) => {
                      const active = cursor === before + index
                      return (
                        <button
                          key={`${hit.source}:${index}`}
                          type="button"
                          data-active={active}
                          onClick={() => void jumpTo(hit.projectId, hit.chapterNo)}
                          className={cn(
                            'flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition',
                            active ? 'bg-amber-50' : 'hover:bg-amber-50'
                          )}
                        >
                          <span className="mt-0.5 shrink-0 rounded bg-ink-surface-2 px-1.5 py-0.5 text-[10px] text-ink-muted">
                            {SOURCE_LABEL[hit.source]}
                          </span>
                          <span className="line-clamp-2 text-xs leading-5 text-ink-muted">
                            <Highlighted text={hit.snippet} />
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </section>
              )
            })}
        </div>

        {result && (
          <div className="border-t border-ink-border px-4 py-2 text-[11px] text-ink-subtle">
            命中 {result.total} 处 · 模式 {result.mode === 'fts' ? 'FTS5（trigram）' : 'LIKE 回退（短查询）'}
            {result.notes?.map((note) => (
              <p key={note} className="mt-1 text-amber-700">
                {note}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
