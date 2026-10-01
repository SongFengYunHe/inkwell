import type { AuditCheck, AuditConfig, AuditReport, ChapterBrief, Project } from '@shared/types'
import { getAuditConfig } from '../db/audit-config-repo'
import { invokeJson } from '../llm/invoke'
import { auditIssuesSchema } from '../llm/schemas'
import { buildAuditMessages } from '../prompts/zh-CN'
import { buildTruthSnapshot } from './truth'
import { FILLER_PHRASES, detectParallelism } from './rules'
import { auditStyleDeterministic } from './style-audit'

/** 把文本切成段落（忽略空行） */
function paragraphsOf(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
}

/** 把文本切成句子 */
function sentencesOf(text: string): string[] {
  return text
    .split(/[。！？!?；;\n]/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2)
}

/** 中文场景下的净字数：忽略空白 */
export function plainLength(text: string): number {
  return text.replace(/\s/g, '').length
}

/**
 * 从一段提示性文本里抽取候选关键词（按标点切分，保留 2 字以上的片段），
 * 用于判断"关键事件 / 钩子"是否在正文里有所落点。
 */
function termsOf(text: string): string[] {
  return text
    .split(/[，。、；：,.;:!?！？\s"'（）()【】[\]{}《》—…·]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
}

/** 覆盖率：正文命中任一候选片段（或片段前三字）即算覆盖 */
function coverageRatio(content: string, terms: string[]): { hit: number; total: number } {
  const unique = [...new Set(terms)]
  if (unique.length === 0) return { hit: 0, total: 0 }
  let hit = 0
  for (const term of unique) {
    if (content.includes(term) || (term.length > 3 && content.includes(term.slice(0, 3)))) hit += 1
  }
  return { hit, total: unique.length }
}

/** 找出包含指定片段的首个段落序号（找不到返回 undefined） */
function paragraphIndexOf(paragraphs: string[], needle: string): number | undefined {
  if (!needle) return undefined
  const index = paragraphs.findIndex((paragraph) => paragraph.includes(needle))
  return index >= 0 ? index : undefined
}

/** 审计用套话表：在「定点修复」可删表的基础上，补充仅检测的项 */
const DETECT_PHRASES = [...FILLER_PHRASES, '让我们']

/** 确定性审计维度（不调用模型，零成本、可解释） */
export function deterministicAudit(
  project: Project,
  brief: ChapterBrief | null,
  content: string,
  previousContent: string
): AuditCheck[] {
  const checks: AuditCheck[] = []
  const plain = plainLength(content)
  const target = project.wordsPerChapter
  const paragraphs = paragraphsOf(content)
  const sentences = sentencesOf(content)

  // 1. 字数
  const lengthOk = plain >= target * 0.7 && plain <= target * 1.3
  checks.push({
    dimension: '字数达标',
    passed: lengthOk,
    severity: 'error',
    detail: `当前 ${plain} 字，目标 ${target} 字（允许 ±30%）`
  })

  // 2. Markdown 残留
  const markdownLike = /(^|\n)\s*#{1,6}\s|(^|\n)\s*[-*]\s|\*\*|`/.test(content)
  checks.push({
    dimension: '无 Markdown 残留',
    passed: !markdownLike,
    severity: 'error',
    detail: markdownLike ? '疑似包含 # / 列表 / 加粗 / 代码标记' : '未发现 Markdown 标记'
  })

  // 3. 章节标题行
  const titleLine = /(^|\n)\s*第\s*[0-9一二三四五六七八九十百零]+\s*章/.test(content)
  checks.push({
    dimension: '无章节标题行',
    passed: !titleLine,
    severity: 'error',
    detail: titleLine ? '正文里出现「第 N 章」标题行，应只保留正文' : '未发现标题行'
  })

  // 4. AI 腔套话
  const hitPhrases = DETECT_PHRASES.filter((phrase) => content.includes(phrase))
  checks.push({
    dimension: '无 AI 腔套话',
    passed: hitPhrases.length === 0,
    severity: 'warn',
    detail: hitPhrases.length ? `命中固定套话：${hitPhrases.join('、')}` : '未命中内置套话表',
    evidence: hitPhrases[0],
    paragraph: hitPhrases.length ? paragraphIndexOf(paragraphs, hitPhrases[0]) : undefined
  })

  // 5. 细纲角色出场
  const missing = (brief?.characters ?? []).filter((name) => name && !content.includes(name))
  checks.push({
    dimension: '细纲角色均出场',
    passed: missing.length === 0,
    severity: 'warn',
    detail: missing.length ? `未在正文出现：${missing.join('、')}` : '细纲角色全部出场'
  })

  // 6. 关键事件覆盖
  const eventCoverage = coverageRatio(content, termsOf(brief?.keyEvents ?? ''))
  const eventOk = eventCoverage.total === 0 || eventCoverage.hit / eventCoverage.total >= 0.34
  checks.push({
    dimension: '关键事件已覆盖',
    passed: eventOk,
    severity: 'warn',
    detail:
      eventCoverage.total === 0
        ? '细纲未提供关键事件，跳过'
        : `命中 ${eventCoverage.hit}/${eventCoverage.total} 个关键片段`
  })

  // 7. 悬念钩子呼应
  const hookCoverage = coverageRatio(content, termsOf(brief?.suspenseHook ?? ''))
  const hookOk = hookCoverage.total === 0 || hookCoverage.hit >= 1
  checks.push({
    dimension: '悬念钩子有呼应',
    passed: hookOk,
    severity: 'warn',
    detail:
      hookCoverage.total === 0 ? '细纲未提供悬念钩子，跳过' : `钩子片段命中 ${hookCoverage.hit}/${hookCoverage.total}`
  })

  // 8. 段落长度
  const longest = paragraphs.reduce((max, item) => Math.max(max, plainLength(item)), 0)
  const longestIndex = paragraphs.findIndex((item) => plainLength(item) === longest)
  checks.push({
    dimension: '段落长度适中',
    passed: longest <= 500,
    severity: 'info',
    detail: paragraphs.length === 0 ? '正文为空' : `最长段落 ${longest} 字（建议 ≤500）`,
    paragraph: longest > 500 && longestIndex >= 0 ? longestIndex : undefined
  })

  // 9. 相邻重复句
  let duplicate = ''
  for (let index = 1; index < sentences.length; index += 1) {
    if (sentences[index].length >= 8 && sentences[index] === sentences[index - 1]) {
      duplicate = sentences[index]
      break
    }
  }
  checks.push({
    dimension: '无相邻重复句',
    passed: duplicate === '',
    severity: 'warn',
    detail: duplicate ? '存在相邻完全重复的句子' : '未发现相邻重复句',
    evidence: duplicate || undefined,
    paragraph: duplicate ? paragraphIndexOf(paragraphs, duplicate) : undefined
  })

  // 10. 与前章不重复
  const prevTail = previousContent.replace(/\s/g, '').slice(-30)
  const prevDup = prevTail.length >= 20 && content.replace(/\s/g, '').includes(prevTail)
  checks.push({
    dimension: '与前章不重复',
    passed: !prevDup,
    severity: 'warn',
    detail: prevDup ? '本章出现了与上一章结尾完全相同的片段' : '与上一章内容未重复'
  })

  // 11. 口头禅密度：统计 2-gram 最高频
  const grams = new Map<string, number>()
  const compact = content.replace(/[\s\p{P}]/gu, '')
  for (let index = 0; index + 2 <= compact.length; index += 1) {
    const gram = compact.slice(index, index + 2)
    grams.set(gram, (grams.get(gram) ?? 0) + 1)
  }
  const topGram = [...grams.entries()].sort((a, b) => b[1] - a[1])[0]
  const gramLimit = Math.max(12, Math.ceil(compact.length * 0.02))
  const gramOk = !topGram || topGram[1] <= gramLimit
  checks.push({
    dimension: '口头禅密度不超标',
    passed: gramOk,
    severity: 'warn',
    detail: topGram ? `最高频二字组合「${topGram[0]}」出现 ${topGram[1]} 次（阈值 ${gramLimit}）` : '正文为空'
  })

  // 12. 章节有收尾段
  const lastParagraph = paragraphs[paragraphs.length - 1] ?? ''
  checks.push({
    dimension: '章节有收尾段',
    passed: paragraphs.length >= 3 && plainLength(lastParagraph) >= 10,
    severity: 'info',
    detail: paragraphs.length < 3 ? `段落过少（${paragraphs.length} 段）` : `末段 ${plainLength(lastParagraph)} 字`
  })

  // 13. 排比 / 同构堆砌（反 AI 味）
  const parallelParagraphs = detectParallelism(content)
  checks.push({
    dimension: '无排比堆砌',
    passed: parallelParagraphs.length === 0,
    severity: 'warn',
    detail: parallelParagraphs.length
      ? `${parallelParagraphs.length} 个段落出现 3 句以上同构句式`
      : '未发现明显排比堆砌',
    paragraph: parallelParagraphs[0]
  })

  // 14. 标点使用规范
  const punctuationMatch = content.match(/([！？!?])\1{2,}|[。，]{2,}/)
  checks.push({
    dimension: '标点使用规范',
    passed: punctuationMatch === null,
    severity: 'info',
    detail: punctuationMatch ? '存在连续重复标点（如 ！！！ 或 。。）' : '标点使用正常',
    evidence: punctuationMatch?.[0],
    paragraph: punctuationMatch ? paragraphIndexOf(paragraphs, punctuationMatch[0]) : undefined
  })

  return checks
}

/* ---------------------- M10：审计配置（维度开关 / 严重度闸门） ---------------------- */

const SEVERITY_RANK: Record<AuditCheck['severity'], number> = { info: 0, warn: 1, error: 2 }

/**
 * 某维度是否被配置关闭。
 * 除精确匹配外，支持用「语义」关闭全部语义维度（各语义维度形如 `语义·OOC 出戏`）。
 */
export function isDimensionDisabled(dimension: string, disabledDimensions: string[]): boolean {
  return disabledDimensions.some((disabled) => {
    if (!disabled) return false
    if (disabled === dimension) return true
    if (dimension.startsWith(disabled + '·')) return true
    return disabled === '语义' && dimension.startsWith('语义')
  })
}

/** 按配置过滤掉被关闭的维度（返回新数组；无关闭项时原样返回） */
export function filterDisabledChecks(checks: AuditCheck[], config: AuditConfig): AuditCheck[] {
  if (config.disabledDimensions.length === 0) return checks
  return checks.filter((check) => !isDimensionDisabled(check.dimension, config.disabledDimensions))
}

export interface AuditVerdict {
  /** 是否算「不通过」：仅统计达到闸门的失败项 */
  passed: boolean
  /** 0–100 的评分 */
  score: number
  /** 计入不通过的失败项数量 */
  failing: number
}

/**
 * 按配置计算「是否不通过」与评分：
 * - 低于 minSeverity 的问题（默认 info）既不参与评分，也不算不通过；
 * - countWarnAsFail=false 时 warn 不计入不通过闸门（但仍会拉低评分，评分反映真实缺陷密度）；
 * - countWarnAsFail=true 时 warn 与 error 一样会导致不通过。
 */
export function evaluateAudit(checks: AuditCheck[], config: AuditConfig): AuditVerdict {
  const floor = SEVERITY_RANK[config.minSeverity]
  const softFails = checks.filter((check) => !check.passed && SEVERITY_RANK[check.severity] >= floor).length
  const failing = checks.filter((check) => {
    if (check.passed) return false
    if (SEVERITY_RANK[check.severity] < floor) return false
    if (check.severity === 'warn' && !config.countWarnAsFail) return false
    return true
  }).length

  return {
    passed: failing === 0,
    score: checks.length === 0 ? 0 : Math.round(((checks.length - softFails) / checks.length) * 100),
    failing
  }
}

export interface AuditInput {
  project: Project
  brief: ChapterBrief | null
  content: string
  previousContent: string
  /** 是否调用 reviewer 模型补充语义审计（OOC / 设定冲突 / 时间线） */
  useModel?: boolean
  signal?: AbortSignal
}

/** 模型补充的语义审计；失败或超时不影响确定性结果 */
async function modelAudit(input: AuditInput): Promise<AuditCheck[]> {
  if (!input.useModel || !input.brief) return []
  const snapshot = buildTruthSnapshot(input.project.id, input.brief.chapterNo)

  try {
    const parsed = await invokeJson(
      {
        role: 'reviewer',
        messages: buildAuditMessages({
          bookTitle: input.project.name,
          genre: input.project.genre,
          worldbuilding: input.project.worldbuilding,
          protagonist: input.project.protagonist,
          chapterNo: input.brief.chapterNo,
          chapterTitle: input.brief.title,
          keyEvents: input.brief.keyEvents,
          characters: input.brief.characters,
          characterStates: snapshot.characterStates,
          pendingHooks: snapshot.pendingHooks,
          previousSummary: snapshot.previousSummary,
          content: input.content
        }),
        signal: input.signal,
        temperature: 0.1
      },
      (raw) => auditIssuesSchema.parse(raw)
    )

    return parsed.issues.map((issue) => ({
      dimension: `语义·${issue.dimension}`,
      passed: false,
      severity: issue.severity,
      detail: issue.detail,
      evidence: issue.evidence || undefined
    }))
  } catch {
    // 语义审计属于增强项：拿不到结构化结果就静默跳过，不阻断流水线
    return []
  }
}

/** 完整审计：14 个确定性维度 + 可选的语义维度（结果会按 audit_config 过滤与判定） */
export async function auditChapter(input: AuditInput): Promise<AuditReport> {
  const chapterNo = input.brief?.chapterNo ?? 0
  const config = getAuditConfig()
  const checks = deterministicAudit(input.project, input.brief, input.content, input.previousContent)
  const semantic = await modelAudit(input)
  const modelAssisted = input.useModel === true

  if (modelAssisted) {
    checks.push({
      dimension: '语义审计（OOC / 设定 / 时间线 / 伏笔 / 称谓）',
      passed: semantic.length === 0,
      severity: 'warn',
      detail: semantic.length === 0 ? '模型未发现可证实的语义矛盾' : `模型报告 ${semantic.length} 处疑似矛盾`
    })
  }
  checks.push(...semantic)

  // M10 §4.2：过滤被关闭的维度，再按严重度闸门重算「是否不通过 / 评分」
  const visible = filterDisabledChecks(checks, config)
  const verdict = evaluateAudit(visible, config)

  // M10 §4.1：附上本章文风贴合度（尚未生成画像时给与题材无关的通用基线分）
  const style = auditStyleDeterministic({ projectId: input.project.id, chapterNo })

  return {
    chapterNo,
    passed: verdict.passed,
    score: verdict.score,
    checks: visible,
    modelAssisted,
    createdAt: Date.now(),
    styleScore: style.score,
    styleChecks: style.checks
  }
}