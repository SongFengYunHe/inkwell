import { useEffect, useMemo, useRef, useState } from 'react'
import type { SearchHit, SearchResult } from '@shared/types'
import { useAppStore } from '../stores/appStore'

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

/**
 * 全文检索命令面板（M8 §5.1）。
 * Ctrl+K 唤起；空查询时承担「跳转到某章」，有查询时按章分组展示命中并高亮。
 */
export default function SearchPalette({ onClose }: { onClose: () => void }) {
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const projects = useAppStore((s) => s.projects)
  const briefs = useAppStore((s) => s.briefs)
  const openProject = useAppStore((s) => s.openProject)
  const setCurrentChapter = useAppStore((s) => s.setCurrentChapter)

  const [query, setQuery] = useState('')
  const [result, setResult] = useState<SearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

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

  const jumpTo = async (projectId: number, chapterNo: number): Promise<void> => {
    if (projectId !== activeProjectId) await openProject(projectId)
    setCurrentChapter(chapterNo)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-stone-900/40 px-4 pt-24"
      onClick={onClose}
    >
      <div
        className="flex max-h-[70vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-stone-200 px-4 py-3">
          <span className="text-stone-400">🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose()
            }}
            placeholder="检索细纲 / 正文 / 记忆，或输入章号跳转…（支持 &quot;短语&quot; 与 -排除）"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-stone-400"
          />
          <span className="rounded border border-stone-200 px-1.5 py-0.5 text-[10px] text-stone-400">Esc 关闭</span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {/* 空查询：跳转到某章 */}
          {!query.trim() && (
            <div className="px-2 py-1">
              <div className="px-1 pb-1 text-[11px] uppercase tracking-wide text-stone-400">跳转到章节</div>
              {briefs.length === 0 ? (
                <p className="px-1 py-3 text-xs text-stone-400">当前项目还没有细纲，先输入关键词检索全书。</p>
              ) : (
                <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-2">
                  {briefs.map((brief) => (
                    <button
                      key={brief.id}
                      type="button"
                      onClick={() => void jumpTo(brief.projectId, brief.chapterNo)}
                      className="flex items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm text-stone-600 transition hover:bg-stone-100"
                    >
                      <span className="truncate">第 {brief.chapterNo} 章 · {brief.title || '（无标题）'}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {query.trim() && loading && <p className="px-3 py-3 text-xs text-stone-400">检索中…</p>}

          {query.trim() && !loading && result && result.groups.length === 0 && (
            <p className="px-3 py-3 text-xs text-stone-400">没有找到匹配内容。</p>
          )}

          {query.trim() &&
            result?.groups.map((group) => (
              <div key={`${group.projectId}:${group.chapterNo}`} className="mb-1">
                <button
                  type="button"
                  onClick={() => void jumpTo(group.projectId, group.chapterNo)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-stone-500 transition hover:bg-stone-100"
                >
                  <span>第 {group.chapterNo} 章</span>
                  <span className="text-stone-400">{projectName.get(group.projectId) ?? `项目 ${group.projectId}`}</span>
                  <span className="ml-auto rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-500">
                    {group.hits.length} 处
                  </span>
                </button>
                <div className="space-y-0.5 pb-1 pl-3">
                  {group.hits.map((hit, index) => (
                    <button
                      key={`${hit.source}:${index}`}
                      type="button"
                      onClick={() => void jumpTo(hit.projectId, hit.chapterNo)}
                      className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-amber-50"
                    >
                      <span className="mt-0.5 shrink-0 rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-500">
                        {SOURCE_LABEL[hit.source]}
                      </span>
                      <span className="line-clamp-2 text-xs leading-5 text-stone-600">
                        <Highlighted text={hit.snippet} />
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
        </div>

        {result && (
          <div className="border-t border-stone-200 px-4 py-2 text-[11px] text-stone-400">
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