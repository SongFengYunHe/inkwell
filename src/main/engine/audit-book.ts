import type {
  AuditCheck,
  AuditReport,
  BookAuditChapterResult,
  BookAuditDimensionStat,
  BookAuditEstimate,
  BookAuditProgress,
  BookAuditSummary,
  ChapterBrief,
  Project
} from '@shared/types'
import { getProject, listBriefs, listDrafts } from '../db/repositories'
import { auditChapter, deterministicAudit } from './audit'

/**
 * 全书一键体检（M8 §5.2）。
 *
 * - 默认只跑**确定性审计**（复用 audit.ts 的纯函数 deterministicAudit，13+ 维度，零成本、不联网）。
 * - 模型语义审计（auditChapter 的 useModel 路径）**显式 opt-in**：调用方需带 confirm=true，
 *   在此之前先用 estimateBookAudit 给出 token 预估并提示用户，避免「整本审计烧 token」。
 * - 逐章可中止：通过 AbortSignal（由 IPC 层 registerAborter 登记，退出时统一中断）。
 */

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
  content: string
  previousContent: string
}

/** 取「有正文的章节」并装配每章上下文（最新版本草稿 + 上一章正文） */
function collectChapters(projectId: number): { project: Project | null; units: AuditChapterUnit[] } {
  const project = getProject(projectId)
  const briefs = listBriefs(projectId)
  const drafts = listDrafts(projectId)

  // listDrafts 已按 (chapterNo asc, version desc) 排序，每章首次出现即最新版本
  const latestByChapter = new Map<number, string>()
  for (const draft of drafts) {
    if (!latestByChapter.has(draft.chapterNo)) latestByChapter.set(draft.chapterNo, draft.content)
  }

  const units: AuditChapterUnit[] = []
  for (const [chapterNo, content] of latestByChapter) {
    if (!content.trim()) continue
    units.push({
      chapterNo,
      title: briefs.find((brief) => brief.chapterNo === chapterNo)?.title ?? '',
      brief: briefs.find((brief) => brief.chapterNo === chapterNo) ?? null,
      content,
      previousContent: latestByChapter.get(chapterNo - 1) ?? ''
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

/** 模型语义审计的 token 预估（供「是否继续」提示） */
export function estimateBookAudit(projectId: number): BookAuditEstimate {
  const { units } = collectChapters(projectId)
  let promptTokens = 0
  for (const unit of units) {
    const briefText = unit.brief
      ? [unit.brief.title, unit.brief.purpose, unit.brief.keyEvents, unit.brief.suspenseHook].join('\n')
      : ''
    // +300 近似提示词模板与真相快照的固定开销
    promptTokens += estimateTokens(unit.content + '\n' + briefText) + 300
  }
  const completionTokens = units.length * 300
  return { chapters: units.length, promptTokens, estTotalTokens: promptTokens + completionTokens }
}

/** 用确定性检查拼一个 AuditReport（与 auditChapter 的输出形态一致） */
function reportFromChecks(chapterNo: number, checks: AuditCheck[]): AuditReport {
  const failedErrors = checks.filter((check) => !check.passed && check.severity === 'error').length
  const passedCount = checks.filter((check) => check.passed).length
  return {
    chapterNo,
    passed: failedErrors === 0,
    score: checks.length === 0 ? 0 : Math.round((passedCount / checks.length) * 100),
    checks,
    modelAssisted: false,
    createdAt: Date.now()
  }
}

export async function auditBook(options: AuditBookOptions): Promise<BookAuditSummary> {
  const { project, units } = collectChapters(options.projectId)
  if (!project) throw new Error(`项目不存在：${options.projectId}`)

  const useModel = options.useModel === true
  const results: BookAuditChapterResult[] = []
  const dimensionMap = new Map<string, BookAuditDimensionStat>()

  for (let index = 0; index < units.length; index += 1) {
    if (options.signal?.aborted) throw new Error('已停止')

    const unit = units[index]
    options.onProgress?.({
      chapterNo: unit.chapterNo,
      done: index,
      total: units.length,
      message: useModel ? `正在审计第 ${unit.chapterNo} 章（含模型语义）…` : `正在体检第 ${unit.chapterNo} 章…`
    })

    const report = useModel
      ? await auditChapter({
          project,
          brief: unit.brief,
          content: unit.content,
          previousContent: unit.previousContent,
          useModel: true,
          signal: options.signal
        })
      : reportFromChecks(unit.chapterNo, deterministicAudit(project, unit.brief, unit.content, unit.previousContent))

    results.push({ chapterNo: unit.chapterNo, title: unit.title, report })

    for (const check of report.checks) {
      const stat = dimensionMap.get(check.dimension) ?? { dimension: check.dimension, total: 0, failed: 0 }
      stat.total += 1
      if (!check.passed) stat.failed += 1
      dimensionMap.set(check.dimension, stat)
    }

    options.onProgress?.({
      chapterNo: unit.chapterNo,
      done: index + 1,
      total: units.length,
      message: `第 ${unit.chapterNo} 章完成`
    })
  }

  const dimensions = [...dimensionMap.values()].sort((a, b) => b.failed - a.failed || a.dimension.localeCompare(b.dimension))
  const totalIssues = results.reduce((sum, result) => sum + result.report.checks.filter((check) => !check.passed).length, 0)

  return {
    projectId: options.projectId,
    chapters: results,
    dimensions,
    totalIssues,
    modelAssisted: useModel,
    createdAt: Date.now()
  }
}