import { sql } from 'drizzle-orm'
import { blob, sqliteTable, integer, text, index, uniqueIndex } from 'drizzle-orm/sqlite-core'
import type {
  AuditReport,
  BriefFieldKey,
  CharacterStateDelta,
  ContinuityFacts,
  ImportBriefPayload,
  ImportFieldDiff,
  ParsedTree,
  ThreadUpdate,
  ValidationReport
} from '@shared/types'

/**
 * Drizzle schema —— 应用层的类型来源（供仓库层做类型安全查询）。
 * 建表 DDL 由 migrations.ts 统一维护，二者需保持同步。
 */

/** 项目（单行项目配置） */
export const project = sqliteTable('project', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  genre: text('genre').notNull().default(''),
  targetAudience: text('target_audience').notNull().default(''),
  totalChapters: integer('total_chapters').notNull().default(50),
  wordsPerChapter: integer('words_per_chapter').notNull().default(3000),
  language: text('language').notNull().default('zh-CN'),
  style: text('style').notNull().default(''),
  premise: text('premise').notNull().default(''),
  worldbuilding: text('worldbuilding').notNull().default(''),
  protagonist: text('protagonist').notNull().default(''),
  goldenFinger: text('golden_finger').notNull().default(''),
  globalGuidance: text('global_guidance').notNull().default(''),
  coreOutline: text('core_outline').notNull().default(''),
  /** A2 文风画像（JSON；空字符串表示尚未生成） */
  styleProfile: text('style_profile').notNull().default(''),
  /** 软删除时间戳；非空表示已移入回收站 */
  deletedAt: integer('deleted_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
})

/** 每章细纲 */
export const chapterBrief = sqliteTable(
  'chapter_brief',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    chapterNo: integer('chapter_no').notNull(),
    volumeIdx: integer('volume_idx').notNull().default(1),
    title: text('title').notNull().default(''),
    role: text('role').notNull().default(''),
    purpose: text('purpose').notNull().default(''),
    keyEvents: text('key_events').notNull().default(''),
    characters: text('characters', { mode: 'json' }).$type<string[]>().notNull().default([]),
    sceneBeats: text('scene_beats', { mode: 'json' }).$type<string[]>().notNull().default([]),
    suspenseHook: text('suspense_hook').notNull().default(''),
    userGuidance: text('user_guidance').notNull().default(''),
    notes: text('notes').notNull().default(''),
    /** 软删除时间戳；非空表示已移入回收站 */
    deletedAt: integer('deleted_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull()
  },
  (t) => [
    // 部分唯一索引：只约束未删除行，回收站中的行不占号
    uniqueIndex('chapter_brief_project_chapter_uq')
      .on(t.projectId, t.chapterNo)
      .where(sql`deleted_at IS NULL`),
    index('chapter_brief_project_idx').on(t.projectId)
  ]
)

/** 正文草稿 */
export const chapterDraft = sqliteTable(
  'chapter_draft',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    chapterNo: integer('chapter_no').notNull(),
    version: integer('version').notNull().default(1),
    status: text('status').notNull().default('draft'),
    source: text('source').notNull().default('write'),
    content: text('content').notNull().default(''),
    wordCount: integer('word_count').notNull().default(0),
    /** 软删除时间戳；非空表示已移入回收站 */
    deletedAt: integer('deleted_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull()
  },
  (t) => [
    uniqueIndex('chapter_draft_project_chapter_version_uq')
      .on(t.projectId, t.chapterNo, t.version)
      .where(sql`deleted_at IS NULL`),
    index('chapter_draft_project_idx').on(t.projectId)
  ]
)

/** 模型接入配置（M1 仅 openai-compatible） */
export const provider = sqliteTable('provider', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  kind: text('kind').notNull().default('openai-compatible'),
  name: text('name').notNull(),
  baseUrl: text('base_url').notNull(),
  /** 经 safeStorage 加密后的密钥密文，永不明文落库 */
  apiKeyEnc: text('api_key_enc').notNull().default(''),
  model: text('model').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  /** 自定义请求头（部分自建 / 第三方端点需要） */
  headers: text('headers', { mode: 'json' }).$type<Record<string, string>>().notNull().default({}),
  /** 每分钟最大请求数，0 表示不限速 */
  rateLimitPerMin: integer('rate_limit_per_min').notNull().default(0),
  /** 自定义端点需用户确认使用须知后才可启用 */
  riskAccepted: integer('risk_accepted', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
})

/** 角色 → 模型路由（计划书 §6.1 RoleRouter） */
export const roleRoute = sqliteTable(
  'role_route',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** architect | writer | reviewer | extractor | embedder */
    role: text('role').notNull(),
    providerId: integer('provider_id')
      .notNull()
      .references(() => provider.id, { onDelete: 'cascade' }),
    /** 留空表示用 provider 的默认模型 */
    model: text('model').notNull().default(''),
    /** 备用 provider id 链（JSON 数组），主 provider 失败时依次尝试 */
    fallbackChain: text('fallback_chain', { mode: 'json' }).$type<number[]>().notNull().default([]),
    maxConcurrency: integer('max_concurrency').notNull().default(2),
    updatedAt: integer('updated_at').notNull()
  },
  (t) => [uniqueIndex('role_route_role_uq').on(t.role)]
)

/** 调用审计与用量记账（计划书 §5.1 `llm_call`） */
export const llmCall = sqliteTable(
  'llm_call',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** 不设外键：provider 删除后仍保留用量历史 */
    providerId: integer('provider_id'),
    providerName: text('provider_name').notNull().default(''),
    model: text('model').notNull().default(''),
    role: text('role').notNull().default(''),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    durationMs: integer('duration_ms').notNull().default(0),
    success: integer('success', { mode: 'boolean' }).notNull().default(true),
    error: text('error').notNull().default(''),
    createdAt: integer('created_at').notNull()
  },
  (t) => [index('llm_call_created_idx').on(t.createdAt), index('llm_call_role_idx').on(t.role)]
)

/** 章节记忆快照（真相文件 chapter_summaries / world_state 载体） */
export const memoryChapter = sqliteTable(
  'memory_chapter',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    chapterNo: integer('chapter_no').notNull(),
    draftId: integer('draft_id'),
    summary: text('summary').notNull().default(''),
    /** Array<{ name, state, location, power, items: string[], recent }> */
    characterStates: text('character_states', { mode: 'json' })
      .$type<CharacterStateDelta[]>()
      .notNull()
      .default([]),
    /** { worldState, timeline, resourceLedger, facts: string[] } */
    continuityFacts: text('continuity_facts', { mode: 'json' })
      .$type<ContinuityFacts>()
      .notNull()
      .default({ worldState: '', timeline: '', resourceLedger: '', facts: [] }),
    /** Array<{ title, type, event, evidence }> */
    threadUpdates: text('thread_updates', { mode: 'json' })
      .$type<ThreadUpdate[]>()
      .notNull()
      .default([]),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull()
  },
  (t) => [uniqueIndex('memory_chapter_project_chapter_uq').on(t.projectId, t.chapterNo)]
)

/** 角色卡 + 当前状态（真相文件 character_matrix 载体） */
export const character = sqliteTable(
  'character',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    role: text('role').notNull().default(''),
    appearance: text('appearance').notNull().default(''),
    personality: text('personality').notNull().default(''),
    background: text('background').notNull().default(''),
    abilities: text('abilities').notNull().default(''),
    motivation: text('motivation').notNull().default(''),
    relationships: text('relationships').notNull().default(''),
    csLocation: text('cs_location').notNull().default(''),
    csPower: text('cs_power').notNull().default(''),
    csState: text('cs_state').notNull().default(''),
    csItems: text('cs_items', { mode: 'json' }).$type<string[]>().notNull().default([]),
    csRecent: text('cs_recent').notNull().default(''),
    csUpdatedCh: integer('cs_updated_ch').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull()
  },
  (t) => [uniqueIndex('character_project_name_uq').on(t.projectId, t.name)]
)

/** 主线/支线/伏笔台账（真相文件 pending_hooks / subplot_board 载体） */
export const outlineThread = sqliteTable(
  'outline_thread',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /** plot | subplot | hook */
    type: text('type').notNull().default('plot'),
    startCh: integer('start_ch').notNull().default(0),
    endCh: integer('end_ch').notNull().default(0),
    intent: text('intent').notNull().default(''),
    /** planned | active | resolved | abandoned */
    status: text('status').notNull().default('planned'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull()
  },
  (t) => [uniqueIndex('outline_thread_project_title_uq').on(t.projectId, t.title)]
)

/** 伏笔状态变更记录 */
export const threadEvent = sqliteTable(
  'thread_event',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    threadId: integer('thread_id')
      .notNull()
      .references(() => outlineThread.id, { onDelete: 'cascade' }),
    chapterNo: integer('chapter_no').notNull().default(0),
    draftId: integer('draft_id'),
    /** planted | progressing | resolved | abandoned */
    event: text('event').notNull().default('progressing'),
    evidence: text('evidence').notNull().default(''),
    createdAt: integer('created_at').notNull()
  },
  (t) => [index('thread_event_thread_idx').on(t.threadId)]
)

/** 审稿报告（多维审计结果） */
export const review = sqliteTable(
  'review',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    draftId: integer('draft_id'),
    chapterNo: integer('chapter_no').notNull(),
    idx: integer('idx').notNull().default(1),
    /** AuditReport 序列化 */
    content: text('content', { mode: 'json' })
      .$type<AuditReport>()
      .notNull()
      .default({ chapterNo: 0, passed: true, score: 0, checks: [], modelAssisted: false, createdAt: 0 }),
    createdAt: integer('created_at').notNull()
  },
  (t) => [index('review_project_chapter_idx').on(t.projectId, t.chapterNo)]
)

/** 连写任务 */
export const pipelineRun = sqliteTable(
  'pipeline_run',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    fromCh: integer('from_ch').notNull(),
    toCh: integer('to_ch').notNull(),
    /** running | paused | awaiting_accept | done | failed | aborted | interrupted */
    status: text('status').notNull().default('running'),
    cursor: integer('cursor').notNull().default(1),
    requireAccept: integer('require_accept', { mode: 'boolean' }).notNull().default(false),
    steerGuidance: text('steer_guidance').notNull().default(''),
    error: text('error').notNull().default(''),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull()
  },
  (t) => [index('pipeline_run_project_idx').on(t.projectId)]
)

/** 步骤级进度（断点恢复） */
export const pipelineStep = sqliteTable(
  'pipeline_step',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    runId: integer('run_id')
      .notNull()
      .references(() => pipelineRun.id, { onDelete: 'cascade' }),
    chapterNo: integer('chapter_no').notNull(),
    /** assemble | draft | audit | memory | skip */
    step: text('step').notNull(),
    ok: integer('ok', { mode: 'boolean' }).notNull().default(false),
    attempt: integer('attempt').notNull().default(1),
    error: text('error').notNull().default(''),
    updatedAt: integer('updated_at').notNull()
  },
  (t) => [uniqueIndex('pipeline_step_run_chapter_step_uq').on(t.runId, t.chapterNo, t.step)]
)

/* ============================ M7：内容导入与解析 ============================ */

/** 导入会话（暂存；parsed_tree / validation 为 JSON） */
export const importSession = sqliteTable(
  'import_session',
  {
    id: text('id').primaryKey(),
    /** 目标项目 id（无项目时为 null） */
    projectId: text('project_id'),
    sourcePath: text('source_path').notNull().default(''),
    sourceKind: text('source_kind').notNull().default(''),
    parsedTree: text('parsed_tree', { mode: 'json' }).$type<ParsedTree>().notNull(),
    validation: text('validation', { mode: 'json' }).$type<ValidationReport>().notNull(),
    warnings: text('warnings', { mode: 'json' }).$type<string[]>().notNull().default([]),
    encoding: text('encoding').notNull().default(''),
    createdAt: integer('created_at').notNull(),
    /** staging | committed | cancelled */
    status: text('status').notNull().default('staging')
  },
  (t) => [index('import_session_status_idx').on(t.status)]
)

/** 暂存条目（逐章，可逐条开关） */
export const importItem = sqliteTable(
  'import_item',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => importSession.id, { onDelete: 'cascade' }),
    chapterNo: integer('chapter_no').notNull().default(0),
    volumeIdx: integer('volume_idx').notNull().default(0),
    title: text('title').notNull().default(''),
    /** create | update | skip | conflict */
    action: text('action').notNull().default('create'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    payload: text('payload', { mode: 'json' }).$type<ImportBriefPayload>().notNull(),
    diff: text('diff', { mode: 'json' }).$type<ImportFieldDiff[]>().notNull().default([]),
    heuristicFields: text('heuristic_fields', { mode: 'json' }).$type<BriefFieldKey[]>().notNull().default([]),
    hasDraft: integer('has_draft', { mode: 'boolean' }).notNull().default(false)
  },
  (t) => [index('import_item_session_idx').on(t.sessionId)]
)

/* ============================ M8：检索与统计增强 ============================ */

/**
 * FTS5 虚拟表（DDL 见 migrations.ts v7）。
 * 这里仅做类型声明，实际写入 / 查询一律走 search/fts.ts 的原生 SQL
 * （drizzle 不支持 FTS5 的 MATCH / snippet 语法）。
 */
export const ftsDraft = sqliteTable('fts_draft', {
  rowid: integer('rowid'),
  content: text('content').notNull().default(''),
  chapterNo: integer('chapter_no').notNull().default(0),
  projectId: integer('project_id').notNull().default(0)
})

export const ftsBrief = sqliteTable('fts_brief', {
  rowid: integer('rowid'),
  title: text('title').notNull().default(''),
  purpose: text('purpose').notNull().default(''),
  keyEvents: text('key_events').notNull().default(''),
  characters: text('characters').notNull().default(''),
  suspenseHook: text('suspense_hook').notNull().default(''),
  sceneBeats: text('scene_beats').notNull().default(''),
  chapterNo: integer('chapter_no').notNull().default(0),
  projectId: integer('project_id').notNull().default(0)
})

export const ftsMemory = sqliteTable('fts_memory', {
  rowid: integer('rowid'),
  summary: text('summary').notNull().default(''),
  chapterNo: integer('chapter_no').notNull().default(0),
  projectId: integer('project_id').notNull().default(0)
})

/** 写作统计（按天，本地时区 YYYY-MM-DD 为主键） */
export const writingStat = sqliteTable('writing_stat', {
  day: text('day').primaryKey(),
  wordsAdded: integer('words_added').notNull().default(0),
  chaptersDone: integer('chapters_done').notNull().default(0),
  updatedAt: integer('updated_at')
})

/** 写作目标（单行，id 恒为 1） */
export const writingGoal = sqliteTable('writing_goal', {
  id: integer('id').primaryKey(),
  dailyWords: integer('daily_words').notNull().default(3000),
  dailyChapters: integer('daily_chapters').notNull().default(1),
  createdAt: integer('created_at')
})

/* ==================== M9（A1–A5）：模板 / 文风 / 向量 / 分卷 / 修订 ==================== */

/**
 * A1 可覆写提示词模板（覆写层）。
 * 只存「被用户改过」的行；没有行 = 用内置默认，因此内置模板升级后老库自动跟随。
 */
export const promptTemplate = sqliteTable(
  'prompt_template',
  {
    key: text('key').notNull(),
    locale: text('locale').notNull().default('zh-CN'),
    systemBody: text('system_body').notNull().default(''),
    instructionBody: text('instruction_body').notNull().default(''),
    version: integer('version').notNull().default(1),
    updatedAt: integer('updated_at').notNull()
  },
  (t) => [uniqueIndex('prompt_template_key_locale_uq').on(t.key, t.locale)]
)

/** A5 分卷（计划书 §5.1 volume）：卷标题 / 卷梗概 */
export const volume = sqliteTable(
  'volume',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    idx: integer('idx').notNull().default(1),
    title: text('title').notNull().default(''),
    synopsis: text('synopsis').notNull().default(''),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull()
  },
  (t) => [uniqueIndex('volume_project_idx_uq').on(t.projectId, t.idx)]
)

/** A5 修订记录（计划书 §5.1 draft_revision）：这次改动「为什么改、改了什么」 */
export const draftRevision = sqliteTable(
  'draft_revision',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    chapterNo: integer('chapter_no').notNull(),
    /** 改动前的版本 id */
    baseDraftId: integer('base_draft_id'),
    /** 改动后的版本 id */
    draftId: integer('draft_id'),
    idx: integer('idx').notNull().default(1),
    /** refine | review-fix | polish | rewrite | manual */
    type: text('type').notNull().default('refine'),
    /** applied | reverted */
    status: text('status').notNull().default('applied'),
    /** 改动来由（如命中的审计维度清单） */
    userPrompt: text('user_prompt').notNull().default(''),
    content: text('content').notNull().default(''),
    wordCount: integer('word_count').notNull().default(0),
    createdAt: integer('created_at').notNull()
  },
  (t) => [index('draft_revision_project_chapter_idx').on(t.projectId, t.chapterNo)]
)

/** A3 向量索引：正文分块 + embedding（vector = Float32Array 的 BLOB） */
export const embedding = sqliteTable(
  'embedding',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    /** draft | brief | memory */
    sourceType: text('source_type').notNull().default('draft'),
    sourceId: integer('source_id').notNull().default(0),
    chapterNo: integer('chapter_no').notNull().default(0),
    chunkIdx: integer('chunk_idx').notNull().default(0),
    text: text('text').notNull().default(''),
    dim: integer('dim').notNull().default(0),
    vector: blob('vector'),
    model: text('model').notNull().default(''),
    createdAt: integer('created_at').notNull()
  },
  (t) => [
    uniqueIndex('embedding_source_uq').on(t.projectId, t.sourceType, t.sourceId, t.chunkIdx),
    index('embedding_project_chapter_idx').on(t.projectId, t.chapterNo)
  ]
)

/** 迁移版本表（schema_version 驱动迁移） */
export const schemaVersion = sqliteTable('schema_version', {
  version: integer('version').primaryKey(),
  appliedAt: integer('applied_at').notNull()
})