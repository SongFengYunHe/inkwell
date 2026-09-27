import { and, asc, desc, eq } from 'drizzle-orm'
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

/* ---------------------------------- 项目 ---------------------------------- */

export function listProjects(): Project[] {
  return getDb().select().from(project).orderBy(desc(project.updatedAt)).all()
}

export function getProject(id: number): Project | null {
  const row = getDb().select().from(project).where(eq(project.id, id)).get()
  return row ?? null
}

export function createProject(input: ProjectCreateInput): Project {
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

export function deleteProject(id: number): void {
  getDb().delete(project).where(eq(project.id, id)).run()
}

/* --------------------------------- 章节细纲 -------------------------------- */

export function listBriefs(projectId: number): ChapterBrief[] {
  return getDb()
    .select()
    .from(chapterBrief)
    .where(eq(chapterBrief.projectId, projectId))
    .orderBy(asc(chapterBrief.chapterNo))
    .all()
}

/** 保存细纲：按 (projectId, chapterNo) 唯一，存在即更新，否则新建 */
export function saveBrief(input: BriefSaveInput): ChapterBrief {
  const db = getDb()
  const now = Date.now()
  const existing = db
    .select()
    .from(chapterBrief)
    .where(and(eq(chapterBrief.projectId, input.projectId), eq(chapterBrief.chapterNo, input.chapterNo)))
    .get()

  if (existing) {
    const patch = pickDefined(input, BRIEF_IMMUTABLE)
    return db
      .update(chapterBrief)
      .set({ ...patch, updatedAt: now })
      .where(eq(chapterBrief.id, existing.id))
      .returning()
      .get()
  }

  return db
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
}

export function deleteBrief(id: number): void {
  getDb().delete(chapterBrief).where(eq(chapterBrief.id, id)).run()
}

/* ---------------------------------- 正文 --------------------------------- */

export function listDrafts(projectId: number): ChapterDraft[] {
  return getDb()
    .select()
    .from(chapterDraft)
    .where(eq(chapterDraft.projectId, projectId))
    .orderBy(asc(chapterDraft.chapterNo), desc(chapterDraft.version))
    .all()
}

/** 保存草稿：按 (projectId, chapterNo, version) 唯一，存在即更新，否则新建 */
export function saveDraft(input: DraftSaveInput): ChapterDraft {
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
        eq(chapterDraft.version, version)
      )
    )
    .get()

  const content = input.content ?? existing?.content ?? ''
  const wordCount = countWords(content)

  if (existing) {
    const patch = pickDefined(input, DRAFT_IMMUTABLE)
    return db
      .update(chapterDraft)
      .set({ ...patch, content, wordCount, updatedAt: now })
      .where(eq(chapterDraft.id, existing.id))
      .returning()
      .get()
  }

  return db
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
}

export function deleteDraft(id: number): void {
  getDb().delete(chapterDraft).where(eq(chapterDraft.id, id)).run()
}