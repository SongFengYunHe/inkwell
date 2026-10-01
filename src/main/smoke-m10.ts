import { app } from 'electron'
import {
  createProject,
  deleteProject,
  listBriefs,
  listDrafts,
  listProjects,
  saveBrief,
  saveDraft
} from './db/repositories'
import { saveReview } from './db/memory-repo'
import { listTrash, purgeTrash } from './db/trash'
import { clearStyleProfile, getStyleProfile, saveStyleProfile } from './engine/style'
import { auditChapter } from './engine/audit'
import { auditStyle, auditStyleDeterministic, projectStyleScore } from './engine/style-audit'
import { DEFAULT_AUDIT_CONFIG, getAuditConfig, listAuditDimensions, saveAuditConfig } from './db/audit-config-repo'
import { listRevisions, recordRevision, revertRevision } from './db/revision-repo'
import { auditBook, estimateBookAudit, latestAuditRun, resumeAuditBook } from './engine/audit-book'

/**
 * M10（质量闭环深化）端到端自检：electron . --smoke-m10
 *
 * 覆盖：
 *   1. 审计配置读写往返 + 关闭某维度后 auditChapter 不再产出该维度；
 *   2. minSeverity / countWarnAsFail 对整体 passed 的影响；
 *   3. 文风体检：有画像走画像指标、无画像走通用基线，分数恒在 0–100；
 *   4. auditChapter 附带 styleScore / styleChecks，projectStyleScore 只统计有报告的章节；
 *   5. 段落级 diff（same/add/del）与「改前 / 改后」摘要；
 *   6. revertRevision 落新版本、内容等于 base 版本，并把原修订标记 reverted；
 *   7. R7：整本审计落 audit_run（done / aborted）并写入按字数分档的 token 预估。
 *
 * 注意：本文件不接入 src/main/index.ts（由主代理添加 --smoke-m10 开关）。
 */

const PROJECT_NAME = '__inkwell_smoke_m10__'

/** 触发「无 AI 腔套话」（warn）与「标点使用规范」（info）两个失败项，其余错误项全部通过 */
const CHAPTER_TEXT = [
  '总而言之，夜色如墨，山道上只余一人一剑。',
  '林川握紧了古剑！！！风从谷底卷上来，吹得衣袍猎猎作响。',
  '他压低身形，沿着碎石小径缓缓靠近。月光破开云层，照见崖边一道模糊的人影。',
  '林川握剑的手紧了紧，终究还是走了过去。剑鸣骤起，惊起满林宿鸟。'
].join('\n')

function cleanup(): void {
  for (const item of listProjects()) {
    if (item.name.startsWith(PROJECT_NAME)) deleteProject(item.id)
  }
  for (const item of listTrash()) purgeTrash({ kind: item.kind, id: item.id })
}

export async function runSmokeM10(): Promise<void> {
  const checks: Array<[string, boolean]> = []

  try {
    cleanup()
    // 审计配置是全局单行，先恢复默认，避免受其它自检影响
    saveAuditConfig({ disabledDimensions: [], minSeverity: 'warn', countWarnAsFail: false })

    const project = createProject({
      name: PROJECT_NAME,
      genre: '仙侠',
      totalChapters: 4,
      wordsPerChapter: 120
    })
    saveBrief({
      projectId: project.id,
      chapterNo: 1,
      title: '开端',
      purpose: '让林川与古剑相遇',
      characters: ['林川', '古剑']
    })
    const draft1 = saveDraft({
      projectId: project.id,
      chapterNo: 1,
      version: 1,
      status: 'draft',
      source: 'write',
      content: CHAPTER_TEXT
    })
    const brief1 = listBriefs(project.id).find((item) => item.chapterNo === 1) ?? null

    /* --------------------- 1. 审计配置读写往返 + 维度开关 --------------------- */
    checks.push([
      '默认配置基线正确（空开关 / warn / warn 不算不通过）',
      getAuditConfig().disabledDimensions.length === 0 &&
        getAuditConfig().minSeverity === DEFAULT_AUDIT_CONFIG.minSeverity &&
        getAuditConfig().countWarnAsFail === DEFAULT_AUDIT_CONFIG.countWarnAsFail
    ])

    const dims = listAuditDimensions()
    checks.push([
      '维度清单覆盖确定性 14 项与语义项',
      dims.length >= 19 && dims.includes('标点使用规范') && dims.includes('语义·OOC 出戏')
    ])

    const saved = saveAuditConfig({
      disabledDimensions: ['标点使用规范'],
      minSeverity: 'warn',
      countWarnAsFail: false
    })
    const loaded = getAuditConfig()
    checks.push([
      '审计配置写回读一致（disabledDimensions）',
      loaded.disabledDimensions.length === 1 && loaded.disabledDimensions[0] === '标点使用规范'
    ])
    checks.push(['审计配置写入后 updatedAt 非空', typeof loaded.updatedAt === 'number' && saved.updatedAt === loaded.updatedAt])

    saveAuditConfig({ disabledDimensions: [], minSeverity: 'warn', countWarnAsFail: false })
    const fullReport = await auditChapter({
      project,
      brief: brief1,
      content: draft1.content,
      previousContent: '',
      useModel: false
    })
    checks.push([
      '默认配置下产出「标点使用规范」维度',
      fullReport.checks.some((check) => check.dimension === '标点使用规范')
    ])

    saveAuditConfig({ disabledDimensions: ['标点使用规范'] })
    const filteredReport = await auditChapter({
      project,
      brief: brief1,
      content: draft1.content,
      previousContent: '',
      useModel: false
    })
    checks.push([
      '关闭某维度后 auditChapter 不再产出该维度',
      !filteredReport.checks.some((check) => check.dimension === '标点使用规范')
    ])
    checks.push([
      '关闭维度后检查总数恰好减少 1',
      filteredReport.checks.length === fullReport.checks.length - 1
    ])

    /* ------------------- 2. minSeverity / countWarnAsFail 闸门 ------------------- */
    saveAuditConfig({ disabledDimensions: [], minSeverity: 'warn', countWarnAsFail: false })
    const relaxed = await auditChapter({ project, brief: brief1, content: draft1.content, previousContent: '', useModel: false })
    checks.push(['warn 不计入不通过时整体 passed=true', relaxed.passed === true])

    saveAuditConfig({ countWarnAsFail: true })
    const strict = await auditChapter({ project, brief: brief1, content: draft1.content, previousContent: '', useModel: false })
    checks.push(['warn 计入不通过后整体 passed=false', strict.passed === false])

    saveAuditConfig({ minSeverity: 'error', countWarnAsFail: true })
    const errorOnly = await auditChapter({ project, brief: brief1, content: draft1.content, previousContent: '', useModel: false })
    checks.push(['minSeverity=error 时 warn 不再构成不通过', errorOnly.passed === true])

    saveAuditConfig({ disabledDimensions: [], minSeverity: 'warn', countWarnAsFail: false })

    /* ------------------------- 3. 文风体检（有画像） ------------------------- */
    saveStyleProfile(project.id, {
      summary: '克制冷峻，重意境与留白',
      tone: '冷峻、克制',
      pov: '第三人称限知',
      sentence: '短句为主，长短交错',
      diction: '书面偏古雅',
      dialogue: '对话占比低，以动作推进',
      imagery: '偏爱夜、雨、剑光',
      pacing: '段落短，切换频繁',
      taboos: ['总而言之'],
      keywords: ['古剑', '夜色'],
      samples: ['夜色如墨，山道上只余一人一剑。'],
      source: 'smoke-m10',
      updatedAt: Date.now()
    })
    checks.push(['文风画像已落库', getStyleProfile(project.id)?.keywords.length === 2])

    const profileReport = auditStyleDeterministic({ projectId: project.id, chapterNo: 1 })
    checks.push(['有画像时文风检查项非空（≥7 项）', profileReport.checks.length >= 7])
    checks.push(['有画像时总分在 0–100', profileReport.score >= 0 && profileReport.score <= 100])
    checks.push(['有画像时逐项分数均在 0–100', profileReport.checks.every((check) => check.score >= 0 && check.score <= 100)])
    checks.push([
      '有画像时包含标志性用词与禁用写法维度',
      profileReport.checks.some((check) => check.dimension === '标志性用词命中率') &&
        profileReport.checks.some((check) => check.dimension === '禁用写法命中')
    ])

    /* ------------------------- 4. 文风体检（无画像基线） ------------------------- */
    clearStyleProfile(project.id)
    checks.push(['清除后确认没有画像', getStyleProfile(project.id) === null])

    const baselineReport = auditStyleDeterministic({ projectId: project.id, chapterNo: 1 })
    checks.push(['无画像时走通用基线且检查项非空', baselineReport.checks.length > 0])
    checks.push([
      '通用基线每项 detail 都说明「尚未生成文风画像」',
      baselineReport.checks.every((check) => check.detail.includes('通用基线'))
    ])
    checks.push(['通用基线总分在 0–100', baselineReport.score >= 0 && baselineReport.score <= 100])

    /* ------------------- 5. auditChapter 附带 styleScore + 整本均分 ------------------- */
    const withStyle = await auditChapter({ project, brief: brief1, content: draft1.content, previousContent: '', useModel: false })
    checks.push([
      'auditChapter 附带 styleScore 与 styleChecks',
      typeof withStyle.styleScore === 'number' && (withStyle.styleChecks?.length ?? 0) > 0
    ])

    checks.push(['无报告时整本文风均分为 null', projectStyleScore(project.id) === null])
    saveReview(project.id, 1, draft1.id, withStyle)
    checks.push(['有报告时整本文风均分等于该章 styleScore', projectStyleScore(project.id) === withStyle.styleScore])

    /* ------------------------- 6. 模型复核失败不影响确定性 ------------------------- */
    const deterministic = auditStyleDeterministic({ projectId: project.id, chapterNo: 1 })
    const aborted = new AbortController()
    aborted.abort()
    const modeled = await auditStyle({
      projectId: project.id,
      chapterNo: 1,
      useModel: true,
      signal: aborted.signal
    })
    checks.push([
      '模型复核失败不影响确定性结果',
      modeled.score === deterministic.score && modeled.checks.length === deterministic.checks.length
    ])
    checks.push(['模型复核结果落在 modelNotes 数组', Array.isArray(modeled.modelNotes)])

    /* ---------------------- 7. 段落级 diff 与回退 ---------------------- */
    const beforeText = ['第一段：夜色如墨。', '第二段：山道寂静。', '第三段：要删掉的旧句。'].join('\n')
    const afterText = ['第一段：夜色如墨。', '第二段：山道寂静。', '第三段：新增的新句。'].join('\n')
    const baseDraft = saveDraft({
      projectId: project.id,
      chapterNo: 2,
      version: 1,
      status: 'draft',
      source: 'write',
      content: beforeText
    })
    const nextDraft = saveDraft({
      projectId: project.id,
      chapterNo: 2,
      version: 2,
      status: 'revised',
      source: 'fix',
      content: afterText
    })
    const revision = recordRevision({
      projectId: project.id,
      chapterNo: 2,
      baseDraftId: baseDraft.id,
      draftId: nextDraft.id,
      type: 'review-fix',
      userPrompt: '自检：段落 diff',
      content: afterText,
      beforeContent: beforeText
    })
    const kinds = new Set(revision.diff.map((line) => line.type))
    checks.push(['段落 diff 至少包含 same/add/del 三种', kinds.has('same') && kinds.has('add') && kinds.has('del')])
    checks.push([
      '修订保留改前 / 改后摘要',
      revision.beforeExcerpt.includes('要删掉的旧句') && revision.afterExcerpt.includes('新增的新句')
    ])
    checks.push([
      '改前 / 改后摘要不超过 400 字',
      revision.beforeExcerpt.length <= 400 && revision.afterExcerpt.length <= 400
    ])
    checks.push([
      '修订 diff 已落库并可读回',
      (listRevisions(project.id, 2).find((item) => item.id === revision.id)?.diff.length ?? 0) === revision.diff.length
    ])

    const versionsBefore = listDrafts(project.id).filter((item) => item.chapterNo === 2).map((item) => item.version)
    const maxBefore = versionsBefore.reduce((max, value) => Math.max(max, value), 0)
    const reverted = revertRevision({ projectId: project.id, chapterNo: 2, revisionId: revision.id })
    checks.push([
      '回退落为新版本且内容等于 base 版本',
      reverted.draft.content === beforeText && reverted.draft.version === maxBefore + 1
    ])
    checks.push([
      '回退版本的 source/status 正确',
      reverted.draft.source === 'revert' && reverted.draft.status === 'revised'
    ])
    checks.push(['回退返回被回退修订的序号', reverted.revisionIdx === revision.idx])

    const afterRevert = listRevisions(project.id, 2)
    checks.push(['原修订被标记 reverted=true', afterRevert.find((item) => item.id === revision.id)?.reverted === true])
    checks.push([
      '回退后新增 manual 修订说明「回退到 v1」',
      afterRevert.some((item) => item.type === 'manual' && item.userPrompt.includes('回退到 v1'))
    ])

    const lonelyDraft = saveDraft({
      projectId: project.id,
      chapterNo: 3,
      version: 1,
      status: 'draft',
      source: 'write',
      content: '独立章节正文，仅用于验证无基准版本的回退报错。'
    })
    const lonelyRevision = recordRevision({
      projectId: project.id,
      chapterNo: 3,
      baseDraftId: null,
      draftId: lonelyDraft.id,
      type: 'manual',
      content: lonelyDraft.content
    })
    let revertError = ''
    try {
      revertRevision({ projectId: project.id, chapterNo: 3, revisionId: lonelyRevision.id })
    } catch (error) {
      revertError = error instanceof Error ? error.message : String(error)
    }
    checks.push(['无基准版本的修订回退时给出可读中文错误', revertError.includes('无法回退')])

    /* ------------------------- 8. R7：整本审计落库与预估 ------------------------- */
    checks.push(['token 预估按字数分档且大于 0', estimateBookAudit(project.id).estTotalTokens > 0])

    const stopped = new AbortController()
    stopped.abort()
    let abortedThrew = false
    try {
      await resumeAuditBook({ projectId: project.id, useModel: false, signal: stopped.signal })
    } catch {
      abortedThrew = true
    }
    const abortedRun = latestAuditRun(project.id)
    checks.push(['被中断的整本审计标记为 aborted', abortedThrew && abortedRun?.status === 'aborted'])

    const bookSummary = await auditBook({ projectId: project.id })
    const doneRun = latestAuditRun(project.id)
    checks.push([
      '整本审计任务落库并置 done，cursor 追平 total',
      doneRun?.status === 'done' && doneRun.cursor === doneRun.total && doneRun.total === bookSummary.chapters.length
    ])
    checks.push(['整本审计把 token 预估写入 est_tokens', (doneRun?.estTokens ?? 0) > 0])
    checks.push(['整本审计聚合结果与章节数一致', bookSummary.chapters.length === 3])

    /* ---------------------------------- 收尾 ---------------------------------- */
    clearStyleProfile(project.id)
  } catch (error) {
    checks.push(['自检执行未抛错：' + (error instanceof Error ? error.message : String(error)), false])
  } finally {
    try {
      saveAuditConfig({ disabledDimensions: [], minSeverity: 'warn', countWarnAsFail: false })
      cleanup()
    } catch {
      // 清理失败不影响结论
    }
  }

  const failed = checks.filter(([, ok]) => !ok)
  for (const [name, ok] of checks) console.log((ok ? '  ✓ ' : '  ✗ ') + name)
  console.log('---')
  console.log('通过 ' + (checks.length - failed.length) + '/' + checks.length + ' 项检查')
  if (failed.length > 0) {
    console.log('M10_SMOKE_FAILED')
    app.exit(1)
    return
  }
  console.log('M10_SMOKE_OK')
  app.exit(0)
}
