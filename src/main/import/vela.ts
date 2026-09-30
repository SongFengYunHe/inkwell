import Database from 'better-sqlite3'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Project, VelaImportSummary } from '@shared/types'
import { createProject, getProject, saveBrief, saveDraft, updateProject } from '../db/repositories'

/**
 * 导入 Vela 工程（计划书 §5.3 / §10 M5）。
 * Vela 与本项目的数据模型同源（本项目即参考 Vela 设计），因此按表名 + 列名做容错映射，
 * 不同小版本的表结构差异通过候选列名兜底。
 */

export type VelaImportResult = VelaImportSummary

type Row = Record<string, unknown>

/** 把用户选择的路径解析为 vela 数据库文件 */
export function resolveVelaDbPath(input: string): string {
  if (!existsSync(input)) throw new Error(`路径不存在：${input}`)
  const stat = statSync(input)
  if (stat.isDirectory()) {
    const candidate = join(input, 'vela.db')
    if (!existsSync(candidate)) throw new Error(`该目录下没有找到 vela.db：${input}`)
    return candidate
  }
  return input
}

function listTables(db: Database.Database): string[] {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>
  return rows.map((row) => row.name)
}

/** 在候选列名中取第一个存在的值 */
function pick(row: Row, candidates: string[], fallback: unknown = ''): unknown {
  for (const name of candidates) {
    if (row[name] !== undefined && row[name] !== null) return row[name]
  }
  return fallback
}

function asText(value: unknown): string {
  if (value === undefined || value === null) return ''
  return String(value)
}

function asNumber(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** Vela 里 JSON 字段可能是字符串也可能是已被解析的对象 */
function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => asText(item)).filter(Boolean)
  const text = asText(value).trim()
  if (!text) return []
  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) return parsed.map((item) => asText(item)).filter(Boolean)
  } catch {
    // 退化为分隔符切分
  }
  return text
    .split(/[\n,，、;；]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

/** 选表：优先精确名，其次在全部表里按关键字模糊匹配 */
function findTable(tables: string[], exact: string[], fuzzy: string[]): string | null {
  for (const name of exact) {
    if (tables.includes(name)) return name
  }
  const lower = tables.map((name) => ({ name, lower: name.toLowerCase() }))
  for (const keyword of fuzzy) {
    const hit = lower.find((item) => item.lower.includes(keyword))
    if (hit) return hit.name
  }
  return null
}

function readRows(db: Database.Database, table: string): Row[] {
  return db.prepare(`SELECT * FROM ${table}`).all() as Row[]
}

/**
 * 导入一个 Vela 数据库文件，返回新建的本项目 Project。
 * 只读取源库，不做任何写入。
 */
export function importVelaDatabase(input: string): VelaImportResult {
  const dbPath = resolveVelaDbPath(input)
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })

  try {
    const tables = listTables(db)
    const projectTable = findTable(tables, ['project_core', 'project'], ['project', 'core'])
    if (!projectTable) throw new Error('不是有效的 Vela 工程：缺少 project_core 表')

    const projectRow = (readRows(db, projectTable)[0] ?? {}) as Row
    const name = asText(pick(projectRow, ['name', 'title', 'book_name'])) || '导入的 Vela 工程'

    const project = createProject({
      name,
      genre: asText(pick(projectRow, ['genre', 'category'])),
      totalChapters: asNumber(pick(projectRow, ['total_chapters', 'totalChapters', 'chapter_count', 'chapters'], 50), 50),
      wordsPerChapter: asNumber(
        pick(projectRow, ['words_per_chapter', 'wordsPerChapter', 'word_count_per_chapter'], 3000),
        3000
      ),
      premise: asText(pick(projectRow, ['premise', 'story_premise', 'one_liner', 'idea']))
    })

    // 补齐设定字段
    const patch: Record<string, string> = {
      worldbuilding: asText(pick(projectRow, ['worldbuilding', 'world_building', 'world_setting', 'setting'])),
      protagonist: asText(pick(projectRow, ['protagonist', 'main_character', 'hero'])),
      goldenFinger: asText(pick(projectRow, ['golden_finger', 'goldenFinger', 'cheat', 'special_power'])),
      style: asText(pick(projectRow, ['style', 'writing_style', 'tone'])),
      globalGuidance: asText(pick(projectRow, ['global_guidance', 'guidance', 'instruction'])),
      coreOutline: asText(pick(projectRow, ['core_outline', 'outline', 'main_outline', 'story_outline']))
    }
    applyProjectPatch(project.id, patch)

    // 细纲
    let briefs = 0
    const briefTable = findTable(tables, ['blueprints', 'chapter_brief'], ['blueprint', 'brief'])
    if (briefTable) {
      for (const row of readRows(db, briefTable)) {
        const chapterNo = asNumber(pick(row, ['chapter_no', 'chapter_number', 'chapterNo', 'chapter_index', 'no']), 0)
        if (chapterNo <= 0) continue
        saveBrief({
          projectId: project.id,
          chapterNo,
          volumeIdx: asNumber(pick(row, ['volume_idx', 'volume_index', 'volume_no', 'volume'], 1), 1),
          title: asText(pick(row, ['title', 'chapter_title', 'name'])),
          role: asText(pick(row, ['role', 'beat_role', 'type'])),
          purpose: asText(pick(row, ['purpose', 'goal', 'intent'])),
          keyEvents: asText(pick(row, ['key_events', 'keyEvents', 'events', 'plot'])),
          characters: asStringArray(pick(row, ['characters', 'characters_json', 'cast', 'roles'])),
          sceneBeats: asStringArray(pick(row, ['scene_beats', 'sceneBeats', 'beats', 'scenes'])),
          suspenseHook: asText(pick(row, ['suspense_hook', 'suspenseHook', 'hook', 'cliffhanger'])),
          userGuidance: asText(pick(row, ['user_guidance', 'userGuidance', 'notes']))
        })
        briefs += 1
      }
    }

    // 正文
    let drafts = 0
    const draftTable = findTable(tables, ['drafts', 'chapter_draft'], ['draft'])
    if (draftTable) {
      for (const row of readRows(db, draftTable)) {
        const chapterNo = asNumber(pick(row, ['chapter_no', 'chapter_number', 'chapterNo', 'chapter_index', 'no']), 0)
        const content = asText(pick(row, ['content', 'text', 'body', 'final_text']))
        if (chapterNo <= 0 || !content.trim()) continue
        saveDraft({
          projectId: project.id,
          chapterNo,
          version: asNumber(pick(row, ['version', 'revision', 'rev'], 1), 1),
          status: asText(pick(row, ['status', 'state'])) || 'draft',
          source: asText(pick(row, ['source', 'origin', 'type'])) || 'write',
          content
        })
        drafts += 1
      }
    }

    const created = applyProjectPatch(project.id, {})
    return { project: created, briefs, drafts, tables }
  } finally {
    db.close()
  }
}

/** 局部更新项目字段（仅写入非空值），返回最新项目 */
function applyProjectPatch(id: number, patch: Record<string, string>): Project {
  const entries = Object.entries(patch).filter(([, value]) => value.trim())
  if (entries.length > 0) {
    return updateProject({ id, ...Object.fromEntries(entries) })
  }
  const current = getProject(id)
  if (!current) throw new Error(`项目不存在：${id}`)
  return current
}