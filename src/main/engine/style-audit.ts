import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import type { AuditReport, StyleAuditReport, StyleCheck, StyleProfile } from '@shared/types'
import { getDb } from '../db/client'
import { chapterDraft, review } from '../db/schema'
import { invokeJson } from '../llm/invoke'
import { FILLER_PHRASES } from './rules'
import { getStyleProfile } from './style'

/**
 * M10 §4.1 文风一致性打分（style.audit）。
 *
 * 定位：A2 只把「文风画像」落库并注入提示词，用户无从判断「写出来像不像」。
 * 这里用一批**确定性文本指标**（不调模型、零成本、可复现）把画像逐项对照出 0–100 的贴合度，
 * 再可选地让 reviewer 角色挑出「最不像的 3 段」。
 *
 * 没有画像时退化为与题材无关的通用基线（句式是否单调 / 是否有 AI 腔套话），
 * 并在每项 detail 里明确标注「尚未生成文风画像，当前为通用基线」。
 */

/** 无画像时每项检查 detail 都会带上这句，便于 UI 与用户解释分数来源 */
export const STYLE_BASELINE_NOTE = '尚未生成文风画像，当前为通用基线'

/** 确定性指标在总分里的权重（画像路径）；通用基线的两项走等权兜底 */
const DIMENSION_WEIGHTS: Record<string, number> = {
  平均句长: 0.18,
  对话占比: 0.14,
  段落长度分布: 0.14,
  标志性用词命中率: 0.16,
  禁用写法命中: 0.16,
  比喻密度: 0.11,
  重复词密度: 0.11
}

/** 除内置套话表外，额外用于「AI 腔套话」通用基线的表达 */
const AI_ISH_PHRASES = [
  '不禁',
  '缓缓地',
  '眼中闪过',
  '嘴角勾起',
  '空气中弥漫',
  '仿佛整个世界',
  '心中一凛',
  '五味杂陈'
]

const DIALOGUE_RE = /「[^」]*」|『[^』]*』|“[^”]*”|"[^"]*"/
const METAPHOR_RE = /像|如|似|仿佛|宛如|犹如|好像|恍若|恰似|好比/

/* ------------------------------- 基础工具 ------------------------------- */

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function stdevOf(values: number[]): number {
  if (values.length < 2) return 0
  const avg = mean(values)
  return Math.sqrt(mean(values.map((value) => (value - avg) ** 2)))
}

function paragraphsOf(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function sentencesOf(text: string): string[] {
  return text
    .split(/[。！？!?；;…\n]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2)
}

function plainLength(text: string): number {
  return text.replace(/\s/g, '').length
}

function countOccurrences(text: string, needle: string): number {
  if (!needle) return 0
  return text.split(needle).length - 1
}

/** 取某章最新一版正文（直接查 chapter_draft，避免整本审计时反复加载全项目正文） */
function latestContent(projectId: number, chapterNo: number): string {
  try {
    const row = getDb()
      .select({ content: chapterDraft.content })
      .from(chapterDraft)
      .where(
        and(
          eq(chapterDraft.projectId, projectId),
          eq(chapterDraft.chapterNo, chapterNo),
          isNull(chapterDraft.deletedAt)
        )
      )
      .orderBy(desc(chapterDraft.version))
      .limit(1)
      .get()
    return row?.content ?? ''
  } catch {
    return ''
  }
}

function safeProfile(projectId: number): StyleProfile | null {
  try {
    return getStyleProfile(projectId)
  } catch {
    return null
  }
}

/* --------------------------- 画像 → 期望值推导 --------------------------- */

/** 画像里的句式描述是自然语言，这里做保守的关键词映射 */
function sentenceTarget(profile: StyleProfile): { avg: number; minStdev: number } {
  const text = profile.sentence
  const short = /短句|简短|简洁/.test(text)
  const long = /长句|绵长/.test(text)
  if (short && !long) return { avg: 16, minStdev: 6 }
  if (long && !short) return { avg: 34, minStdev: 30 }
  if (/交错|参差|长短/.test(text)) return { avg: 24, minStdev: 45 }
  return { avg: 24, minStdev: 15 }
}

function dialogueTarget(profile: StyleProfile): number {
  const text = profile.dialogue
  if (/无对话|零对话|没有对话/.test(text)) return 5
  if (/低|少|克制/.test(text)) return 15
  if (/高|多|密集/.test(text)) return 55
  return 30
}

function paragraphTarget(profile: StyleProfile): number {
  const text = profile.pacing
  if (/长段|段落长|大段/.test(text)) return 220
  if (/短段|段落短|分段多|切换频繁/.test(text)) return 70
  return 130
}

function imageryTarget(profile: StyleProfile): number {
  const text = profile.imagery
  if (/少|克制|朴素/.test(text)) return 8
  if (/密集|多|丰富/.test(text)) return 35
  return 18
}

/* ----------------------------- 逐项指标实现 ----------------------------- */

function profileChecks(content: string, profile: StyleProfile): StyleCheck[] {
  const checks: StyleCheck[] = []
  const sentences = sentencesOf(content)
  const paragraphs = paragraphsOf(content)

  // 1. 平均句长与句长起伏
  const sentenceLengths = sentences.map((sentence) => plainLength(sentence))
  const avgSentence = mean(sentenceLengths)
  const sentenceStdev = stdevOf(sentenceLengths)
  const sentenceGoal = sentenceTarget(profile)
  const avgPenalty = sentenceGoal.avg > 0 ? (Math.abs(avgSentence - sentenceGoal.avg) / sentenceGoal.avg) * 140 : 0
  const stdevPenalty =
    sentenceStdev >= sentenceGoal.minStdev
      ? 0
      : ((sentenceGoal.minStdev - sentenceStdev) / Math.max(1, sentenceGoal.minStdev)) * 30
  const sentenceScore = clampScore(100 - avgPenalty - stdevPenalty)
  checks.push({
    dimension: '平均句长',
    score: sentenceScore,
    actual: `平均 ${avgSentence.toFixed(1)} 字，句长标准差 ${sentenceStdev.toFixed(1)}`,
    expected: `画像「${profile.sentence || '未指定'}」→ 目标均长约 ${sentenceGoal.avg} 字、起伏 ≥ ${sentenceGoal.minStdev}`,
    passed: sentenceScore >= 60,
    detail:
      sentenceScore >= 85
        ? '句长节奏与画像接近'
        : `句长节奏偏离画像：均长差 ${Math.abs(avgSentence - sentenceGoal.avg).toFixed(1)} 字，起伏 ${sentenceStdev.toFixed(1)}`
  })

  // 2. 对话占比（成对引号包裹的段落比例）
  const dialogueParagraphs = paragraphs.filter((paragraph) => DIALOGUE_RE.test(paragraph)).length
  const dialogueRatio = paragraphs.length > 0 ? (dialogueParagraphs / paragraphs.length) * 100 : 0
  const dialogueGoal = dialogueTarget(profile)
  const dialogueScore = clampScore(100 - Math.abs(dialogueRatio - dialogueGoal) * 1.6)
  checks.push({
    dimension: '对话占比',
    score: dialogueScore,
    actual: `对话段落 ${dialogueParagraphs}/${paragraphs.length}（${dialogueRatio.toFixed(0)}%）`,
    expected: `画像「${profile.dialogue || '未指定'}」→ 目标约 ${dialogueGoal}%`,
    passed: dialogueScore >= 60,
    detail:
      dialogueScore >= 85
        ? '对话占比与画像接近'
        : `对话占比偏离画像约 ${Math.abs(dialogueRatio - dialogueGoal).toFixed(0)} 个百分点`
  })

  // 3. 段落长度分布
  const paragraphLengths = paragraphs.map((paragraph) => plainLength(paragraph))
  const avgParagraph = mean(paragraphLengths)
  const maxParagraph = paragraphLengths.reduce((max, value) => Math.max(max, value), 0)
  const paragraphGoal = paragraphTarget(profile)
  let paragraphScore = 100 - (Math.abs(avgParagraph - paragraphGoal) / Math.max(1, paragraphGoal)) * 120
  if (maxParagraph > 500) paragraphScore -= ((maxParagraph - 500) / 500) * 40
  const paragraphFinal = clampScore(paragraphScore)
  checks.push({
    dimension: '段落长度分布',
    score: paragraphFinal,
    actual: `${paragraphs.length} 段，均长 ${avgParagraph.toFixed(0)} 字，最长 ${maxParagraph} 字`,
    expected: `画像「${profile.pacing || '未指定'}」→ 目标段均长约 ${paragraphGoal} 字，单段 ≤ 500 字`,
    passed: paragraphFinal >= 60,
    detail:
      paragraphFinal >= 85
        ? '段落节奏与画像接近'
        : `段落节奏偏离画像：均长差 ${Math.abs(avgParagraph - paragraphGoal).toFixed(0)} 字`
  })

  // 4. 标志性用词命中率
  const keywords = profile.keywords.map((keyword) => keyword.trim()).filter(Boolean)
  const keywordHits = keywords.filter((keyword) => content.includes(keyword))
  const keywordScore = keywords.length === 0 ? 75 : clampScore((keywordHits.length / keywords.length) * 100)
  checks.push({
    dimension: '标志性用词命中率',
    score: keywordScore,
    actual:
      keywords.length === 0
        ? '画像未提供标志性用词'
        : `命中 ${keywordHits.length}/${keywords.length}（${keywordHits.join('、') || '无'}）`,
    expected: keywords.length === 0 ? '画像未提供标志性用词，跳过比对' : `标志性用词：${keywords.join('、')}`,
    passed: keywordScore >= 60,
    detail:
      keywords.length === 0
        ? '画像未提供标志性用词，本项按中性分处理'
        : keywordHits.length === keywords.length
          ? '全部标志性用词均已出现'
          : `有 ${keywords.length - keywordHits.length} 个标志性用词未出现`
  })

  // 5. 禁用写法命中
  const taboos = profile.taboos.map((taboo) => taboo.trim()).filter(Boolean)
  let tabooHits = 0
  const tabooHitNames: string[] = []
  for (const taboo of taboos) {
    const token = taboo
      .replace(/^(不要|避免|禁止|杜绝|严禁|切勿|别)+/, '')
      .replace(/[。！？!?；;，,、\s]/g, '')
      .trim()
    if (token.length < 2) continue
    const hits = countOccurrences(content, token)
    if (hits > 0) {
      tabooHits += hits
      tabooHitNames.push(`${token}×${hits}`)
    }
  }
  const tabooScore = taboos.length === 0 ? 75 : clampScore(100 - tabooHits * 25)
  checks.push({
    dimension: '禁用写法命中',
    score: tabooScore,
    actual: taboos.length === 0 ? '画像未提供禁用写法' : `命中 ${tabooHits} 次${tabooHitNames.length ? '（' + tabooHitNames.join('、') + '）' : ''}`,
    expected: taboos.length === 0 ? '画像未提供禁用写法，跳过比对' : `必须避免：${taboos.join('；')}`,
    passed: tabooScore >= 60,
    detail:
      taboos.length === 0
        ? '画像未提供禁用写法，本项按中性分处理'
        : tabooHits === 0
          ? '未命中画像里的禁用写法'
          : `命中 ${tabooHits} 次禁用写法`
  })

  // 6. 比喻密度
  const metaphorSentences = sentences.filter((sentence) => METAPHOR_RE.test(sentence)).length
  const metaphorRatio = sentences.length > 0 ? (metaphorSentences / sentences.length) * 100 : 0
  const imageryGoal = imageryTarget(profile)
  const metaphorScore = clampScore(100 - Math.abs(metaphorRatio - imageryGoal) * 1.5)
  checks.push({
    dimension: '比喻密度',
    score: metaphorScore,
    actual: `含比喻词的句子 ${metaphorSentences}/${sentences.length}（${metaphorRatio.toFixed(0)}%）`,
    expected: `画像「${profile.imagery || '未指定'}」→ 目标约 ${imageryGoal}%`,
    passed: metaphorScore >= 60,
    detail:
      metaphorScore >= 85 ? '比喻密度与画像接近' : `比喻密度偏离画像约 ${Math.abs(metaphorRatio - imageryGoal).toFixed(0)} 个百分点`
  })

  // 7. 重复词密度（二字组合最高频占比）
  const compact = content.replace(/[\s\p{P}]/gu, '')
  const counters = new Map<string, number>()
  for (let index = 0; index + 2 <= compact.length; index += 1) {
    const gram = compact.slice(index, index + 2)
    counters.set(gram, (counters.get(gram) ?? 0) + 1)
  }
  let topGram = ''
  let topCount = 0
  for (const [gram, hits] of counters) {
    if (hits > topCount) {
      topGram = gram
      topCount = hits
    }
  }
  const totalGrams = Math.max(0, compact.length - 1)
  const density = totalGrams > 0 ? (topCount / totalGrams) * 100 : 0
  const repeatScore = totalGrams < 8 ? 70 : clampScore(100 - Math.max(0, density - 4) * 10)
  checks.push({
    dimension: '重复词密度',
    score: repeatScore,
    actual: totalGrams < 8 ? '文本过短，跳过统计' : `最高频二字组合「${topGram}」${topCount} 次（${density.toFixed(1)}%）`,
    expected: '重复二字组合占比 ≤ 4%',
    passed: repeatScore >= 60,
    detail: totalGrams < 8 ? '文本过短，本项按中性分处理' : density <= 4 ? '重复用词在合理范围内' : `重复用词偏多（${density.toFixed(1)}%）`
  })

  return checks
}

/** 无画像时的通用基线：只判「句式是否单调」与「是否有 AI 腔套话」 */
function baselineChecks(content: string): StyleCheck[] {
  const sentences = sentencesOf(content)
  const sentenceLengths = sentences.map((sentence) => plainLength(sentence))
  const avgSentence = mean(sentenceLengths)
  const sentenceStdev = stdevOf(sentenceLengths)
  const varietyScore = sentences.length < 3 ? 60 : clampScore((sentenceStdev / 14) * 100)

  const phrases = [...FILLER_PHRASES, ...AI_ISH_PHRASES]
  const hitPhrases = phrases.filter((phrase) => content.includes(phrase))
  let hits = 0
  for (const phrase of hitPhrases) hits += countOccurrences(content, phrase)
  const aiScore = clampScore(100 - hits * 20)

  return [
    {
      dimension: '句式是否单调',
      score: varietyScore,
      actual: `平均 ${avgSentence.toFixed(1)} 字，句长标准差 ${sentenceStdev.toFixed(1)}`,
      expected: '句长起伏明显（标准差 ≥ 10），避免整段同构',
      passed: varietyScore >= 60,
      detail: `${STYLE_BASELINE_NOTE}：${varietyScore >= 60 ? '句式有起伏' : '句长过于整齐，读起来像模板生成'}`
    },
    {
      dimension: 'AI 腔套话',
      score: aiScore,
      actual: hits > 0 ? `命中 ${hits} 次：${hitPhrases.slice(0, 5).join('、')}` : '未命中套话表',
      expected: '不使用「总而言之 / 综上所述 / 不禁 / 眼中闪过」等模板化表达',
      passed: aiScore >= 60,
      detail: `${STYLE_BASELINE_NOTE}：${hits > 0 ? '存在模板化表达' : '未发现明显 AI 腔'}`
    }
  ]
}

function weightedScore(checks: StyleCheck[]): number {
  let total = 0
  let weight = 0
  for (const check of checks) {
    const itemWeight = DIMENSION_WEIGHTS[check.dimension] ?? 1 / Math.max(1, checks.length)
    total += check.score * itemWeight
    weight += itemWeight
  }
  return weight > 0 ? clampScore(total / weight) : 0
}

function buildReport(
  projectId: number,
  chapterNo: number,
  content: string,
  profile: StyleProfile | null
): StyleAuditReport {
  if (!content.trim()) {
    return {
      projectId,
      chapterNo,
      score: 0,
      checks: [
        {
          dimension: '正文可用性',
          score: 0,
          actual: '本章暂无正文',
          expected: '本章有可体检的正文',
          passed: false,
          detail: `${STYLE_BASELINE_NOTE}：本章暂无正文，无法做文风体检`
        }
      ],
      modelNotes: [],
      createdAt: Date.now()
    }
  }

  const checks = profile ? profileChecks(content, profile) : baselineChecks(content)
  const score = profile ? weightedScore(checks) : clampScore(mean(checks.map((check) => check.score)))
  return { projectId, chapterNo, score, checks, modelNotes: [], createdAt: Date.now() }
}

/* ------------------------------- 对外接口 ------------------------------- */

/** 确定性文风体检（纯本地、不调模型；画像不存在时给通用基线分） */
export function auditStyleDeterministic(input: { projectId: number; chapterNo: number }): StyleAuditReport {
  const content = latestContent(input.projectId, input.chapterNo)
  const profile = safeProfile(input.projectId)
  return buildReport(input.projectId, input.chapterNo, content, profile)
}

const styleUnlikeSchema = z.object({
  unlike: z
    .array(
      z.object({
        text: z.string().max(2_000),
        reason: z.string().max(1_000)
      })
    )
    .max(5)
    .default([])
})

/** 模型复核：挑出「最不像的 3 段」；失败或未配置模型时静默返回空数组，不影响确定性结果 */
async function modelStyleNotes(input: {
  projectId: number
  chapterNo: number
  signal?: AbortSignal
}): Promise<string[]> {
  const content = latestContent(input.projectId, input.chapterNo)
  if (!content.trim()) return []
  try {
    const parsed = await invokeJson(
      {
        role: 'reviewer',
        messages: [
          { role: 'system', content: '你是严谨的中文小说审稿人，只输出 JSON，不要解释。' },
          {
            role: 'user',
            content:
              `下面是第 ${input.chapterNo} 章正文。请挑出「最不像同一文风」的 3 个段落，并各给一句改写建议。\n` +
              '只输出 JSON：{"unlike":[{"text":"原文段落","reason":"为什么不像"}]}\n\n正文：\n' +
              content.slice(0, 6_000)
          }
        ],
        signal: input.signal,
        temperature: 0.1
      },
      (raw) => styleUnlikeSchema.parse(raw)
    )
    return parsed.unlike
      .slice(0, 3)
      .map((item) => `「${item.text.trim().slice(0, 60)}」——${item.reason.trim()}`)
  } catch {
    return []
  }
}

/** 完整文风体检：确定性指标 +（可选）模型复核 */
export async function auditStyle(input: {
  projectId: number
  chapterNo: number
  useModel?: boolean
  signal?: AbortSignal
}): Promise<StyleAuditReport> {
  const base = auditStyleDeterministic({ projectId: input.projectId, chapterNo: input.chapterNo })
  if (input.useModel !== true) return base
  const modelNotes = await modelStyleNotes({
    projectId: input.projectId,
    chapterNo: input.chapterNo,
    signal: input.signal
  })
  return { ...base, modelNotes }
}

/**
 * 整本平均文风贴合度：只统计「有报告」的章节（取每章最新一条 review 的 styleScore）。
 * 没有任何带 styleScore 的报告时返回 null。
 */
export function projectStyleScore(projectId: number): number | null {
  try {
    const rows = getDb()
      .select({ chapterNo: review.chapterNo, content: review.content })
      .from(review)
      .where(eq(review.projectId, projectId))
      .orderBy(asc(review.chapterNo), asc(review.idx))
      .all()
    if (rows.length === 0) return null

    const latestByChapter = new Map<number, AuditReport>()
    for (const row of rows) latestByChapter.set(row.chapterNo, row.content)

    const scores: number[] = []
    for (const report of latestByChapter.values()) {
      if (typeof report.styleScore === 'number' && Number.isFinite(report.styleScore)) scores.push(report.styleScore)
    }
    if (scores.length === 0) return null
    return Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length)
  } catch {
    return null
  }
}
