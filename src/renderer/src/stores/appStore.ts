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
  TruthFiles,
  LibraryBootstrap,
  BriefFieldKey,
  ImportEvent,
  ImportSession,
  ImportUpdateItemInput
} from '@shared/types'
import { create } from 'zustand'

export type View = 'bookshelf' | 'workspace' | 'settings' | 'library'

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

/** M6：可撤销操作（删除即移入回收站，5 秒内可撤销） */
interface UndoState {
  message: string
  run: () => Promise<void>
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

  /** M6：书库启动态（活动库 / 全部库 / 是否需要引导迁移） */
  bootstrap: LibraryBootstrap | null
  /** M6：迁移向导是否打开 */
  migrationOpen: boolean
  /** M6：可撤销提示（5 秒） */
  undo: UndoState | null

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
  importDraft: (projectId: number, chapterNo: number, text: string, source?: string) => Promise<ChapterDraft | null>

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

  /* ----------------------------- M7：内容导入 ----------------------------- */
  /** 当前导入会话（非空时展示差异预览页） */
  importSession: ImportSession | null
  /** 解析中的进度文案 */
  importProgress: string | null
  /** 从文件路径 / 粘贴文本发起解析并打开差异预览 */
  openImportReview: (input: {
    path?: string
    text?: string
    kind?: string
    projectId?: number
    useLlm?: boolean
  }) => Promise<ImportSession | null>
  /** 改单条 action / enabled */
  updateImportItem: (input: ImportUpdateItemInput) => Promise<void>
  /** 重跑体检 */
  revalidateImport: (requiredFields?: BriefFieldKey[]) => Promise<void>
  /** 仅导入选中项 */
  commitImport: () => Promise<boolean>
  cancelImport: () => Promise<void>
  closeImportReview: () => void
  handleImportEvent: (event: ImportEvent) => void
  /** 拖拽落点路由（按扩展开与页面位置分流） */
  dropImport: (path: string, target: string) => Promise<void>
  /** 书架空白区：新建项目（预填标题）后进入导入预览（文件或粘贴文本） */
  createProjectFromImport: (input: { path?: string; text?: string }) => Promise<void>
  /** 「正文」Tab：作为当前章草稿新版本导入 */
  importDraftFromPath: (path: string) => Promise<void>

  /* ----------------------------- M6：书库与撤销 ----------------------------- */
  loadBootstrap: () => Promise<void>
  openMigration: () => void
  closeMigration: () => void
  dismissUndo: () => void
  runUndo: () => Promise<void>
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
  bootstrap: null,
  migrationOpen: false,
  undo: null,
  importSession: null,
  importProgress: null,

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
    const removed = get().projects.find((item) => item.id === id)
    await guard(set, () => window.inkwell.project.remove(id))
    if (get().activeProjectId === id) set({ activeProjectId: null, briefs: [], drafts: [] })
    await get().loadProjects()
    if (removed) {
      set({
        undo: {
          message: `已把「${removed.name}」移入回收站`,
          run: async () => {
            await window.inkwell.trash.restore({ kind: 'project', id })
            await get().loadProjects()
          }
        }
      })
    }
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
    const removed = get().briefs.find((item) => item.id === id)
    await guard(set, () => window.inkwell.brief.remove(id))
    await get().reloadBriefs()
    await get().reloadDrafts()
    if (removed) {
      set({
        undo: {
          message: `已把第 ${removed.chapterNo} 章移入回收站`,
          run: async () => {
            const result = await window.inkwell.trash.restore({ kind: 'chapter', id })
            await get().reloadBriefs()
            await get().reloadDrafts()
            if (result.chapterNo && result.chapterNo !== removed.chapterNo) {
              set({ notice: `原章节号已被占用，已恢复到第 ${result.chapterNo} 章` })
            }
          }
        }
      })
    }
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
    const removed = get().drafts.find((item) => item.id === id)
    await guard(set, () => window.inkwell.draft.remove(id))
    await get().reloadDrafts()
    if (removed) {
      set({
        undo: {
          message: `已把第 ${removed.chapterNo} 章 v${removed.version} 移入回收站`,
          run: async () => {
            // 软删除行不占用唯一索引，按原版本号重建即可
            await window.inkwell.draft.save({
              projectId: removed.projectId,
              chapterNo: removed.chapterNo,
              version: removed.version,
              status: removed.status,
              source: removed.source,
              content: removed.content
            })
            await get().reloadDrafts()
          }
        }
      })
    }
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

  importDraft: async (projectId, chapterNo, text, source) => {
    const saved = await guard(set, async () => {
      const drafts = await window.inkwell.draft.list(projectId)
      const versions = drafts.filter((item) => item.chapterNo === chapterNo)
      const nextVersion = (versions[0]?.version ?? 0) + 1
      return window.inkwell.draft.save({
        projectId,
        chapterNo,
        version: nextVersion,
        status: 'draft',
        source: source ?? 'write',
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

  clearExportResult: () => set({ exportResult: null }),

  /* ----------------------------- M7：内容导入 ----------------------------- */

  openImportReview: async (input) => {
    const session = await guard(set, () => window.inkwell.import.analyze(input))
    if (!session) return null
    set({ importSession: session, importProgress: null })
    return session
  },

  updateImportItem: async (input) => {
    const session = await guard(set, () => window.inkwell.import.updateItem(input))
    if (session) set({ importSession: session })
  },

  revalidateImport: async (requiredFields) => {
    const current = get().importSession
    if (!current) return
    const session = await guard(set, () =>
      window.inkwell.import.validate({ sessionId: current.id, requiredFields })
    )
    if (session) set({ importSession: session })
  },

  commitImport: async () => {
    const current = get().importSession
    if (!current) return false
    if (current.projectId === null) {
      set({ error: '请选择目标项目后再导入' })
      return false
    }
    const result = await guard(set, () => window.inkwell.import.commit(current.id))
    if (!result) return false
    set({ importSession: null, importProgress: null })
    await get().reloadBriefs()
    await get().loadProjects()
    set({ notice: `已仅导入选中项，共写入 ${result.committed} 章细纲` })
    return true
  },

  cancelImport: async () => {
    const current = get().importSession
    if (!current) return
    await guard(set, () => window.inkwell.import.cancel(current.id))
    set({ importSession: null, importProgress: null })
  },

  closeImportReview: () => set({ importSession: null, importProgress: null }),

  handleImportEvent: (event) => {
    if (event.type === 'progress') set({ importProgress: event.progress.message })
  },

  dropImport: async (path, target) => {
    const ext = path.toLowerCase().split('.').pop() ?? ''
    if (['vela', 'db', 'sqlite', 'sqlite3'].includes(ext)) {
      set({ notice: 'Vela 工程 / 数据库请使用「导入 Vela 项目」或书库挂载' })
      return
    }
    if (target.startsWith('project-card:')) {
      const id = Number(target.slice('project-card:'.length))
      await get().openImportReview({ path, projectId: Number.isFinite(id) ? id : undefined })
      return
    }
    if (target === 'outline') {
      await get().openImportReview({ path, projectId: get().activeProjectId ?? undefined })
      return
    }
    if (target === 'draft') {
      await get().importDraftFromPath(path)
      return
    }
    if (target === 'cover') {
      set({ notice: '暂不支持拖入图片设置封面' })
      return
    }
    // 书架空白区：新建项目（预填标题）后进入大纲分层解析
    await get().createProjectFromImport({ path })
  },

  createProjectFromImport: async (input) => {
    const preview = await guard(set, () => window.inkwell.import.analyze(input))
    if (!preview) return
    const firstChapter = preview.tree.volumes.flatMap((volume) => volume.chapters)[0]
    const baseName = input.path?.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') ?? '粘贴导入的项目'
    const name = (firstChapter?.title || baseName).slice(0, 60)
    const created = await guard(set, () => window.inkwell.project.create({ name }))
    if (!created) return
    // 关掉无项目会话，重新按新项目解析（差异预览需要 projectId）
    set({ importSession: null })
    await get().openProject(created.id)
    await get().openImportReview({ ...input, projectId: created.id })
  },

  importDraftFromPath: async (path) => {
    const projectId = get().activeProjectId
    if (projectId === null) return
    const session = await guard(set, () => window.inkwell.import.analyze({ path, projectId }))
    if (!session) return
    const chapterNo = get().currentChapterNo
    await get().importDraft(projectId, chapterNo, session.rawText ?? '', 'import')
    set({ notice: `已把文件内容作为第 ${chapterNo} 章草稿新版本导入` })
  },

  /* ----------------------------- M6：书库与撤销 ----------------------------- */

  loadBootstrap: async () => {
    const bootstrap = await guard(set, () => window.inkwell.library.bootstrap())
    if (!bootstrap) return
    set({ bootstrap })
    // 检测到 userData 旧库且未引导过 → 首次启动自动弹出迁移向导
    if (bootstrap.pendingMigration) set({ migrationOpen: true })
  },

  openMigration: () => set({ migrationOpen: true }),
  closeMigration: () => set({ migrationOpen: false }),

  dismissUndo: () => set({ undo: null }),

  runUndo: async () => {
    const undo = get().undo
    if (!undo) return
    set({ undo: null })
    await guard(set, undo.run)
  }
}))