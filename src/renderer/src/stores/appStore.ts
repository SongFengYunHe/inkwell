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
  BriefExpandInput,
  BridgeTaskExport,
  LlmRoleName,
  RoleRoute,
  RoleRouteSaveInput,
  UsageSummary,
  AuditReport,
  ExportFormat,
  ExportResult,
  FixResult,
  PipelineEvent,
  PipelineRun,
  TruthFiles
} from '@shared/types'
import { create } from 'zustand'

export type View = 'bookshelf' | 'workspace' | 'settings'

export type Theme = 'light' | 'dark'

const THEME_KEY = 'inkwell.theme'

/** 首次启动时跟随系统偏好，之后以用户选择为准 */
function initialTheme(): Theme {
  const saved = localStorage.getItem(THEME_KEY)
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

interface GeneratingState {
  requestId: string
  chapterNo: number
  mode: GenerationMode
}

interface WizardState {
  requestId: string
  progress: WizardProgress | null
}

interface PipelineState {
  requestId: string
  run: PipelineRun | null
  message: string
}

interface AppState {
  view: View
  projects: Project[]
  activeProjectId: number | null
  briefs: ChapterBrief[]
  drafts: ChapterDraft[]
  providers: Provider[]
  routes: RoleRoute[]
  usage: UsageSummary | null
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

  /** M3：连写队列运行时状态 */
  pipeline: PipelineState | null
  pipelineNotice: string | null
  /** M3：项目最近一次连写任务（用于「继续连写」） */
  lastRun: PipelineRun | null
  /** M3：七个真相文件 */
  truth: TruthFiles | null
  /** M3：当前章最新审计报告 */
  audit: AuditReport | null
  /** M4：最近一次一键修复结果 */
  fixResult: FixResult | null
  /** M4：最近一次导出结果 */
  exportResult: ExportResult | null
  /** M5：深浅主题 */
  theme: Theme
  /** M5：专注模式（隐藏所有 chrome，只留正文） */
  focusMode: boolean

  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  setFocusMode: (on: boolean) => void
  toggleFocusMode: () => void

  setView: (view: View) => void
  clearError: () => void
  clearNotice: () => void

  loadProjects: () => Promise<void>
  createProject: (input: ProjectCreateInput & { style?: string }) => Promise<void>
  removeProject: (id: number) => Promise<void>
  /** M5：导入 Vela 工程并直接打开 */
  importVelaProject: () => Promise<void>
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

  loadRoutes: () => Promise<void>
  saveRoute: (input: RoleRouteSaveInput) => Promise<void>
  removeRoute: (role: LlmRoleName) => Promise<void>
  loadUsage: () => Promise<void>
  exportTask: (projectId: number, chapterNo: number) => Promise<BridgeTaskExport | null>
  /** 任务单桥：把外部 Agent 产出的文本存为本章新版本 */
  importDraft: (projectId: number, chapterNo: number, text: string) => Promise<ChapterDraft | null>

  generate: (mode: GenerationMode) => Promise<void>
  abortGeneration: () => Promise<void>
  handleGenerateEvent: (event: GenerateEvent) => void

  startWizard: (projectId?: number) => Promise<void>
  abortWizard: () => Promise<void>
  handleWizardEvent: (event: WizardEvent) => void
  clearWizardNotice: () => void

  /* ------------------------------ M3：连写与记忆 ------------------------------ */
  startPipeline: (options?: { fromCh?: number; toCh?: number; requireAccept?: boolean }) => Promise<void>
  resumePipeline: () => Promise<void>
  pausePipeline: () => Promise<void>
  abortPipeline: () => Promise<void>
  skipPipeline: () => Promise<void>
  acceptPipeline: () => Promise<void>
  rejectPipeline: () => Promise<void>
  steerPipeline: (guidance: string) => Promise<void>
  handlePipelineEvent: (event: PipelineEvent) => void
  clearPipelineNotice: () => void
  loadLastRun: () => Promise<void>

  loadTruthFiles: () => Promise<void>
  loadLatestAudit: (chapterNo: number) => Promise<void>
  rebuildMemory: () => Promise<void>

  /* ----------------------------- M4：审稿 / 修复 / 导出 ----------------------------- */
  auditCurrent: () => Promise<void>
  fixCurrent: (useModel?: boolean) => Promise<void>
  clearFixResult: () => void
  runExport: (formats: ExportFormat[]) => Promise<void>
  openExportDir: (path: string) => Promise<void>
  clearExportResult: () => void
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
  routes: [],
  usage: null,
  currentChapterNo: 1,
  loading: false,
  error: null,
  generating: null,
  streamText: '',
  notice: null,
  wizard: null,
  wizardNotice: null,
  pipeline: null,
  pipelineNotice: null,
  lastRun: null,
  truth: null,
  audit: null,
  fixResult: null,
  exportResult: null,
  theme: initialTheme(),
  focusMode: false,

  setTheme: (theme) => {
    localStorage.setItem(THEME_KEY, theme)
    set({ theme })
  },
  toggleTheme: () => {
    const theme: Theme = get().theme === 'dark' ? 'light' : 'dark'
    localStorage.setItem(THEME_KEY, theme)
    set({ theme })
  },
  setFocusMode: (on) => set({ focusMode: on }),
  toggleFocusMode: () => set({ focusMode: !get().focusMode }),

  setView: (view) => set({ view }),
  clearError: () => set({ error: null }),
  clearNotice: () => set({ notice: null }),

  loadProjects: async () => {
    const projects = await guard(set, () => window.inkwell.project.list())
    if (projects) set({ projects })
  },

  createProject: async (input) => {
    const { style, ...create } = input
    const created = await guard(set, () => window.inkwell.project.create(create))
    if (!created) return
    if (style?.trim()) {
      const updated = await guard(set, () => window.inkwell.project.update({ id: created.id, style: style.trim() }))
      if (updated) created.style = updated.style
    }
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

  importVelaProject: async () => {
    const summary = await guard(set, () => window.inkwell.project.importVela())
    if (!summary) return
    await get().loadProjects()
    await get().openProject(summary.project.id)
    set({ notice: `已导入「${summary.project.name}」：细纲 ${summary.briefs} 章 · 正文 ${summary.drafts} 章` })
  },

  openProject: async (id) => {
    set({
      view: 'workspace',
      activeProjectId: id,
      currentChapterNo: 1,
      streamText: '',
      notice: null,
      wizardNotice: null,
      pipelineNotice: null,
      truth: null,
      audit: null,
      fixResult: null,
      exportResult: null
    })
    await Promise.all([get().reloadBriefs(), get().reloadDrafts()])
    void get().loadLastRun()
    void get().loadTruthFiles()
    void get().loadLatestAudit(1)
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

  setCurrentChapter: (chapterNo) => {
    set({ currentChapterNo: chapterNo, fixResult: null })
    void get().loadLatestAudit(chapterNo)
  },

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

  loadRoutes: async () => {
    const routes = await guard(set, () => window.inkwell.route.list())
    if (routes) set({ routes })
  },

  saveRoute: async (input) => {
    const saved = await guard(set, () => window.inkwell.route.save(input))
    if (!saved) return
    await get().loadRoutes()
  },

  removeRoute: async (role) => {
    await guard(set, () => window.inkwell.route.remove(role))
    await get().loadRoutes()
  },

  loadUsage: async () => {
    const summary = await guard(set, () => window.inkwell.usage.summary())
    if (summary) set({ usage: summary })
  },

  exportTask: async (projectId, chapterNo) => {
    const result = await guard(set, () => window.inkwell.bridge.exportTask(projectId, chapterNo))
    return result ?? null
  },

  importDraft: async (projectId, chapterNo, text) => {
    const saved = await guard(set, async () => {
      const drafts = await window.inkwell.draft.list(projectId)
      const versions = drafts.filter((item) => item.chapterNo === chapterNo)
      const nextVersion = (versions[0]?.version ?? 0) + 1
      return window.inkwell.draft.save({
        projectId,
        chapterNo,
        version: nextVersion,
        status: 'draft',
        source: 'write',
        content: text
      })
    })
    if (saved) await get().reloadDrafts()
    return saved ?? null
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

  clearWizardNotice: () => set({ wizardNotice: null }),

  /* ------------------------------ M3：连写与记忆 ------------------------------ */

  startPipeline: async (options) => {
    const projectId = get().activeProjectId
    if (projectId === null || get().pipeline) return
    const requestId = makeRequestId()
    set({
      pipeline: { requestId, run: null, message: '正在启动连写…' },
      pipelineNotice: null,
      error: null
    })
    try {
      await window.inkwell.pipeline.start({ requestId, projectId, ...options })
    } catch (err) {
      set({ pipeline: null, error: err instanceof Error ? err.message : String(err) })
    }
  },

  resumePipeline: async () => {
    const projectId = get().activeProjectId
    if (projectId === null || get().pipeline) return
    const requestId = makeRequestId()
    set({ pipeline: { requestId, run: null, message: '正在从断点继续…' }, pipelineNotice: null, error: null })
    try {
      await window.inkwell.pipeline.resume(requestId, projectId)
    } catch (err) {
      set({ pipeline: null, error: err instanceof Error ? err.message : String(err) })
    }
  },

  pausePipeline: async () => {
    const pipeline = get().pipeline
    if (!pipeline) return
    await window.inkwell.pipeline.pause(pipeline.requestId)
  },

  abortPipeline: async () => {
    const pipeline = get().pipeline
    if (!pipeline) return
    await window.inkwell.pipeline.abort(pipeline.requestId)
  },

  skipPipeline: async () => {
    const pipeline = get().pipeline
    if (!pipeline) return
    await window.inkwell.pipeline.skip(pipeline.requestId)
  },

  acceptPipeline: async () => {
    const pipeline = get().pipeline
    if (!pipeline) return
    await window.inkwell.pipeline.accept(pipeline.requestId)
  },

  rejectPipeline: async () => {
    const pipeline = get().pipeline
    if (!pipeline) return
    await window.inkwell.pipeline.reject(pipeline.requestId)
  },

  steerPipeline: async (guidance) => {
    const pipeline = get().pipeline
    if (!pipeline) return
    await window.inkwell.pipeline.steer(pipeline.requestId, guidance)
    set({ pipelineNotice: '已注入本章要求，将从下一章起生效' })
  },

  handlePipelineEvent: (event) => {
    const pipeline = get().pipeline
    if (!pipeline || pipeline.requestId !== event.requestId) return

    if (event.type === 'progress') {
      set({ pipeline: { requestId: event.requestId, run: event.run, message: event.message } })
      return
    }

    if (event.type === 'chapter_done') {
      set({ pipeline: { requestId: event.requestId, run: event.run, message: `第 ${event.chapterNo} 章已完成` } })
      void get().reloadDrafts()
      void get().loadTruthFiles()
      return
    }

    if (event.type === 'awaiting_accept') {
      set({
        pipeline: { requestId: event.requestId, run: event.run, message: `第 ${event.chapterNo} 章等待你的确认` },
        currentChapterNo: event.chapterNo
      })
      void get().reloadDrafts()
      void get().loadTruthFiles()
      void get().loadLatestAudit(event.chapterNo)
      return
    }

    if (event.type === 'done') {
      set({
        pipeline: null,
        lastRun: event.run,
        pipelineNotice: `连写完成：本次新写 ${event.written} 章`
      })
      void get().loadProjects()
      void get().reloadBriefs()
      void get().reloadDrafts()
      void get().loadTruthFiles()
      return
    }

    // error
    set({ pipeline: null, lastRun: event.run, pipelineNotice: event.message })
    void get().loadLastRun()
    void get().reloadDrafts()
  },

  clearPipelineNotice: () => set({ pipelineNotice: null }),

  loadLastRun: async () => {
    const projectId = get().activeProjectId
    if (projectId === null) {
      set({ lastRun: null })
      return
    }
    const run = await guard(set, () => window.inkwell.pipeline.latest(projectId))
    set({ lastRun: run ?? null })
  },

  loadTruthFiles: async () => {
    const projectId = get().activeProjectId
    if (projectId === null) {
      set({ truth: null })
      return
    }
    const truth = await guard(set, () => window.inkwell.memory.truthFiles(projectId))
    if (truth) set({ truth })
  },

  loadLatestAudit: async (chapterNo) => {
    const projectId = get().activeProjectId
    if (projectId === null) {
      set({ audit: null })
      return
    }
    const report = await guard(set, () => window.inkwell.memory.latestAudit(projectId, chapterNo))
    set({ audit: report ?? null })
  },

  rebuildMemory: async () => {
    const projectId = get().activeProjectId
    if (projectId === null) return
    const result = await guard(set, () => window.inkwell.memory.rebuild(projectId))
    if (result) {
      set({ pipelineNotice: `已从正文重建 ${result.chapters} 章的记忆` })
      await get().loadTruthFiles()
    }
  },

  /* ----------------------------- M4：审稿 / 修复 / 导出 ----------------------------- */

  auditCurrent: async () => {
    const { activeProjectId, currentChapterNo } = get()
    if (activeProjectId === null) return
    const report = await guard(set, () => window.inkwell.draft.audit(activeProjectId, currentChapterNo))
    if (!report) return
    set({
      audit: report,
      fixResult: null,
      notice: `审稿完成：${report.passed ? '整体通过' : '存在 error 级问题'}（评分 ${report.score}）`
    })
  },

  fixCurrent: async (useModel) => {
    const { activeProjectId, currentChapterNo } = get()
    if (activeProjectId === null) return
    const result = await guard(set, () =>
      window.inkwell.draft.fix({ projectId: activeProjectId, chapterNo: currentChapterNo, useModel: useModel ?? true })
    )
    if (!result) return

    set({
      fixResult: result,
      audit: result.auditAfter ?? get().audit,
      notice: result.noop
        ? '没有需要修复的问题'
        : `已修复并保存为 v${result.draft.version}（规则变更 ${result.styleChanges.length} 条${
            result.modelUsed ? ' + 模型定点修复' : ''
          }）`
    })
    await get().reloadDrafts()
  },

  clearFixResult: () => set({ fixResult: null }),

  runExport: async (formats) => {
    const projectId = get().activeProjectId
    if (projectId === null || formats.length === 0) return
    const result = await guard(set, () => window.inkwell.export.project({ projectId, formats }))
    if (result) set({ exportResult: result })
  },

  openExportDir: async (path) => {
    await window.inkwell.export.openDir(path)
  },

  clearExportResult: () => set({ exportResult: null })
}))