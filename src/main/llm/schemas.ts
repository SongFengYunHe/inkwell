import { z } from 'zod'

/** 一句话灵感 → 设定与总大纲 */
export const outlineDraftSchema = z.object({
  premise: z.string().min(1).max(2_000),
  worldbuilding: z.string().min(1).max(4_000),
  protagonist: z.string().min(1).max(4_000),
  goldenFinger: z.string().min(1).max(2_000),
  style: z.string().min(1).max(500),
  coreOutline: z.string().min(1).max(20_000)
})

export type OutlineDraft = z.infer<typeof outlineDraftSchema>

/** 单章细纲草案 */
export const briefDraftSchema = z.object({
  chapterNo: z.number().int().min(1).max(99_999),
  title: z.string().max(200).default(''),
  purpose: z.string().max(4_000).default(''),
  keyEvents: z.string().max(20_000).default(''),
  characters: z.array(z.string().max(80)).max(50).default([]),
  sceneBeats: z.array(z.string().max(2_000)).max(50).default([]),
  suspenseHook: z.string().max(2_000).default('')
})

export type BriefDraft = z.infer<typeof briefDraftSchema>

/** 批量细纲（模型可能多给或少给，这里只做形状校验，数量由调用方兜底） */
export const briefBatchSchema = z.union([z.array(briefDraftSchema), z.object({ briefs: z.array(briefDraftSchema) })])

export function normalizeBriefBatch(raw: unknown): BriefDraft[] {
  const parsed = briefBatchSchema.parse(raw)
  return Array.isArray(parsed) ? parsed : parsed.briefs
}

/* ============================ M3：审计与记忆回写 ============================ */

/** 模型补充的语义审计问题（宁缺毋滥，允许为空数组） */
export const auditIssuesSchema = z.object({
  issues: z
    .array(
      z.object({
        dimension: z.string().min(1).max(60),
        severity: z.enum(['info', 'warn', 'error']).default('warn'),
        detail: z.string().min(1).max(500),
        evidence: z.string().max(200).default('')
      })
    )
    .max(30)
    .default([])
})

export type AuditIssues = z.infer<typeof auditIssuesSchema>

/** 章节记忆快照抽取结果 */
export const memoryDraftSchema = z.object({
  summary: z.string().max(2_000).default(''),
  characterStates: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        state: z.string().max(500).default(''),
        location: z.string().max(200).default(''),
        power: z.string().max(500).default(''),
        items: z.array(z.string().max(120)).max(30).default([]),
        recent: z.string().max(500).default('')
      })
    )
    .max(60)
    .default([]),
  continuityFacts: z
    .object({
      worldState: z.string().max(1_000).default(''),
      timeline: z.string().max(500).default(''),
      resourceLedger: z.string().max(1_000).default(''),
      facts: z.array(z.string().max(300)).max(40).default([])
    })
    .default({ worldState: '', timeline: '', resourceLedger: '', facts: [] }),
  threadUpdates: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        type: z.enum(['plot', 'subplot', 'hook']).default('hook'),
        event: z.enum(['planted', 'progressing', 'resolved', 'abandoned']).default('progressing'),
        evidence: z.string().max(300).default('')
      })
    )
    .max(30)
    .default([])
})

export type MemoryDraft = z.infer<typeof memoryDraftSchema>