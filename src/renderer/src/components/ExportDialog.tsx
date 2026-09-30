import type { ExportFormat } from '@shared/types'
import { useState } from 'react'
import { useAppStore } from '../stores/appStore'
import { BUTTON_GHOST, BUTTON_PRIMARY } from './ui'

const FORMATS: Array<{ key: ExportFormat; label: string; hint: string }> = [
  { key: 'txt', label: 'TXT', hint: '纯文本，兼容一切阅读器' },
  { key: 'md', label: 'Markdown', hint: '带目录，方便二次排版' },
  { key: 'docx', label: 'DOCX', hint: 'Word 可直接打开' },
  { key: 'epub', label: 'EPUB', hint: '电子书，含目录与分章' }
]

/** 导出成书对话框：TXT / MD / DOCX / EPUB（计划书 §10 M4） */
export default function ExportDialog({ onClose }: { onClose: () => void }) {
  const drafts = useAppStore((s) => s.drafts)
  const loading = useAppStore((s) => s.loading)
  const exportResult = useAppStore((s) => s.exportResult)
  const runExport = useAppStore((s) => s.runExport)
  const openExportDir = useAppStore((s) => s.openExportDir)
  const clearExportResult = useAppStore((s) => s.clearExportResult)

  const [selected, setSelected] = useState<ExportFormat[]>(['txt', 'md', 'docx', 'epub'])

  const writtenChapters = new Set(drafts.filter((item) => item.content.trim()).map((item) => item.chapterNo)).size

  const toggle = (format: ExportFormat): void => {
    setSelected((current) =>
      current.includes(format) ? current.filter((item) => item !== format) : [...current, format]
    )
    clearExportResult()
  }

  const handleExport = async (): Promise<void> => {
    await runExport(selected)
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-stone-900/30 p-6">
      <div className="w-full max-w-lg rounded-xl border border-stone-200 bg-white p-6 shadow-xl">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-medium text-stone-800">导出成书</h2>
          <button type="button" onClick={onClose} className="text-sm text-stone-400 hover:text-stone-600">
            关闭
          </button>
        </div>

        <p className="mt-1 text-xs text-stone-400">
          当前有 {writtenChapters} 章正文可导出；未写的章节会跳过。导出文件默认落在「文档 / Inkwell 导出 / 书名」。
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2">
          {FORMATS.map((format) => (
            <label
              key={format.key}
              className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 transition ${
                selected.includes(format.key) ? 'border-amber-400 bg-amber-50/50' : 'border-stone-200'
              }`}
            >
              <input
                type="checkbox"
                checked={selected.includes(format.key)}
                onChange={() => toggle(format.key)}
                className="mt-0.5 h-4 w-4"
              />
              <span className="min-w-0">
                <span className="block text-sm text-stone-800">{format.label}</span>
                <span className="block text-xs text-stone-400">{format.hint}</span>
              </span>
            </label>
          ))}
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            disabled={loading || selected.length === 0 || writtenChapters === 0}
            onClick={() => void handleExport()}
            className={BUTTON_PRIMARY}
          >
            {loading ? '导出中…' : `导出选中格式（${selected.length}）`}
          </button>
          {writtenChapters === 0 && <span className="text-xs text-amber-700">还没有正文可导出</span>}
        </div>

        {exportResult && (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
            <div className="flex items-center gap-2">
              <span className="font-medium">导出完成</span>
              <span>共 {exportResult.files.length} 个文件</span>
              <button
                type="button"
                onClick={() => void openExportDir(exportResult.dir)}
                className="ml-auto underline"
              >
                打开目录
              </button>
            </div>
            <ul className="mt-2 space-y-0.5">
              {exportResult.files.map((file) => (
                <li key={file.format} className="truncate">
                  {file.format.toUpperCase()} · {(file.bytes / 1024).toFixed(1)} KB · {file.chapters} 章 · {file.path}
                </li>
              ))}
            </ul>
            {exportResult.skippedChapters.length > 0 && (
              <p className="mt-1 text-amber-700">已跳过无正文的章节：{exportResult.skippedChapters.join('、')}</p>
            )}
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onClose} className={BUTTON_GHOST}>
            完成
          </button>
        </div>
      </div>
    </div>
  )
}