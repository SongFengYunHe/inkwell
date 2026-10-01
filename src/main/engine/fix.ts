import type { FixResult } from '@shared/types'
import { getLatestReview, saveReview } from '../db/memory-repo'
import { listDrafts, saveDraft } from '../db/repositories'
import { buildFixMessages } from '../prompts/zh-CN'
import { buildChapterContext } from '../llm/context'
import { invokeChat } from '../llm/invoke'
import { auditChapter } from './audit'
import { applyStyleRules } from './rules'
import { recordRevision } from '../db/revision-repo'

export interface FixChapterInput {
  projectId: number
  chapterNo: number
  /** 是否用 reviewer 模型做语义定点修复（确定性规则始终会跑） */
  useModel?: boolean
  signal?: AbortSignal
}

/** 这些维度可以由「确定性的文本规则」直接修掉 */
const RULE_DIMENSIONS = new Set(['无 AI 腔套话', '无排比堆砌', '标点使用规范', '无相邻重复句', '段落长度适中'])

/** 这些维度需要模型理解语义才能修 */
const MODEL_DIMENSIONS = new Set([
  '语义审计（OOC / 设定 / 时间线 / 伏笔 / 称谓）',
  '与前章不重复',
  '关键事件已覆盖',
  '悬念钩子有呼应'
])

/**
 * 一键修复（计划书 §7.1 的「审计 → 定点修复」闭环）：
 * 先跑确定性反 AI 味规则，再（可选）让 reviewer 模型只改语义问题句段，
 * 落为新版本后再重审一次，形成可观测的「修复前后」对比。
 */
export async function fixChapter(input: FixChapterInput): Promise<FixResult> {
  const { projectId, chapterNo } = input
  const bundle = buildChapterContext(projectId, chapterNo)
  if (!bundle) throw new Error(`项目不存在：${projectId}`)
  if (!bundle.latestDraft?.content.trim()) throw new Error(`第 ${chapterNo} 章还没有正文，无法修复`)

  const latest = bundle.latestDraft
  const auditBefore = getLatestReview(projectId, chapterNo) ?? null

  // 1. 确定性去 AI 味定点修复
  const styled = applyStyleRules(latest.content)
  let content = styled.content
  const styleChanges = styled.changes
  let modelUsed = false

  // 2. 模型语义定点修复（仅在确有语义类问题时）
  const issues = (auditBefore?.checks ?? []).filter(
    (check) => !check.passed && (RULE_DIMENSIONS.has(check.dimension) || MODEL_DIMENSIONS.has(check.dimension))
  )
  const hasModelIssue = issues.some((check) => MODEL_DIMENSIONS.has(check.dimension) || check.dimension.startsWith('语义·'))

  if (input.useModel && hasModelIssue) {
    try {
      const fixed = await invokeChat({
        role: 'reviewer',
        messages: buildFixMessages({
          bookTitle: bundle.project.name,
          genre: bundle.project.genre,
          chapterNo,
          chapterTitle: bundle.brief?.title ?? '',
          content,
          issues: issues.map((check) => ({
            dimension: check.dimension,
            detail: check.detail,
            evidence: check.evidence,
            paragraph: check.paragraph
          }))
        }),
        signal: input.signal,
        temperature: 0.2
      })

      const trimmed = fixed.trim()
      // 仅当长度合理（未整章重写）时才采纳模型结果
      const ratio = trimmed.length / Math.max(1, content.length)
      if (trimmed && ratio >= 0.7 && ratio <= 1.3) {
        content = trimmed
        modelUsed = true
      }
    } catch {
      // 模型修复失败时保留确定性修复结果，不阻断闭环
      modelUsed = false
    }
  }

  // 3. 无变化则不新增版本
  if (content === latest.content) {
    return {
      draft: latest,
      styleChanges,
      modelUsed: false,
      auditBefore,
      auditAfter: auditBefore,
      noop: true
    }
  }

  const versions = listDrafts(projectId).filter((item) => item.chapterNo === chapterNo)
  const draft = saveDraft({
    projectId,
    chapterNo,
    version: (versions[0]?.version ?? 0) + 1,
    status: 'revised',
    source: 'fix',
    content
  })

  // A5：记一条修订，说明「这一版是怎么来的、依据是哪些问题」
  recordRevision({
    projectId,
    chapterNo,
    baseDraftId: latest.id,
    draftId: draft.id,
    type: 'review-fix',
    userPrompt:
      issues.length > 0
        ? `修复维度：${[...new Set(issues.map((check) => check.dimension))].join('、')}` +
          (modelUsed ? '（含模型定点修复）' : '（仅确定性规则）')
        : '确定性去 AI 味规则',
    content: draft.content,
    // M10 §4.3：带上改动前正文，才能生成「改前 / 改后」摘要与段落级 diff
    beforeContent: latest.content
  })

  // 4. 重审：形成修复前后的可观测对比
  const previous = listDrafts(projectId).find((item) => item.chapterNo === chapterNo - 1)?.content ?? ''
  const auditAfter = await auditChapter({
    project: bundle.project,
    brief: bundle.brief,
    content: draft.content,
    previousContent: previous,
    useModel: input.useModel === true,
    signal: input.signal
  })
  saveReview(projectId, chapterNo, draft.id, auditAfter)

  return { draft, styleChanges, modelUsed, auditBefore, auditAfter, noop: false }
}