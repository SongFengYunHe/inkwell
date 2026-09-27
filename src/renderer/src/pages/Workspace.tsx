import type { ChapterBrief } from '@shared/types'
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useAppStore } from '../stores/appStore'

interface BriefForm {
  id: number | null
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

interface SettingsForm {
  premise: string
  worldbuilding: string
  protagonist: string
  goldenFinger: string
  globalGuidance: string
  coreOutline: string
}

const INPUT_CLASS =
  'rounded-lg border border-stone-200 px-3 py-2 text-sm outline-none transition focus:border-amber-500'

const emptyBriefForm = (chapterNo: number): BriefForm => ({
  id: null,
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
})

function toBriefForm(brief: ChapterBrief): BriefForm {
  return {
    id: brief.id,
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

function Labeled({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs text-stone-500">
        {label}
        {hint && <span className="ml-2 text-stone-400">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

export default function Workspace() {
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const projects = useAppStore((s) => s.projects)
  const briefs = useAppStore((s) => s.briefs)
  const loading = useAppStore((s) => s.loading)
  const selectProject = useAppStore((s) => s.selectProject)
  const updateProject = useAppStore((s) => s.updateProject)
  const saveBrief = useAppStore((s) => s.saveBrief)
  const removeBrief = useAppStore((s) => s.removeBrief)

  const project = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId]
  )

  const [settings, setSettings] = useState<SettingsForm>({
    premise: '',
    worldbuilding: '',
    protagonist: '',
    goldenFinger: '',
    globalGuidance: '',
    coreOutline: ''
  })
  const [dbPath, setDbPath] = useState('')

  useEffect(() => {
    if (!project) return
    setSettings({
      premise: project.premise,
      worldbuilding: project.worldbuilding,
      protagonist: project.protagonist,
      goldenFinger: project.goldenFinger,
      globalGuidance: project.globalGuidance,
      coreOutline: project.coreOutline
    })
  }, [project])

  useEffect(() => {
    void window.inkwell.app.dbPath().then(setDbPath)
  }, [])

  const nextChapterNo = useMemo(
    () => (briefs.length === 0 ? 1 : Math.max(...briefs.map((item) => item.chapterNo)) + 1),
    [briefs]
  )

  const [briefForm, setBriefForm] = useState<BriefForm>(() => emptyBriefForm(1))

  // 切换项目或章节集合变化时，把编辑器复位到「新建下一章」
  useEffect(() => {
    setBriefForm(emptyBriefForm(nextChapterNo))
  }, [nextChapterNo, activeProjectId])

  if (!project) {
    return <div className="flex flex-1 items-center justify-center text-sm text-stone-400">加载项目…</div>
  }

  const handleSaveSettings = async (event: FormEvent) => {
    event.preventDefault()
    await updateProject({ id: project.id, ...settings })
  }

  const handleSaveBrief = async (event: FormEvent) => {
    event.preventDefault()
    await saveBrief({
      id: briefForm.id ?? undefined,
      projectId: project.id,
      chapterNo: briefForm.chapterNo,
      title: briefForm.title,
      role: briefForm.role,
      purpose: briefForm.purpose,
      keyEvents: briefForm.keyEvents,
      characters: splitList(briefForm.characters),
      sceneBeats: briefForm.sceneBeats
        .split('\n')
        .map((beat) => beat.trim())
        .filter(Boolean),
      suspenseHook: briefForm.suspenseHook,
      userGuidance: briefForm.userGuidance,
      notes: briefForm.notes
    })
    if (briefForm.id === null) setBriefForm(emptyBriefForm(briefForm.chapterNo + 1))
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-4 border-b border-stone-200 bg-white px-6 py-3">
        <button
          type="button"
          onClick={() => void selectProject(null)}
          className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm text-stone-600 transition hover:bg-stone-50"
        >
          ← 书架
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-base font-medium">{project.name}</h1>
          <p className="truncate text-xs text-stone-400">
            {project.genre || '未设题材'} · 计划 {project.totalChapters} 章 · 已填细纲 {briefs.length} 章
          </p>
        </div>
        <span className="ml-auto text-xs text-stone-400">{loading ? '保存中…' : ''}</span>
      </header>

      <main className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
        <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-medium text-stone-700">设定与总大纲</h2>
          </div>
          <form onSubmit={handleSaveSettings} className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Labeled label="故事前提 / 一句话灵感">
              <textarea
                rows={3}
                value={settings.premise}
                onChange={(e) => setSettings({ ...settings, premise: e.target.value })}
                className={`${INPUT_CLASS} resize-none`}
              />
            </Labeled>
            <Labeled label="主角档案">
              <textarea
                rows={3}
                value={settings.protagonist}
                onChange={(e) => setSettings({ ...settings, protagonist: e.target.value })}
                className={`${INPUT_CLASS} resize-none`}
              />
            </Labeled>
            <Labeled label="世界观设定">
              <textarea
                rows={3}
                value={settings.worldbuilding}
                onChange={(e) => setSettings({ ...settings, worldbuilding: e.target.value })}
                className={`${INPUT_CLASS} resize-none`}
              />
            </Labeled>
            <Labeled label="金手指 / 核心设定">
              <textarea
                rows={3}
                value={settings.goldenFinger}
                onChange={(e) => setSettings({ ...settings, goldenFinger: e.target.value })}
                className={`${INPUT_CLASS} resize-none`}
              />
            </Labeled>
            <div className="md:col-span-2">
              <Labeled label="全局写作指引" hint="文风、禁忌、视角等">
                <textarea
                  rows={2}
                  value={settings.globalGuidance}
                  onChange={(e) => setSettings({ ...settings, globalGuidance: e.target.value })}
                  className={`${INPUT_CLASS} resize-none`}
                />
              </Labeled>
            </div>
            <div className="md:col-span-2">
              <Labeled label="L1 总大纲" hint="分卷 + 主线/支线/伏笔">
                <textarea
                  rows={8}
                  value={settings.coreOutline}
                  onChange={(e) => setSettings({ ...settings, coreOutline: e.target.value })}
                  className={`${INPUT_CLASS} resize-y leading-6`}
                />
              </Labeled>
            </div>
            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={loading}
                className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-stone-700 disabled:opacity-40"
              >
                保存设定与大纲
              </button>
            </div>
          </form>
        </section>

        <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-medium text-stone-700">章节细纲（L2）</h2>
            <button
              type="button"
              onClick={() => setBriefForm(emptyBriefForm(nextChapterNo))}
              className="text-xs text-amber-700 hover:underline"
            >
              + 新建下一章（第 {nextChapterNo} 章）
            </button>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_1fr]">
            <div className="max-h-[420px] space-y-1 overflow-y-auto pr-1">
              {briefs.length === 0 ? (
                <p className="rounded-lg border border-dashed border-stone-300 px-3 py-6 text-center text-xs text-stone-400">
                  还没有细纲，右侧填写第 1 章
                </p>
              ) : (
                briefs.map((brief) => (
                  <button
                    key={brief.id}
                    type="button"
                    onClick={() => setBriefForm(toBriefForm(brief))}
                    className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${
                      briefForm.id === brief.id
                        ? 'bg-amber-50 text-amber-900'
                        : 'hover:bg-stone-50 text-stone-700'
                    }`}
                  >
                    <span className="shrink-0 text-xs text-stone-400">第 {brief.chapterNo} 章</span>
                    <span className="truncate">{brief.title || '（未命名）'}</span>
                  </button>
                ))
              )}
            </div>

            <form onSubmit={handleSaveBrief} className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Labeled label="章节号">
                <input
                  type="number"
                  min={1}
                  value={briefForm.chapterNo}
                  onChange={(e) => setBriefForm({ ...briefForm, chapterNo: Number(e.target.value) || 1 })}
                  className={INPUT_CLASS}
                />
              </Labeled>
              <Labeled label="章节标题">
                <input
                  value={briefForm.title}
                  onChange={(e) => setBriefForm({ ...briefForm, title: e.target.value })}
                  className={INPUT_CLASS}
                />
              </Labeled>
              <div className="md:col-span-2">
                <Labeled label="本章目的">
                  <textarea
                    rows={2}
                    value={briefForm.purpose}
                    onChange={(e) => setBriefForm({ ...briefForm, purpose: e.target.value })}
                    className={`${INPUT_CLASS} resize-none`}
                  />
                </Labeled>
              </div>
              <div className="md:col-span-2">
                <Labeled label="关键事件">
                  <textarea
                    rows={3}
                    value={briefForm.keyEvents}
                    onChange={(e) => setBriefForm({ ...briefForm, keyEvents: e.target.value })}
                    className={`${INPUT_CLASS} resize-none`}
                  />
                </Labeled>
              </div>
              <Labeled label="出场角色" hint="用「、」或逗号分隔">
                <input
                  value={briefForm.characters}
                  onChange={(e) => setBriefForm({ ...briefForm, characters: e.target.value })}
                  className={INPUT_CLASS}
                />
              </Labeled>
              <Labeled label="悬念钩子">
                <input
                  value={briefForm.suspenseHook}
                  onChange={(e) => setBriefForm({ ...briefForm, suspenseHook: e.target.value })}
                  className={INPUT_CLASS}
                />
              </Labeled>
              <div className="md:col-span-2">
                <Labeled label="场景节拍" hint="每行一个节拍">
                  <textarea
                    rows={4}
                    value={briefForm.sceneBeats}
                    onChange={(e) => setBriefForm({ ...briefForm, sceneBeats: e.target.value })}
                    className={`${INPUT_CLASS} resize-none`}
                  />
                </Labeled>
              </div>
              <Labeled label="额外要求">
                <textarea
                  rows={2}
                  value={briefForm.userGuidance}
                  onChange={(e) => setBriefForm({ ...briefForm, userGuidance: e.target.value })}
                  className={`${INPUT_CLASS} resize-none`}
                />
              </Labeled>
              <Labeled label="备注">
                <textarea
                  rows={2}
                  value={briefForm.notes}
                  onChange={(e) => setBriefForm({ ...briefForm, notes: e.target.value })}
                  className={`${INPUT_CLASS} resize-none`}
                />
              </Labeled>
              <div className="flex items-center gap-3 md:col-span-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-stone-700 disabled:opacity-40"
                >
                  {briefForm.id === null ? '保存细纲' : '更新细纲'}
                </button>
                {briefForm.id !== null && (
                  <>
                    <button
                      type="button"
                      onClick={() => void removeBrief(briefForm.id as number)}
                      className="rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-600 transition hover:bg-red-50 hover:text-red-600"
                    >
                      删除本章
                    </button>
                    <span className="text-xs text-stone-400">正在编辑第 {briefForm.chapterNo} 章</span>
                  </>
                )}
              </div>
            </form>
          </div>
        </section>

        <p className="pb-2 text-center text-xs text-stone-400">数据文件：{dbPath}</p>
      </main>
    </div>
  )
}