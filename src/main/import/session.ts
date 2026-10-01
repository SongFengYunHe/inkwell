import { and, asc, eq } from 'drizzle-orm'
import type {
  BriefFieldKey,
  ChapterBrief,
  ImportAction,
  ImportAnalyzeInput,
  ImportBriefPayload,
  ImportFieldDiff,
  ImportItem,
  ImportSession,
  ImportStats,
  ImportUpdateItemInput,
  ImportUpdateItemsInput,
  ImportValidateInput,
  ImportProgress,
  ParsedChapter
} from '@shared/types'
import { getDb } from '../db/client'
import { importItem, importSession } from '../db/schema'
import { deleteBrief, listBriefs, listDrafts, saveBrief } from '../db/repositories'
import { isQuitting } from '../lifecycle'
import { readSourceFromPath, readSourceFromText, type ImportKind } from './text'
import { parseOutline, validateTree } from './outline/parser'
import { DEFAULT_REQUIRED_FIELDS, FIELD_LABELS } from './outline/patterns'
import { enrichWithLlm } from './outline/llm'

/**
 * 导入暂存与提交（计划书 §4.5 / §4.7）：
 *   analyze → 暂存 import_session / import_item（不落 chapter_brief）
 *   差异预览 → updateItem / revalidate
 *   commit → 仅落库 enabled 的条目；更新前先把旧细纲移入回收站（软删除）
 *   cancel → 标记 cancelled，不落库
 */

const DIFF_FIELDS: BriefFieldKey[] = [
  'purpose',
  'keyEvents',
  'characters',
  'suspenseHook',
  'sceneBeats',
  'userGuidance',
  'notes'
]

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function assertWritable(): void {
  if (isQuitting()) throw new Error('应用正在退出，已拒绝本次写入')
}

function splitList(value: string): string[] {
  return value
    .split(/[\n,，、;；]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function splitLines(value: string): string[] {
  return value
    .split(/\n/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function toPayload(projectId: number, chapter: ParsedChapter): ImportBriefPayload {
  return {
    projectId,
    chapterNo: chapter.chapterNo,
    volumeIdx: chapter.volumeIdx,
    title: chapter.title,
    role: '',
    purpose: chapter.fields.purpose.value,
    keyEvents: chapter.fields.keyEvents.value,
    characters: splitList(chapter.fields.characters.value),
    sceneBeats: splitLines(chapter.fields.sceneBeats.value),
    suspenseHook: chapter.fields.suspenseHook.value,
    userGuidance: chapter.fields.userGuidance.value,
    notes: chapter.fields.notes.value
  }
}

function payloadValue(payload: ImportBriefPayload, field: BriefFieldKey): string {
  switch (field) {
    case 'characters':
      return payload.characters.join('、')
    case 'sceneBeats':
      return payload.sceneBeats.join('\n')
    default:
      return payload[field]
  }
}

function briefValue(brief: ChapterBrief, field: BriefFieldKey): string {
  switch (field) {
    case 'characters':
      return brief.characters.join('、')
    case 'sceneBeats':
      return brief.sceneBeats.join('\n')
    default:
      return brief[field]
  }
}

function buildDiff(existing: ChapterBrief | undefined, payload: ImportBriefPayload): ImportFieldDiff[] {
  return DIFF_FIELDS.map((field) => {
    const oldValue = existing ? briefValue(existing, field) : ''
    const newValue = payloadValue(payload, field)
    return { field, label: FIELD_LABELS[field], oldValue, newValue, changed: oldValue !== newValue }
  })
}

function heuristicFieldsOf(chapter: ParsedChapter): BriefFieldKey[] {
  return (Object.keys(chapter.fields) as BriefFieldKey[]).filter((key) => chapter.fields[key].heuristic)
}

function computeStats(items: ImportItem[]): ImportStats {
  return {
    total: items.length,
    create: items.filter((item) => item.action === 'create').length,
    update: items.filter((item) => item.action === 'update').length,
    conflict: items.filter((item) => item.action === 'conflict').length,
    skip: items.filter((item) => item.action === 'skip').length
  }
}

/** 组装一次导入会话的条目（含 action / enabled / diff） */
function buildItems(
  sessionId: string,
  projectId: number | null,
  chapters: ParsedChapter[]
): ImportItem[] {
  const existingBriefs = projectId !== null ? listBriefs(projectId) : []
  const briefByNo = new Map(existingBriefs.map((brief) => [brief.chapterNo, brief]))
  const hasDraftNos = new Set(
    projectId !== null
      ? listDrafts(projectId)
          .filter((draft) => draft.content.trim().length > 0)
          .map((draft) => draft.chapterNo)
      : []
  )

  return chapters.map((chapter) => {
    const payload = toPayload(projectId ?? 0, chapter)
    const existing = briefByNo.get(chapter.chapterNo)
    const hasDraft = hasDraftNos.has(chapter.chapterNo)

    let action: ImportAction = 'create'
    if (existing) action = hasDraft ? 'conflict' : 'update'
    const enabled = action === 'create' || action === 'update'

    return {
      id: makeId('item'),
      sessionId,
      chapterNo: chapter.chapterNo,
      volumeIdx: chapter.volumeIdx,
      title: chapter.title,
      action,
      enabled,
      payload,
      diff: buildDiff(existing, payload),
      heuristicFields: heuristicFieldsOf(chapter),
      hasDraft
    }
  })
}

function persistSession(
  id: string,
  projectId: number | null,
  sourcePath: string,
  sourceKind: string,
  tree: ImportSession['tree'],
  validation: ImportSession['validation'],
  warnings: string[],
  encoding: string,
  items: ImportItem[]
): void {
  const db = getDb()
  const now = Date.now()
  // 会话头 + 逐章条目必须原子写入：中途失败留下「0 条目的 staging 会话」会污染导入列表
  db.transaction(() => {
    db.insert(importSession)
      .values({
        id,
        projectId: projectId === null ? null : String(projectId),
        sourcePath,
        sourceKind,
        parsedTree: tree,
        validation,
        warnings,
        encoding,
        createdAt: now,
        status: 'staging'
      })
      .run()

    if (items.length > 0) {
      db.insert(importItem)
        .values(
          items.map((item) => ({
            id: item.id,
            sessionId: id,
            chapterNo: item.chapterNo,
            volumeIdx: item.volumeIdx,
            title: item.title,
            action: item.action,
            enabled: item.enabled,
            payload: item.payload,
            diff: item.diff,
            heuristicFields: item.heuristicFields,
            hasDraft: item.hasDraft
          }))
        )
        .run()
    }
  })
  pruneImportSessions()
}

/**
 * 暂存保留期：未完成的会话留 3 天；已结束（committed / cancelled）的留 24 小时。
 * 导入会话此前只增不减，会让书库文件无限膨胀；但也不能「一提交就删」——
 * 提交后的会话状态仍要被读取（例如「提交后状态为 committed」这类断言与刷新恢复）。
 */
const SESSION_STAGING_KEEP_MS = 3 * 24 * 60 * 60 * 1000
const SESSION_FINISHED_KEEP_MS = 24 * 60 * 60 * 1000

/** 清理过期的导入暂存（含逐章条目，靠外键级联） */
export function pruneImportSessions(now = Date.now()): number {
  const db = getDb()
  const rows = db.select().from(importSession).all()
  let removed = 0
  db.transaction(() => {
    for (const row of rows) {
      const age = now - row.createdAt
      const expired = row.status === 'staging' ? age > SESSION_STAGING_KEEP_MS : age > SESSION_FINISHED_KEEP_MS
      if (!expired) continue
      db.delete(importSession).where(eq(importSession.id, row.id)).run()
      removed += 1
    }
  })
  return removed
}

/** 从暂存表读取完整会话 */
export function getSession(id: string): ImportSession | null {
  const db = getDb()
  const row = db.select().from(importSession).where(eq(importSession.id, id)).get()
  if (!row) return null

  const itemRows = db
    .select()
    .from(importItem)
    .where(eq(importItem.sessionId, id))
    .orderBy(asc(importItem.chapterNo))
    .all()

  const items: ImportItem[] = itemRows.map((item) => ({
    id: item.id,
    sessionId: item.sessionId,
    chapterNo: item.chapterNo,
    volumeIdx: item.volumeIdx,
    title: item.title,
    action: item.action as ImportAction,
    enabled: item.enabled,
    payload: item.payload,
    diff: item.diff,
    heuristicFields: item.heuristicFields,
    hasDraft: item.hasDraft
  }))

  return {
    id: row.id,
    projectId: row.projectId === null ? null : Number(row.projectId),
    sourcePath: row.sourcePath,
    sourceKind: row.sourceKind,
    tree: row.parsedTree,
    validation: row.validation,
    items,
    stats: computeStats(items),
    status: row.status as ImportSession['status'],
    warnings: row.warnings,
    encoding: row.encoding || undefined,
    createdAt: row.createdAt
  }
}

export interface AnalyzeOptions {
  onProgress?: (progress: ImportProgress) => void
}

/** 解析入口：从文件路径或粘贴文本创建导入会话 */
export async function analyzeImport(input: ImportAnalyzeInput, options: AnalyzeOptions = {}): Promise<ImportSession> {
  assertWritable()
  const sessionId = makeId('imp')
  const projectId = input.projectId ?? null
  const emit = (phase: ImportProgress['phase'], message: string, percent: number): void =>
    options.onProgress?.({ sessionId, phase, message, percent })

  emit('read', '正在读取文件…', 10)
  const source = input.path
    ? readSourceFromPath(input.path, input.kind)
    : readSourceFromText(input.text ?? '', (input.kind as ImportKind) ?? 'manual')

  if (source.kind === 'vela') {
    throw new Error('Vela 工程请使用「导入 Vela 项目」入口')
  }

  emit('extract', `已读取 ${source.lines.length} 行，正在分层解析…`, 40)
  const tree = parseOutline(source.lines.join('\n'))

  if (input.useLlm) {
    emit('llm', '正在用 AI 辅助解析未识别段落…', 60)
    await enrichWithLlm(tree, {
      onProgress: (done, total) => emit('llm', `AI 解析中 ${done}/${total}`, 60 + Math.round((done / Math.max(1, total)) * 20))
    })
  }

  emit('parse', '正在生成体检表…', 80)
  const validation = validateTree(tree)

  const chapters = tree.volumes.flatMap((volume) => volume.chapters)
  const items = chapters.length > 0 ? buildItems(sessionId, projectId, chapters) : []

  emit('diff', '正在比对现有细纲…', 90)
  const warnings = [...source.warnings, ...tree.warnings]
  persistSession(sessionId, projectId, input.path ?? '', source.kind, tree, validation, warnings, source.encoding ?? '', items)

  const session = getSession(sessionId)
  if (!session) throw new Error('导入会话创建失败')
  emit('done', '解析完成', 100)
  // rawText 只在响应中携带（不落库），供「正文」Tab 作为草稿导入复用
  return { ...session, rawText: source.text ?? source.lines.join('\n') }
}

/** 改单条 action / enabled */
export function updateImportItem(input: ImportUpdateItemInput): ImportSession {
  assertWritable()
  const db = getDb()
  const row = db
    .select()
    .from(importItem)
    .where(and(eq(importItem.id, input.itemId), eq(importItem.sessionId, input.sessionId)))
    .get()
  if (!row) throw new Error('导入条目不存在')

  const patch: {
    action?: ImportAction
    enabled?: boolean
    chapterNo?: number
    volumeIdx?: number
    payload?: ImportBriefPayload
  } = {}
  if (input.action) {
    patch.action = input.action
    if (input.action === 'update') patch.enabled = input.enabled ?? true
    if (input.action === 'skip') patch.enabled = input.enabled ?? false
  }
  if (input.enabled !== undefined) patch.enabled = input.enabled

  // 调整章节号 / 卷号时同步 payload，保证提交写入一致
  if (input.chapterNo !== undefined || input.volumeIdx !== undefined) {
    const chapterNo = input.chapterNo ?? row.chapterNo
    const volumeIdx = input.volumeIdx ?? row.volumeIdx
    patch.chapterNo = chapterNo
    patch.volumeIdx = volumeIdx
    patch.payload = { ...row.payload, chapterNo, volumeIdx }
  }

  db.update(importItem)
    .set(patch)
    .where(and(eq(importItem.id, input.itemId), eq(importItem.sessionId, input.sessionId)))
    .run()

  const session = getSession(input.sessionId)
  if (!session) throw new Error('导入会话不存在')
  return session
}

/**
 * 批量改多条（全选 / 全不选 / 只选新建 / 只选更新）。
 * 逐条 IPC 在几百章时会因为每次重读整棵树而让界面「按不动」，
 * 这里一次事务改完、只回读一次会话。
 */
export function updateImportItems(input: ImportUpdateItemsInput): ImportSession {
  assertWritable()
  const db = getDb()
  const rows = db.select().from(importItem).where(eq(importItem.sessionId, input.sessionId)).all()
  const byId = new Map(rows.map((row) => [row.id, row]))

  db.transaction(() => {
    for (const update of input.updates) {
      const row = byId.get(update.itemId)
      if (!row) continue
      const patch: {
        action?: ImportAction
        enabled?: boolean
        chapterNo?: number
        volumeIdx?: number
        payload?: ImportBriefPayload
      } = {}
      if (update.action) {
        patch.action = update.action
        if (update.action === 'update') patch.enabled = update.enabled ?? true
        if (update.action === 'skip') patch.enabled = update.enabled ?? false
      }
      if (update.enabled !== undefined) patch.enabled = update.enabled
      if (update.chapterNo !== undefined || update.volumeIdx !== undefined) {
        const chapterNo = update.chapterNo ?? row.chapterNo
        const volumeIdx = update.volumeIdx ?? row.volumeIdx
        patch.chapterNo = chapterNo
        patch.volumeIdx = volumeIdx
        patch.payload = { ...row.payload, chapterNo, volumeIdx }
      }
      if (Object.keys(patch).length === 0) continue
      db.update(importItem)
        .set(patch)
        .where(and(eq(importItem.id, update.itemId), eq(importItem.sessionId, input.sessionId)))
        .run()
      // 同一批里可能出现重复条目：保持内存快照同步，避免读到旧值
      byId.set(update.itemId, { ...row, ...patch })
    }
  })

  const session = getSession(input.sessionId)
  if (!session) throw new Error('导入会话不存在')
  return session
}

/** 重跑体检（不落库） */
export function revalidateSession(input: ImportValidateInput): ImportSession {
  assertWritable()
  const db = getDb()
  const row = db.select().from(importSession).where(eq(importSession.id, input.sessionId)).get()
  if (!row) throw new Error('导入会话不存在')
  const validation = validateTree(row.parsedTree, input.requiredFields ?? DEFAULT_REQUIRED_FIELDS)
  db.update(importSession).set({ validation }).where(eq(importSession.id, input.sessionId)).run()
  const session = getSession(input.sessionId)
  if (!session) throw new Error('导入会话不存在')
  return session
}

/** 提交：仅落库 enabled 的条目；更新前先把旧细纲移入回收站 */
export function commitSession(sessionId: string): { committed: number } {
  assertWritable()
  const session = getSession(sessionId)
  if (!session) throw new Error('导入会话不存在')
  if (session.status === 'committed') throw new Error('该导入会话已提交')
  if (session.status === 'cancelled') throw new Error('该导入会话已取消')
  if (session.projectId === null) throw new Error('请先选择目标项目再导入')

  const projectId = session.projectId
  const db = getDb()
  const existing = new Map(listBriefs(projectId).map((brief) => [brief.chapterNo, brief]))
  let committed = 0

  // better-sqlite3 的 transaction 为同步执行：回调直接运行，返回值即结果
  db.transaction(() => {
    for (const item of session.items) {
      if (!item.enabled || item.action === 'skip') continue
      const current = existing.get(item.chapterNo)
      // 更新：先把旧细纲软删除（移入回收站），再写入新值
      if (current) deleteBrief(current.id)
      const saved = saveBrief({ ...item.payload, projectId, chapterNo: item.chapterNo })
      // 同一会话里重复章节号时，后面的条目要看到前面刚写入的结果，
      // 否则 existing 是过期快照，看似「更新」实为覆盖，与差异预览不符。
      existing.set(saved.chapterNo, saved)
      committed += 1
    }
    db.update(importSession).set({ status: 'committed' }).where(eq(importSession.id, sessionId)).run()
  })

  pruneImportSessions()
  return { committed }
}

/** 取消：标记 cancelled，不落库 */
export function cancelSession(sessionId: string): void {
  assertWritable()
  const db = getDb()
  const row = db.select().from(importSession).where(eq(importSession.id, sessionId)).get()
  if (!row) throw new Error('导入会话不存在')
  db.update(importSession).set({ status: 'cancelled' }).where(eq(importSession.id, sessionId)).run()
  pruneImportSessions()
}