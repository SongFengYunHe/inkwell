import { useMemo } from 'react'
import { useAppStore } from '../stores/appStore'

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

export default function ChapterNav() {
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

  const nextChapterNo = chapterNos.length === 0 ? 1 : Math.max(...chapterNos) + 1

  const statusOf = (chapterNo: number): ChapterStatus => {
    if (drafts.some((item) => item.chapterNo === chapterNo && item.content.trim())) return 'written'
    if (briefs.some((item) => item.chapterNo === chapterNo)) return 'briefed'
    return 'none'
  }

  const titleOf = (chapterNo: number): string =>
    briefs.find((item) => item.chapterNo === chapterNo)?.title || '（未命名）'

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-stone-200 bg-stone-50/60">
      <div className="flex items-center justify-between border-b border-stone-200 px-3 py-2">
        <span className="text-xs font-medium text-stone-500">章节</span>
        <button
          type="button"
          onClick={() => setCurrentChapter(nextChapterNo)}
          className="text-xs text-amber-700 hover:underline"
        >
          + 第 {nextChapterNo} 章
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {rows.map((chapterNo) => {
          const status = statusOf(chapterNo)
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
                  第 {chapterNo} 章 · {titleOf(chapterNo)}
                </span>
                <span className="block text-[11px] text-stone-400">{STATUS_TEXT[status]}</span>
              </span>
            </button>
          )
        })}
      </div>
    </aside>
  )
}