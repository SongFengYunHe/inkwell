import { and, asc, desc, eq, gt, isNull, sql } from 'drizzle-orm'
import type {
  BriefSaveInput,
  ChapterBrief,
  ChapterDraft,
  DraftSaveInput,
  Project,
  ProjectCreateInput,
  ProjectUpdateInput
} from '@shared/types'
import { getDb } from './client'
import { chapterBrief, chapterDraft, project } from './schema'
import { ensureVolume } from './volume-repo'
import { isQuitting } from '../lifecycle'
import { addChaptersDone, addWords } from '../stat/tracker'

/** 退出过程中拒绝新的写操作，保证数据落盘一致 */
function assertWritable(): void {
  if (isQuitting()) throw new Error('应用正在退出，已拒绝本次写入')
}

/** 中文场景下的字符数统计：忽略所有空白字符 */
export function countWords(content: string): number {
  return content.replace(/\s/g, '').length
}

/** 从更新入参中挑出已定义字段（忽略 id 与时间戳，由仓库层接管） */
function pickDefined<T extends object>(source: T, omit: ReadonlySet<string>): Partial<T> {
  const patch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && !omit.has(key)) patch[key] = value
  }
  return patch as Partial<T>
}

const PROJECT_IMMUTABLE = new Set(['id', 'createdAt', 'updatedAt'])
const BRIEF_IMMUTABLE = new Set(['id', 'projectId', 'createdAt', 'updatedAt'])
const DRAFT_IMMUTABLE = new Set(['id', 'projectId', 'createdAt', 'updatedAt', 'wordCount'])

/**
 * 软删除约定（M6）：所有查询默认 `WHERE deleted_at IS NULL`。
 * 删除一律打时间戳（repositories / trash 层统一封装），不在各处散落。
 */

/* ---------------------------------- 项目 ---------------------------------- */

export function listProjects(): Project[] {
  return getDb()
    .select()
    .from(project)
    .where(isNull(project.deletedAt))
    .orderBy(desc(project.updatedAt))
    .all()
}

export function getProject(id: number): Project | null {
  const row = getDb()
    .select()
    .from(project)
    .where(and(eq(project.id, id), isNull(project.deletedAt)))
    .get()
  return row ?? null
}

export function createProject(input: ProjectCreateInput): Project {
  assertWritable()
  const now = Date.now()
  return getDb()
    .insert(project)
    .values({
      name: input.name,
      genre: input.genre ?? '',
      totalChapters: input.totalChapters ?? 50,
      wordsPerChapter: input.wordsPerChapter ?? 3000,
      premise: input.premise ?? '',
      createdAt: now,
      updatedAt: now
    })
    .returning()
    .get()
}

export function updateProject(input: ProjectUpdateInput): Project {
  assertWritable()
  const patch = pickDefined(input, PROJECT_IMMUTABLE)
  const row = getDb()
    .update(project)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(project.id, input.id))
    .returning()
    .get()
  if (!row) throw new Error(`项目不存在：${input.id}`)
  return row
}

/** 移入回收站（软删除）；children 保留，彻底删除时由外键级联清理 */
export function deleteProject(id: number): void {
  assertWritable()
  const now = Date.now()
  getDb().update(project).set({ deletedAt: now, updatedAt: now }).where(eq(project.id, id)).run()
}

/* --------------------------------- 章节细纲 -------------------------------- */

export function listBriefs(projectId: number): ChapterBrief[] {
  return getDb()
    .select()
    .from(chapterBrief)
    .where(and(eq(chapterBrief.projectId, projectId), isNull(chapterBrief.deletedAt)))
    .orderBy(asc(chapterBrief.chapterNo))
    .all()
}

/** 保存细纲：按 (projectId, chapterNo) 唯一，存在即更新，否则新建 */
export function saveBrief(input: BriefSaveInput): ChapterBrief {
  // A5：细纲写入时顺带确保所属分卷存在，避免出现「有章节、无卷」的悬空数据
  assertWritable()
  const db = getDb()
  const now = Date.now()
  const existing = db
    .select()
    .from(chapterBrief)
    .where(
      and(
        eq(chapterBrief.projectId, input.projectId),
        eq(chapterBrief.chapterNo, input.chapterNo),
        isNull(chapterBrief.deletedAt)
      )
    )
    .get()

  if (existing) {
    const patch = pickDefined(input, BRIEF_IMMUTABLE)
    const updated = db
      .update(chapterBrief)
      .set({ ...patch, updatedAt: now })
      .where(eq(chapterBrief.id, existing.id))
      .returning()
      .get()
    ensureVolume(updated.projectId, updated.volumeIdx)
    return updated
  }

  const created = db
    .insert(chapterBrief)
    .values({
      projectId: input.projectId,
      chapterNo: input.chapterNo,
      volumeIdx: input.volumeIdx ?? 1,
      title: input.title ?? '',
      role: input.role ?? '',
      purpose: input.purpose ?? '',
      keyEvents: input.keyEvents ?? '',
      characters: input.characters ?? [],
      sceneBeats: input.sceneBeats ?? [],
      suspenseHook: input.suspenseHook ?? '',
      userGuidance: input.userGuidance ?? '',
      notes: input.notes ?? '',
      createdAt: now,
      updatedAt: now
    })
    .returning()
    .get()
  ensureVolume(created.projectId, created.volumeIdx)
  return created
}

/** 删除章节 = 给 chapter_brief 与其所有 chapter_draft 打同一个时间戳（便于成组恢复） */
export function deleteBrief(id: number): void {
  assertWritable()
  const db = getDb()
  const row = db.select().from(chapterBrief).where(eq(chapterBrief.id, id)).get()
  if (!row) return
  const now = Date.now()
  db.update(chapterBrief)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(chapterBrief.id, id))
    .run()
  db.update(chapterDraft)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        eq(chapterDraft.projectId, row.projectId),
        eq(chapterDraft.chapterNo, row.chapterNo),
        isNull(chapterDraft.deletedAt)
      )
    )
    .run()
}

/* ---------------------------------- 正文 --------------------------------- */

export function listDrafts(projectId: number): ChapterDraft[] {
  return getDb()
    .select()
    .from(chapterDraft)
    .where(and(eq(chapterDraft.projectId, projectId), isNull(chapterDraft.deletedAt)))
    .orderBy(asc(chapterDraft.chapterNo), desc(chapterDraft.version))
    .all()
}

/**
 * 保存草稿：按 (projectId, chapterNo, version) 唯一，存在即更新，否则新建。
 * M8：写入后按差值累加写作统计（新增 = +wordCount；更新 = 新 − 旧，可为负）；
 *      若该章此前没有任何非空正文、本次首次产生正文，则「章节完成数」+1。
 */
export function saveDraft(input: DraftSaveInput): ChapterDraft {
  assertWritable()
  const db = getDb()
  const now = Date.now()
  const version = input.version ?? 1
  const existing = db
    .select()
    .from(chapterDraft)
    .where(
      and(
        eq(chapterDraft.projectId, input.projectId),
        eq(chapterDraft.chapterNo, input.chapterNo),
        eq(chapterDraft.version, version),
        isNull(chapterDraft.deletedAt)
      )
    )
    .get()

  const content = input.content ?? existing?.content ?? ''
  const wordCount = countWords(content)
  const before = existing?.wordCount ?? 0

  // 「章节首次产生正文」判定：写入前该章是否已有非空正文
  const nonEmptyBefore =
    db
      .select({ value: sql<number>`count(*)` })
      .from(chapterDraft)
      .where(
        and(
          eq(chapterDraft.projectId, input.projectId),
          eq(chapterDraft.chapterNo, input.chapterNo),
          isNull(chapterDraft.deletedAt),
          gt(chapterDraft.wordCount, 0)
        )
      )
      .get()?.value ?? 0

  const row = existing
    ? db
        .update(chapterDraft)
        .set({ ...pickDefined(input, DRAFT_IMMUTABLE), content, wordCount, updatedAt: now })
        .where(eq(chapterDraft.id, existing.id))
        .returning()
        .get()
    : db
        .insert(chapterDraft)
        .values({
          projectId: input.projectId,
          chapterNo: input.chapterNo,
          version,
          status: input.status ?? 'draft',
          source: input.source ?? 'write',
          content,
          wordCount,
          createdAt: now,
          updatedAt: now
        })
        .returning()
        .get()

  // 记账放在写入成功之后，避免写失败却留下统计
  addWords(wordCount - before, now)
  if (wordCount > 0 && nonEmptyBefore === 0) addChaptersDone(1, now)

  return row
}

export function deleteDraft(id: number): void {
  assertWritable()
  const now = Date.now()
  getDb().update(chapterDraft).set({ deletedAt: now, updatedAt: now }).where(eq(chapterDraft.id, id)).run()
}