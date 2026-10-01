import { useEffect, useRef, useState } from 'react'
import { BUTTON_PRIMARY, INPUT_CLASS } from './ui'

interface DropResult {
  path: string
  ok: boolean
}

interface DropZoneProps {
  /** 逐个处理拖入的文件；返回每个文件是否成功 */
  onDropPaths: (paths: string[], target: string) => Promise<DropResult[]>
}

/** 从落点元素向上找最近的分流标记（data-drop-zone） */
function resolveTarget(event: DragEvent): string {
  const element = document.elementFromPoint(event.clientX, event.clientY)
  return element?.closest('[data-drop-zone]')?.getAttribute('data-drop-zone') ?? 'bookshelf'
}

/**
 * 拖拽导入区（计划书 §4.1）：
 *   - Electron 44 已移除 File.path，路径一律经 preload 的 webUtils（resolveDropPath）解析；
 *   - 拖入时整窗虚线高亮 +「松手即导入」；
 *   - 多文件队列逐个处理，失败项单独列出可重试。
 */
export default function DropZone({ onDropPaths }: DropZoneProps) {
  const [dragging, setDragging] = useState(false)
  const [queue, setQueue] = useState<string[]>([])
  const [current, setCurrent] = useState<string | null>(null)
  const [failed, setFailed] = useState<string[]>([])
  const [lastTarget, setLastTarget] = useState('bookshelf')
  const depth = useRef(0)

  useEffect(() => {
    const hasFiles = (event: DragEvent): boolean =>
      Array.from(event.dataTransfer?.types ?? []).includes('Files')

    const onEnter = (event: DragEvent): void => {
      if (!hasFiles(event)) return
      event.preventDefault()
      depth.current += 1
      setDragging(true)
    }
    const onOver = (event: DragEvent): void => {
      if (hasFiles(event)) event.preventDefault()
    }
    const onLeave = (event: DragEvent): void => {
      if (!hasFiles(event)) return
      depth.current -= 1
      if (depth.current <= 0) {
        depth.current = 0
        setDragging(false)
      }
    }
    const onDrop = (event: DragEvent): void => {
      if (!hasFiles(event)) return
      event.preventDefault()
      depth.current = 0
      setDragging(false)
      const target = resolveTarget(event)
      setLastTarget(target)
      const paths = Array.from(event.dataTransfer?.files ?? [])
        .map((file) => window.inkwell.resolveDropPath(file))
        .filter((path): path is string => Boolean(path))
      if (paths.length > 0) void run(paths, target)
    }

    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onDropPaths])

  const run = async (paths: string[], target: string): Promise<void> => {
    setFailed([])
    setQueue(paths)
    const bad: string[] = []
    for (const path of paths) {
      setCurrent(path)
      try {
        const result = await onDropPaths([path], target)
        if (!result[0]?.ok) bad.push(path)
      } catch {
        bad.push(path)
      }
    }
    setQueue([])
    setCurrent(null)
    setFailed(bad)
  }

  return (
    <>
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center bg-amber-500/10 backdrop-blur-[1px]">
          <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-amber-500 bg-white/90 px-12 py-10 shadow-xl">
            <span className="text-2xl">📥</span>
            <span className="text-base font-medium text-stone-700">松手即导入</span>
            <span className="text-xs text-stone-400">支持 txt / md / json / docx / epub</span>
          </div>
        </div>
      )}

      {(queue.length > 0 || failed.length > 0) && (
        <div className="fixed bottom-4 right-4 z-[60] w-72 rounded-xl border border-stone-200 bg-white p-3 text-xs shadow-lg">
          {queue.length > 0 && (
            <>
              <p className="mb-1 font-medium text-stone-700">正在导入（{queue.length} 个文件）…</p>
              <p className="truncate text-stone-500">{current}</p>
            </>
          )}
          {queue.length === 0 && failed.length > 0 && (
            <>
              <p className="mb-1 font-medium text-red-600">{failed.length} 个文件导入失败</p>
              <ul className="mb-2 max-h-24 space-y-0.5 overflow-y-auto text-stone-500">
                {failed.map((path) => (
                  <li key={path} className="truncate">
                    {path.split(/[\\/]/).pop()}
                  </li>
                ))}
              </ul>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => void run(failed, lastTarget)}
                  className="rounded border border-stone-200 px-2 py-1 text-stone-600 hover:bg-stone-50"
                >
                  重试
                </button>
                <button
                  type="button"
                  onClick={() => setFailed([])}
                  className="rounded px-2 py-1 text-stone-400 hover:text-stone-600"
                >
                  关闭
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  )
}

/** 粘贴文本导入（计划书 §4.6）：与文件导入走完全相同的解析管线 */
export function PasteImportDialog({
  busy,
  onClose,
  onSubmit
}: {
  busy?: boolean
  onClose: () => void
  onSubmit: (text: string) => void
}) {
  const [text, setText] = useState('')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6">
      <div className="flex w-full max-w-2xl flex-col gap-3 rounded-xl bg-white p-5 shadow-xl">
        <h2 className="text-sm font-medium text-stone-700">粘贴文本导入</h2>
        <p className="text-xs text-stone-400">与文件导入走完全相同的解析管线，适合从网页 / 聊天记录复制一段大纲。</p>
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={12}
          placeholder="在此粘贴大纲文本…"
          className={`${INPUT_CLASS} resize-none`}
        />
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-600 transition hover:bg-stone-50"
          >
            取消
          </button>
          <button type="button" disabled={!text.trim() || busy} onClick={() => onSubmit(text)} className={BUTTON_PRIMARY}>
            开始解析
          </button>
        </div>
      </div>
    </div>
  )
}