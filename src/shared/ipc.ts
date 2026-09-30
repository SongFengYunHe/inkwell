import { z } from 'zod'

/** IPC 通道名（主进程与预加载脚本共用，避免字符串漂移） */
export const IpcChannel = {
  projectList: 'project:list',
  projectGet: 'project:get',
  projectCreate: 'project:create',
  projectUpdate: 'project:update',
  projectRemove: 'project:remove',
  briefList: 'brief:list',
  briefSave: 'brief:save',
  briefRemove: 'brief:remove',
  briefExpand: 'brief:expand',
  draftList: 'draft:list',
  draftSave: 'draft:save',
  draftRemove: 'draft:remove',
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
  appMcpEntry: 'app:mcp-entry'
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
  source: z.enum(['write', 'continue', 'rewrite', 'polish']).optional(),
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