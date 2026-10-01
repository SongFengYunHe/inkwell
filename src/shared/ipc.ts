import { z } from 'zod'

/** IPC 通道名（主进程与预加载脚本共用，避免字符串漂移） */
export const IpcChannel = {
  projectList: 'project:list',
  projectGet: 'project:get',
  projectCreate: 'project:create',
  projectUpdate: 'project:update',
  projectRemove: 'project:remove',
  projectImportVela: 'project:import-vela',
  briefList: 'brief:list',
  briefSave: 'brief:save',
  briefRemove: 'brief:remove',
  briefExpand: 'brief:expand',
  draftList: 'draft:list',
  draftSave: 'draft:save',
  draftRemove: 'draft:remove',
  draftAudit: 'draft:audit',
  draftFix: 'draft:fix',
  exportProject: 'export:project',
  exportOpenDir: 'export:open-dir',
  providerList: 'provider:list',
  providerSave: 'provider:save',
  providerRemove: 'provider:remove',
  providerTest: 'provider:test',
  routeList: 'route:list',
  routeSave: 'route:save',
  routeRemove: 'route:remove',
  usageSummary: 'usage:summary',
  bridgeExportTask: 'bridge:export-task',
  generateStart: 'generate:start',
  generateAbort: 'generate:abort',
  /** 主进程 → 渲染进程的流式推送通道 */
  generateEvent: 'generate:event',
  wizardStart: 'wizard:start',
  wizardAbort: 'wizard:abort',
  /** 主进程 → 渲染进程的向导进度推送通道 */
  wizardEvent: 'wizard:event',
  /** M3：记忆面板（七个真相文件 / 审计报告 / 投影重建） */
  memoryTruthFiles: 'memory:truth-files',
  memoryLatestAudit: 'memory:latest-audit',
  memoryRebuild: 'memory:rebuild',
  /** M3：连写队列 */
  pipelineStart: 'pipeline:start',
  pipelineAbort: 'pipeline:abort',
  pipelinePause: 'pipeline:pause',
  pipelineResume: 'pipeline:resume',
  pipelineSteer: 'pipeline:steer',
  pipelineSkip: 'pipeline:skip',
  pipelineAccept: 'pipeline:accept',
  pipelineReject: 'pipeline:reject',
  pipelineLatest: 'pipeline:latest',
  /** 主进程 → 渲染进程的连写进度推送通道 */
  pipelineEvent: 'pipeline:event',
  appDbPath: 'app:db-path',
  appMcpEntry: 'app:mcp-entry',
  appMcpLaunch: 'app:mcp-launch',
  appPickFolder: 'app:pick-folder',
  appPickFile: 'app:pick-file',
  appOpenPath: 'app:open-path',
  appClearCache: 'app:clear-cache',
  /** M6：多书库 */
  libraryBootstrap: 'library:bootstrap',
  libraryList: 'library:list',
  libraryCreate: 'library:create',
  libraryAdd: 'library:add',
  librarySwitch: 'library:switch',
  libraryLocate: 'library:locate',
  libraryRemove: 'library:remove',
  libraryRename: 'library:rename',
  libraryPrecheck: 'library:precheck',
  libraryMigrate: 'library:migrate',
  libraryDismissMigration: 'library:dismiss-migration',
  librarySettings: 'library:settings',
  librarySaveSettings: 'library:save-settings',
  libraryPurgeLegacy: 'library:purge-legacy',
  /** 主进程 → 渲染进程：迁移进度推送 */
  libraryMigrationEvent: 'library:migration-event',
  /** M6：回收站 */
  trashList: 'trash:list',
  trashRestore: 'trash:restore',
  trashPurge: 'trash:purge',
  trashEmpty: 'trash:empty',
  /** M6：备份 */
  backupList: 'backup:list',
  backupCreate: 'backup:create',
  backupRestore: 'backup:restore',
  backupDelete: 'backup:delete',
  backupReveal: 'backup:reveal',
  /** M7：内容导入与解析 */
  importAnalyze: 'import:analyze',
  importSession: 'import:session',
  importUpdateItem: 'import:update-item',
  importUpdateItems: 'import:update-items',
  importCommit: 'import:commit',
  importCancel: 'import:cancel',
  importValidate: 'import:validate',
  /** 主进程 → 渲染进程：导入进度推送 */
  importEvent: 'import:event',
  /** M8：全文检索与统计 */
  searchQuery: 'search:query',
  auditBook: 'audit:book',
  auditAbort: 'audit:abort',
  /** 主进程 → 渲染进程：整本审计进度推送 */
  auditEvent: 'audit:event',
  statSummary: 'stat:summary',
  statSetGoal: 'stat:set-goal',
  /** M9 · A1：可覆写提示词模板 */
  promptList: 'prompt:list',
  promptSave: 'prompt:save',
  promptReset: 'prompt:reset',
  /** M9 · A2：文风仿写画像 */
  styleGet: 'style:get',
  styleGenerate: 'style:generate',
  styleClear: 'style:clear',
  /** M9 · A3：向量检索 */
  vectorStatus: 'vector:status',
  vectorRebuild: 'vector:rebuild',
  vectorQuery: 'vector:query',
  vectorClear: 'vector:clear',
  /** M9 · A4：自动更新 */
  updateStatus: 'update:status',
  updateCheck: 'update:check',
  updateDownload: 'update:download',
  updateInstall: 'update:install',
  /** 主进程 → 渲染进程：更新状态推送 */
  updateEvent: 'update:event',
  /** M9 · A5：分卷与修订记录 */
  volumeList: 'volume:list',
  volumeSave: 'volume:save',
  volumeRemove: 'volume:remove',
  revisionList: 'revision:list'
} as const

export type IpcChannelName = (typeof IpcChannel)[keyof typeof IpcChannel]

export const idSchema = z.number().int().positive()

export const projectIdSchema = z.number().int().positive()

export const projectCreateSchema = z.object({
  name: z.string().trim().min(1, '项目名不能为空').max(120),
  genre: z.string().max(60).optional(),
  totalChapters: z.number().int().min(1).max(10_000).optional(),
  wordsPerChapter: z.number().int().min(200).max(20_000).optional(),
  premise: z.string().max(4_000).optional()
})

export const projectUpdateSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(120).optional(),
  genre: z.string().max(60).optional(),
  targetAudience: z.string().max(120).optional(),
  totalChapters: z.number().int().min(1).max(10_000).optional(),
  wordsPerChapter: z.number().int().min(200).max(20_000).optional(),
  language: z.string().max(30).optional(),
  style: z.string().max(4_000).optional(),
  premise: z.string().max(20_000).optional(),
  worldbuilding: z.string().max(200_000).optional(),
  protagonist: z.string().max(200_000).optional(),
  goldenFinger: z.string().max(200_000).optional(),
  globalGuidance: z.string().max(200_000).optional(),
  coreOutline: z.string().max(500_000).optional()
})

export const briefSaveSchema = z.object({
  id: idSchema.optional(),
  projectId: projectIdSchema,
  chapterNo: z.number().int().min(1).max(99_999),
  volumeIdx: z.number().int().min(0).max(9_999).optional(),
  title: z.string().max(200).optional(),
  role: z.string().max(60).optional(),
  purpose: z.string().max(4_000).optional(),
  keyEvents: z.string().max(20_000).optional(),
  characters: z.array(z.string().max(80)).max(200).optional(),
  sceneBeats: z.array(z.string().max(2_000)).max(200).optional(),
  suspenseHook: z.string().max(2_000).optional(),
  userGuidance: z.string().max(4_000).optional(),
  notes: z.string().max(4_000).optional()
})

export const draftSaveSchema = z.object({
  id: idSchema.optional(),
  projectId: projectIdSchema,
  chapterNo: z.number().int().min(1).max(99_999),
  version: z.number().int().min(1).max(9_999).optional(),
  status: z.enum(['draft', 'revised', 'finalized', 'archived']).optional(),
  source: z.enum(['write', 'continue', 'rewrite', 'polish', 'fix', 'import']).optional(),
  content: z.string().max(2_000_000).optional()
})

export const providerSaveSchema = z.object({
  id: idSchema.optional(),
  kind: z.enum(['openai-compatible', 'custom-reverse-proxy']).optional(),
  name: z.string().trim().min(1, '名称不能为空').max(80),
  baseUrl: z
    .string()
    .trim()
    .min(1, '接口地址不能为空')
    .max(500)
    .regex(/^https?:\/\//i, '需以 http:// 或 https:// 开头'),
  model: z.string().trim().min(1, '模型名不能为空').max(200),
  apiKey: z.string().max(500).optional(),
  enabled: z.boolean().optional(),
  headers: z.record(z.string().max(80), z.string().max(2000)).optional(),
  rateLimitPerMin: z.number().int().min(0).max(6000).optional(),
  riskAccepted: z.boolean().optional()
})

export const roleRouteSaveSchema = z.object({
  role: z.enum(['architect', 'writer', 'reviewer', 'extractor', 'embedder']),
  providerId: idSchema,
  model: z.string().max(200).optional(),
  fallbackChain: z.array(idSchema).max(5).optional(),
  maxConcurrency: z.number().int().min(1).max(8).optional()
})

export const exportTaskSchema = z.object({
  projectId: projectIdSchema,
  chapterNo: z.number().int().min(1).max(99_999)
})

export const requestIdSchema = z.string().min(1).max(100)

export const generateStartSchema = z.object({
  requestId: requestIdSchema,
  projectId: projectIdSchema,
  chapterNo: z.number().int().min(1).max(99_999),
  mode: z.enum(['draft', 'continue', 'rewrite', 'polish'])
})

export const wizardStartSchema = z.object({
  requestId: requestIdSchema,
  projectId: projectIdSchema
})

export const briefExpandSchema = z.object({
  projectId: projectIdSchema,
  chapterNo: z.number().int().min(1).max(99_999),
  current: z.object({
    title: z.string().max(200),
    purpose: z.string().max(4_000),
    keyEvents: z.string().max(20_000),
    characters: z.array(z.string().max(80)).max(200),
    sceneBeats: z.array(z.string().max(2_000)).max(200),
    suspenseHook: z.string().max(2_000)
  })
})

/* ============================ M3：连写队列 ============================ */

export const pipelineStartSchema = z.object({
  requestId: requestIdSchema,
  projectId: projectIdSchema,
  fromCh: z.number().int().min(1).max(99_999).optional(),
  toCh: z.number().int().min(1).max(99_999).optional(),
  requireAccept: z.boolean().optional()
})

export const pipelineSteerSchema = z.object({
  requestId: requestIdSchema,
  guidance: z.string().max(4_000)
})

/** 章节定位查询（记忆面板读取单章审计报告等） */
export const chapterQuerySchema = z.object({
  projectId: projectIdSchema,
  chapterNo: z.number().int().min(1).max(99_999)
})

/* ============================ M4：修复与导出 ============================ */

export const fixChapterSchema = chapterQuerySchema.extend({
  useModel: z.boolean().optional()
})

export const exportSchema = z.object({
  projectId: projectIdSchema,
  formats: z.array(z.enum(['txt', 'md', 'docx', 'epub'])).min(1).max(4),
  outDir: z.string().max(1_000).optional()
})

/** 本地路径（打开导出目录等） */
export const pathSchema = z.string().min(1).max(1_000)

/* ============================ M6：书库与生命周期 ============================ */

export const libraryNameSchema = z.string().trim().min(1, '书库名称不能为空').max(80)
export const libraryPathSchema = z.string().trim().min(1, '路径不能为空').max(1_000)
export const libraryIdSchema = z.string().min(1).max(80)

export const libraryCreateSchema = z.object({ name: libraryNameSchema, path: libraryPathSchema })
export const libraryLocateSchema = z.object({ id: libraryIdSchema, path: libraryPathSchema })
export const libraryRemoveSchema = z.object({ id: libraryIdSchema, deleteFiles: z.boolean() })
export const libraryRenameSchema = z.object({ id: libraryIdSchema, name: libraryNameSchema })
export const libraryMigrateSchema = z.object({ targetPath: libraryPathSchema })

export const librarySettingsSchema = z.object({
  trashRetentionDays: z.union([z.literal(0), z.literal(7), z.literal(30), z.literal(90)]).optional(),
  cleanCacheOnQuit: z.boolean().optional(),
  autoBackup: z.boolean().optional(),
  ragSearch: z.boolean().optional(),
  autoUpdate: z.boolean().optional()
})

export const trashItemSchema = z.object({
  kind: z.enum(['project', 'chapter']),
  id: idSchema
})

export const backupNameSchema = z.string().min(1).max(200)

/* ============================ M7：内容导入与解析 ============================ */

export const briefFieldKeySchema = z.enum([
  'purpose',
  'keyEvents',
  'characters',
  'suspenseHook',
  'sceneBeats',
  'userGuidance',
  'notes'
])

export const importActionSchema = z.enum(['create', 'update', 'skip', 'conflict'])

export const importAnalyzeSchema = z
  .object({
    path: z.string().trim().min(1).max(1_000).optional(),
    text: z.string().max(2_000_000).optional(),
    kind: z.enum(['txt', 'md', 'docx', 'epub', 'json', 'vela', 'manual']).optional(),
    projectId: projectIdSchema.optional(),
    useLlm: z.boolean().optional()
  })
  .refine((value) => Boolean(value.path) !== Boolean(value.text && value.text.length > 0), {
    message: 'path 与 text 必须二选一'
  })

export const importSessionSchema = z.object({ id: z.string().min(1).max(100) })

export const importUpdateItemsSchema = z.object({
  sessionId: z.string().min(1).max(100),
  updates: z
    .array(
      z.object({
        itemId: z.string().min(1).max(100),
        action: importActionSchema.optional(),
        enabled: z.boolean().optional(),
        chapterNo: z.number().int().min(1).max(99_999).optional(),
        volumeIdx: z.number().int().min(0).max(9_999).optional()
      })
    )
    .min(1)
    .max(5_000)
})

export const importUpdateItemSchema = z.object({
  sessionId: z.string().min(1).max(100),
  itemId: z.string().min(1).max(100),
  action: importActionSchema.optional(),
  enabled: z.boolean().optional(),
  chapterNo: z.number().int().min(1).max(99_999).optional(),
  volumeIdx: z.number().int().min(0).max(9_999).optional()
})

export const importCommitSchema = z.object({ sessionId: z.string().min(1).max(100) })

export const importValidateSchema = z.object({
  sessionId: z.string().min(1).max(100),
  requiredFields: z.array(briefFieldKeySchema).max(9).optional()
})

/* ============================ M8：检索与统计增强 ============================ */

export const searchQuerySchema = z.object({
  /** 缺省表示跨全部项目检索 */
  projectId: projectIdSchema.optional(),
  query: z.string().trim().min(1, '请输入检索词').max(200),
  limit: z.number().int().min(1).max(200).optional()
})

export const bookAuditSchema = z.object({
  projectId: projectIdSchema,
  useModel: z.boolean().optional(),
  confirm: z.boolean().optional()
})

export const auditAbortSchema = z.object({ taskId: z.string().min(1).max(100) })

/* ============================ M9（A1–A5） ============================ */

export const promptSaveSchema = z.object({
  key: z.string().min(1).max(100),
  system: z.string().max(200_000).optional(),
  instruction: z.string().max(200_000).optional()
})

export const promptKeySchema = z.string().min(1).max(100)

export const styleGenerateSchema = z
  .object({
    projectId: projectIdSchema,
    sample: z.string().max(200_000).optional(),
    useExisting: z.boolean().optional()
  })
  .refine((value) => Boolean(value.sample && value.sample.trim()) || value.useExisting === true, {
    message: '请粘贴参考文本，或选择从本书已有正文抽取样本'
  })

export const vectorQuerySchema = z.object({
  projectId: projectIdSchema,
  text: z.string().trim().min(1).max(4_000),
  limit: z.number().int().min(1).max(50).optional()
})

export const volumeSaveSchema = z.object({
  id: idSchema.optional(),
  projectId: projectIdSchema,
  idx: z.number().int().min(0).max(9_999),
  title: z.string().max(200).optional(),
  synopsis: z.string().max(20_000).optional()
})

export const volumeRemoveSchema = idSchema

export const revisionQuerySchema = chapterQuerySchema

export const statSetGoalSchema = z
  .object({
    dailyWords: z.number().int().min(0).max(1_000_000).optional(),
    dailyChapters: z.number().int().min(0).max(1_000).optional()
  })
  .refine((value) => value.dailyWords !== undefined || value.dailyChapters !== undefined, {
    message: '至少需要设置一项目标'
  })