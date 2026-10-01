import type {
  AuditReport,
  CharacterCard,
  CharacterSaveInput,
  CharacterStateDelta,
  ContinuityFacts,
  MemoryChapter,
  OutlineThread,
  ThreadEvent,
  ThreadUpdate
} from '@shared/types'
import { and, asc, desc, eq } from 'drizzle-orm'
import { getDb } from './client'
import { character, memoryChapter, outlineThread, review, threadEvent } from './schema'

type MemoryRow = typeof memoryChapter.$inferSelect
type CharacterRow = typeof character.$inferSelect
type ThreadRow = typeof outlineThread.$inferSelect

const EMPTY_FACTS: ContinuityFacts = { worldState: '', timeline: '', resourceLedger: '', facts: [] }

function toMemoryDto(row: MemoryRow): MemoryChapter {
  return {
    id: row.id,
    projectId: row.projectId,
    chapterNo: row.chapterNo,
    draftId: row.draftId,
    summary: row.summary,
    characterStates: row.characterStates ?? [],
    continuityFacts: row.continuityFacts ?? EMPTY_FACTS,
    threadUpdates: row.threadUpdates ?? [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

function toCharacterDto(row: CharacterRow): CharacterCard {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    role: row.role,
    appearance: row.appearance,
    personality: row.personality,
    background: row.background,
    abilities: row.abilities,
    motivation: row.motivation,
    relationships: row.relationships,
    csLocation: row.csLocation,
    csPower: row.csPower,
    csState: row.csState,
    csItems: row.csItems ?? [],
    csRecent: row.csRecent,
    csUpdatedCh: row.csUpdatedCh,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

function toThreadDto(row: ThreadRow): OutlineThread {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    type: row.type,
    startCh: row.startCh,
    endCh: row.endCh,
    intent: row.intent,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

/* ------------------------------- 章节记忆快照 ------------------------------ */

export function listMemoryChapters(projectId: number): MemoryChapter[] {
  return getDb()
    .select()
    .from(memoryChapter)
    .where(eq(memoryChapter.projectId, projectId))
    .orderBy(asc(memoryChapter.chapterNo))
    .all()
    .map(toMemoryDto)
}

export function getMemoryChapter(projectId: number, chapterNo: number): MemoryChapter | null {
  const row = getDb()
    .select()
    .from(memoryChapter)
    .where(and(eq(memoryChapter.projectId, projectId), eq(memoryChapter.chapterNo, chapterNo)))
    .get()
  return row ? toMemoryDto(row) : null
}

export interface SaveMemoryInput {
  projectId: number
  chapterNo: number
  draftId: number | null
  summary: string
  characterStates: CharacterStateDelta[]
  continuityFacts: ContinuityFacts
  threadUpdates: ThreadUpdate[]
}

/** 保存章节记忆快照：按 (projectId, chapterNo) 唯一，存在即覆盖（投影可重建） */
export function saveMemoryChapter(input: SaveMemoryInput): MemoryChapter {
  const db = getDb()
  const now = Date.now()
  const existing = db
    .select()
    .from(memoryChapter)
    .where(and(eq(memoryChapter.projectId, input.projectId), eq(memoryChapter.chapterNo, input.chapterNo)))
    .get()

  const values = {
    projectId: input.projectId,
    chapterNo: input.chapterNo,
    draftId: input.draftId,
    summary: input.summary,
    characterStates: input.characterStates,
    continuityFacts: input.continuityFacts,
    threadUpdates: input.threadUpdates,
    updatedAt: now
  }

  if (existing) {
    return toMemoryDto(db.update(memoryChapter).set(values).where(eq(memoryChapter.id, existing.id)).returning().get())
  }
  return toMemoryDto(db.insert(memoryChapter).values({ ...values, createdAt: now }).returning().get())
}

/* --------------------------------- 角色矩阵 -------------------------------- */

export function listCharacters(projectId: number): CharacterCard[] {
  return getDb()
    .select()
    .from(character)
    .where(eq(character.projectId, projectId))
    .orderBy(asc(character.id))
    .all()
    .map(toCharacterDto)
}

/**
 * R12：手工保存角色卡（角色矩阵此前只能从正文重建，用户无法修正设定）。
 * 有 id 就按 id 更新（允许改名），没有就按 (projectId, name) upsert。
 */
export function saveCharacter(input: CharacterSaveInput): CharacterCard[] {
  const db = getDb()
  const now = Date.now()
  const name = input.name.trim()
  const patch: CharacterPatch = {
    role: input.role,
    appearance: input.appearance,
    personality: input.personality,
    background: input.background,
    abilities: input.abilities,
    motivation: input.motivation,
    relationships: input.relationships,
    csLocation: input.csLocation,
    csPower: input.csPower,
    csState: input.csState,
    csItems: input.csItems,
    csRecent: input.csRecent
  }

  if (input.id !== undefined) {
    const existing = db.select().from(character).where(eq(character.id, input.id)).get()
    if (!existing) throw new Error('角色不存在：' + input.id)
    const merged: Record<string, unknown> = { name, updatedAt: now }
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) merged[key] = value
    }
    db.update(character).set(merged).where(eq(character.id, input.id)).run()
    return listCharacters(existing.projectId)
  }

  const projectId = input.projectId
  const duplicated = db
    .select()
    .from(character)
    .where(and(eq(character.projectId, projectId), eq(character.name, name)))
    .get()
  if (duplicated) {
    upsertCharacter(projectId, name, patch)
    return listCharacters(projectId)
  }

  db.insert(character)
    .values({
      projectId,
      name,
      role: patch.role ?? '',
      appearance: patch.appearance ?? '',
      personality: patch.personality ?? '',
      background: patch.background ?? '',
      abilities: patch.abilities ?? '',
      motivation: patch.motivation ?? '',
      relationships: patch.relationships ?? '',
      csLocation: patch.csLocation ?? '',
      csPower: patch.csPower ?? '',
      csState: patch.csState ?? '',
      csItems: patch.csItems ?? [],
      csRecent: patch.csRecent ?? '',
      csUpdatedCh: 0,
      createdAt: now,
      updatedAt: now
    })
    .run()
  return listCharacters(projectId)
}

/** R12：删除角色卡 */
export function removeCharacter(id: number): CharacterCard[] {
  const db = getDb()
  const row = db.select().from(character).where(eq(character.id, id)).get()
  if (!row) return []
  db.delete(character).where(eq(character.id, id)).run()
  return listCharacters(row.projectId)
}

export interface CharacterPatch {
  role?: string
  appearance?: string
  personality?: string
  background?: string
  abilities?: string
  motivation?: string
  relationships?: string
  csLocation?: string
  csPower?: string
  csState?: string
  csItems?: string[]
  csRecent?: string
  csUpdatedCh?: number
}

/** 按 (projectId, name) upsert 角色，仅覆盖显式传入的字段 */
export function upsertCharacter(projectId: number, name: string, patch: CharacterPatch): CharacterCard {
  const db = getDb()
  const now = Date.now()
  const trimmed = name.trim()
  const existing = db
    .select()
    .from(character)
    .where(and(eq(character.projectId, projectId), eq(character.name, trimmed)))
    .get()

  if (existing) {
    const merged: Record<string, unknown> = { updatedAt: now }
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) merged[key] = value
    }
    return toCharacterDto(
      db.update(character).set(merged).where(eq(character.id, existing.id)).returning().get()
    )
  }

  return toCharacterDto(
    db
      .insert(character)
      .values({
        projectId,
        name: trimmed,
        role: patch.role ?? '',
        appearance: patch.appearance ?? '',
        personality: patch.personality ?? '',
        background: patch.background ?? '',
        abilities: patch.abilities ?? '',
        motivation: patch.motivation ?? '',
        relationships: patch.relationships ?? '',
        csLocation: patch.csLocation ?? '',
        csPower: patch.csPower ?? '',
        csState: patch.csState ?? '',
        csItems: patch.csItems ?? [],
        csRecent: patch.csRecent ?? '',
        csUpdatedCh: patch.csUpdatedCh ?? 0,
        createdAt: now,
        updatedAt: now
      })
      .returning()
      .get()
  )
}

/** 把某章抽取出的角色状态增量投影到角色矩阵 */
export function applyCharacterStates(
  projectId: number,
  chapterNo: number,
  deltas: CharacterStateDelta[]
): void {
  for (const delta of deltas) {
    const name = delta.name.trim()
    if (!name) continue
    upsertCharacter(projectId, name, {
      csState: delta.state,
      csLocation: delta.location,
      csPower: delta.power,
      csItems: delta.items,
      csRecent: delta.recent,
      csUpdatedCh: chapterNo
    })
  }
}

/* -------------------------------- 伏笔台账 -------------------------------- */

export function listThreads(projectId: number): OutlineThread[] {
  return getDb()
    .select()
    .from(outlineThread)
    .where(eq(outlineThread.projectId, projectId))
    .orderBy(asc(outlineThread.id))
    .all()
    .map(toThreadDto)
}

export interface ThreadPatch {
  type?: string
  startCh?: number
  endCh?: number
  intent?: string
  status?: string
}

/** 按 (projectId, title) upsert 伏笔 / 支线，仅覆盖显式传入的字段 */
export function upsertThread(projectId: number, title: string, patch: ThreadPatch): OutlineThread {
  const db = getDb()
  const now = Date.now()
  const trimmed = title.trim()
  const existing = db
    .select()
    .from(outlineThread)
    .where(and(eq(outlineThread.projectId, projectId), eq(outlineThread.title, trimmed)))
    .get()

  if (existing) {
    const merged: Record<string, unknown> = { updatedAt: now }
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) merged[key] = value
    }
    return toThreadDto(db.update(outlineThread).set(merged).where(eq(outlineThread.id, existing.id)).returning().get())
  }

  return toThreadDto(
    db
      .insert(outlineThread)
      .values({
        projectId,
        title: trimmed,
        type: patch.type ?? 'plot',
        startCh: patch.startCh ?? 0,
        endCh: patch.endCh ?? 0,
        intent: patch.intent ?? '',
        status: patch.status ?? 'planned',
        createdAt: now,
        updatedAt: now
      })
      .returning()
      .get()
  )
}

export function listThreadEvents(projectId: number): ThreadEvent[] {
  return getDb()
    .select()
    .from(threadEvent)
    .where(eq(threadEvent.projectId, projectId))
    .orderBy(asc(threadEvent.chapterNo), asc(threadEvent.id))
    .all()
}

/** 把某章的伏笔状态变更写入台账，并更新伏笔当前状态 */
export function applyThreadUpdates(
  projectId: number,
  chapterNo: number,
  draftId: number | null,
  updates: ThreadUpdate[]
): void {
  const db = getDb()
  const now = Date.now()
  for (const update of updates) {
    const title = update.title.trim()
    if (!title) continue

    const existing = db
      .select({ id: outlineThread.id })
      .from(outlineThread)
      .where(and(eq(outlineThread.projectId, projectId), eq(outlineThread.title, title)))
      .get()

    // 首次登记时记下起始章；后续推进只更新状态，不覆盖 startCh
    const thread = upsertThread(
      projectId,
      title,
      existing
        ? { type: update.type || 'hook', status: update.event }
        : { type: update.type || 'hook', status: update.event, startCh: chapterNo }
    )

    db.insert(threadEvent)
      .values({
        projectId,
        threadId: thread.id,
        chapterNo,
        draftId,
        event: update.event || 'progressing',
        evidence: update.evidence,
        createdAt: now
      })
      .run()
  }
}

export function deleteThread(id: number): void {
  getDb().delete(outlineThread).where(eq(outlineThread.id, id)).run()
}

/* -------------------------------- 审计报告 -------------------------------- */

export function saveReview(projectId: number, chapterNo: number, draftId: number | null, report: AuditReport): void {
  const db = getDb()
  const previous = db
    .select({ idx: review.idx })
    .from(review)
    .where(and(eq(review.projectId, projectId), eq(review.chapterNo, chapterNo)))
    .orderBy(desc(review.idx))
    .limit(1)
    .get()

  db.insert(review)
    .values({
      projectId,
      draftId,
      chapterNo,
      idx: (previous?.idx ?? 0) + 1,
      content: report,
      createdAt: Date.now()
    })
    .run()
}

export function getLatestReview(projectId: number, chapterNo: number): AuditReport | null {
  const row = getDb()
    .select()
    .from(review)
    .where(and(eq(review.projectId, projectId), eq(review.chapterNo, chapterNo)))
    .orderBy(desc(review.idx))
    .limit(1)
    .get()
  return row?.content ?? null
}

export function deleteMemoryForProject(projectId: number): void {
  const db = getDb()
  db.delete(memoryChapter).where(eq(memoryChapter.projectId, projectId)).run()
  db.delete(threadEvent).where(eq(threadEvent.projectId, projectId)).run()
  db.delete(outlineThread).where(eq(outlineThread.projectId, projectId)).run()
  db.delete(character).where(eq(character.projectId, projectId)).run()
  db.delete(review).where(eq(review.projectId, projectId)).run()
}