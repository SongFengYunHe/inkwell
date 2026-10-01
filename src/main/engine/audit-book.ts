import { and, desc, eq } from 'drizzle-orm'
import type {
  AuditCheck,
  AuditReport,
  BookAuditChapterResult,
  BookAuditDimensionStat,
  BookAuditEstimate,
  BookAuditProgress,
  BookAuditSummary,
  ChapterBrief,
  ChapterDraft,
  Project
} from '@shared/types'
import { getDb } from '../db/client'
import { auditRun } from '../db/schema'
import { getAuditConfig } from '../db/audit-config-repo'
import { getProject, listBriefs, listDrafts } from '../db/repositories'
import { getLatestReview, saveReview } from '../db/memory-repo'
import { auditChapter, deterministicAudit, evaluateAudit, filterDisabledChecks, plainLength } from './audit'
import { auditStyleDeterministic } from './style-audit'

/**
 * 全书一键体检（M8 §5.2）+ R7（断点续跑 + 预估校准）。
 *
 * - 默认只跑**确定性审计**（复用 audit.ts 的纯函数 deterministicAudit，14 维度，零成本、不联网）。
 * - 模型语义审计（auditChapter 的 useModel 路径）**显式 opt-in**：调用方需带 confirm=true，
 *   在此之前先用 estimateBookAudit 给出 token 预估并提示用户，避免「整本审计烧 token」。
 * - 逐章可中止：通过 AbortSignal（由 IPC 层 registerAborter 登记，退出时统一中断）。
 * - R7：任务落 audit_run 表（开始 running，每章更新 cursor，结束 done/failed/aborted）；
 *   已有同口径 running 任务时从 cursor 继续，跳过已完成章节（复用 review 表里的报告）。
 */

/** R7：整本审计任务（audit_run）的内存形态 */
export interface AuditRunInfo {
  id: number
  projectId: number
  useModel: boolean
  status: 'running' | 'done' | 'failed' | 'aborted'
  /** 已完成的章节序号（用于断点续跑） */
  cursor: number
  total: number
  /** 任务开始时的 token 预估（按实际字数分档） */
  estTokens: number
  error: string
  createdAt: number
  updatedAt: number
}

export interface AuditBookOptions {
  projectId: number
  useModel?: boolean
  signal?: AbortSignal
  onProgress?: (progress: BookAuditProgress) => void
}

interface AuditChapterUnit {
  chapterNo: number
  title: string
  brief: ChapterBrief | null
  draftId: number
  content: string
  previousContent: string
}

/** 取「有正文的章节」并装配每章上下文（最新版本草稿 + 上一章正文） */
function collectChapters(projectId: number): { project: Project | null; units: AuditChapterUnit[] } {
  const project = getProject(projectId)
  const briefs = listBriefs(projectId)
  const drafts = listDrafts(projectId)

  // listDrafts 已按 (chapterNo asc, version desc) 排序，每章首次出现即最新版本
  const latestByChapter = new Map<number, ChapterDraft>()
  for (const draft of drafts) {
    if (!latestByChapter.has(draft.chapterNo)) latestByChapter.set(draft.chapterNo, draft)
  }

  const units: AuditChapterUnit[] = []
  for (const [chapterNo, draft] of latestByChapter) {
    if (!draft.content.trim()) continue
    units.push({
      chapterNo,
      title: briefs.find((brief) => brief.chapterNo === chapterNo)?.title ?? '',
      brief: briefs.find((brief) => brief.chapterNo === chapterNo) ?? null,
      draftId: draft.id,
      content: draft.content,
      previousContent: latestByChapter.get(chapterNo - 1)?.content ?? ''
    })
  }
  units.sort((a, b) => a.chapterNo - b.chapterNo)
  return { project, units }
}

/** 中文为主的粗略 token 估算（与 llm/invoke.ts 同口径） */
function estimateTokens(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  const rest = text.length - cjk
  return Math.max(1, Math.round(cjk + rest / 4))
}

/**
 * R7：按实际字数分档估算「每章模型输出」token，替代原来的「每章固定 300」。
 * 中文正文按 1 字 ≈ 1 token 计输入；输出按章节规模分档（越长的章节问题清单越长）。
 */
function estimateOutputTokens(plainChars: number): number {
  if (plainChars < 500) return 200
  if (plainChars < 1_500) return 320
  if (plainChars < 3_000) return 500
  if (plainChars < 6_000) return 800
  return 1_200
}

/** 逐章累加 token 预估：输入按真实字数，输出按字数分档 */
function estimateTokensForUnits(units: AuditChapterUnit[]): { promptTokens: number; totalTokens: number } {
  let promptTokens = 0
  let completionTokens = 0
  for (const unit of units) {
    const briefText = unit.brief
      ? [unit.brief.title, unit.brief.purpose, unit.brief.keyEvents, unit.brief.suspenseHook].join('\n')
      : ''
    // +300 近似提示词模板与真相快照的固定开销
    promptTokens += estimateTokens(unit.content + '\n' + briefText) + 300
    completionTokens += estimateOutputTokens(plainLength(unit.content))
  }
  return { promptTokens, totalTokens: promptTokens + completionTokens }
}

/** 模型语义审计的 token 预估（供「是否继续」提示）；签名与返回类型保持不变 */
export function estimateBookAudit(projectId: number): BookAuditEstimate {
  const { units } = collectChapters(projectId)
  const { promptTokens, totalTokens } = estimateTokensForUnits(units)
  return { chapters: units.length, promptTokens, estTotalTokens: totalTokens }
}

/** 用确定性检查拼一个 AuditReport（与 auditChapter 的输出形态一致，同样读 audit_config） */
function reportFromChecks(projectId: number, chapterNo: number, checks: AuditCheck[]): AuditReport {
  const config = getAuditConfig()
  const visible = filterDisabledChecks(checks, config)
  const verdict = evaluateAudit(visible, config)
  const style = auditStyleDeterministic({ projectId, chapterNo })
  return {
    chapterNo,
    passed: verdict.passed,
    score: verdict.score,
    checks: visible,
    modelAssisted: false,
    createdAt: Date.now(),
    styleScore: style.score,
    styleChecks: style.checks
  }
}

/* ------------------------------ R7：任务落库 ------------------------------ */

type AuditRunRow = typeof auditRun.$inferSelect

function toRunInfo(row: AuditRunRow): AuditRunInfo {
  const status: AuditRunInfo['status'] =
    row.status === 'done' || row.status === 'failed' || row.status === 'aborted' ? row.status : 'running'
  return {
    id: row.id,
    projectId: row.projectId,
    useModel: row.useModel === true,
    status,
    cursor: row.cursor,
    total: row.total,
    estTokens: row.estTokens,
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

/** 项目最近一次整本审计任务（含 running / done / failed / aborted），无则 null */
export function latestAuditRun(projectId: number): AuditRunInfo | null {
  try {
    const row = getDb()
      .select()
      .from(auditRun)
      .where(eq(auditRun.projectId, projectId))
      .orderBy(desc(auditRun.id))
      .limit(1)
      .get()
    return row ? toRunInfo(row) : null
  } catch {
    return null
  }
}

function findRunningRun(projectId: number): AuditRunInfo | null {
  const row = getDb()
    .select()
    .from(auditRun)
    .where(and(eq(auditRun.projectId, projectId), eq(auditRun.status, 'running')))
    .orderBy(desc(auditRun.id))
    .limit(1)
    .get()
  return row ? toRunInfo(row) : null
}

function createAuditRun(projectId: number, useModel: boolean, total: number, estTokens: number): AuditRunInfo {
  const now = Date.now()
  const row = getDb()
    .insert(auditRun)
    .values({
      projectId,
      useModel,
      status: 'running',
      cursor: 0,
      total,
      estTokens,
      error: '',
      createdAt: now,
      updatedAt: now
    })
    .returning()
    .get()
  return toRunInfo(row)
}

function updateAuditRun(
  id: number,
  patch: Partial<Pick<AuditRunInfo, 'status' | 'cursor' | 'total' | 'estTokens' | 'error'>>
): void {
  getDb()
    .update(auditRun)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(auditRun.id, id))
    .run()
}

/**
 * R7：整本审计（可断点续跑）。
 *
 * - 有同口径（同 useModel、同章节数）的 running 任务时从 cursor 继续；否则新建任务，
 *   并把残留的 running 任务标记为 aborted。
 * - 从 cursor 继续时，已完成章节直接复用 review 表里已有的报告（拿不到就重审）。
 * - 每章报告只在「该章尚无报告」时落 review 表，避免覆盖此前的模型审计报告（M9 缺陷 #15）。
 */
export async function resumeAuditBook(input: {
  projectId: number
  useModel: boolean
  signal?: AbortSignal
  onProgress?: (progress: BookAuditProgress) => void
}): Promise<BookAuditSummary> {
  const { project, units } = collectChapters(input.projectId)
  if (!project) throw new Error(`项目不存在：${input.projectId}`)

  const useModel = input.useModel === true
  const { totalTokens } = estimateTokensForUnits(units)

  const existing = findRunningRun(input.projectId)
  let run: AuditRunInfo
  if (existing && existing.useModel === useModel && existing.total === units.length) {
    run = existing
  } else {
    if (existing) updateAuditRun(existing.id, { status: 'aborted', error: '被新的整本审计任务取代' })
    run = createAuditRun(input.projectId, useModel, units.length, totalTokens)
  }

  const results: BookAuditChapterResult[] = []
  const dimensionMap = new Map<string, BookAuditDimensionStat>()
  let cursor = run.cursor

  try {
    for (let index = 0; index < units.length; index += 1) {
      if (input.signal?.aborted) {
        updateAuditRun(run.id, { status: 'aborted', cursor, error: '已停止' })
        throw new Error('已停止')
      }

      const unit = units[index]
      input.onProgress?.({
        chapterNo: unit.chapterNo,
        done: index,
        total: units.length,
        message: useModel ? `正在审计第 ${unit.chapterNo} 章（含模型语义）…` : `正在体检第 ${unit.chapterNo} 章…`
      })

      const stored = getLatestReview(input.projectId, unit.chapterNo)
      let report: AuditReport | null = index < run.cursor ? stored : null

      if (!report) {
        report = useModel
          ? await auditChapter({
              project,
              brief: unit.brief,
              content: unit.content,
              previousContent: unit.previousContent,
              useModel: true,
              signal: input.signal
            })
          : reportFromChecks(
              input.projectId,
              unit.chapterNo,
              deterministicAudit(project, unit.brief, unit.content, unit.previousContent)
            )

        // 断点复跑依赖 review 表；仅在尚无报告时落库，避免覆盖模型审计报告
        if (!stored) saveReview(input.projectId, unit.chapterNo, unit.draftId, report)
      }

      results.push({ chapterNo: unit.chapterNo, title: unit.title, report })

      for (const check of report.checks) {
        const stat = dimensionMap.get(check.dimension) ?? { dimension: check.dimension, total: 0, failed: 0 }
        stat.total += 1
        if (!check.passed) stat.failed += 1
        dimensionMap.set(check.dimension, stat)
      }

      cursor = index + 1
      updateAuditRun(run.id, { cursor })
      input.onProgress?.({
        chapterNo: unit.chapterNo,
        done: index + 1,
        total: units.length,
        message: `第 ${unit.chapterNo} 章完成`
      })
    }

    updateAuditRun(run.id, { status: 'done', cursor: units.length })
  } catch (error) {
    updateAuditRun(run.id, {
      status: input.signal?.aborted ? 'aborted' : 'failed',
      cursor,
      error: error instanceof Error ? error.message : String(error)
    })
    throw error
  }

  const dimensions = [...dimensionMap.values()].sort((a, b) => b.failed - a.failed || a.dimension.localeCompare(b.dimension))
  const totalIssues = results.reduce((sum, result) => sum + result.report.checks.filter((check) => !check.passed).length, 0)

  return {
    projectId: input.projectId,
    chapters: results,
    dimensions,
    totalIssues,
    modelAssisted: useModel,
    createdAt: Date.now()
  }
}

/** 全书一键体检；签名与返回类型保持不变，内部复用 resumeAuditBook（断点续跑） */
export async function auditBook(options: AuditBookOptions): Promise<BookAuditSummary> {
  return resumeAuditBook({
    projectId: options.projectId,
    useModel: options.useModel === true,
    signal: options.signal,
    onProgress: options.onProgress
  })
}
