import { useCallback, useMemo, type CSSProperties } from 'react'
import { useAppStore } from '../stores/appStore'
import { useVirtualList } from '../virtual'
import { cn, IconButton } from './ui'

type ChapterStatus = 'none' | 'briefed' | 'written'

const STATUS_DOT: Record<ChapterStatus, string> = {
  none: 'bg-stone-300',
  briefed: 'bg-amber-400',
  written: 'bg-emerald-500'
}

const STATUS_TEXT: Record<ChapterStatus, string> = {
  none: '无细纲',
  briefed: '已细纲',
  written: '已生成'
}

/** M12-B：单行高度（px），与下方按钮「两行文本 + py-2」对应 */
const ROW_HEIGHT = 56
/** 超过该章节数才启用虚拟滚动（小项目全量渲染更省事） */
const VIRTUAL_THRESHOLD = 200
/** 视口外多渲染几行，滚动更平滑 */
const OVERSCAN = 4

/**
 * 章节导航（M13-B：宽度 / 折叠加 / 换边由父容器控制）。
 * 自身不再写死 w-60，改为受控宽度，以便工作区 Dock 化后自由调宽与折叠。
 */
export default function ChapterNav({
  onCollapse,
  side = 'left',
  className,
  style
}: {
  onCollapse?: () => void
  side?: 'left' | 'right'
  className?: string
  style?: CSSProperties
} = {}) {
  const briefs = useAppStore((s) => s.briefs)
  const drafts = useAppStore((s) => s.drafts)
  const currentChapterNo = useAppStore((s) => s.currentChapterNo)
  const setCurrentChapter = useAppStore((s) => s.setCurrentChapter)

  const chapterNos = useMemo(() => {
    const numbers = new Set<number>()
    briefs.forEach((item) => numbers.add(item.chapterNo))
    drafts.forEach((item) => numbers.add(item.chapterNo))
    return [...numbers].sort((a, b) => a - b)
  }, [briefs, drafts])

  // 当前章可能还没落库（新建章），需要额外补一行
  const rows = useMemo(() => {
    const list = [...chapterNos]
    if (!list.includes(currentChapterNo)) list.push(currentChapterNo)
    return list.sort((a, b) => a - b)
  }, [chapterNos, currentChapterNo])

  // M12-B：把「每行都扫一遍 briefs / drafts」的 O(n²) 改成一次性建表 O(n)
  const statusMap = useMemo(() => {
    const map = new Map<number, ChapterStatus>()
    for (const item of drafts) if (item.wordCount > 0) map.set(item.chapterNo, 'written')
    for (const item of briefs) if (!map.has(item.chapterNo)) map.set(item.chapterNo, 'briefed')
    return map
  }, [briefs, drafts])
  const titleMap = useMemo(() => new Map(briefs.map((item) => [item.chapterNo, item.title])), [briefs])

  const nextChapterNo = chapterNos.length === 0 ? 1 : Math.max(...chapterNos) + 1

  // M14-A：复用统一虚拟滚动 hook（原为此处独有实现）
  const { scrollRef, onScroll, virtual, range, totalHeight } = useVirtualList({
    count: rows.length,
    rowHeight: ROW_HEIGHT,
    overscan: OVERSCAN,
    threshold: VIRTUAL_THRESHOLD
  })

  const renderRow = useCallback(
    (chapterNo: number) => {
      const status = statusMap.get(chapterNo) ?? 'none'
      const active = chapterNo === currentChapterNo
      return (
        <button
          key={chapterNo}
          type="button"
          onClick={() => setCurrentChapter(chapterNo)}
          className={`mb-0.5 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition ${
            active ? 'bg-white shadow-sm ring-1 ring-amber-400' : 'hover:bg-white/70'
          }`}
        >
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[status]}`} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm text-stone-700">
              第 {chapterNo} 章 · {titleMap.get(chapterNo) || '（未命名）'}
            </span>
            <span className="block text-[11px] text-stone-400">{STATUS_TEXT[status]}</span>
          </span>
        </button>
      )
    },
    [currentChapterNo, statusMap, titleMap, setCurrentChapter]
  )

  return (
    <aside
      style={style}
      className={cn(
        'flex min-h-0 flex-col bg-stone-50/60',
        side === 'left' ? 'border-r' : 'border-l',
        'border-stone-200',
        className
      )}
    >
      <div className="flex items-center justify-between border-b border-stone-200 px-3 py-2">
        <span className="text-xs font-medium text-stone-500">章节</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCurrentChapter(nextChapterNo)}
            className="text-xs text-amber-700 hover:underline"
          >
            + 第 {nextChapterNo} 章
          </button>
          {onCollapse && (
            <IconButton label="收起章节栏" onClick={onCollapse} className="h-6 w-6 text-xs">
              {side === 'left' ? '⟨' : '⟩'}
            </IconButton>
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto px-2 py-2"
      >
        {virtual ? (
          <div style={{ height: totalHeight, position: 'relative' }}>
            {rows.slice(range.start, range.end).map((chapterNo, index) => (
              <div
                key={chapterNo}
                style={{ position: 'absolute', top: (range.start + index) * ROW_HEIGHT, left: 0, right: 0 }}
              >
                {renderRow(chapterNo)}
              </div>
            ))}
          </div>
        ) : (
          rows.map((chapterNo) => <div key={chapterNo}>{renderRow(chapterNo)}</div>)
        )}
      </div>
    </aside>
  )
}
