import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useAppStore } from '../stores/appStore'
import StylePanel from './StylePanel'
import VolumePanel from './VolumePanel'
import { BUTTON_GHOST, BUTTON_PRIMARY, INPUT_CLASS, Labeled } from './ui'

interface OutlineForm {
  premise: string
  worldbuilding: string
  protagonist: string
  goldenFinger: string
  style: string
  wordsPerChapter: number
  globalGuidance: string
  coreOutline: string
}

export default function OutlinePanel() {
  const projects = useAppStore((s) => s.projects)
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const loading = useAppStore((s) => s.loading)
  const updateProject = useAppStore((s) => s.updateProject)
  const startWizard = useAppStore((s) => s.startWizard)
  const wizard = useAppStore((s) => s.wizard)

  const project = useMemo(
    () => projects.find((item) => item.id === activeProjectId) ?? null,
    [projects, activeProjectId]
  )

  const [form, setForm] = useState<OutlineForm>({
    premise: '',
    worldbuilding: '',
    protagonist: '',
    goldenFinger: '',
    style: '',
    wordsPerChapter: 3000,
    globalGuidance: '',
    coreOutline: ''
  })

  useEffect(() => {
    if (!project) return
    setForm({
      premise: project.premise,
      worldbuilding: project.worldbuilding,
      protagonist: project.protagonist,
      goldenFinger: project.goldenFinger,
      style: project.style,
      wordsPerChapter: project.wordsPerChapter,
      globalGuidance: project.globalGuidance,
      coreOutline: project.coreOutline
    })
  }, [project])

  if (!project) return null

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    await updateProject({ id: project.id, ...form })
  }

  const handleWizard = async (): Promise<void> => {
    if (
      form.coreOutline.trim() &&
      !window.confirm('AI 生成会覆盖世界观 / 主角 / 金手指 / 文风 / 总大纲（不会动已有细纲）。继续？')
    ) {
      return
    }
    await startWizard()
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Labeled label="故事前提 / 一句话灵感">
        <textarea
          rows={3}
          value={form.premise}
          onChange={(e) => setForm({ ...form, premise: e.target.value })}
          className={`${INPUT_CLASS} resize-none`}
        />
      </Labeled>
      <Labeled label="主角档案">
        <textarea
          rows={3}
          value={form.protagonist}
          onChange={(e) => setForm({ ...form, protagonist: e.target.value })}
          className={`${INPUT_CLASS} resize-none`}
        />
      </Labeled>
      <Labeled label="世界观设定">
        <textarea
          rows={3}
          value={form.worldbuilding}
          onChange={(e) => setForm({ ...form, worldbuilding: e.target.value })}
          className={`${INPUT_CLASS} resize-none`}
        />
      </Labeled>
      <Labeled label="金手指 / 核心设定">
        <textarea
          rows={3}
          value={form.goldenFinger}
          onChange={(e) => setForm({ ...form, goldenFinger: e.target.value })}
          className={`${INPUT_CLASS} resize-none`}
        />
      </Labeled>
      <Labeled label="文风">
        <textarea
          rows={3}
          value={form.style}
          onChange={(e) => setForm({ ...form, style: e.target.value })}
          placeholder="例如：克制冷峻，重意境，少用感叹号"
          className={`${INPUT_CLASS} resize-none`}
        />
      </Labeled>
      <Labeled label="单章目标字数">
        <input
          type="number"
          min={200}
          max={20000}
          value={form.wordsPerChapter}
          onChange={(e) => setForm({ ...form, wordsPerChapter: Number(e.target.value) || 3000 })}
          className={INPUT_CLASS}
        />
      </Labeled>
      <div className="md:col-span-2">
        <Labeled label="全局写作指引" hint="禁忌、视角、节奏偏好等">
          <textarea
            rows={2}
            value={form.globalGuidance}
            onChange={(e) => setForm({ ...form, globalGuidance: e.target.value })}
            className={`${INPUT_CLASS} resize-none`}
          />
        </Labeled>
      </div>
      <div className="md:col-span-2">
        <Labeled label="L1 总大纲" hint="分卷 + 主线 / 支线 / 伏笔">
          <textarea
            rows={10}
            value={form.coreOutline}
            onChange={(e) => setForm({ ...form, coreOutline: e.target.value })}
            className={`${INPUT_CLASS} resize-y leading-6`}
          />
        </Labeled>
      </div>
      <div className="flex flex-wrap items-center gap-3 md:col-span-2">
        <button type="submit" disabled={loading} className={BUTTON_PRIMARY}>
          保存设定与大纲
        </button>
        <button
          type="button"
          onClick={() => void handleWizard()}
          disabled={loading || wizard !== null}
          className={BUTTON_GHOST}
        >
          {wizard ? 'AI 生成中…' : 'AI 生成设定与大纲'}
        </button>
        <span className="text-xs text-stone-400">按总大纲自动补齐所有章节细纲</span>
      </div>

      <div className="md:col-span-2 mt-2 border-t border-stone-200 pt-5">
        <StylePanel projectId={project.id} />
      </div>

      <div className="md:col-span-2 border-t border-stone-200 pt-5">
        <VolumePanel projectId={project.id} />
      </div>
    </form>
  )
}