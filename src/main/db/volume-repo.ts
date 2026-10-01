import { and, asc, eq, isNull } from 'drizzle-orm'
import type { Volume, VolumeSaveInput } from '@shared/types'
import { getDb } from './client'
import { chapterBrief, volume } from './schema'

/**
 * A5 分卷（计划书 §5.1 volume）。
 * 分卷此前只是 chapter_brief.volume_idx 的一个数字，卷标题 / 卷梗概无处安放；
 * 导出成书与章节导航都只能显示「第 N 卷」。这里补齐真正的卷实体。
 */

type VolumeRow = typeof volume.$inferSelect

function toDto(row: VolumeRow, stats?: { from: number; to: number; count: number }): Volume {
  return {
    id: row.id,
    projectId: row.projectId,
    idx: row.idx,
    title: row.title,
    synopsis: row.synopsis,
    fromChapter: stats?.from ?? 0,
    toChapter: stats?.to ?? 0,
    chapterCount: stats?.count ?? 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

/** 各卷的章节区间（派生数据，不落库） */
function chapterStats(projectId: number): Map<number, { from: number; to: number; count: number }> {
  const rows = getDb()
    .select({ volumeIdx: chapterBrief.volumeIdx, chapterNo: chapterBrief.chapterNo })
    .from(chapterBrief)
    .where(and(eq(chapterBrief.projectId, projectId), isNull(chapterBrief.deletedAt)))
    .all()
  const map = new Map<number, { from: number; to: number; count: number }>()
  for (const row of rows) {
    const current = map.get(row.volumeIdx)
    if (!current) map.set(row.volumeIdx, { from: row.chapterNo, to: row.chapterNo, count: 1 })
    else {
      current.from = Math.min(current.from, row.chapterNo)
      current.to = Math.max(current.to, row.chapterNo)
      current.count += 1
    }
  }
  return map
}

export function listVolumes(projectId: number): Volume[] {
  const stats = chapterStats(projectId)
  return getDb()
    .select()
    .from(volume)
    .where(eq(volume.projectId, projectId))
    .orderBy(asc(volume.idx))
    .all()
    .map((row) => toDto(row, stats.get(row.idx)))
}

/** 新建 / 更新一卷（按 projectId + idx 唯一） */
export function saveVolume(input: VolumeSaveInput): Volume[] {
  const db = getDb()
  const now = Date.now()
  const existing = input.id
    ? db.select().from(volume).where(eq(volume.id, input.id)).get()
    : db
        .select()
        .from(volume)
        .where(and(eq(volume.projectId, input.projectId), eq(volume.idx, input.idx)))
        .get()

  if (existing) {
    db.update(volume)
      .set({
        idx: input.idx,
        title: input.title ?? existing.title,
        synopsis: input.synopsis ?? existing.synopsis,
        updatedAt: now
      })
      .where(eq(volume.id, existing.id))
      .run()
  } else {
    db.insert(volume)
      .values({
        projectId: input.projectId,
        idx: input.idx,
        title: input.title ?? '',
        synopsis: input.synopsis ?? '',
        createdAt: now,
        updatedAt: now
      })
      .run()
  }
  return listVolumes(input.projectId)
}

export function removeVolume(id: number): Volume[] {
  const db = getDb()
  const row = db.select().from(volume).where(eq(volume.id, id)).get()
  if (!row) return []
  db.delete(volume).where(eq(volume.id, id)).run()
  return listVolumes(row.projectId)
}

/** 卷标题映射：导出时把「第 N 卷」换成用户写的卷名 */
export function volumeTitles(projectId: number): Map<number, string> {
  const map = new Map<number, string>()
  for (const row of getDb().select().from(volume).where(eq(volume.projectId, projectId)).all()) {
    if (row.title.trim()) map.set(row.idx, row.title.trim())
  }
  return map
}

/** 确保某个卷号存在（生成 / 导入细纲时自动补一条卷记录，避免出现「无主章节」） */
export function ensureVolume(projectId: number, idx: number): void {
  const db = getDb()
  const existing = db
    .select({ id: volume.id })
    .from(volume)
    .where(and(eq(volume.projectId, projectId), eq(volume.idx, idx)))
    .get()
  if (existing) return
  const now = Date.now()
  db.insert(volume)
    .values({ projectId, idx, title: '', synopsis: '', createdAt: now, updatedAt: now })
    .run()
}
