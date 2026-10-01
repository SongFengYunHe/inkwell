import { useEffect, useState } from 'react'
import type { Volume } from '@shared/types'
import { BUTTON_GHOST, INPUT_CLASS } from './ui'

/**
 * A5 分卷（计划书 §5.1 volume）：给「第 N 卷」补上卷名与卷梗概。
 * 章节仍以 chapter_brief.volume_idx 归属分卷；这里只是卷级元信息。
 */
export default function VolumePanel({ projectId }: { projectId: number }) {
  const [volumes, setVolumes] = useState<Volume[]>([])
  const [draft, setDraft] = useState<Record<number, { title: string; synopsis: string }>>({})
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const apply = (list: Volume[]): void => {
    setVolumes(list)
    setDraft(Object.fromEntries(list.map((item) => [item.id, { title: item.title, synopsis: item.synopsis }])))
  }

  useEffect(() => {
    void window.inkwell.volume.list(projectId).then(apply)
  }, [projectId])

  const save = async (item: Volume): Promise<void> => {
    const current = draft[item.id] ?? { title: item.title, synopsis: item.synopsis }
    setBusy(true)
    setMessage('')
    try {
      apply(await window.inkwell.volume.save({ id: item.id, projectId, idx: item.idx, ...current }))
      setMessage(`第 ${item.idx} 卷已保存`)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const addVolume = async (): Promise<void> => {
    const nextIdx = volumes.reduce((max, item) => Math.max(max, item.idx), 0) + 1
    setBusy(true)
    try {
      apply(await window.inkwell.volume.save({ projectId, idx: nextIdx, title: '', synopsis: '' }))
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-stone-700">分卷</h3>
        <button type="button" onClick={() => void addVolume()} disabled={busy} className="text-xs text-stone-500 hover:text-stone-800">
          ＋ 新增一卷
        </button>
      </div>
      {volumes.length === 0 ? (
        <p className="text-xs text-stone-400">还没有分卷：细纲里填的卷号会自动建卷，也可以手动新增。</p>
      ) : (
        <ul className="space-y-3">
          {volumes.map((item) => {
            const current = draft[item.id] ?? { title: item.title, synopsis: item.synopsis }
            return (
              <li key={item.id} className="rounded-lg border border-stone-200 p-3">
                <div className="flex items-center justify-between text-xs text-stone-500">
                  <span>
                    第 {item.idx} 卷 · {item.chapterCount} 章
                    {item.chapterCount > 0 && ` （第 ${item.fromChapter}–${item.toChapter} 章）`}
                  </span>
                  <button type="button" onClick={() => void save(item)} disabled={busy} className="text-stone-400 hover:text-stone-700">
                    保存
                  </button>
                </div>
                <input
                  value={current.title}
                  onChange={(e) => setDraft({ ...draft, [item.id]: { ...current, title: e.target.value } })}
                  placeholder="卷名，例如「初入宗门」"
                  className={`mt-2 ${INPUT_CLASS} text-xs`}
                />
                <textarea
                  value={current.synopsis}
                  onChange={(e) => setDraft({ ...draft, [item.id]: { ...current, synopsis: e.target.value } })}
                  rows={2}
                  placeholder="卷梗概（这一卷要讲什么）"
                  className={`mt-2 ${INPUT_CLASS} resize-y text-xs`}
                />
              </li>
            )
          })}
        </ul>
      )}
      {message && <p className="text-xs text-stone-500">{message}</p>}
      <button
        type="button"
        onClick={() => void window.inkwell.volume.list(projectId).then(apply)}
        disabled={busy}
        className={`${BUTTON_GHOST} self-start text-xs`}
      >
        刷新
      </button>
    </section>
  )
}
