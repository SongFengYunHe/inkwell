import { and, desc, eq } from 'drizzle-orm'
import type { ChapterDraft, DraftRevision } from '@shared/types'
import { getDb } from './client'
import { draftRevision } from './schema'

/**
 * A5 修订记录（计划书 §5.1 draft_revision）。
 *
 * 与 chapter_draft 的分工：
 *   - chapter_draft  = 正文的「版本」（内容本身，可回滚到任意版本）
 *   - draft_revision = 这次改动的「来由与产出」（为什么改、依据是什么问题、改动前后）
 * 一键修复 / 润色 / 重写都会记一条，正文面板里可以回看「这一版是怎么来的」。
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
    createdAt: row.createdAt
  }
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
}

export function recordRevision(input: RecordRevisionInput): DraftRevision {
  const db = getDb()
  const count = db
    .select({ id: draftRevision.id })
    .from(draftRevision)
    .where(and(eq(draftRevision.projectId, input.projectId), eq(draftRevision.chapterNo, input.chapterNo)))
    .all().length

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
      content: draft.content
    })
  } catch {
    // 修订记录失败不影响主流程
  }
}
