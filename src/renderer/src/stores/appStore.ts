import type {
  BriefSaveInput,
  BriefSuggestion,
  ChapterBrief,
  ChapterDraft,
  DraftSaveInput,
  GenerateEvent,
  GenerationMode,
  Project,
  ProjectCreateInput,
  ProjectUpdateInput,
  Provider,
  ProviderSaveInput,
  ProviderTestResult,
  WizardEvent,
  WizardProgress,
  BriefExpandInput
} from '@shared/types'
import { create } from 'zustand'

export type View = 'bookshelf' | 'workspace' | 'settings'

interface GeneratingState {
  requestId: string
  chapterNo: number
  mode: GenerationMode
}

interface WizardState {
  requestId: string
  progress: WizardProgress | null
}

interface AppState {
  view: View
  projects: Project[]
  activeProjectId: number | null
  briefs: ChapterBrief[]
  drafts: ChapterDraft[]
  providers: Provider[]
  currentChapterNo: number
  loading: boolean
  error: string | null

  generating: GeneratingState | null
  /** 流式生成过程中已到达的文本 */
  streamText: string
  /** 生成收尾提示（如「已停止生成」） */
  notice: string | null

  wizard: WizardState | null
  wizardNotice: string | null

  setView: (view: View) => void
  clearError: () => void
  clearNotice: () => void

  loadProjects: () => Promise<void>
  createProject: (input: ProjectCreateInput) => Promise<void>
  removeProject: (id: number) => Promise<void>
  openProject: (id: number) => Promise<void>
  backToBookshelf: () => void
  updateProject: (input: ProjectUpdateInput) => Promise<void>

  saveBrief: (input: BriefSaveInput) => Promise<void>
  removeBrief: (id: number) => Promise<void>
  expandBrief: (input: BriefExpandInput) => Promise<BriefSuggestion | null>
  saveDraft: (input: DraftSaveInput) => Promise<void>
  removeDraft: (id: number) => Promise<void>

  setCurrentChapter: (chapterNo: number) => void
  reloadBriefs: () => Promise<void>
  reloadDrafts: () => Promise<void>

  loadProviders: () => Promise<void>
  saveProvider: (input: ProviderSaveInput) => Promise<void>
  removeProvider: (id: number) => Promise<void>
  testProvider: (input: ProviderSaveInput) => Promise<ProviderTestResult | null>

  generate: (mode: GenerationMode) => Promise<void>
  abortGeneration: () => Promise<void>
  handleGenerateEvent: (event: GenerateEvent) => void

  startWizard: (projectId?: number) => Promise<void>
  abortWizard: () => Promise<void>
  handleWizardEvent: (event: WizardEvent) => void
  clearWizardNotice: () => void
}

/** 统一收敛错误信息，避免每个动作各写一遍 try/catch */
async function guard<T>(set: (partial: Partial<AppState>) => void, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    set({ loading: true, error: null })
    return await fn()
  } catch (err) {
    set({ error: err instanceof Error ? err.message : String(err) })
    return undefined
  } finally {
    set({ loading: false })
  }
}

/** 不依赖 crypto.randomUUID，避免 file:// 下的可用性差异 */
function makeRequestId(): string {
  return `gen-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export const useAppStore = create<AppState>((set, get) => ({
  view: 'bookshelf',
  projects: [],
  activeProjectId: null,
  briefs: [],
  drafts: [],
  providers: [],
  currentChapterNo: 1,
  loading: false,
  error: null,
  generating: null,
  streamText: '',
  notice: null,
  wizard: null,
  wizardNotice: null,

  setView: (view) => set({ view }),
  clearError: () => set({ error: null }),
  clearNotice: () => set({ notice: null }),

  loadProjects: async () => {
    const projects = await guard(set, () => window.inkwell.project.list())
    if (projects) set({ projects })
  },

  createProject: async (input) => {
    const created = await guard(set, () => window.inkwell.project.create(input))
    if (!created) return
    set({ projects: [created, ...get().projects] })
    await get().openProject(created.id)
    // 填了灵感就立刻让 AI 出设定、大纲与细纲（计划书 §8.1）
    if (created.premise.trim()) await get().startWizard(created.id)
  },

  removeProject: async (id) => {
    await guard(set, () => window.inkwell.project.remove(id))
    if (get().activeProjectId === id) set({ activeProjectId: null, briefs: [], drafts: [] })
    await get().loadProjects()
  },

  openProject: async (id) => {
    set({ view: 'workspace', activeProjectId: id, currentChapterNo: 1, streamText: '', notice: null, wizardNotice: null })
    await Promise.all([get().reloadBriefs(), get().reloadDrafts()])
  },

  backToBookshelf: () => set({ view: 'bookshelf', streamText: '', notice: null }),

  updateProject: async (input) => {
    const updated = await guard(set, () => window.inkwell.project.update(input))
    if (!updated) return
    set({ projects: get().projects.map((item) => (item.id === updated.id ? updated : item)) })
  },

  saveBrief: async (input) => {
    const saved = await guard(set, () => window.inkwell.brief.save(input))
    if (!saved) return
    await get().reloadBriefs()
  },

  removeBrief: async (id) => {
    await guard(set, () => window.inkwell.brief.remove(id))
    await get().reloadBriefs()
  },

  expandBrief: async (input) => {
    const suggestion = await guard(set, () => window.inkwell.brief.expand(input))
    return suggestion ?? null
  },

  saveDraft: async (input) => {
    const saved = await guard(set, () => window.inkwell.draft.save(input))
    if (!saved) return
    await get().reloadDrafts()
  },

  removeDraft: async (id) => {
    await guard(set, () => window.inkwell.draft.remove(id))
    await get().reloadDrafts()
  },

  setCurrentChapter: (chapterNo) => set({ currentChapterNo: chapterNo }),

  reloadBriefs: async () => {
    const projectId = get().activeProjectId
    if (projectId === null) {
      set({ briefs: [] })
      return
    }
    const briefs = await guard(set, () => window.inkwell.brief.list(projectId))
    if (briefs) set({ briefs })
  },

  reloadDrafts: async () => {
    const projectId = get().activeProjectId
    if (projectId === null) {
      set({ drafts: [] })
      return
    }
    const drafts = await guard(set, () => window.inkwell.draft.list(projectId))
    if (drafts) set({ drafts })
  },

  loadProviders: async () => {
    const providers = await guard(set, () => window.inkwell.provider.list())
    if (providers) set({ providers })
  },

  saveProvider: async (input) => {
    const saved = await guard(set, () => window.inkwell.provider.save(input))
    if (!saved) return
    await get().loadProviders()
  },

  removeProvider: async (id) => {
    await guard(set, () => window.inkwell.provider.remove(id))
    await get().loadProviders()
  },

  testProvider: async (input) => {
    const result = await guard(set, () => window.inkwell.provider.test(input))
    return result ?? null
  },

  generate: async (mode) => {
    const { activeProjectId, currentChapterNo } = get()
    if (activeProjectId === null || get().generating) return

    const requestId = makeRequestId()
    set({
      generating: { requestId, chapterNo: currentChapterNo, mode },
      streamText: '',
      error: null,
      notice: null
    })

    try {
      await window.inkwell.generate.start({
        requestId,
        projectId: activeProjectId,
        chapterNo: currentChapterNo,
        mode
      })
    } catch (err) {
      set({
        generating: null,
        streamText: '',
        error: err instanceof Error ? err.message : String(err)
      })
    }
  },

  abortGeneration: async () => {
    const generating = get().generating
    if (!generating) return
    await window.inkwell.generate.abort(generating.requestId)
  },

  handleGenerateEvent: (event) => {
    const generating = get().generating
    if (!generating || generating.requestId !== event.requestId) return

    if (event.type === 'delta') {
      set({ streamText: get().streamText + event.text })
      return
    }

    if (event.type === 'done') {
      set({ generating: null, streamText: '', notice: '已生成并保存为新版本' })
      void get().reloadDrafts()
      return
    }

    set({ generating: null, streamText: '', notice: event.message })
  },

  startWizard: async (projectId) => {
    const target = projectId ?? get().activeProjectId
    if (target === null || get().wizard) return

    const requestId = makeRequestId()
    set({ wizard: { requestId, progress: null }, wizardNotice: null, error: null })
    try {
      await window.inkwell.wizard.start({ requestId, projectId: target })
    } catch (err) {
      set({ wizard: null, error: err instanceof Error ? err.message : String(err) })
    }
  },

  abortWizard: async () => {
    const wizard = get().wizard
    if (!wizard) return
    await window.inkwell.wizard.abort(wizard.requestId)
  },

  handleWizardEvent: (event) => {
    const wizard = get().wizard
    if (!wizard || wizard.requestId !== event.requestId) return

    if (event.type === 'progress') {
      set({ wizard: { ...wizard, progress: event.progress } })
      return
    }

    if (event.type === 'done') {
      set({ wizard: null, wizardNotice: `已完成：设定与大纲，并补齐 ${event.briefsCreated} 章细纲` })
      void get().loadProjects()
      void get().reloadBriefs()
      void get().reloadDrafts()
      return
    }

    if (event.message === '已停止') {
      set({ wizard: null, wizardNotice: '已停止生成' })
      return
    }
    set({ wizard: null, error: event.message })
  },

  clearWizardNotice: () => set({ wizardNotice: null })
}))