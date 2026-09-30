import type { AuditCheck, AuditReport, ChapterBrief, Project } from '@shared/types'
import { invokeJson } from '../llm/invoke'
import { auditIssuesSchema } from '../llm/schemas'
import { buildAuditMessages } from '../prompts/zh-CN'
import { buildTruthSnapshot } from './truth'

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

const AI_PHRASES = ['总而言之', '综上所述', '值得注意的是', '不得不提的是', '让我们', '由此可见', '换句话说']

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
  const hitPhrases = AI_PHRASES.filter((phrase) => content.includes(phrase))
  checks.push({
    dimension: '无 AI 腔套话',
    passed: hitPhrases.length === 0,
    severity: 'warn',
    detail: hitPhrases.length ? `命中固定套话：${hitPhrases.join('、')}` : '未命中内置套话表',
    evidence: hitPhrases[0]
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
  checks.push({
    dimension: '段落长度适中',
    passed: longest <= 500,
    severity: 'info',
    detail: paragraphs.length === 0 ? '正文为空' : `最长段落 ${longest} 字（建议 ≤500）`
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
    evidence: duplicate || undefined
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

  // 13. 标点使用规范
  const punctuationNoise = /([！？!?])\1{2,}|[。，]{2,}/.test(content)
  checks.push({
    dimension: '标点使用规范',
    passed: !punctuationNoise,
    severity: 'info',
    detail: punctuationNoise ? '存在连续重复标点（如 ！！！ 或 。。）' : '标点使用正常'
  })

  return checks
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

/** 完整审计：13 个确定性维度 + 可选的语义维度 */
export async function auditChapter(input: AuditInput): Promise<AuditReport> {
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

  const failedErrors = checks.filter((check) => !check.passed && check.severity === 'error').length
  const passedCount = checks.filter((check) => check.passed).length

  return {
    chapterNo: input.brief?.chapterNo ?? 0,
    passed: failedErrors === 0,
    score: checks.length === 0 ? 0 : Math.round((passedCount / checks.length) * 100),
    checks,
    modelAssisted,
    createdAt: Date.now()
  }
}