import { useState } from 'react'
import type { ImportItem, ParsedTree } from '@shared/types'
import { ActionBadge } from './FieldDiff'

interface OutlineTreeProps {
  tree: ParsedTree
  items: ImportItem[]
  selectedId: string | null
  onSelect: (item: ImportItem) => void
  onToggle: (item: ImportItem, enabled: boolean) => void
  /** 交换两章的章节号 / 卷号（用于上下移动、调整层级） */
  onSwap: (a: ImportItem, b: ImportItem) => void
}

/** 解析树：卷 → 章；可勾选、可上下移动、可拖拽交换位置 */
export default function OutlineTree({ tree, items, selectedId, onSelect, onToggle, onSwap }: OutlineTreeProps) {
  const [dragId, setDragId] = useState<string | null>(null)

  const flat = [...items].sort((a, b) => a.volumeIdx - b.volumeIdx || a.chapterNo - b.chapterNo)
  const itemOf = (chapterNo: number): ImportItem | undefined => items.find((item) => item.chapterNo === chapterNo)

  const move = (item: ImportItem, delta: number): void => {
    const index = flat.findIndex((entry) => entry.id === item.id)
    const neighbor = flat[index + delta]
    if (neighbor) onSwap(item, neighbor)
  }

  return (
    <div className="flex flex-col gap-3">
      {tree.volumes.map((volume) => (
        <div key={`${volume.index}-${volume.title}`} className="flex flex-col gap-1">
          <div className="px-1 text-[11px] font-medium text-stone-500">
            {volume.index > 0 ? volume.title || `第 ${volume.index} 卷` : '未分卷'}
          </div>
          {volume.chapters.map((chapter) => {
            const item = itemOf(chapter.chapterNo)
            if (!item) return null
            const selected = item.id === selectedId
            return (
              <div
                key={item.id}
                draggable
                onDragStart={() => setDragId(item.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  const from = items.find((entry) => entry.id === dragId)
                  if (from && from.id !== item.id) onSwap(from, item)
                  setDragId(null)
                }}
                onClick={() => onSelect(item)}
                className={`group flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 text-sm transition ${
                  selected ? 'border-amber-400 bg-amber-50' : 'border-transparent hover:bg-stone-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={item.enabled}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => onToggle(item, event.target.checked)}
                  className="accent-amber-500"
                />
                <span className="shrink-0 text-xs text-stone-400">第{item.chapterNo}章</span>
                <span className="min-w-0 flex-1 truncate text-stone-700">{item.title || '（未命名）'}</span>
                <ActionBadge action={item.action} />
                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                  <button
                    type="button"
                    title="上移"
                    onClick={(event) => {
                      event.stopPropagation()
                      move(item, -1)
                    }}
                    className="rounded px-1 text-xs text-stone-500 hover:bg-stone-200"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    title="下移"
                    onClick={(event) => {
                      event.stopPropagation()
                      move(item, 1)
                    }}
                    className="rounded px-1 text-xs text-stone-500 hover:bg-stone-200"
                  >
                    ↓
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}