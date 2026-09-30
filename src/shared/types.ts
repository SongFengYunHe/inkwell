/**
 * 主进程 / 预加载 / 渲染进程共享的实体类型（DTO）。
 * 仅描述跨进程传输的数据形态，不依赖任何 Node 或 DOM 专有 API。
 */

/** 项目（对应计划书 §5.1 `project` 表，M0 采用精简字段集） */
export interface Project {
  id: number
  name: string
  genre: string
  targetAudience: string
  /** 预计章数 */
  totalChapters: number
  /** 单章目标字数 */
  wordsPerChapter: number
  language: string
  /** 文风 */
  style: string
  /** 一句话灵感 / 故事前提 */
  premise: string
  /** 世界观设定 */
  worldbuilding: string
  /** 主角档案 */
  protagonist: string
  /** 金手指 */
  goldenFinger: string
  /** 全局写作指引 */
  globalGuidance: string
  /** L1 总大纲 */
  coreOutline: string
  createdAt: number
  updatedAt: number
}

/** 每章细纲（对应计划书 §5.1 `chapter_brief` 表） */
export interface ChapterBrief {
  id: number
  projectId: number
  chapterNo: number
  volumeIdx: number
  title: string
  /** 章节角色定位（如 开篇/推进/高潮/过渡） */
  role: string
  /** 本章目的 */
  purpose: string
  /** 关键事件 */
  keyEvents: string
  /** 出场角色 */
  characters: string[]
  /** 场景节拍 */
  sceneBeats: string[]
  /** 悬念钩子 */
  suspenseHook: string
  /** 用户额外要求 */
  userGuidance: string
  notes: string
  createdAt: number
  updatedAt: number
}

/** 正文草稿（对应计划书 §5.1 `chapter_draft` 表，M0 仅落地最小字段） */
export interface ChapterDraft {
  id: number
  projectId: number
  chapterNo: number
  version: number
  /** draft | revised | finalized | archived */
  status: string
  /** write | rewrite */
  source: string
  content: string
  wordCount: number
  createdAt: number
  updatedAt: number
}

/** 新建项目入参 */
export interface ProjectCreateInput {
  name: string
  genre?: string
  totalChapters?: number
  wordsPerChapter?: number
  premise?: string
}

/** 更新项目入参（仅传入需要变更的字段） */
export type ProjectUpdateInput = Partial<Omit<Project, 'id' | 'createdAt' | 'updatedAt'>> & {
  id: number
}

/** 保存细纲入参（id 缺省表示新建） */
export type BriefSaveInput = Partial<Omit<ChapterBrief, 'id' | 'createdAt' | 'updatedAt'>> & {
  id?: number
  projectId: number
  chapterNo: number
}

/** 保存草稿入参（id 缺省表示新建） */
export type DraftSaveInput = Partial<Omit<ChapterDraft, 'id' | 'createdAt' | 'updatedAt'>> & {
  id?: number
  projectId: number
  chapterNo: number
}

/** 接入类型：官方/中转（OpenAI 兼容）与自定义端点 */
export type ProviderKind = 'openai-compatible' | 'custom-reverse-proxy'

/** 创作角色（计划书 §6.1） */
export type LlmRoleName = 'architect' | 'writer' | 'reviewer' | 'extractor' | 'embedder'

/** 模型接入配置（对应计划书 §5.1 `provider` 表） */
export interface Provider {
  id: number
  kind: ProviderKind
  name: string
  baseUrl: string
  model: string
  enabled: boolean
  /** 是否已保存密钥（密钥本身永不出主进程） */
  hasApiKey: boolean
  /** 自定义请求头（部分自建/第三方端点需要） */
  headers: Record<string, string>
  /** 每分钟最大请求数，0 表示不限速 */
  rateLimitPerMin: number
  /** 自定义端点已确认使用须知 */
  riskAccepted: boolean
  createdAt: number
  updatedAt: number
}

/** 保存接入配置入参；`apiKey` 留空表示保持原密钥不变 */
export interface ProviderSaveInput {
  id?: number
  kind?: ProviderKind
  name: string
  baseUrl: string
  model: string
  apiKey?: string
  enabled?: boolean
  headers?: Record<string, string>
  rateLimitPerMin?: number
  riskAccepted?: boolean
}

/** 角色 → 模型路由 */
export interface RoleRoute {
  id: number
  role: LlmRoleName
  providerId: number
  /** 留空表示沿用 provider 的默认模型 */
  model: string
  fallbackChain: number[]
  maxConcurrency: number
  updatedAt: number
}

export interface RoleRouteSaveInput {
  role: LlmRoleName
  providerId: number
  model?: string
  fallbackChain?: number[]
  maxConcurrency?: number
}

/** 单次调用的用量记录 */
export interface LlmCallRecord {
  id: number
  providerId: number | null
  providerName: string
  model: string
  role: string
  promptTokens: number
  completionTokens: number
  durationMs: number
  success: boolean
  error: string
  createdAt: number
}

/** 用量仪表盘数据 */
export interface UsageSummary {
  totalCalls: number
  failedCalls: number
  promptTokens: number
  completionTokens: number
  totalDurationMs: number
  byRole: Array<{ role: string; calls: number; tokens: number }>
  recent: LlmCallRecord[]
}

/** 连接测试结果 */
export interface ProviderTestResult {
  ok: boolean
  message: string
  latencyMs: number
}

/** 单章生成模式 */
export type GenerationMode = 'draft' | 'continue' | 'rewrite' | 'polish'

export interface GenerateStartInput {
  requestId: string
  projectId: number
  chapterNo: number
  mode: GenerationMode
}

/** 生成过程中的流式事件（主进程 → 渲染进程推送） */
export type GenerateEvent =
  | { requestId: string; type: 'delta'; text: string }
  | { requestId: string; type: 'done'; draft: ChapterDraft }
  | { requestId: string; type: 'error'; message: string }

/** 新建向导进度（一句话灵感 → 设定/大纲 → 逐章细纲） */
export interface WizardProgress {
  phase: 'outline' | 'briefs' | 'done'
  message: string
  completed: number
  total: number
}

export interface WizardStartInput {
  requestId: string
  projectId: number
}

export type WizardEvent =
  | { requestId: string; type: 'progress'; progress: WizardProgress }
  | { requestId: string; type: 'done'; briefsCreated: number }
  | { requestId: string; type: 'error'; message: string }

/** 细纲 AI 补全的输入 */
export interface BriefExpandInput {
  projectId: number
  chapterNo: number
  current: {
    title: string
    purpose: string
    keyEvents: string
    characters: string[]
    sceneBeats: string[]
    suspenseHook: string
  }
}

/** 细纲 AI 补全的建议结果（需用户确认后才落库） */
export interface BriefSuggestion {
  chapterNo: number
  title: string
  purpose: string
  keyEvents: string
  characters: string[]
  sceneBeats: string[]
  suspenseHook: string
}

/** 任务单桥导出结果 */
export interface BridgeTaskExport {
  /** 落盘路径 */
  path: string
  /** 任务单全文（含提示词），可直接丢给任意 Agent */
  content: string
}

/* ============================ M3：记忆与连写 ============================ */

/** 角色当前状态增量（记忆回写产出，投影到 character 表） */
export interface CharacterStateDelta {
  name: string
  state: string
  location: string
  power: string
  items: string[]
  recent: string
}

/** 连续性事实增量（世界状态 / 时间线 / 资源账本） */
export interface ContinuityFacts {
  worldState: string
  timeline: string
  resourceLedger: string
  facts: string[]
}

/** 伏笔台账状态变更 */
export interface ThreadUpdate {
  title: string
  /** plot | subplot | hook */
  type: string
  /** planted | progressing | resolved | abandoned */
  event: string
  evidence: string
}

/** 章节记忆快照 */
export interface MemoryChapter {
  id: number
  projectId: number
  chapterNo: number
  draftId: number | null
  summary: string
  characterStates: CharacterStateDelta[]
  continuityFacts: ContinuityFacts
  threadUpdates: ThreadUpdate[]
  createdAt: number
  updatedAt: number
}

/** 角色卡 + 当前状态（真相文件 character_matrix） */
export interface CharacterCard {
  id: number
  projectId: number
  name: string
  role: string
  appearance: string
  personality: string
  background: string
  abilities: string
  motivation: string
  relationships: string
  csLocation: string
  csPower: string
  csState: string
  csItems: string[]
  csRecent: string
  csUpdatedCh: number
  createdAt: number
  updatedAt: number
}

/** 主线 / 支线 / 伏笔台账 */
export interface OutlineThread {
  id: number
  projectId: number
  title: string
  type: string
  startCh: number
  endCh: number
  intent: string
  status: string
  createdAt: number
  updatedAt: number
}

/** 伏笔状态变更记录 */
export interface ThreadEvent {
  id: number
  projectId: number
  threadId: number
  chapterNo: number
  draftId: number | null
  event: string
  evidence: string
  createdAt: number
}

/** 单条审计维度结果 */
export interface AuditCheck {
  dimension: string
  passed: boolean
  severity: 'info' | 'warn' | 'error'
  detail: string
  /** 命中的问题片段（可选，供定位） */
  evidence?: string
  /** 命中的段落序号（从 0 开始，用于定位到具体段落） */
  paragraph?: number
}

/** 章节审计报告 */
export interface AuditReport {
  chapterNo: number
  passed: boolean
  score: number
  checks: AuditCheck[]
  /** 是否由模型补充了语义审计 */
  modelAssisted: boolean
  createdAt: number
}

/** 七个真相文件（从记忆表投影而来，只读） */
export interface TruthFiles {
  projectId: number
  /** 1. 世界当前状态 */
  worldState: string
  /** 2. 角色矩阵与当前状态 */
  characterMatrix: CharacterCard[]
  /** 3. 待处理伏笔池 */
  pendingHooks: OutlineThread[]
  /** 4. 章节摘要链 */
  chapterSummaries: Array<{ chapterNo: number; summary: string }>
  /** 5. 支线进度板 */
  subplotBoard: OutlineThread[]
  /** 6. 时间线 */
  timeline: string
  /** 7. 资源 / 道具 / 数值账本 */
  resourceLedger: string
}

/** 连写任务状态 */
export type PipelineStatus =
  | 'running'
  | 'paused'
  | 'awaiting_accept'
  | 'done'
  | 'failed'
  | 'aborted'
  | 'interrupted'

/** 连写任务 */
export interface PipelineRun {
  id: number
  projectId: number
  fromCh: number
  toCh: number
  status: PipelineStatus
  cursor: number
  requireAccept: boolean
  steerGuidance: string
  error: string
  createdAt: number
  updatedAt: number
}

/** 步骤级进度 */
export interface PipelineStep {
  id: number
  runId: number
  chapterNo: number
  /** assemble | draft | audit | memory | skip */
  step: string
  ok: boolean
  attempt: number
  error: string
  updatedAt: number
}

/** 启动连写入参 */
export interface PipelineStartInput {
  requestId: string
  projectId: number
  fromCh?: number
  toCh?: number
  /** 逐章验收：每章生成后暂停，等待用户确认继续 */
  requireAccept?: boolean
}

/** 连写过程中的事件（主进程 → 渲染进程推送） */
export type PipelineEvent =
  | {
      requestId: string
      type: 'progress'
      run: PipelineRun
      chapterNo: number
      step: string
      message: string
    }
  | { requestId: string; type: 'chapter_done'; run: PipelineRun; chapterNo: number; audit: AuditReport | null }
  | { requestId: string; type: 'awaiting_accept'; run: PipelineRun; chapterNo: number }
  | { requestId: string; type: 'done'; run: PipelineRun; written: number }
  | { requestId: string; type: 'error'; run: PipelineRun | null; message: string }

/* ============================ M4：修复与导出 ============================ */

/** 反 AI 味确定性规则产生的一条变更 */
export interface StyleChange {
  rule: string
  before: string
  after: string
  count: number
}

/** 一键修复入参 */
export interface FixChapterInput {
  projectId: number
  chapterNo: number
  /** 是否用模型做语义定点修复（确定性规则始终执行） */
  useModel?: boolean
}

/** 一键修复结果（审计 → 定点修复 → 重审） */
export interface FixResult {
  draft: ChapterDraft
  styleChanges: StyleChange[]
  modelUsed: boolean
  auditBefore: AuditReport | null
  auditAfter: AuditReport | null
  /** 没有任何可修复项时为 true，未新增版本 */
  noop: boolean
}

/** 导出格式 */
export type ExportFormat = 'txt' | 'md' | 'docx' | 'epub'

export interface ExportInput {
  projectId: number
  formats: ExportFormat[]
  /** 输出目录；缺省由主进程落到「文档 / Inkwell 导出 / 书名」 */
  outDir?: string
}

export interface ExportFile {
  format: ExportFormat
  path: string
  bytes: number
  chapters: number
}

export interface ExportResult {
  dir: string
  bookTitle: string
  files: ExportFile[]
  /** 未导出的章节（无正文），便于提示用户 */
  skippedChapters: number[]
}

/* ============================ M5：导入 Vela 工程 ============================ */

/** 导入 Vela 工程的结果 */
export interface VelaImportSummary {
  project: Project
  briefs: number
  drafts: number
  /** 识别到的源表名，便于排查映射问题 */
  tables: string[]
}

/** M5：MCP Server 的启动方式说明（供设置页一键生成 Agent 配置） */
export interface McpLaunchConfig {
  /** electron = 用应用自带运行时（Inkwell.exe + ELECTRON_RUN_AS_NODE，无需另装 Node）；node = 源码目录用系统 Node */
  mode: 'electron' | 'node'
  /** mcp.js 入口绝对路径 */
  entry: string
  command: string
  args: string[]
  env: Record<string, string>
  /** 可直接粘贴进 Agent 配置的完整 JSON */
  configJson: string
}

/** 预加载脚本向渲染进程暴露的 API 契约 */
export interface InkwellApi {
  project: {
    list(): Promise<Project[]>
    get(id: number): Promise<Project | null>
    create(input: ProjectCreateInput): Promise<Project>
    update(input: ProjectUpdateInput): Promise<Project>
    remove(id: number): Promise<void>
    /** 打开文件对话框并导入 Vela 工程；用户取消时返回 null */
    importVela(): Promise<VelaImportSummary | null>
  }
  brief: {
    list(projectId: number): Promise<ChapterBrief[]>
    save(input: BriefSaveInput): Promise<ChapterBrief>
    remove(id: number): Promise<void>
    /** AI 补全单章细纲，仅返回建议，不落库 */
    expand(input: BriefExpandInput): Promise<BriefSuggestion>
  }
  draft: {
    list(projectId: number): Promise<ChapterDraft[]>
    save(input: DraftSaveInput): Promise<ChapterDraft>
    remove(id: number): Promise<void>
    /** 对某章正文跑完整审计并落库，返回报告 */
    audit(projectId: number, chapterNo: number): Promise<AuditReport>
    /** 一键修复：审计 → 确定性去 AI 味 + 可选模型定点修复 → 重审 */
    fix(input: FixChapterInput): Promise<FixResult>
  }
  /** 导出成书 */
  export: {
    project(input: ExportInput): Promise<ExportResult>
    /** 在系统文件管理器中打开导出目录 */
    openDir(path: string): Promise<void>
  }
  provider: {
    list(): Promise<Provider[]>
    save(input: ProviderSaveInput): Promise<Provider>
    remove(id: number): Promise<void>
    /** 用当前表单值直接测试连通性（不落库） */
    test(input: ProviderSaveInput): Promise<ProviderTestResult>
  }
  route: {
    list(): Promise<RoleRoute[]>
    save(input: RoleRouteSaveInput): Promise<RoleRoute>
    remove(role: LlmRoleName): Promise<void>
  }
  usage: {
    summary(): Promise<UsageSummary>
  }
  bridge: {
    /** 任务单桥：导出某章的任务单（含完整提示词）到本地文件 */
    exportTask(projectId: number, chapterNo: number): Promise<BridgeTaskExport>
  }
  generate: {
    start(input: GenerateStartInput): Promise<void>
    abort(requestId: string): Promise<void>
    /** 订阅流式事件，返回取消订阅函数 */
    onEvent(listener: (event: GenerateEvent) => void): () => void
  }
  wizard: {
    start(input: WizardStartInput): Promise<void>
    abort(requestId: string): Promise<void>
    onEvent(listener: (event: WizardEvent) => void): () => void
  }
  /** 记忆面板：七个真相文件 + 章节审计报告 */
  memory: {
    /** 读取七个真相文件（只读投影） */
    truthFiles(projectId: number): Promise<TruthFiles>
    /** 读取某章最新审计报告 */
    latestAudit(projectId: number, chapterNo: number): Promise<AuditReport | null>
    /** 从既有正文按章重算记忆与真相文件（投影重建） */
    rebuild(projectId: number): Promise<{ chapters: number }>
  }
  /** 连写队列（全自动整本 + 断点恢复 + Steer + 逐章验收） */
  pipeline: {
    start(input: PipelineStartInput): Promise<void>
    /** 中断当前连写 */
    abort(requestId: string): Promise<void>
    /** 暂停：当前章写完后停下 */
    pause(requestId: string): Promise<void>
    /** 继续：从 cursor 处的断点续跑 */
    resume(requestId: string, projectId: number): Promise<void>
    /** Steer：注入后续章节的额外要求 / 禁止项 */
    steer(requestId: string, guidance: string): Promise<void>
    /** 跳过当前章 */
    skip(requestId: string): Promise<void>
    /** 逐章验收：接受本章并继续 */
    accept(requestId: string): Promise<void>
    /** 逐章验收：拒绝本章并重写 */
    reject(requestId: string): Promise<void>
    /** 取项目最近一次连写任务 */
    latest(projectId: number): Promise<PipelineRun | null>
    onEvent(listener: (event: PipelineEvent) => void): () => void
  }
  app: {
    /** 数据库文件绝对路径，用于排查与备份 */
    dbPath(): Promise<string>
    /** MCP Server 入口的绝对路径，供外部 Agent 配置使用 */
    mcpEntry(): Promise<string>
    /** MCP Server 的启动方式（含可直接粘贴的配置 JSON） */
    mcpLaunch(): Promise<McpLaunchConfig>
  }
}