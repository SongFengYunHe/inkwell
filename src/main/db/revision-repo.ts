import { and, desc, eq } from 'drizzle-orm'
import type { ChapterDraft, DraftRevision, RevertRevisionResult, RevisionDiffLine } from '@shared/types'
import { getDb } from './client'
import { chapterDraft, draftRevision } from './schema'
import { listDrafts, saveDraft } from './repositories'

/**
 * A5 修订记录（计划书 §5.1 draft_revision）+ M10 §4.3「修复可回滚与可视化对比」。
 *
 * 与 chapter_draft 的分工：
 *   - chapter_draft  = 正文的「版本」（内容本身，可回滚到任意版本）
 *   - draft_revision = 这次改动的「来由与产出」（为什么改、依据是什么问题、改动前后）
 * 一键修复 / 润色 / 重写都会记一条，正文面板里可以回看「这一版是怎么来的」。
 *
 * M10 增补：before_content / after_content 摘要 + 段落级 diff + reverted 标记 + 回退能力。
 */

type RevisionRow = typeof draftRevision.$inferSelect

function toDto(row: RevisionRow): DraftRevision {
  return {
    id: row.id,
    projectId: row.projectId,
    chapterNo: row.chapterNo,
    baseDraftId: row.baseDraftId,
    draftId: row.draftId,
    idx: row.idx,
    type: row.type,
    status: row.status,
    userPrompt: row.userPrompt,
    wordCount: row.wordCount,
    beforeExcerpt: row.beforeExcerpt,
    afterExcerpt: row.afterExcerpt,
    diff: row.diff ?? [],
    reverted: row.reverted,
    createdAt: row.createdAt
  }
}

/** 改前 / 改后摘要：取前 limit 字，尽量在段落边界截断以保留段落感 */
export function excerptOf(text: string, limit = 400): string {
  const normalized = text.replace(/\r\n?/g, '\n').trim()
  if (normalized.length <= limit) return normalized
  const slice = normalized.slice(0, limit)
  const lastBreak = slice.lastIndexOf('\n')
  if (lastBreak >= Math.floor(limit * 0.6)) return slice.slice(0, lastBreak)
  return slice
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
}

/** 段落数过多时的退化 diff：保留公共前后缀，中段整体记 del + add */
function prefixSuffixDiff(before: string[], after: string[]): RevisionDiffLine[] {
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1
  let endBefore = before.length
  let endAfter = after.length
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore -= 1
    endAfter -= 1
  }

  const lines: RevisionDiffLine[] = []
  for (let index = 0; index < start; index += 1) lines.push({ type: 'same', text: before[index] })
  for (let index = start; index < endBefore; index += 1) lines.push({ type: 'del', text: before[index] })
  for (let index = start; index < endAfter; index += 1) lines.push({ type: 'add', text: after[index] })
  for (let index = endBefore; index < before.length; index += 1) lines.push({ type: 'same', text: before[index] })
  return lines
}

/** 段落级 diff（LCS 三态：same / add / del），顺序与原段落一致 */
export function paragraphDiff(before: string, after: string): RevisionDiffLine[] {
  const a = splitParagraphs(before)
  const b = splitParagraphs(after)
  if (a.length === 0) return b.map((text) => ({ type: 'add' as const, text }))
  if (b.length === 0) return a.map((text) => ({ type: 'del' as const, text }))
  // O(n·m) 内存上限保护：超过 16 万格就退回前后缀算法
  if (a.length * b.length > 160_000) return prefixSuffixDiff(a, b)

  const rows = a.length + 1
  const cols = b.length + 1
  const table = new Uint32Array(rows * cols)
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * cols + j] =
        a[i] === b[j]
          ? table[(i + 1) * cols + (j + 1)] + 1
          : Math.max(table[(i + 1) * cols + j], table[i * cols + (j + 1)])
    }
  }

  const lines: RevisionDiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ type: 'same', text: a[i] })
      i += 1
      j += 1
    } else if (table[(i + 1) * cols + j] >= table[i * cols + (j + 1)]) {
      lines.push({ type: 'del', text: a[i] })
      i += 1
    } else {
      lines.push({ type: 'add', text: b[j] })
      j += 1
    }
  }
  while (i < a.length) {
    lines.push({ type: 'del', text: a[i] })
    i += 1
  }
  while (j < b.length) {
    lines.push({ type: 'add', text: b[j] })
    j += 1
  }
  return lines
}

export interface RecordRevisionInput {
  projectId: number
  chapterNo: number
  baseDraftId: number | null
  draftId: number | null
  type: 'refine' | 'review-fix' | 'polish' | 'rewrite' | 'manual' | 'import'
  /** 改动来由，例如命中的审计维度清单 */
  userPrompt?: string
  content: string
  /** M10：改动前正文（可选）。不传时 beforeExcerpt 为空、diff 为空数组（不做「全是新增」的误导性推断） */
  beforeContent?: string
}

export function recordRevision(input: RecordRevisionInput): DraftRevision {
  const db = getDb()
  const count = db
    .select({ id: draftRevision.id })
    .from(draftRevision)
    .where(and(eq(draftRevision.projectId, input.projectId), eq(draftRevision.chapterNo, input.chapterNo)))
    .all().length
  const before = typeof input.beforeContent === 'string' ? input.beforeContent : null

  return toDto(
    db
      .insert(draftRevision)
      .values({
        projectId: input.projectId,
        chapterNo: input.chapterNo,
        baseDraftId: input.baseDraftId,
        draftId: input.draftId,
        idx: count + 1,
        type: input.type,
        status: 'applied',
        userPrompt: (input.userPrompt ?? '').slice(0, 4_000),
        content: input.content.slice(0, 2_000_000),
        wordCount: input.content.replace(/\s/g, '').length,
        beforeExcerpt: before === null ? '' : excerptOf(before),
        afterExcerpt: excerptOf(input.content),
        diff: before === null ? [] : paragraphDiff(before, input.content),
        createdAt: Date.now()
      })
      .returning()
      .get()
  )
}

export function listRevisions(projectId: number, chapterNo: number): DraftRevision[] {
  return getDb()
    .select()
    .from(draftRevision)
    .where(and(eq(draftRevision.projectId, projectId), eq(draftRevision.chapterNo, chapterNo)))
    .orderBy(desc(draftRevision.idx))
    .all()
    .map(toDto)
}

/**
 * M10 §4.3：回退到某条修订「改动之前」的版本。
 *
 * 语义：取该修订 baseDraftId 对应版本的正文件为**新版本**写入 chapter_draft
 * （version = 当前最大 + 1，source='revert'，status='revised'），
 * 把该修订标记 reverted=true，再记一条 type='manual' 的修订说明「回退到 v<base>」。
 * 历史版本一律不覆盖、不删除。
 */
export function revertRevision(input: {
  projectId: number
  chapterNo: number
  revisionId: number
}): RevertRevisionResult {
  const db = getDb()
  const revision = db
    .select()
    .from(draftRevision)
    .where(
      and(
        eq(draftRevision.id, input.revisionId),
        eq(draftRevision.projectId, input.projectId),
        eq(draftRevision.chapterNo, input.chapterNo)
      )
    )
    .get()

  if (!revision) throw new Error(`找不到修订记录（id=${input.revisionId}），无法回退`)
  if (revision.baseDraftId === null) {
    throw new Error('这条修订没有可回退的基准版本（可能是首次生成），无法回退')
  }

  const base = db.select().from(chapterDraft).where(eq(chapterDraft.id, revision.baseDraftId)).get()
  if (!base || base.deletedAt !== null) {
    throw new Error(`找不到基准版本（id=${revision.baseDraftId}），它可能已被删除，无法回退`)
  }

  const versions = listDrafts(input.projectId).filter((item) => item.chapterNo === input.chapterNo)
  const nextVersion = versions.reduce((max, item) => Math.max(max, item.version), 0) + 1
  // 「改前」= 这条修订当时产出的版本（用户在回退前看到的正文）
  const current = versions.find((item) => item.id === revision.draftId) ?? versions[0] ?? null

  const draft = saveDraft({
    projectId: input.projectId,
    chapterNo: input.chapterNo,
    version: nextVersion,
    status: 'revised',
    source: 'revert',
    content: base.content
  })

  db.update(draftRevision)
    .set({ reverted: true, status: 'reverted' })
    .where(eq(draftRevision.id, revision.id))
    .run()

  recordRevision({
    projectId: input.projectId,
    chapterNo: input.chapterNo,
    baseDraftId: current?.id ?? null,
    draftId: draft.id,
    type: 'manual',
    userPrompt: `回退到 v${base.version}`,
    content: draft.content,
    beforeContent: current?.content
  })

  return { draft, revisionIdx: revision.idx }
}

/**
 * 生成 / 重写 / 续写 / 润色后自动记一条修订。
 * 只在「确实产生了新版本」时调用，避免把无变化的操作也记成修订。
 */
export function recordGenerationRevision(
  type: 'polish' | 'rewrite' | 'refine',
  base: ChapterDraft | null,
  draft: ChapterDraft
): void {
  try {
    recordRevision({
      projectId: draft.projectId,
      chapterNo: draft.chapterNo,
      baseDraftId: base?.id ?? null,
      draftId: draft.id,
      type,
      userPrompt: base ? `基于 v${base.version}` : '首次生成',
      content: draft.content,
      beforeContent: base?.content
    })
  } catch {
    // 修订记录失败不影响主流程
  }
}
