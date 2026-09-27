import { sqliteTable, integer, text, index, uniqueIndex } from 'drizzle-orm/sqlite-core'

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
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull()
  },
  (t) => [
    uniqueIndex('chapter_brief_project_chapter_uq').on(t.projectId, t.chapterNo),
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
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull()
  },
  (t) => [
    uniqueIndex('chapter_draft_project_chapter_version_uq').on(t.projectId, t.chapterNo, t.version),
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
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
})

/** 迁移版本表（schema_version 驱动迁移） */
export const schemaVersion = sqliteTable('schema_version', {
  version: integer('version').primaryKey(),
  appliedAt: integer('applied_at').notNull()
})