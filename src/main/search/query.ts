import type { SearchGroup, SearchHit, SearchQueryInput, SearchResult, SearchSource } from '@shared/types'
import { getRawSqlite } from '../db/client'
import { FTS_TEXT_COLUMNS, ftsAvailable, searchFts } from './fts'

/**
 * 统一检索入口（M8 §5.1）：跨「细纲 / 正文 / 记忆」，返回按章分组的结果。
 *
 * 混合策略（关键，务必按实测结论落地）：
 * - 查询串的正向词**全部 ≥ 3 个字符**时走 FTS5 MATCH（trigram 分词）。
 * - 存在 1~2 字符的短词（中文里两字词极常见，如「古剑」「山道」）时，
 *   trigram 无法切出三元组、命中为 0，**回退到 LIKE '%x%' 扫描**（单本书数据量完全可接受）。
 * - 用户输入的 `-排除词` 在 FTS 模式翻译为 FTS5 的 `NOT`，在 LIKE 模式翻译为 `NOT LIKE`；
 *   `"短语"` 原样保留为短语查询。
 */

const DEFAULT_LIMIT = 50
/** 每个来源最多取多少条（再统一截断到 limit） */
const PER_SOURCE_CAP = 200
const SNIPPET_WINDOW = 36

interface ParsedQuery {
  positives: string[]
  exclusions: string[]
}

/** 解析用户查询：`"短语"` 保留、`-词` 作为排除、其余按空白分词 */
export function parseQuery(raw: string): ParsedQuery {
  const positives: string[] = []
  const exclusions: string[] = []

  const phraseRe = /"([^"]+)"/g
  let match: RegExpExecArray | null
  while ((match = phraseRe.exec(raw)) !== null) {
    const phrase = match[1].trim()
    if (phrase) positives.push(phrase)
  }

  const rest = raw.replace(phraseRe, ' ')
  for (const token of rest.split(/\s+/)) {
    const term = token.trim()
    if (!term) continue
    if (term.startsWith('-') && term.length > 1) exclusions.push(term.slice(1))
    else positives.push(term)
  }

  return { positives, exclusions }
}

/** 正向词全部 ≥ 3 字符才走 FTS，否则 LIKE 回退 */
function useFtsMatch(positives: string[]): boolean {
  return positives.length > 0 && positives.every((term) => term.length >= 3)
}

function buildFtsMatch(positives: string[], exclusions: string[]): string {
  const quote = (term: string): string => `"${term.replace(/"/g, '""')}"`
  const parts = positives.map(quote)
  for (const term of exclusions) parts.push(`NOT ${quote(term)}`)
  return parts.join(' ')
}

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 单次替换，命中的词用 \u0001 / \u0002 包裹，避免嵌套标记 */
function markAll(segment: string, needles: string[]): string {
  const valid = needles.filter(Boolean).sort((a, b) => b.length - a.length)
  if (valid.length === 0) return segment
  const combined = new RegExp(valid.map(escapeRegExp).join('|'), 'gi')
  return segment.replace(combined, (matched) => `\u0001${matched}\u0002`)
}

/** 以首个命中词为中心截取片段并高亮 */
function buildSnippet(text: string, needles: string[]): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (!compact) return ''

  const lower = compact.toLowerCase()
  let bestIndex = -1
  let hitLength = 0
  for (const needle of needles) {
    const index = lower.indexOf(needle.toLowerCase())
    if (index >= 0 && (bestIndex === -1 || index < bestIndex)) {
      bestIndex = index
      hitLength = needle.length
    }
  }

  if (bestIndex === -1) return compact.slice(0, SNIPPET_WINDOW * 2)
  const start = Math.max(0, bestIndex - SNIPPET_WINDOW)
  const end = Math.min(compact.length, bestIndex + hitLength + SNIPPET_WINDOW)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < compact.length ? '…' : ''
  return `${prefix}${markAll(compact.slice(start, end), needles)}${suffix}`
}

interface RawHit {
  rowid: number
  chapterNo: number
  projectId: number
  texts: Record<string, string>
}

/** LIKE 回退：直接扫描源表（数据量是单本书，可接受） */
function searchLikeSource(
  source: SearchSource,
  parsed: ParsedQuery,
  projectId: number | undefined,
  limit: number
): RawHit[] {
  const config: Record<SearchSource, { table: string; expr: string; columns: string[]; deletedGuard: string }> = {
    draft: { table: 'chapter_draft', expr: 'content', columns: ['content'], deletedGuard: 'deleted_at IS NULL' },
    brief: {
      table: 'chapter_brief',
      expr:
        "(coalesce(title,'') || ' ' || coalesce(purpose,'') || ' ' || coalesce(key_events,'') || ' ' ||" +
        " coalesce(characters,'') || ' ' || coalesce(suspense_hook,'') || ' ' || coalesce(scene_beats,''))",
      columns: FTS_TEXT_COLUMNS.brief,
      deletedGuard: 'deleted_at IS NULL'
    },
    memory: { table: 'memory_chapter', expr: 'summary', columns: ['summary'], deletedGuard: '1 = 1' }
  }

  const { table, expr, columns, deletedGuard } = config[source]
  const conditions: string[] = [deletedGuard]
  const params: unknown[] = []

  if (projectId !== undefined) {
    conditions.push('project_id = ?')
    params.push(projectId)
  }
  for (const term of parsed.positives) {
    conditions.push(`${expr} LIKE ? ESCAPE '\\'`)
    params.push(`%${escapeLike(term)}%`)
  }
  for (const term of parsed.exclusions) {
    conditions.push(`${expr} NOT LIKE ? ESCAPE '\\'`)
    params.push(`%${escapeLike(term)}%`)
  }

  const select = ['id AS rowid', 'chapter_no', 'project_id', ...columns].join(', ')
  const sql = `SELECT ${select} FROM ${table} WHERE ${conditions.join(' AND ')} LIMIT ?`
  params.push(limit)

  const rows = getRawSqlite().prepare(sql).all(...params) as Array<Record<string, unknown>>
  return rows.map((row) => ({
    rowid: Number(row.rowid),
    chapterNo: Number(row.chapter_no),
    projectId: Number(row.project_id),
    texts: Object.fromEntries(columns.map((col) => [col, String(row[col] ?? '')]))
  }))
}

function combineTexts(source: SearchSource, texts: Record<string, string>): string {
  return FTS_TEXT_COLUMNS[source].map((col) => texts[col] ?? '').join(' ')
}

const SOURCE_RANK: Record<SearchSource, number> = { brief: 0, draft: 1, memory: 2 }
const SOURCES: SearchSource[] = ['brief', 'draft', 'memory']

export function search(input: SearchQueryInput): SearchResult {
  const raw = input.query.trim()
  const limit = input.limit ?? DEFAULT_LIMIT
  const parsed = parseQuery(raw)

  // 无任何正向词（例如只输入了排除词）没有可检索锚点，直接返回空
  if (parsed.positives.length === 0) {
    return { query: raw, mode: 'like', groups: [], total: 0 }
  }

  const mode: 'fts' | 'like' = ftsAvailable() && useFtsMatch(parsed.positives) ? 'fts' : 'like'

  const collected: Array<RawHit & { source: SearchSource }> = []
  for (const source of SOURCES) {
    const hits =
      mode === 'fts'
        ? searchFts(source, buildFtsMatch(parsed.positives, parsed.exclusions), input.projectId, PER_SOURCE_CAP)
        : searchLikeSource(source, parsed, input.projectId, PER_SOURCE_CAP)
    for (const hit of hits) collected.push({ ...hit, source })
  }

  collected.sort((a, b) => {
    if (a.projectId !== b.projectId) return a.projectId - b.projectId
    if (a.chapterNo !== b.chapterNo) return a.chapterNo - b.chapterNo
    if (SOURCE_RANK[a.source] !== SOURCE_RANK[b.source]) return SOURCE_RANK[a.source] - SOURCE_RANK[b.source]
    return a.rowid - b.rowid
  })

  const trimmed = collected.slice(0, limit)
  const groups: SearchGroup[] = []
  const index = new Map<string, SearchGroup>()

  for (const hit of trimmed) {
    const key = `${hit.projectId}:${hit.chapterNo}`
    let group = index.get(key)
    if (!group) {
      group = { projectId: hit.projectId, chapterNo: hit.chapterNo, hits: [] }
      index.set(key, group)
      groups.push(group)
    }
    const searchHit: SearchHit = {
      source: hit.source,
      projectId: hit.projectId,
      chapterNo: hit.chapterNo,
      snippet: buildSnippet(combineTexts(hit.source, hit.texts), parsed.positives)
    }
    group.hits.push(searchHit)
  }

  return { query: raw, mode, groups, total: groups.reduce((sum, group) => sum + group.hits.length, 0) }
}