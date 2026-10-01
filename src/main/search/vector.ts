import { and, eq, isNull } from 'drizzle-orm'
import type { VectorIndexResult, VectorIndexStatus, VectorRecallHit } from '@shared/types'
import { getDb } from '../db/client'
import { chapterDraft, embedding } from '../db/schema'
import { embedTexts, embedderConfigured } from '../llm/embed'
import { getSettings } from '../library/registry'

/**
 * A3 向量检索（RAG）。
 *
 * 设计取舍：
 *   - 不引入第三方向量库，向量以 Float32Array 的 BLOB 存在 SQLite 里；
 *   - 检索在主进程用 JS 算余弦相似度：单本书的块数在千级，毫秒级即可完成，
 *     换成 sqlite-vec 之类的扩展会带来原生依赖与体积成本；
 *   - 一切以「不可用就静默降级」为原则：没有 embedder、没开开关、索引为空，
 *     都不应该影响正常的写作流程。
 */

const CHUNK_CHARS = 600
const CHUNK_OVERLAP = 120
// 30 字：再短的段落（例如一句对话）也值得进索引；过短会让召回退回「命中不了」
const MIN_CHUNK_CHARS = 30

/** 把正文切成带重叠的块：优先按段落边界切，段太长再按字数硬切 */
export function chunkText(text: string): string[] {
  const paragraphs = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)

  const chunks: string[] = []
  let buffer = ''

  const flush = (): void => {
    const trimmed = buffer.trim()
    if (trimmed.length >= MIN_CHUNK_CHARS) chunks.push(trimmed)
    buffer = ''
  }

  for (const paragraph of paragraphs) {
    if (paragraph.length > CHUNK_CHARS) {
      flush()
      for (let start = 0; start < paragraph.length; start += CHUNK_CHARS - CHUNK_OVERLAP) {
        const piece = paragraph.slice(start, start + CHUNK_CHARS).trim()
        if (piece.length >= MIN_CHUNK_CHARS) chunks.push(piece)
      }
      continue
    }
    if (buffer.length + paragraph.length + 1 > CHUNK_CHARS) {
      const tail = buffer.slice(-CHUNK_OVERLAP)
      flush()
      buffer = tail
    }
    buffer += (buffer ? '\n' : '') + paragraph
  }
  flush()
  return chunks
}

function toBlob(vector: number[]): Buffer {
  const floats = Float32Array.from(vector)
  return Buffer.from(floats.buffer.slice(0))
}

function toVector(blob: Buffer | null): Float32Array | null {
  if (!blob || blob.byteLength === 0 || blob.byteLength % 4 !== 0) return null
  const copy = blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength)
  return new Float32Array(copy)
}

/** 余弦相似度（向量已归一化时等价于点积；这里做完整计算以防端点返回未归一化向量） */
function cosine(a: Float32Array, b: Float32Array): number {
  const length = Math.min(a.length, b.length)
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export function indexStatus(projectId: number): VectorIndexStatus {
  const rows = getDb()
    .select({
      chapterNo: embedding.chapterNo,
      dim: embedding.dim,
      model: embedding.model,
      createdAt: embedding.createdAt
    })
    .from(embedding)
    .where(eq(embedding.projectId, projectId))
    .all()

  const chapters = new Set(rows.map((row) => row.chapterNo))
  const latest = rows.reduce((max, row) => Math.max(max, row.createdAt), 0)
  return {
    embedderAvailable: embedderConfigured(),
    enabled: getSettings().ragSearch,
    chapters: chapters.size,
    chunks: rows.length,
    dim: rows[0]?.dim ?? 0,
    model: rows[0]?.model ?? '',
    updatedAt: latest > 0 ? latest : null
  }
}

export function clearIndex(projectId: number): void {
  getDb().delete(embedding).where(eq(embedding.projectId, projectId)).run()
}

/** 索引（或重建）单章：先删旧块，再写入新块 */
async function indexChapter(
  projectId: number,
  chapterNo: number,
  draftId: number,
  content: string,
  signal?: AbortSignal
): Promise<number> {
  const db = getDb()
  const chunks = chunkText(content)
  if (chunks.length === 0) return 0

  const { vectors, model } = await embedTexts(chunks, signal)
  const now = Date.now()

  db.transaction(() => {
    db.delete(embedding)
      .where(
        and(
          eq(embedding.projectId, projectId),
          eq(embedding.sourceType, 'draft'),
          eq(embedding.sourceId, draftId)
        )
      )
      .run()
    chunks.forEach((text, index) => {
      const vector = vectors[index] ?? []
      if (vector.length === 0) return
      db.insert(embedding)
        .values({
          projectId,
          sourceType: 'draft',
          sourceId: draftId,
          chapterNo,
          chunkIdx: index,
          text,
          dim: vector.length,
          vector: toBlob(vector),
          model,
          createdAt: now
        })
        .run()
    })
  })

  return chunks.length
}

/** 全量重建索引：遍历该项目所有未删除的正文（每个章节取最新版本） */
export async function rebuildIndex(
  projectId: number,
  signal?: AbortSignal,
  onProgress?: (message: string, done: number, total: number) => void
): Promise<VectorIndexResult> {
  const db = getDb()
  const drafts = db
    .select()
    .from(chapterDraft)
    .where(and(eq(chapterDraft.projectId, projectId), isNull(chapterDraft.deletedAt)))
    .all()

  // 每章只索引最新版本
  const latest = new Map<number, (typeof drafts)[number]>()
  for (const draft of drafts) {
    const current = latest.get(draft.chapterNo)
    if (!current || draft.version > current.version) latest.set(draft.chapterNo, draft)
  }

  const ordered = [...latest.values()].sort((a, b) => a.chapterNo - b.chapterNo)
  let chunks = 0
  let indexed = 0
  let skipped = 0

  db.delete(embedding).where(eq(embedding.projectId, projectId)).run()

  for (const draft of ordered) {
    if (!draft.content.trim()) {
      skipped += 1
      continue
    }
    onProgress?.(`正在索引第 ${draft.chapterNo} 章…`, indexed, ordered.length)
    chunks += await indexChapter(projectId, draft.chapterNo, draft.id, draft.content, signal)
    indexed += 1
  }

  return { chapters: indexed, chunks, skipped }
}

/** 章节落盘后增量索引（失败不影响主流程） */
export async function indexChapterDraft(
  projectId: number,
  chapterNo: number,
  draftId: number,
  content: string,
  signal?: AbortSignal
): Promise<boolean> {
  try {
    if (!getSettings().ragSearch || !embedderConfigured()) return false
    if (!content.trim()) return false
    await indexChapter(projectId, chapterNo, draftId, content, signal)
    return true
  } catch (error) {
    console.warn('[inkwell] 向量索引失败（不影响写作）：', error instanceof Error ? error.message : error)
    return false
  }
}

export interface VectorSearchOptions {
  limit?: number
  /** 只检索该章之前的章节（写作时用作「回忆」，不把本章自己检索回来） */
  beforeChapter?: number
}

export async function searchVectors(
  projectId: number,
  query: string,
  options: VectorSearchOptions = {},
  signal?: AbortSignal
): Promise<VectorRecallHit[]> {
  const limit = Math.max(1, Math.min(20, options.limit ?? 4))
  if (!query.trim()) return []

  const { vectors } = await embedTexts([query], signal)
  const queryVector = vectors[0] ? Float32Array.from(vectors[0]) : null
  if (!queryVector) return []

  const rows = getDb().select().from(embedding).where(eq(embedding.projectId, projectId)).all()
  const scored: VectorRecallHit[] = []
  for (const row of rows) {
    if (options.beforeChapter !== undefined && row.chapterNo >= options.beforeChapter) continue
    const vector = toVector((row.vector as Buffer | null) ?? null)
    if (!vector) continue
    scored.push({
      chapterNo: row.chapterNo,
      chunkIdx: row.chunkIdx,
      score: cosine(queryVector, vector),
      text: row.text
    })
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit)
}
