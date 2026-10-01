import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { closeDatabase, getRawSqlite, initDatabase } from './db/client'
import { countWords, createProject, deleteBrief, saveBrief, saveDraft } from './db/repositories'
import { saveMemoryChapter } from './db/memory-repo'
import { auditBook, estimateBookAudit } from './engine/audit-book'
import { probeTrigram } from './search/fts'
import { search } from './search/query'
import { getDayStat, dayKey, shiftDayKey } from './stat/tracker'
import { getStatSummary, setGoal } from './stat/goal'

/**
 * M8 端到端自检：`electron . --smoke-m8`
 * 覆盖：① FTS5 trigram 可用性实测 ② 中英文检索命中（含 ≥3 字中文 FTS 与 1~2 字中文 LIKE 回退）
 *      ③ 软删除后从 FTS 移除 ④ 整本审计聚合正确 ⑤ 写作统计正确性（增量 / 负数 / streak）。
 * 用独立库文件 inkwell-m8.db（共享库会被历史残留污染）。
 */
const BASE = join(app.getPath('temp'), 'inkwell-m8-smoke')

export async function runSmokeM8(): Promise<void> {
  const checks: Array<[string, boolean]> = []

  try {
    rmSync(BASE, { recursive: true, force: true })
    mkdirSync(BASE, { recursive: true })
    rmSync(join(app.getPath('userData'), 'config.json'), { force: true })

    const m8Db = join(app.getPath('userData'), 'inkwell-m8.db')
    closeDatabase()
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${m8Db}${suffix}`, { force: true })
    initDatabase(m8Db, { journalMode: 'DELETE' })

    /* ------------------------- ① FTS5 trigram 可用性实测 ------------------------- */
    const trigram = probeTrigram()
    checks.push([`FTS5 trigram 分词器可用（实测 ${trigram ? '可用' : '不可用'}）`, trigram])

    /* -------------------------------- 造检索数据 -------------------------------- */
    const project = createProject({ name: '检索自检书', wordsPerChapter: 1000 })
    saveBrief({
      projectId: project.id,
      chapterNo: 1,
      title: '雨夜相逢',
      purpose: '让林川与古剑相遇',
      keyEvents: '雨夜山道，古剑认主',
      characters: ['林川', '古剑'],
      suspenseHook: '古剑为何认主'
    })
    saveDraft({
      projectId: project.id,
      chapterNo: 1,
      version: 1,
      source: 'write',
      content: '雨夜山道，少年握紧古剑，剑身泛起微光。sword of dawn。'
    })
    saveBrief({
      projectId: project.id,
      chapterNo: 2,
      title: '黎明之战',
      purpose: '林川迎战',
      keyEvents: '黎明决战',
      characters: ['林川'],
      suspenseHook: '胜负如何'
    })
    saveDraft({
      projectId: project.id,
      chapterNo: 2,
      version: 1,
      source: 'write',
      content: '黎明时分，回想昨夜雨夜山道，少年握剑而立，山道尽头传来脚步声。'
    })

    /* --------------------------------- ② 检索命中 --------------------------------- */
    const hitLong = search({ query: '少年握' })
    checks.push([
      `≥3 字中文命中（FTS，'少年握'→${hitLong.total}，mode=${hitLong.mode}）`,
      hitLong.mode === 'fts' && hitLong.total >= 1
    ])

    const hitEn = search({ query: 'sword' })
    checks.push([`英文命中（'sword'→${hitEn.total}）`, hitEn.total >= 1])

    const hitShort = search({ query: '古剑' })
    checks.push([
      `1~2 字中文 LIKE 回退命中（'古剑'→${hitShort.total}，mode=${hitShort.mode}）`,
      hitShort.mode === 'like' && hitShort.total >= 1
    ])

    const hitPhrase = search({ query: '"剑身泛起"' })
    checks.push([`短语检索命中（'"剑身泛起"'→${hitPhrase.total}）`, hitPhrase.total >= 1])

    const hitExclude = search({ query: '雨夜山道 -黎明时分' })
    checks.push([
      `排除词生效（'雨夜山道 -黎明时分'→${hitExclude.total}，命中章均不含第 2 章）`,
      hitExclude.mode === 'fts' && hitExclude.total >= 1 && hitExclude.groups.every((group) => group.chapterNo !== 2)
    ])

    saveMemoryChapter({
      projectId: project.id,
      chapterNo: 1,
      draftId: null,
      summary: '传说中有一段《星陨录》的记载，藏于旧书库。',
      characterStates: [],
      continuityFacts: { worldState: '', timeline: '', resourceLedger: '', facts: [] },
      threadUpdates: []
    })
    const hitMemory = search({ query: '星陨录' })
    checks.push([
      `记忆来源可检出（'星陨录'→${hitMemory.total}）`,
      hitMemory.total >= 1 && hitMemory.groups.some((group) => group.hits.some((hit) => hit.source === 'memory'))
    ])

    /* ------------------------------ ③ 软删除后移除 FTS ------------------------------ */
    const brief3 = saveBrief({ projectId: project.id, chapterNo: 3, title: '无用章节' })
    saveDraft({
      projectId: project.id,
      chapterNo: 3,
      version: 1,
      source: 'write',
      content: '幽冥谷中传来低语，似有若无。'
    })
    const beforeDelete = search({ query: '幽冥谷' })
    deleteBrief(brief3.id)
    const afterDelete = search({ query: '幽冥谷' })
    checks.push([
      `软删除后从 FTS 移除（删前 ${beforeDelete.total} → 删后 ${afterDelete.total}）`,
      beforeDelete.total >= 1 && afterDelete.total === 0
    ])

    /* ------------------------------ ④ 整本审计聚合正确 ------------------------------ */
    const auditProject = createProject({ name: '审计自检书', wordsPerChapter: 200 })
    for (const chapterNo of [1, 2]) {
      saveBrief({ projectId: auditProject.id, chapterNo, title: `第${chapterNo}章`, purpose: '推进剧情' })
      saveDraft({
        projectId: auditProject.id,
        chapterNo,
        version: 1,
        source: 'write',
        content: `这是第${chapterNo}章的正文，**带有 Markdown 残留**，内容很简短。`
      })
    }
    const summary = await auditBook({ projectId: auditProject.id })
    const chapterFailedSum = summary.chapters.reduce(
      (sum, chapter) => sum + chapter.report.checks.filter((check) => !check.passed).length,
      0
    )
    const chapterCheckSum = summary.chapters.reduce((sum, chapter) => sum + chapter.report.checks.length, 0)
    const dimensionFailedSum = summary.dimensions.reduce((sum, item) => sum + item.failed, 0)
    const dimensionTotalSum = summary.dimensions.reduce((sum, item) => sum + item.total, 0)

    checks.push(['整本审计：章数 = 有正文章节数', summary.chapters.length === 2])
    checks.push([
      `整本审计：维度命中数之和 = 各章命中数之和（${dimensionFailedSum} = ${chapterFailedSum} = ${summary.totalIssues}）`,
      dimensionFailedSum === chapterFailedSum && chapterFailedSum === summary.totalIssues
    ])
    checks.push([
      `整本审计：维度检查数之和 = 各章检查数之和（${dimensionTotalSum} = ${chapterCheckSum}）`,
      dimensionTotalSum === chapterCheckSum
    ])

    const estimate = estimateBookAudit(auditProject.id)
    checks.push([
      `整本审计：模型 token 预估（${estimate.chapters} 章 / 约 ${estimate.estTotalTokens} tokens）`,
      estimate.chapters === 2 && estimate.estTotalTokens > 0
    ])

    /* ------------------------------ ⑤ 写作统计正确性 ------------------------------ */
    const today = dayKey()
    // 新建草稿：delta = +wordCount
    const wordsBefore = getDayStat(today).wordsAdded
    const fresh = '甲乙丙丁戊'
    saveDraft({ projectId: project.id, chapterNo: 90, version: 1, source: 'write', content: fresh })
    const wordsAfterCreate = getDayStat(today).wordsAdded
    checks.push([
      `新建草稿按 wordCount 累加（+${wordsAfterCreate - wordsBefore} = ${countWords(fresh)}）`,
      wordsAfterCreate - wordsBefore === countWords(fresh)
    ])

    // 改写更短：delta 为负
    const shorter = '甲乙'
    saveDraft({ projectId: project.id, chapterNo: 90, version: 1, source: 'rewrite', content: shorter })
    const wordsAfterRewrite = getDayStat(today).wordsAdded
    checks.push([
      `改写后按差值累加（可为负，${wordsAfterRewrite - wordsAfterCreate} = ${countWords(shorter) - countWords(fresh)}）`,
      wordsAfterRewrite - wordsAfterCreate === countWords(shorter) - countWords(fresh)
    ])

    // 章节完成数：首次产生正文 +1，改写不重复计
    const doneBefore = getDayStat(today).chaptersDone
    saveDraft({ projectId: project.id, chapterNo: 91, version: 1, source: 'write', content: '全新的一章正文。' })
    const doneAfterCreate = getDayStat(today).chaptersDone
    saveDraft({ projectId: project.id, chapterNo: 91, version: 1, source: 'rewrite', content: '全新的一章正文，稍作修改。' })
    const doneAfterRewrite = getDayStat(today).chaptersDone
    checks.push([
      `章节完成数：首次产生正文 +1（${doneAfterCreate - doneBefore}），改写不重复计（${doneAfterRewrite - doneAfterCreate}）`,
      doneAfterCreate - doneBefore === 1 && doneAfterRewrite === doneAfterCreate
    ])

    // streak：把今天设为 1000 字，前两天各 100 字，目标 100 → 连续 3 天
    const raw = getRawSqlite()
    const upsert = raw.prepare(
      `INSERT INTO writing_stat (day, words_added, chapters_done, updated_at)
       VALUES (?, ?, 0, ?)
       ON CONFLICT(day) DO UPDATE SET words_added = excluded.words_added`
    )
    upsert.run(today, 1000, Date.now())
    upsert.run(shiftDayKey(today, -1), 100, Date.now())
    upsert.run(shiftDayKey(today, -2), 100, Date.now())

    setGoal({ dailyWords: 100 })
    checks.push([`streak：今天/昨天/前天均达标 → 3（实测 ${getStatSummary().streak}）`, getStatSummary().streak === 3])

    setGoal({ dailyWords: 2000 })
    checks.push([
      `streak：今天未达标时从昨天起算 → 0（实测 ${getStatSummary().streak}）`,
      getStatSummary().streak === 0
    ])

    setGoal({ dailyWords: 1000 })
    checks.push([`streak：仅今天达标 → 1（实测 ${getStatSummary().streak}）`, getStatSummary().streak === 1])

    for (const [name, passed] of checks) {
      console.log(`[smoke-m8] ${passed ? '✓' : '✗'} ${name}`)
    }
    const allPassed = checks.every(([, passed]) => passed)
    console.log(`[smoke-m8] result: ${allPassed ? 'M8_OK' : 'M8_FAILED'}`)
    process.exitCode = allPassed ? 0 : 1
  } catch (error) {
    for (const [name, passed] of checks) {
      console.log(`[smoke-m8] ${passed ? '✓' : '✗'} ${name}`)
    }
    console.log(`[smoke-m8] result: M8_FAILED (${error instanceof Error ? error.message : String(error)})`)
    process.exitCode = 1
  } finally {
    // 先关库再删临时目录（Windows 上开着库删目录会 EBUSY 挂死进程）
    try {
      closeDatabase()
    } catch {
      // 忽略
    }
    try {
      rmSync(BASE, { recursive: true, force: true })
    } catch {
      // 残留目录不影响结论
    }
    app.quit()
  }
}