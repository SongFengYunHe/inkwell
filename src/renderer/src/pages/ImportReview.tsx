import { useEffect, useState } from 'react'
import type { ImportItem } from '@shared/types'
import FieldDiff from '../components/FieldDiff'
import OutlineTree from '../components/OutlineTree'
import ValidationReport from '../components/ValidationReport'
import { BUTTON_GHOST, BUTTON_PRIMARY } from '../components/ui'
import { useAppStore } from '../stores/appStore'

/**
 * 差异预览页（计划书 §4.5）：左侧卷/章树，右侧字段级 diff + 体检表。
 * 底部只有「取消 / 仅导入选中项」，不存在无条件全量导入。
 */
export default function ImportReview() {
  const session = useAppStore((s) => s.importSession)
  const progress = useAppStore((s) => s.importProgress)
  const loading = useAppStore((s) => s.loading)
  const updateImportItem = useAppStore((s) => s.updateImportItem)
  const commitImport = useAppStore((s) => s.commitImport)
  const cancelImport = useAppStore((s) => s.cancelImport)

  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    if (!session) return
    if (!selectedId || !session.items.some((item) => item.id === selectedId)) {
      setSelectedId(session.items[0]?.id ?? null)
    }
  }, [session, selectedId])

  if (!session) return null

  const selected = session.items.find((item) => item.id === selectedId) ?? null
  const selectedCount = session.items.filter((item) => item.enabled).length

  const setEnabled = (item: ImportItem, enabled: boolean): void => {
    void updateImportItem({ sessionId: session.id, itemId: item.id, enabled })
  }
  const applySelection = async (predicate: (item: ImportItem) => boolean): Promise<void> => {
    for (const item of session.items) {
      const want = predicate(item)
      if (item.enabled !== want) await updateImportItem({ sessionId: session.id, itemId: item.id, enabled: want })
    }
  }
  const swap = async (a: ImportItem, b: ImportItem): Promise<void> => {
    await updateImportItem({ sessionId: session.id, itemId: a.id, chapterNo: b.chapterNo, volumeIdx: b.volumeIdx })
    await updateImportItem({ sessionId: session.id, itemId: b.id, chapterNo: a.chapterNo, volumeIdx: a.volumeIdx })
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-stone-100">
      <header className="flex items-center gap-3 border-b border-stone-200 bg-white px-5 py-3">
        <div className="min-w-0">
          <h1 className="text-base font-medium text-stone-800">导入预览</h1>
          <p className="truncate text-xs text-stone-400">
            来源：{session.sourceKind}
            {session.encoding ? ` · 编码 ${session.encoding}` : ''}
            {session.projectId === null ? ' · 未绑定项目' : ` · 项目 #${session.projectId}`}
            {progress ? ` · ${progress}` : ''}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button type="button" className={BUTTON_GHOST} onClick={() => void applySelection(() => true)}>
            全选
          </button>
          <button type="button" className={BUTTON_GHOST} onClick={() => void applySelection(() => false)}>
            全不选
          </button>
          <button
            type="button"
            className={BUTTON_GHOST}
            onClick={() => void applySelection((item) => item.action === 'create')}
          >
            只选新建
          </button>
          <button
            type="button"
            className={BUTTON_GHOST}
            onClick={() => void applySelection((item) => item.action === 'update')}
          >
            只选更新
          </button>
        </div>
      </header>

      <div className="flex items-center gap-4 border-b border-stone-200 bg-amber-50/60 px-5 py-2 text-xs text-stone-600">
        <span className="font-medium text-stone-700">
          将新建 {session.stats.create} 章，更新 {session.stats.update} 章，跳过 {session.stats.skip} 章
        </span>
        {session.stats.conflict > 0 && (
          <span className="text-red-600">冲突 {session.stats.conflict} 章（默认跳过，可在右侧改为覆盖更新）</span>
        )}
        {session.warnings.length > 0 && <span className="truncate text-stone-400">提示：{session.warnings.join('；')}</span>}
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="w-[320px] shrink-0 overflow-y-auto border-r border-stone-200 bg-white p-3">
          {session.items.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-stone-400">未识别到任何章节</p>
          ) : (
            <OutlineTree
              tree={session.tree}
              items={session.items}
              selectedId={selectedId}
              onSelect={(item) => setSelectedId(item.id)}
              onToggle={setEnabled}
              onSwap={(a, b) => void swap(a, b)}
            />
          )}
        </aside>

        <main className="min-h-0 flex-1 overflow-y-auto p-5">
          {selected?.action === 'conflict' && (
            <div className="mb-4 flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              <span>本章已存在正文，默认跳过。确认要覆盖旧细纲吗？</span>
              <button
                type="button"
                className="rounded border border-red-300 px-2 py-1 text-red-700 transition hover:bg-red-100"
                onClick={() =>
                  void updateImportItem({ sessionId: session.id, itemId: selected.id, action: 'update', enabled: true })
                }
              >
                改为更新（旧细纲移入回收站）
              </button>
            </div>
          )}
          <FieldDiff item={selected} />
          <div className="mt-6">
            <h3 className="mb-2 text-sm font-medium text-stone-700">导入体检表</h3>
            <ValidationReport report={session.validation} />
          </div>
        </main>
      </div>

      <footer className="flex items-center gap-3 border-t border-stone-200 bg-white px-5 py-3">
        <span className="text-xs text-stone-400">已选中 {selectedCount} 章</span>
        <div className="ml-auto flex items-center gap-3">
          <button type="button" className={BUTTON_GHOST} onClick={() => void cancelImport()} disabled={loading}>
            取消
          </button>
          <button
            type="button"
            className={BUTTON_PRIMARY}
            onClick={() => void commitImport()}
            disabled={loading || selectedCount === 0 || session.projectId === null}
          >
            仅导入选中项
          </button>
        </div>
      </footer>
    </div>
  )
}