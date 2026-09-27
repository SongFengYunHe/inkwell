import type { LlmCallRecord, UsageSummary } from '@shared/types'
import { desc, sql } from 'drizzle-orm'
import { getDb } from '../db/client'
import { llmCall } from '../db/schema'

/** 记录一次调用；记账失败绝不能影响主流程 */
export function recordLlmCall(record: Omit<LlmCallRecord, 'id'>): void {
  try {
    getDb()
      .insert(llmCall)
      .values({
        providerId: record.providerId,
        providerName: record.providerName,
        model: record.model,
        role: record.role,
        promptTokens: record.promptTokens,
        completionTokens: record.completionTokens,
        durationMs: record.durationMs,
        success: record.success,
        error: record.error,
        createdAt: record.createdAt
      })
      .run()
  } catch {
    // 忽略
  }
}

export function getUsageSummary(recentLimit = 50): UsageSummary {
  const db = getDb()

  const totals = db
    .select({
      calls: sql<number>`count(*)`,
      failed: sql<number>`coalesce(sum(case when success = 0 then 1 else 0 end), 0)`,
      prompt: sql<number>`coalesce(sum(prompt_tokens), 0)`,
      completion: sql<number>`coalesce(sum(completion_tokens), 0)`,
      duration: sql<number>`coalesce(sum(duration_ms), 0)`
    })
    .from(llmCall)
    .get()

  const byRole = db
    .select({
      role: llmCall.role,
      calls: sql<number>`count(*)`,
      tokens: sql<number>`coalesce(sum(prompt_tokens + completion_tokens), 0)`
    })
    .from(llmCall)
    .groupBy(llmCall.role)
    .all()

  const recent = db.select().from(llmCall).orderBy(desc(llmCall.id)).limit(recentLimit).all()

  return {
    totalCalls: totals?.calls ?? 0,
    failedCalls: totals?.failed ?? 0,
    promptTokens: totals?.prompt ?? 0,
    completionTokens: totals?.completion ?? 0,
    totalDurationMs: totals?.duration ?? 0,
    byRole: byRole.map((row) => ({ role: row.role, calls: row.calls, tokens: row.tokens })),
    recent
  }
}