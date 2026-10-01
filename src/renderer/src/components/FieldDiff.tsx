import type { ImportFieldDiff, ImportItem } from '@shared/types'

/** 字段级差异（左旧右新，逐字段高亮）；未命中标签的启发式字段会标黄提示 */
export default function FieldDiff({ item }: { item: ImportItem | null }) {
  if (!item) {
    return <p className="px-1 py-10 text-center text-sm text-stone-400">从左侧选择一章查看字段级差异</p>
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium text-stone-700">
          第 {item.chapterNo} 章 {item.title || '（未命名）'}
        </h3>
        <ActionBadge action={item.action} />
      </div>

      <div className="overflow-hidden rounded-lg border border-stone-200">
        <div className="grid grid-cols-2 border-b border-stone-200 bg-stone-50 text-xs text-stone-500">
          <span className="px-3 py-1.5">现有细纲</span>
          <span className="border-l border-stone-200 px-3 py-1.5">本次导入</span>
        </div>
        {item.diff.map((diff) => (
          <DiffRow key={diff.field} diff={diff} heuristic={item.heuristicFields.includes(diff.field)} />
        ))}
      </div>
    </div>
  )
}

function DiffRow({ diff, heuristic }: { diff: ImportFieldDiff; heuristic: boolean }) {
  const empty = !diff.oldValue.trim() && !diff.newValue.trim()
  if (empty) return null
  return (
    <div className="grid grid-cols-2 border-b border-stone-100 last:border-b-0">
      <div className="px-3 py-2">
        <div className="mb-1 text-[11px] text-stone-400">{diff.label}</div>
        <div className="whitespace-pre-wrap break-words text-xs text-stone-500">{diff.oldValue || '（空）'}</div>
      </div>
      <div className={`border-l border-stone-100 px-3 py-2 ${diff.changed ? 'bg-amber-50' : ''}`}>
        <div className="mb-1 flex items-center gap-2 text-[11px] text-stone-400">
          <span>{diff.label}</span>
          {heuristic && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">未标注，已按启发式归类</span>
          )}
        </div>
        <div className={`whitespace-pre-wrap break-words text-xs ${diff.changed ? 'text-amber-900' : 'text-stone-600'}`}>
          {diff.newValue || '（空）'}
        </div>
      </div>
    </div>
  )
}

export function ActionBadge({ action }: { action: ImportItem['action'] }) {
  const map: Record<ImportItem['action'], { label: string; className: string }> = {
    create: { label: '新建', className: 'bg-emerald-100 text-emerald-700' },
    update: { label: '更新', className: 'bg-sky-100 text-sky-700' },
    conflict: { label: '冲突', className: 'bg-red-100 text-red-700' },
    skip: { label: '跳过', className: 'bg-stone-200 text-stone-600' }
  }
  const item = map[action]
  return <span className={`rounded px-1.5 py-0.5 text-[11px] ${item.className}`}>{item.label}</span>
}