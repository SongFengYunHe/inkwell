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