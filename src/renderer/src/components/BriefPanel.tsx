import type { ChapterBrief } from '@shared/types'
import { useEffect, useState, type FormEvent } from 'react'
import { useAppStore } from '../stores/appStore'
import { BUTTON_GHOST, BUTTON_PRIMARY, INPUT_CLASS, Labeled } from './ui'

interface BriefForm {
  chapterNo: number
  title: string
  role: string
  purpose: string
  keyEvents: string
  characters: string
  sceneBeats: string
  suspenseHook: string
  userGuidance: string
  notes: string
}

function emptyForm(chapterNo: number): BriefForm {
  return {
    chapterNo,
    title: '',
    role: '',
    purpose: '',
    keyEvents: '',
    characters: '',
    sceneBeats: '',
    suspenseHook: '',
    userGuidance: '',
    notes: ''
  }
}

function toForm(brief: ChapterBrief): BriefForm {
  return {
    chapterNo: brief.chapterNo,
    title: brief.title,
    role: brief.role,
    purpose: brief.purpose,
    keyEvents: brief.keyEvents,
    characters: brief.characters.join('、'),
    sceneBeats: brief.sceneBeats.join('\n'),
    suspenseHook: brief.suspenseHook,
    userGuidance: brief.userGuidance,
    notes: brief.notes
  }
}

const splitList = (value: string): string[] =>
  value
    .split(/[,，、\n]/)
    .map((item) => item.trim())
    .filter(Boolean)

export default function BriefPanel() {
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const briefs = useAppStore((s) => s.briefs)
  const currentChapterNo = useAppStore((s) => s.currentChapterNo)
  const loading = useAppStore((s) => s.loading)
  const saveBrief = useAppStore((s) => s.saveBrief)
  const removeBrief = useAppStore((s) => s.removeBrief)
  const expandBrief = useAppStore((s) => s.expandBrief)
  const setCurrentChapter = useAppStore((s) => s.setCurrentChapter)

  const brief = briefs.find((item) => item.chapterNo === currentChapterNo) ?? null
  const [form, setForm] = useState<BriefForm>(() => emptyForm(currentChapterNo))
  const [expanding, setExpanding] = useState(false)

  useEffect(() => {
    setForm(brief ? toForm(brief) : emptyForm(currentChapterNo))
  }, [brief, currentChapterNo])

  const chapterTitle = (no: number): string => briefs.find((item) => item.chapterNo === no)?.title || '（未命名）'

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (activeProjectId === null) return
    await saveBrief({
      id: brief?.id,
      projectId: activeProjectId,
      chapterNo: form.chapterNo,
      title: form.title,
      role: form.role,
      purpose: form.purpose,
      keyEvents: form.keyEvents,
      characters: splitList(form.characters),
      sceneBeats: form.sceneBeats
        .split('\n')
        .map((beat) => beat.trim())
        .filter(Boolean),
      suspenseHook: form.suspenseHook,
      userGuidance: form.userGuidance,
      notes: form.notes
    })
    setCurrentChapter(form.chapterNo)
  }

  const parseBeats = (value: string): string[] =>
    value
      .split('\n')
      .map((beat) => beat.trim())
      .filter(Boolean)

  /** AI 补全：把建议填回表单，由用户确认后再保存 */
  const handleExpand = async (): Promise<void> => {
    if (activeProjectId === null) return
    setExpanding(true)
    try {
      const suggestion = await expandBrief({
        projectId: activeProjectId,
        chapterNo: form.chapterNo,
        current: {
          title: form.title,
          purpose: form.purpose,
          keyEvents: form.keyEvents,
          characters: splitList(form.characters),
          sceneBeats: parseBeats(form.sceneBeats),
          suspenseHook: form.suspenseHook
        }
      })
      if (!suggestion) return
      setForm((prev) => ({
        ...prev,
        title: suggestion.title || prev.title,
        purpose: suggestion.purpose || prev.purpose,
        keyEvents: suggestion.keyEvents || prev.keyEvents,
        characters: suggestion.characters.length ? suggestion.characters.join('、') : prev.characters,
        sceneBeats: suggestion.sceneBeats.length ? suggestion.sceneBeats.join('\n') : prev.sceneBeats,
        suspenseHook: suggestion.suspenseHook || prev.suspenseHook
      }))
    } finally {
      setExpanding(false)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[210px_1fr]">
      <div className="max-h-[60vh] space-y-1 overflow-y-auto pr-1">
        {briefs.length === 0 ? (
          <p className="rounded-lg border border-dashed border-stone-300 px-3 py-6 text-center text-xs text-stone-400">
            还没有任何细纲
          </p>
        ) : (
          briefs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setCurrentChapter(item.chapterNo)}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${
                item.chapterNo === currentChapterNo ? 'bg-amber-50 text-amber-900' : 'text-stone-700 hover:bg-stone-50'
              }`}
            >
              <span className="shrink-0 text-xs text-stone-400">第 {item.chapterNo} 章</span>
              <span className="truncate">{item.title || '（未命名）'}</span>
            </button>
          ))
        )}
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Labeled label="章节号">
          <input
            type="number"
            min={1}
            value={form.chapterNo}
            onChange={(e) => setForm({ ...form, chapterNo: Number(e.target.value) || 1 })}
            className={INPUT_CLASS}
          />
        </Labeled>
        <Labeled label="章节标题">
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className={INPUT_CLASS}
          />
        </Labeled>
        <div className="md:col-span-2">
          <Labeled label="本章目的">
            <textarea
              rows={2}
              value={form.purpose}
              onChange={(e) => setForm({ ...form, purpose: e.target.value })}
              className={`${INPUT_CLASS} resize-none`}
            />
          </Labeled>
        </div>
        <div className="md:col-span-2">
          <Labeled label="关键事件">
            <textarea
              rows={3}
              value={form.keyEvents}
              onChange={(e) => setForm({ ...form, keyEvents: e.target.value })}
              className={`${INPUT_CLASS} resize-none`}
            />
          </Labeled>
        </div>
        <Labeled label="出场角色" hint="用「、」或逗号分隔">
          <input
            value={form.characters}
            onChange={(e) => setForm({ ...form, characters: e.target.value })}
            className={INPUT_CLASS}
          />
        </Labeled>
        <Labeled label="悬念钩子">
          <input
            value={form.suspenseHook}
            onChange={(e) => setForm({ ...form, suspenseHook: e.target.value })}
            className={INPUT_CLASS}
          />
        </Labeled>
        <div className="md:col-span-2">
          <Labeled label="场景节拍" hint="每行一个节拍">
            <textarea
              rows={4}
              value={form.sceneBeats}
              onChange={(e) => setForm({ ...form, sceneBeats: e.target.value })}
              className={`${INPUT_CLASS} resize-none`}
            />
          </Labeled>
        </div>
        <Labeled label="额外要求">
          <textarea
            rows={2}
            value={form.userGuidance}
            onChange={(e) => setForm({ ...form, userGuidance: e.target.value })}
            className={`${INPUT_CLASS} resize-none`}
          />
        </Labeled>
        <Labeled label="备注">
          <textarea
            rows={2}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            className={`${INPUT_CLASS} resize-none`}
          />
        </Labeled>

        <div className="flex items-center gap-3 md:col-span-2">
          <button type="submit" disabled={loading} className={BUTTON_PRIMARY}>
            {brief ? '更新细纲' : '保存细纲'}
          </button>
          <button
            type="button"
            onClick={() => void handleExpand()}
            disabled={expanding || loading}
            className={BUTTON_GHOST}
          >
            {expanding ? 'AI 补全中…' : 'AI 补全本章细纲'}
          </button>
          {brief && (
            <>
              <button
                type="button"
                onClick={() => void removeBrief(brief.id)}
                className={`${BUTTON_GHOST} hover:bg-red-50 hover:text-red-600`}
              >
                移入回收站
              </button>
              <span className="text-xs text-stone-400">
                已保存第 {brief.chapterNo} 章 · 下一章「{chapterTitle(brief.chapterNo + 1)}」
              </span>
            </>
          )}
        </div>
      </form>
    </div>
  )
}