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
  /** 软删除时间戳；非空表示已移入回收站 */
  deletedAt: number | null
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
  /** 软删除时间戳；非空表示已移入回收站 */
  deletedAt: number | null
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
  /** 软删除时间戳；非空表示已移入回收站 */
  deletedAt: number | null
  createdAt: number
  updatedAt: number
}

/**
 * R10：正文列表用的轻量摘要（**不含 content**）。
 * 一本书几百章的正文可能有几 MB，列表接口不再把它们全量传给渲染进程；
 * 正文按章按需通过 draft.content 拉取。
 */
export interface ChapterDraftSummary {
  id: number
  projectId: number
  chapterNo: number
  version: number
  status: string
  source: string
  wordCount: number
  deletedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface DraftContentInput {
  projectId: number
  chapterNo: number
  /** 缺省取最新版本 */
  version?: number
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
  /** M10：文风贴合度 0–100（未生成画像时为空） */
  styleScore?: number
  /** M10：文风逐项检查结果 */
  styleChecks?: StyleCheck[]
}

/* ============================ M10：质量闭环 ============================ */

/** 文风一致性单项检查（确定性指标，不调用模型） */
export interface StyleCheck {
  dimension: string
  /** 0–100，越高越贴合画像 */
  score: number
  /** 实测值的人类可读描述 */
  actual: string
  /** 画像期望值的人类可读描述 */
  expected: string
  passed: boolean
  /** 偏离说明（可直接展示给用户） */
  detail: string
}

/** 章节文风体检报告 */
export interface StyleAuditReport {
  projectId: number
  chapterNo: number
  /** 加权总分 0–100 */
  score: number
  checks: StyleCheck[]
  /** 可选模型复核给出的「最不像的段落」与建议 */
  modelNotes: string[]
  createdAt: number
}

/** 审计维度配置（设置页「审稿」Tab） */
export interface AuditConfig {
  /** 被关闭的维度名（与 AuditCheck.dimension 对齐） */
  disabledDimensions: string[]
  /** 低于该严重度的问题不计入不通过 */
  minSeverity: 'info' | 'warn' | 'error'
  /** warn 级问题是否算不通过 */
  countWarnAsFail: boolean
  updatedAt: number | null
}

export interface AuditConfigSaveInput {
  disabledDimensions?: string[]
  minSeverity?: 'info' | 'warn' | 'error'
  countWarnAsFail?: boolean
}

/** M10：段落级 diff 行 */
export interface RevisionDiffLine {
  type: 'same' | 'add' | 'del'
  text: string
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
export type ExportFormat = 'txt' | 'md' | 'docx' | 'epub' | 'pdf'

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

/* ============================ M6：书库与生命周期 ============================ */

/** 书库元信息（config.json 中登记的一条） */
export interface LibraryInfo {
  id: string
  name: string
  /** 书库根目录绝对路径（inkwell.db / backups / exports / covers 所在处） */
  path: string
  createdAt: number
  lastOpenedAt: number
  /** 该库当前 schema 版本（打开后刷新，未打开时为 null） */
  schemaVersion: number | null
  /** 是否可直接打开（路径存在且库文件完好） */
  available: boolean
}

/** 启动时解析书库的结果 */
export interface LibraryBootstrap {
  /** activeLibraryId，无可用书库时为 null */
  activeLibraryId: string | null
  libraries: LibraryInfo[]
  /** 需要在 UI 上提示「书库找不到」，引导重新定位 / 挂载 / 新建 */
  needsAttention: boolean
  attentionMessage: string
  /** 检测到 userData 旧库且尚未引导迁移 */
  pendingMigration: boolean
  /** 旧库（%APPDATA%/inkwell/inkwell.db）是否存在 */
  legacyDbPath: string | null
  legacyDbExists: boolean
  /** 当前实际打开的数据库文件（无书库时为空串） */
  databasePath: string
}

/** 书库目录预检结论（创建 / 挂载 / 迁移共用） */
export interface LibraryPrecheck {
  path: string
  /** 目录是否存在且可写 */
  writable: boolean
  /** 是否已存在 inkwell.db */
  hasDatabase: boolean
  /** 命中的同步盘（OneDrive/Dropbox/坚果云…），命中时需降级 journal_mode */
  syncProvider: string | null
  /** 是否 UNC / 网络盘 */
  networkPath: boolean
  /** 可用空间（字节）；探测失败为 null */
  freeBytes: number | null
  /** 当前库大小（字节），用于估算所需空间 */
  sourceBytes: number
  /** 明确阻止操作的原因（为空表示可继续） */
  blockingError: string
  /** 强警告文案（可继续，但需用户确认） */
  warnings: string[]
}

/** 回收站条目（项目级 / 章节级统一视图） */
export type TrashItem = {
  kind: 'project' | 'chapter'
  /** 项目 id 或细纲 id */
  id: number
  projectId: number
  projectName: string
  chapterNo: number | null
  title: string
  /** 该条目连带影响的正文章节数（章节级：该章草稿数） */
  draftCount: number
  deletedAt: number
  /** 到期自动清理时间戳（null 表示永久保留） */
  expiresAt: number | null
}

/** 自动备份条目 */
export interface BackupInfo {
  name: string
  path: string
  bytes: number
  createdAt: number
  /** 触发来源：startup | migrate | interval | manual | pre-restore */
  reason: string
}

/** 书库迁移进度（主进程 → 渲染进程推送） */
export interface MigrationProgress {
  phase: 'precheck' | 'vacuum' | 'copy' | 'verify' | 'switch' | 'done'
  message: string
  /** 0–100，未知时为 -1 */
  percent: number
}

export interface MigrationRequest {
  /** 目标书库根目录 */
  targetPath: string
}

export interface MigrationResult {
  ok: boolean
  library: LibraryInfo | null
  /** 失败原因（ok=false 时） */
  error: string
  /** 目标半成品是否已清理 */
  rolledBack: boolean
}

/** 迁移向导事件 */
export type MigrationEvent =
  | { type: 'progress'; progress: MigrationProgress }
  | { type: 'done'; result: MigrationResult }

/** 回收站保留期设置 */
export type TrashRetention = 7 | 30 | 90 | 0

/** 书库与备份相关设置（存 config.json） */
export interface LibrarySettings {
  trashRetentionDays: TrashRetention
  /** 退出时清理 Electron 运行时缓存 */
  cleanCacheOnQuit: boolean
  /** 自动备份开关 */
  autoBackup: boolean
  /** A3：写作时用向量检索召回相关回忆（默认关闭：会消耗 embedding 额度） */
  ragSearch: boolean
  /** A4：启动后自动检查更新（默认开启，只检查不自动安装） */
  autoUpdate: boolean
}

/* ============================ M7：内容导入与解析 ============================ */

/** 章内可抽取字段（与 chapter_brief 对齐） */
export type BriefFieldKey =
  | 'purpose'
  | 'keyEvents'
  | 'characters'
  | 'suspenseHook'
  | 'sceneBeats'
  | 'userGuidance'
  | 'notes'

/** 抽取出的字段值；heuristic=true 表示未命中标签、由启发式归类（预览标黄） */
export interface ParsedFieldValue {
  value: string
  heuristic: boolean
}

export type ParsedFields = Record<BriefFieldKey, ParsedFieldValue>

/** 解析出的单章 */
export interface ParsedChapter {
  chapterNo: number
  title: string
  volumeIdx: number
  fields: ParsedFields
  /** 原始正文块（未标注时预览用） */
  rawText: string
}

export interface ParsedVolume {
  index: number
  title: string
  chapters: ParsedChapter[]
}

/** 大纲分层解析结果（import_session.parsed_tree） */
export interface ParsedTree {
  /** 总纲（卷之前的散落段落） */
  coreOutline: string
  volumes: ParsedVolume[]
  /** 是否识别到分卷结构 */
  hasVolume: boolean
  /** 识别到的标题风格 */
  headingStyle: 'markdown' | 'chinese' | 'mixed' | 'none'
  warnings: string[]
}

/** 单字段校验结果 */
export interface ValidationFieldResult {
  field: BriefFieldKey
  label: string
  present: boolean
  required: boolean
}

export interface ValidationRow {
  chapterNo: number
  title: string
  fields: ValidationFieldResult[]
  missingRequired: number
  /** 缺项明细文案（如「出场角色：未识别」） */
  missing: string[]
}

/** 导入后体检表（import_session.validation） */
export interface ValidationReport {
  rows: ValidationRow[]
  requiredFields: BriefFieldKey[]
  totalMissing: number
  /** 通过率（0-100） */
  passRate: number
}

/** 将写入 chapter_brief 的载荷 */
export interface ImportBriefPayload {
  projectId: number
  chapterNo: number
  volumeIdx: number
  title: string
  role: string
  purpose: string
  keyEvents: string
  characters: string[]
  sceneBeats: string[]
  suspenseHook: string
  userGuidance: string
  notes: string
}

export type ImportAction = 'create' | 'update' | 'skip' | 'conflict'

/** 字段级差异（左旧右新） */
export interface ImportFieldDiff {
  field: BriefFieldKey
  label: string
  oldValue: string
  newValue: string
  changed: boolean
}

/** 暂存条目（import_item） */
export interface ImportItem {
  id: string
  sessionId: string
  chapterNo: number
  volumeIdx: number
  title: string
  action: ImportAction
  enabled: boolean
  payload: ImportBriefPayload
  diff: ImportFieldDiff[]
  /** 启发式归类（未命中标签）的字段，预览标黄 */
  heuristicFields: BriefFieldKey[]
  /** 是否与已有正文冲突 */
  hasDraft: boolean
}

/** 导入统计 */
export interface ImportStats {
  total: number
  create: number
  update: number
  conflict: number
  skip: number
}

/** 导入会话（import_session + 条目） */
export interface ImportSession {
  id: string
  projectId: number | null
  sourcePath: string
  sourceKind: string
  tree: ParsedTree
  validation: ValidationReport
  items: ImportItem[]
  stats: ImportStats
  status: 'staging' | 'committed' | 'cancelled'
  warnings: string[]
  encoding?: string
  /** 仅解析响应携带（不落库）：原始全文，供「正文」Tab 作为草稿导入复用 */
  rawText?: string
  createdAt: number
}

/** 导入入参：path 或 text 二选一 */
export interface ImportAnalyzeInput {
  path?: string
  text?: string
  kind?: string
  projectId?: number
  useLlm?: boolean
}

export interface ImportUpdateItemsInput {
  sessionId: string
  updates: Array<{
    itemId: string
    action?: ImportAction
    enabled?: boolean
    chapterNo?: number
    volumeIdx?: number
  }>
}

export interface ImportUpdateItemInput {
  sessionId: string
  itemId: string
  action?: ImportAction
  enabled?: boolean
  /** 调整章节号（上下移动 / 重排） */
  chapterNo?: number
  /** 调整归属卷（调整层级） */
  volumeIdx?: number
}

export interface ImportValidateInput {
  sessionId: string
  requiredFields?: BriefFieldKey[]
}

/** 导入进度（主进程 → 渲染进程推送） */
export interface ImportProgress {
  sessionId: string
  phase: 'read' | 'extract' | 'parse' | 'diff' | 'llm' | 'done'
  message: string
  percent: number
}

export type ImportEvent =
  | { type: 'progress'; progress: ImportProgress }
  | { type: 'done'; session: ImportSession }
  | { type: 'error'; message: string }

/* ============================ M8：检索与统计增强 ============================ */

/** 检索来源：细纲 / 正文 / 记忆 */
export type SearchSource = 'brief' | 'draft' | 'memory'

/** 单条命中（片段中匹配到的字词用 \u0001 / \u0002 包裹，供 UI 高亮） */
export interface SearchHit {
  source: SearchSource
  projectId: number
  chapterNo: number
  snippet: string
}

/** 按章分组的结果 */
export interface SearchGroup {
  projectId: number
  chapterNo: number
  hits: SearchHit[]
}

export interface SearchResult {
  /** R11：检索策略说明（例如短词走了优先小表的路径），供 UI 如实展示 */
  notes?: string[]
  query: string
  /** 实际使用的检索模式：fts（≥3 字符）或 like（1~2 字符短查询回退） */
  mode: 'fts' | 'like'
  groups: SearchGroup[]
  total: number
}

export interface SearchQueryInput {
  projectId?: number
  query: string
  limit?: number
}

/** 整本审计的单章结果 */
export interface BookAuditChapterResult {
  chapterNo: number
  title: string
  report: AuditReport
}

/** 按维度聚合的命中统计 */
export interface BookAuditDimensionStat {
  dimension: string
  /** 该维度的检查次数 */
  total: number
  /** 未通过次数（命中数） */
  failed: number
}

export interface BookAuditSummary {
  projectId: number
  chapters: BookAuditChapterResult[]
  dimensions: BookAuditDimensionStat[]
  /** 各章未通过检查数之和 */
  totalIssues: number
  modelAssisted: boolean
  createdAt: number
}

/** 模型语义审计的 token 预估（供「是否继续」提示） */
export interface BookAuditEstimate {
  chapters: number
  promptTokens: number
  estTotalTokens: number
}

export interface BookAuditStartInput {
  projectId: number
  useModel?: boolean
  /** 模型审计需二次确认：不带 confirm 时只返回预估，确认后再带 confirm=true 启动 */
  confirm?: boolean
}

export interface BookAuditStartResult {
  /** 未真正启动（needsConfirm）时为空串 */
  taskId: string
  needsConfirm: boolean
  estimate: BookAuditEstimate | null
}

export interface BookAuditProgress {
  chapterNo: number
  done: number
  total: number
  message: string
}

export type BookAuditEvent =
  | { taskId: string; type: 'progress'; progress: BookAuditProgress }
  | { taskId: string; type: 'done'; summary: BookAuditSummary }
  | { taskId: string; type: 'error'; message: string }

/** 写作目标设置 */
export interface WritingGoalSettings {
  dailyWords: number
  dailyChapters: number
}

export interface DayStat {
  /** 本地时区 YYYY-MM-DD */
  day: string
  wordsAdded: number
  chaptersDone: number
}

export interface StatSummary {
  today: DayStat
  goal: WritingGoalSettings
  /** 连续达标天数（按每日字数目标计算） */
  streak: number
  /** 最近 7 天（含今天，按时间升序） */
  recent: DayStat[]
}

export interface StatSetGoalInput {
  dailyWords?: number
  dailyChapters?: number
}

/* ==================== M9（A1–A5）：提示词 / 文风 / 向量 / 更新 / 分卷 / 修订 ==================== */

/** A1 可覆写提示词模板 */
export interface PromptTemplateInfo {
  key: string
  title: string
  category: string
  description: string
  /** 该模板支持的 {{变量}} */
  variables: string[]
  /** 当前生效的系统提示词（可能是覆写值） */
  system: string
  /** 当前生效的指令块（可能是覆写值） */
  instruction: string
  /** 内置默认值，供「恢复默认」预览 */
  defaultSystem: string
  defaultInstruction: string
  /** 是否被用户覆写过 */
  overridden: boolean
  updatedAt: number | null
}

export interface PromptTemplateSaveInput {
  key: string
  system?: string
  instruction?: string
}

/** A2 文风仿写画像（JSON 落 project.style_profile） */
export interface StyleProfile {
  summary: string
  tone: string
  pov: string
  sentence: string
  diction: string
  dialogue: string
  imagery: string
  pacing: string
  taboos: string[]
  keywords: string[]
  samples: string[]
  /** 画像来源说明（样本来源 / 生成时间） */
  source: string
  updatedAt: number
}

export interface StyleProfileGenerateInput {
  projectId: number
  /** 直接粘贴的参考文本；与 useExisting 二选一 */
  sample?: string
  /** 从本书已有正文里自动摘取样本 */
  useExisting?: boolean
}

/** A3 向量索引状态 */
export interface VectorIndexStatus {
  /** 是否配置了 embedder 角色可用的端点 */
  embedderAvailable: boolean
  /** 是否开启了写作时的向量检索 */
  enabled: boolean
  chapters: number
  chunks: number
  dim: number
  model: string
  updatedAt: number | null
}

export interface VectorIndexResult {
  chapters: number
  chunks: number
  /** 跳过的章节（无正文） */
  skipped: number
}

export interface VectorRecallHit {
  chapterNo: number
  chunkIdx: number
  score: number
  text: string
}

/** A4 自动更新 */
export type UpdatePhase = 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error' | 'unsupported'

export interface UpdateStatus {
  phase: UpdatePhase
  /** 当前应用版本 */
  currentVersion: string
  /** 可用版本（phase=available/downloaded 时有值） */
  version: string | null
  releaseNotes: string
  /** 下载进度 0-100 */
  percent: number
  bytesPerSecond: number
  message: string
  /** 打包版才支持自动更新（开发模式为 false） */
  supported: boolean
}

/** A5 分卷（计划书 §5.1 volume） */
export interface Volume {
  id: number
  projectId: number
  idx: number
  title: string
  synopsis: string
  /** 该卷下的章节号区间（派生，不落库） */
  fromChapter: number
  toChapter: number
  chapterCount: number
  createdAt: number
  updatedAt: number
}

export interface VolumeSaveInput {
  id?: number
  projectId: number
  idx: number
  title?: string
  synopsis?: string
}

/** A5 修订记录（计划书 §5.1 draft_revision） */
export interface DraftRevision {
  id: number
  projectId: number
  chapterNo: number
  baseDraftId: number | null
  draftId: number | null
  idx: number
  /** refine | review-fix | polish | rewrite | manual | import */
  type: string
  status: string
  /** 改动来由（如命中的审计维度清单） */
  userPrompt: string
  wordCount: number
  /** M10：改前摘要（400 字以内） */
  beforeExcerpt: string
  /** M10：改后摘要（400 字以内） */
  afterExcerpt: string
  /** M10：段落级 diff */
  diff: RevisionDiffLine[]
  /** M10：是否已回退到该修订之前的版本 */
  reverted: boolean
  createdAt: number
}

/** M10：回退某条修订的结果 */
export interface RevertRevisionResult {
  draft: ChapterDraft
  /** 被回退的修订序号 */
  revisionIdx: number
}

/* ============================ M11：产出与分发 ============================ */

/** 题材包（可分享的「题材 + 提示词覆写 + 校验模板」组合） */
export interface ThemePack {
  /** 包格式版本，便于以后兼容 */
  packVersion: 1
  name: string
  description: string
  /** 导出的 Inkwell 版本 */
  appVersion: string
  exportedAt: number
  /** 题材模板（与 renderer/data/genres.ts 结构一致：name + 推荐章数 + 文风建议） */
  genres: Array<{ name: string; chapters: number; style: string }>
  /** 提示词覆写（key → { system, instruction }） */
  promptOverrides: Array<{ key: string; system: string; instruction: string }>
  /** 导入校验必填字段模板 */
  requiredFields: string[]
}

/** 题材模板（渲染层 data/genres.ts 的结构；主进程只做透传与统计） */
export interface GenreTemplate {
  name: string
  chapters: number
  style: string
}

export interface PackExportInput {
  name: string
  description?: string
  /** 是否把当前提示词覆写一起打包 */
  includePrompts?: boolean
  /** 渲染层传入的题材模板列表（主进程拿不到渲染层的静态资源） */
  genres?: GenreTemplate[]
}

export interface PackImportResult {
  name: string
  genresAdded: number
  promptsApplied: number
  requiredFields: string
  /** 包里的题材模板（渲染层负责落本地存储并合并进题材下拉） */
  genres: GenreTemplate[]
}

/* ============================ R12：角色卡编辑 ============================ */

export interface CharacterSaveInput {
  id?: number
  projectId: number
  name: string
  role?: string
  appearance?: string
  personality?: string
  background?: string
  abilities?: string
  motivation?: string
  relationships?: string
  csLocation?: string
  csPower?: string
  csState?: string
  csItems?: string[]
  csRecent?: string
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
    /** R10：只取摘要（不含正文），避免一次把整本正文传进渲染进程 */
    list(projectId: number): Promise<ChapterDraftSummary[]>
    /** R10：按章按需拉取某一版正文 */
    content(input: DraftContentInput): Promise<ChapterDraft | null>
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
    /** 打开目录选择对话框，返回所选目录（取消为 null） */
    pickFolder(): Promise<string | null>
    /** M7：打开文件选择对话框（docx/epub/txt/md/json/vela），返回所选文件（取消为 null） */
    pickFile(): Promise<string | null>
    /** 在系统文件管理器中打开路径 */
    openPath(path: string): Promise<void>
    /** 清理 Electron 运行时缓存 */
    clearCache(): Promise<{ freedBytes: number }>
  }
  /** M6：多书库（像 VSCode 工作区一样自由切换） */
  library: {
    /** 解析启动态：活动库 / 全部库 / 是否需要引导 */
    bootstrap(): Promise<LibraryBootstrap>
    list(): Promise<LibraryInfo[]>
    /** 在指定目录新建书库（目录可不存在，会创建） */
    create(input: { name: string; path: string }): Promise<LibraryInfo>
    /** 挂载一个已存在的书库目录 */
    add(input: { name: string; path: string }): Promise<LibraryInfo>
    /** 切换活动书库（先关旧库再开新库） */
    switch(id: string): Promise<{ ok: boolean }>
    /** 库被移动/改名后重新指路 */
    locate(input: { id: string; path: string }): Promise<LibraryInfo>
    /** 从列表移除（deleteFiles 为 true 时同时删除磁盘文件） */
    remove(input: { id: string; deleteFiles: boolean }): Promise<{ ok: boolean }>
    rename(input: { id: string; name: string }): Promise<{ ok: boolean }>
    /** 创库 / 挂载前的目录预检 */
    precheck(path: string): Promise<LibraryPrecheck>
    /** 启动迁移向导：把旧 userData 库迁到目标目录（可中断、可回滚） */
    migrate(input: MigrationRequest): Promise<MigrationResult>
    /** R1：取消正在进行的迁移（走 utilityProcess，取消后目标半成品会被清理、指针不变） */
    cancelMigrate(): Promise<{ ok: boolean }>
    /** 放弃迁移引导（之后不再自动弹出） */
    dismissMigration(): Promise<void>
    /** 迁移确认无误后清理 userData 里的旧库文件 */
    purgeLegacy(): Promise<{ ok: boolean; freedBytes: number }>
    /** 读取 / 写入书库相关设置 */
    settings(): Promise<LibrarySettings>
    saveSettings(settings: Partial<LibrarySettings>): Promise<LibrarySettings>
  }
  /** M6：回收站（软删除） */
  trash: {
    list(): Promise<TrashItem[]>
    /** 恢复条目；章节号冲突时自动排到末尾 */
    restore(item: { kind: 'project' | 'chapter'; id: number }): Promise<{ ok: boolean; chapterNo?: number }>
    /** 彻底删除单条 */
    purge(item: { kind: 'project' | 'chapter'; id: number }): Promise<void>
    /** 清空回收站 */
    empty(): Promise<{ removed: number }>
  }
  /** M6：自动备份 */
  backup: {
    list(): Promise<BackupInfo[]>
    /** 立即备份一份（VACUUM INTO） */
    create(): Promise<BackupInfo>
    /** 恢复某份备份（恢复前自动先备份当前库） */
    restore(name: string): Promise<{ ok: boolean }>
    remove(name: string): Promise<void>
    /** 在文件管理器中显示备份目录 */
    reveal(): Promise<void>
  }
  /** M7：内容导入与解析（拖拽 / 粘贴 → 解析 → 差异预览 → 提交） */
  import: {
    /** 从文件路径或粘贴文本创建导入会话（含解析树、体检、逐条差异） */
    analyze(input: ImportAnalyzeInput): Promise<ImportSession>
    /** 读取某个暂存会话（刷新页面后恢复） */
    session(id: string): Promise<ImportSession | null>
    /** 改单条 action / enabled */
    updateItem(input: ImportUpdateItemInput): Promise<ImportSession>
    /** 批量改多条（全选 / 只选新建等）：一次 IPC 往返，避免逐条往返把界面按死 */
    updateItems(input: ImportUpdateItemsInput): Promise<ImportSession>
    /** 重跑体检（可自定义必填字段） */
    validate(input: ImportValidateInput): Promise<ImportSession>
    /** 仅落库 enabled 的条目；返回实际写入章数 */
    commit(sessionId: string): Promise<{ committed: number }>
    cancel(sessionId: string): Promise<void>
    onEvent(listener: (event: ImportEvent) => void): () => void
  }
  /** M8：全文检索（细纲 / 正文 / 记忆；短查询自动 LIKE 回退） */
  search: {
    query(input: SearchQueryInput): Promise<SearchResult>
  }
  /** M8：全书一键体检（默认确定性审计；勾选后模型语义审计，需预估确认、可中止） */
  audit: {
    book(input: BookAuditStartInput): Promise<BookAuditStartResult>
    abort(taskId: string): Promise<void>
    onEvent(listener: (event: BookAuditEvent) => void): () => void
    /** M10：读取审计维度配置 */
    config(): Promise<AuditConfig>
    /** M10：保存审计维度配置 */
    saveConfig(input: AuditConfigSaveInput): Promise<AuditConfig>
    /** M10：列出全部可用维度名（供设置页渲染开关） */
    dimensions(): Promise<string[]>
  }
  /** M8：写作统计与目标 */
  stat: {
    summary(): Promise<StatSummary>
    setGoal(input: StatSetGoalInput): Promise<StatSummary>
  }
  /** A1：可覆写提示词模板（计划书 §12 的关键提示词资产） */
  prompt: {
    list(): Promise<PromptTemplateInfo[]>
    save(input: PromptTemplateSaveInput): Promise<PromptTemplateInfo>
    reset(key: string): Promise<PromptTemplateInfo>
  }
  /** A2：文风仿写画像 + M10：文风一致性体检 */
  style: {
    get(projectId: number): Promise<StyleProfile | null>
    generate(input: StyleProfileGenerateInput): Promise<StyleProfile>
    clear(projectId: number): Promise<void>
    /** M10：对某章做文风一致性体检（确定性指标；useModel 时追加模型复核） */
    audit(input: { projectId: number; chapterNo: number; useModel?: boolean }): Promise<StyleAuditReport>
    /** M10：整本平均文风贴合度（未生成画像时为 null） */
    score(projectId: number): Promise<number | null>
  }
  /** A3：向量检索（RAG） */
  vector: {
    status(projectId: number): Promise<VectorIndexStatus>
    /** 重建索引（只索引未删除项目和章节） */
    rebuild(projectId: number): Promise<VectorIndexResult>
    /** 调试用：直接检索 */
    query(input: { projectId: number; text: string; limit?: number }): Promise<VectorRecallHit[]>
    clear(projectId: number): Promise<void>
  }
  /** A4：自动更新 */
  update: {
    status(): Promise<UpdateStatus>
    check(): Promise<UpdateStatus>
    download(): Promise<UpdateStatus>
    install(): Promise<void>
    onEvent(listener: (event: UpdateStatus) => void): () => void
  }
  /** A5：分卷（计划书 §5.1 volume） */
  volume: {
    list(projectId: number): Promise<Volume[]>
    save(input: VolumeSaveInput): Promise<Volume[]>
    remove(id: number): Promise<Volume[]>
  }
  /** A5：修订记录（计划书 §5.1 draft_revision）+ M10：回退 */
  revision: {
    list(projectId: number, chapterNo: number): Promise<DraftRevision[]>
    /** M10：回退到某条修订之前（落一个新版本，不覆盖历史） */
    revert(input: { projectId: number; chapterNo: number; revisionId: number }): Promise<RevertRevisionResult>
  }
  /** R12：角色卡（真相文件 character_matrix 的可编辑来源） */
  character: {
    list(projectId: number): Promise<CharacterCard[]>
    save(input: CharacterSaveInput): Promise<CharacterCard[]>
    remove(id: number): Promise<CharacterCard[]>
  }
  /** M11：题材包（题材 + 提示词覆写 + 校验模板）导入导出 */
  pack: {
    /** 导出到用户选择的文件；取消时返回 null */
    export(input: PackExportInput): Promise<{ path: string } | null>
    /** 从用户选择的文件导入；取消时返回 null */
    import(): Promise<PackImportResult | null>
  }
  /** M7：Electron 44 已移除 File.path，拖拽落点必须经 preload 的 webUtils 解析 */
  resolveDropPath(file: File): string
  /** 主进程 → 渲染进程：迁移进度推送通道 */
  onMigrationEvent(listener: (event: MigrationEvent) => void): () => void
}