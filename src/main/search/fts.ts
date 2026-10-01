import type { SearchSource } from '@shared/types'
import { getRawSqlite } from '../db/client'

/**
 * FTS5 原语封装（M8 §5.1）。
 *
 * 三张虚拟表（fts_draft / fts_brief / fts_memory）的 DDL 与触发器在 migrations v7，
 * 这里只做「可用性探测 + 查询 + 写入/删除」的原生 SQL 封装。
 * 触发器的存在意味着正常路径下增量同步由 SQLite 自动完成；写入/删除原语用于回填与修复。
 */

export type FtsSource = SearchSource

const FTS_TABLE: Record<FtsSource, string> = {
  draft: 'fts_draft',
  brief: 'fts_brief',
  memory: 'fts_memory'
}

/** 各 FTS 表的可检索文本列（用于片段构建与回填） */
export const FTS_TEXT_COLUMNS: Record<FtsSource, string[]> = {
  draft: ['content'],
  brief: ['title', 'purpose', 'key_events', 'characters', 'suspense_hook', 'scene_beats'],
  memory: ['summary']
}

export interface FtsRow {
  rowid: number
  chapterNo: number
  projectId: number
  texts: Record<string, string>
}

let trigramCache: boolean | null = null

/**
 * FTS5 trigram 分词器可用性探测（**实测**，不想当然）。
 * 用临时表建一次再删；失败说明该 SQLite 构建不支持 trigram。
 */
export function probeTrigram(): boolean {
  if (trigramCache !== null) return trigramCache
  const raw = getRawSqlite()
  try {
    raw.exec("CREATE VIRTUAL TABLE IF NOT EXISTS temp.__inkwell_fts_probe USING fts5(x, tokenize='trigram')")
    raw.exec('DROP TABLE IF EXISTS temp.__inkwell_fts_probe')
    trigramCache = true
  } catch {
    try {
      raw.exec('DROP TABLE IF EXISTS temp.__inkwell_fts_probe')
    } catch {
      // 清理失败不影响结论
    }
    trigramCache = false
  }
  return trigramCache
}

/** FTS 三张表是否已就绪（老库未迁移 / trigram 不可用时退回 LIKE 扫描） */
export function ftsAvailable(): boolean {
  try {
    const row = getRawSqlite()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'fts_draft'")
      .get() as { name: string } | undefined
    return Boolean(row) && probeTrigram()
  } catch {
    return false
  }
}

/** FTS5 MATCH 查询，返回命中的 rowid / 章号 / 项目与命中行的文本列 */
export function searchFts(
  source: FtsSource,
  matchExpr: string,
  projectId: number | undefined,
  limit: number
): FtsRow[] {
  const table = FTS_TABLE[source]
  const cols = FTS_TEXT_COLUMNS[source]
  const select = ['rowid', 'chapter_no', 'project_id', ...cols].join(', ')
  const whereProject = projectId === undefined ? '' : ' AND project_id = ?'
  const sql = `SELECT ${select} FROM ${table} WHERE ${table} MATCH ?${whereProject} LIMIT ?`
  const params: unknown[] = projectId === undefined ? [matchExpr, limit] : [matchExpr, projectId, limit]

  const rows = getRawSqlite().prepare(sql).all(...params) as Array<Record<string, unknown>>
  return rows.map((row) => ({
    rowid: Number(row.rowid),
    chapterNo: Number(row.chapter_no),
    projectId: Number(row.project_id),
    texts: Object.fromEntries(cols.map((col) => [col, String(row[col] ?? '')]))
  }))
}

/** 写入 / 更新一条 FTS 记录（回填或修复用） */
export function indexFtsRow(source: FtsSource, rowid: number, values: Record<string, string>, meta: { projectId: number; chapterNo: number }): void {
  const table = FTS_TABLE[source]
  const cols = [...FTS_TEXT_COLUMNS[source], 'chapter_no', 'project_id']
  const placeholders = cols.map(() => '?').join(', ')
  const params = [...FTS_TEXT_COLUMNS[source].map((col) => values[col] ?? ''), meta.chapterNo, meta.projectId]
  getRawSqlite()
    .prepare(`INSERT INTO ${table}(rowid, ${cols.join(', ')}) VALUES (?, ${placeholders})`)
    .run(rowid, ...params)
}

/** 从 FTS 移除一条记录 */
export function removeFtsRow(source: FtsSource, rowid: number): void {
  getRawSqlite().prepare(`DELETE FROM ${FTS_TABLE[source]} WHERE rowid = ?`).run(rowid)
}