import { and, asc, desc, eq, isNotNull, isNull, lt, max } from 'drizzle-orm'
import type { TrashItem, TrashRetention } from '@shared/types'
import { getDb } from './client'
import { chapterBrief, chapterDraft, project } from './schema'
import { getSettings } from '../library/registry'

const DAY_MS = 24 * 60 * 60 * 1000

function expiresAtFor(deletedAt: number, retentionDays: TrashRetention): number | null {
  return retentionDays === 0 ? null : deletedAt + retentionDays * DAY_MS
}

/** 回收站列表：项目级 + 章节级统一视图 */
export function listTrash(): TrashItem[] {
  const db = getDb()
  const retention = getSettings().trashRetentionDays
  const items: TrashItem[] = []

  const deletedProjects = db
    .select()
    .from(project)
    .where(isNotNull(project.deletedAt))
    .orderBy(desc(project.deletedAt))
    .all()

  for (const row of deletedProjects) {
    const deletedAt = row.deletedAt ?? 0
    items.push({
      kind: 'project',
      id: row.id,
      projectId: row.id,
      projectName: row.name,
      chapterNo: null,
      title: row.name,
      draftCount: 0,
      deletedAt,
      expiresAt: expiresAtFor(deletedAt, retention)
    })
  }

  // 章节级只列「项目仍在」的，避免项目删除后回收站一片噪音
  const deletedBriefs = db
    .select({
      id: chapterBrief.id,
      projectId: chapterBrief.projectId,
      chapterNo: chapterBrief.chapterNo,
      title: chapterBrief.title,
      deletedAt: chapterBrief.deletedAt,
      projectName: project.name
    })
    .from(chapterBrief)
    .innerJoin(project, eq(chapterBrief.projectId, project.id))
    .where(and(isNotNull(chapterBrief.deletedAt), isNull(project.deletedAt)))
    .orderBy(desc(chapterBrief.deletedAt))
    .all()

  for (const row of deletedBriefs) {
    const deletedAt = row.deletedAt ?? 0
    const drafts = db
      .select({ id: chapterDraft.id })
      .from(chapterDraft)
      .where(
        and(
          eq(chapterDraft.projectId, row.projectId),
          eq(chapterDraft.chapterNo, row.chapterNo),
          isNotNull(chapterDraft.deletedAt)
        )
      )
      .all()
    items.push({
      kind: 'chapter',
      id: row.id,
      projectId: row.projectId,
      projectName: row.projectName,
      chapterNo: row.chapterNo,
      title: row.title || `第 ${row.chapterNo} 章`,
      draftCount: drafts.length,
      deletedAt,
      expiresAt: expiresAtFor(deletedAt, retention)
    })
  }

  return items.sort((a, b) => b.deletedAt - a.deletedAt)
}

/** 恢复项目 */
function restoreProject(id: number): { ok: boolean } {
  getDb().update(project).set({ deletedAt: null, updatedAt: Date.now() }).where(eq(project.id, id)).run()
  return { ok: true }
}

/** 恢复章节；章节号被占用时自动排到末尾（不覆盖） */
function restoreChapter(id: number): { ok: boolean; chapterNo: number } {
  const db = getDb()
  const row = db.select().from(chapterBrief).where(eq(chapterBrief.id, id)).get()
  if (!row) throw new Error('该章节不在回收站中')

  const parent = db.select().from(project).where(eq(project.id, row.projectId)).get()
  if (!parent) throw new Error('所属项目已被彻底删除，无法恢复该章节')
  if (parent.deletedAt) {
    // 项目在回收站里：先把项目一并恢复，避免恢复出「孤儿章节」
    db.update(project).set({ deletedAt: null, updatedAt: Date.now() }).where(eq(project.id, parent.id)).run()
  }

  const occupied = db
    .select({ id: chapterBrief.id })
    .from(chapterBrief)
    .where(
      and(
        eq(chapterBrief.projectId, row.projectId),
        eq(chapterBrief.chapterNo, row.chapterNo),
        isNull(chapterBrief.deletedAt)
      )
    )
    .get()

  let chapterNo = row.chapterNo
  if (occupied) {
    const top = db
      .select({ value: max(chapterBrief.chapterNo) })
      .from(chapterBrief)
      .where(and(eq(chapterBrief.projectId, row.projectId), isNull(chapterBrief.deletedAt)))
      .get()
    chapterNo = (top?.value ?? 0) + 1
  }

  const oldNo = row.chapterNo
  const stamp = row.deletedAt
  db.update(chapterBrief)
    .set({ chapterNo, deletedAt: null, updatedAt: Date.now() })
    .where(eq(chapterBrief.id, id))
    .run()

  // 同一批被删除的草稿跟随章节号迁移
  const drafts = db
    .select()
    .from(chapterDraft)
    .where(
      and(
        eq(chapterDraft.projectId, row.projectId),
        eq(chapterDraft.chapterNo, oldNo),
        stamp === null ? isNotNull(chapterDraft.deletedAt) : eq(chapterDraft.deletedAt, stamp)
      )
    )
    .all()
  for (const draft of drafts) {
    db.update(chapterDraft)
      .set({ chapterNo, deletedAt: null, updatedAt: Date.now() })
      .where(eq(chapterDraft.id, draft.id))
      .run()
  }

  return { ok: true, chapterNo }
}

export function restoreTrash(item: {
  kind: 'project' | 'chapter'
  id: number
}): { ok: boolean; chapterNo?: number } {
  return item.kind === 'project' ? restoreProject(item.id) : restoreChapter(item.id)
}

/** 彻底删除单条 */
export function purgeTrash(item: { kind: 'project' | 'chapter'; id: number }): void {
  const db = getDb()
  if (item.kind === 'project') {
    // 外键 ON DELETE CASCADE 会清理 brief / draft / memory / pipeline 等从属数据
    db.delete(project).where(eq(project.id, item.id)).run()
    return
  }
  const row = db.select().from(chapterBrief).where(eq(chapterBrief.id, item.id)).get()
  if (!row) return
  db.delete(chapterDraft)
    .where(and(eq(chapterDraft.projectId, row.projectId), eq(chapterDraft.chapterNo, row.chapterNo)))
    .run()
  db.delete(chapterBrief).where(eq(chapterBrief.id, item.id)).run()
}

/** 清空回收站 */
export function emptyTrash(): { removed: number } {
  const items = listTrash()
  for (const item of items) purgeTrash({ kind: item.kind, id: item.id })
  return { removed: items.length }
}

/** 到期自动清理（启动时 + 每天一次） */
export function cleanupExpiredTrash(): number {
  const retention = getSettings().trashRetentionDays
  if (retention === 0) return 0
  const cutoff = Date.now() - retention * DAY_MS
  const db = getDb()
  const expiredProjects = db
    .select({ id: project.id })
    .from(project)
    .where(and(isNotNull(project.deletedAt), lt(project.deletedAt, cutoff)))
    .all()
  const expiredBriefs = db
    .select({ id: chapterBrief.id })
    .from(chapterBrief)
    .where(and(isNotNull(chapterBrief.deletedAt), lt(chapterBrief.deletedAt, cutoff)))
    .orderBy(asc(chapterBrief.deletedAt))
    .all()

  let removed = 0
  for (const row of expiredBriefs) {
    purgeTrash({ kind: 'chapter', id: row.id })
    removed += 1
  }
  for (const row of expiredProjects) {
    purgeTrash({ kind: 'project', id: row.id })
    removed += 1
  }
  return removed
}