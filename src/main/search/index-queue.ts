import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import { getDb } from '../db/client'
import { chapterDraft, embedding, embeddingQueue } from '../db/schema'
import { embedderConfigured } from '../llm/embed'
import { getSettings } from '../library/registry'
import { indexChapterDraft } from './vector'

/**
 * M12-C：向量索引后台队列。
 *
 * 设计取舍：
 *   - 正文落盘 / 生成完成后只做「入队」，真正的 embedding 调用放到空闲时串行执行，
 *     避免与生成抢占主进程与端点额度；
 *   - 队列只记录「脏章节」（每章唯一），索引成功即删行，因此体积不随章节数增长；
 *   - 可暂停（设置项 vectorIndexPaused）、可随应用退出中断（定时器 unref，不阻止退出）。
 *   - 任何失败都不影响写作：入队 / 清理失败只记日志。
 */

/** 空闲触发延迟：给生成与交互让路 */
const IDLE_DELAY_MS = 2_000
/** 单次失败后的重试间隔（避免紧循环；成功或暂停则不受影响） */
const RETRY_DELAY_MS = 30_000

let timer: ReturnType<typeof setTimeout> | null = null
let running = false

function schedule(delay: number): void {
  if (timer) return
  timer = setTimeout(() => {
    timer = null
    void drainIndexQueue()
  }, delay)
  timer.unref?.()
}

/** 只有「开关开启 + 未暂停 + embedder 可用」时才继续处理 */
function canIndex(): boolean {
  const settings = getSettings()
  return settings.ragSearch && !settings.vectorIndexPaused && embedderConfigured()
}

/** 正文落盘 / 生成后入队（不可用时不入队，避免产生无谓的工单噪音） */
export function enqueueChapterIndex(projectId: number, chapterNo: number, draftId: number): void {
  try {
    if (!canIndex()) return
    const db = getDb()
    const now = Date.now()
    const existing = db
      .select({ id: embeddingQueue.id })
      .from(embeddingQueue)
      .where(and(eq(embeddingQueue.projectId, projectId), eq(embeddingQueue.chapterNo, chapterNo)))
      .get()
    if (existing) {
      db.update(embeddingQueue)
        .set({ draftId, error: '', updatedAt: now })
        .where(eq(embeddingQueue.id, existing.id))
        .run()
    } else {
      db.insert(embeddingQueue)
        .values({ projectId, chapterNo, draftId, enqueuedAt: now, updatedAt: now })
        .run()
    }
    schedule(IDLE_DELAY_MS)
  } catch (error) {
    console.warn('[inkwell] 索引入队失败（不影响写作）：', error instanceof Error ? error.message : error)
  }
}

/** 软删除 / 正文清空时同步移除该章的索引与工单 */
export function removeChapterIndex(projectId: number, chapterNo: number): void {
  try {
    const db = getDb()
    db.delete(embedding)
      .where(
        and(
          eq(embedding.projectId, projectId),
          eq(embedding.sourceType, 'draft'),
          eq(embedding.chapterNo, chapterNo)
        )
      )
      .run()
    db.delete(embeddingQueue)
      .where(and(eq(embeddingQueue.projectId, projectId), eq(embeddingQueue.chapterNo, chapterNo)))
      .run()
  } catch (error) {
    console.warn('[inkwell] 索引清理失败（不影响写作）：', error instanceof Error ? error.message : error)
  }
}

/** 整体移除某项目的索引与工单 */
export function removeProjectIndex(projectId: number): void {
  try {
    const db = getDb()
    db.delete(embedding).where(eq(embedding.projectId, projectId)).run()
    db.delete(embeddingQueue).where(eq(embeddingQueue.projectId, projectId)).run()
  } catch (error) {
    console.warn('[inkwell] 索引清理失败（不影响写作）：', error instanceof Error ? error.message : error)
  }
}

/**
 * 排空队列：取最旧的一条工单处理。
 * 暂停 / 无 embedder 时原地返回（队列保留）；失败则退避重试，绝不紧循环。
 */
export async function drainIndexQueue(): Promise<number> {
  if (running) return 0
  running = true
  let indexed = 0
  try {
    for (;;) {
      if (!canIndex()) return indexed
      const db = getDb()
      const row = db
        .select()
        .from(embeddingQueue)
        .orderBy(asc(embeddingQueue.enqueuedAt))
        .limit(1)
        .get()
      if (!row) return indexed

      // 以「该项目该章最新的未删除版本」为准，避免索引到过期或已删的正文
      const draft = db
        .select()
        .from(chapterDraft)
        .where(
          and(
            eq(chapterDraft.projectId, row.projectId),
            eq(chapterDraft.chapterNo, row.chapterNo),
            isNull(chapterDraft.deletedAt)
          )
        )
        .orderBy(desc(chapterDraft.version))
        .limit(1)
        .get()

      if (!draft || !draft.content.trim()) {
        removeChapterIndex(row.projectId, row.chapterNo)
        continue
      }

      const ok = await indexChapterDraft(row.projectId, row.chapterNo, draft.id, draft.content)
      if (ok) {
        db.delete(embeddingQueue).where(eq(embeddingQueue.id, row.id)).run()
        indexed += 1
      } else {
        db.update(embeddingQueue)
          .set({ attempts: row.attempts + 1, error: '索引失败，稍后重试', updatedAt: Date.now() })
          .where(eq(embeddingQueue.id, row.id))
          .run()
        schedule(RETRY_DELAY_MS)
        return indexed
      }
    }
  } finally {
    running = false
  }
}

/** 启动后延迟做一次排空（等界面稳定、没有生成任务时再跑） */
export function initIndexQueue(): void {
  schedule(IDLE_DELAY_MS)
}
