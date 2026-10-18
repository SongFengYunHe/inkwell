import { app } from 'electron'
import { checkpointWal, closeDatabase, latestSchemaVersion, optimizeDatabase } from './db/client'
import { explainQuery } from './db/query-plan'
import { auditBook } from './engine/audit-book'
import { createProject, deleteProject, listProjects, saveBrief, saveDraft } from './db/repositories'
import { listTrash, purgeTrash } from './db/trash'

/**
 * M14（多层次优化）端到端自检：electron . --smoke-m14
 *
 * 断言：
 *   1. 书库 schema 仍为 v11（M14 无结构变更，验证未意外回退）；
 *   2. 热点查询（正文列表 / 细纲列表）走索引而非全表扫描（EXPLAIN QUERY PLAN，§3.3）；
 *   3. WAL checkpoint 与 PRAGMA optimize 可安全调用（§3.3 维护复核）；
 *   4. 跨章一致性维度生效：细纲声明却全书未出场的角色被标记（§3.5，M14-D）；
 *   5. 该书里正常出场的角色不被误报。
 *
 * 虚拟化 / 动效预算属渲染进程侧，主进程只能用「hook 文件存在 + 结构收敛」间接验证，
 * 真正的 UI 抖动仍需人工在 200+ 章项目上确认。
 */
const PROJECT_PREFIX = '__inkwell_smoke_m14__'
const FILLER = '雨夜山道，少年握紧了那柄古剑，剑鞘上的雨珠顺着纹路滑落。'.repeat(40)

function cleanup(): void {
  for (const item of listProjects()) {
    if (item.name.startsWith(PROJECT_PREFIX)) deleteProject(item.id)
  }
  for (const item of listTrash()) purgeTrash({ kind: item.kind, id: item.id })
}

export async function runSmokeM14(): Promise<void> {
  const checks: Array<[string, boolean]> = []

  try {
    cleanup()

    /* ---------- 1. schema 未回退 ---------- */
    checks.push([`书库 schema 为 v${latestSchemaVersion()}（M14 无结构变更）`, latestSchemaVersion() >= 11])

    /* ---------- 2. 热点查询走索引 ---------- */
    const draftSql =
      'SELECT id, project_id, chapter_no, version FROM chapter_draft WHERE project_id = ? AND deleted_at IS NULL ORDER BY chapter_no ASC, version DESC'
    const briefSql = 'SELECT * FROM chapter_brief WHERE project_id = ? AND deleted_at IS NULL ORDER BY chapter_no ASC'
    const draftPlan = explainQuery(draftSql, [1])
    const briefPlan = explainQuery(briefSql, [1])
    const indexed = (plan: string): boolean => /SEARCH|COVERING INDEX/.test(plan)
    checks.push([`正文列表查询走索引（${draftPlan}）`, indexed(draftPlan)])
    checks.push([`细纲列表查询走索引（${briefPlan}）`, indexed(briefPlan)])

    /* ---------- 3. 维护动作可安全调用 ---------- */
    let maintenanceOk = true
    try {
      optimizeDatabase()
      checkpointWal()
    } catch {
      maintenanceOk = false
    }
    checks.push(['PRAGMA optimize 与 WAL checkpoint 可安全调用', maintenanceOk])

    /* ---------- 4/5. 跨章一致性（人物连续性） ---------- */
    const project = createProject({ name: PROJECT_PREFIX, genre: '仙侠', totalChapters: 2 })
    saveBrief({ projectId: project.id, chapterNo: 1, title: '第一章', characters: ['林清'] })
    saveBrief({ projectId: project.id, chapterNo: 2, title: '第二章', characters: ['幽灵客'] })
    saveDraft({
      projectId: project.id,
      chapterNo: 1,
      version: 1,
      status: 'draft',
      source: 'write',
      content: `林清推门而入。${FILLER}`
    })
    saveDraft({
      projectId: project.id,
      chapterNo: 2,
      version: 1,
      status: 'draft',
      source: 'write',
      content: FILLER
    })

    const summary = await auditBook({ projectId: project.id })
    const crossStat = summary.dimensions.find((item) => item.dimension === '跨章一致性·角色')
    checks.push(['跨章一致性维度产出（细纲声明却全书未出场的角色被标记）', crossStat !== undefined && crossStat.failed > 0])

    const crossDetail =
      summary.chapters
        .flatMap((chapter) => chapter.report.checks)
        .find((check) => check.dimension === '跨章一致性·角色')?.detail ?? ''
    checks.push([`悬空角色被点名（幽灵客）：${crossDetail}`, crossDetail.includes('幽灵客')])
    checks.push(['正常出场的角色不被误报（林清）', !crossDetail.includes('林清')])
  } catch (error) {
    checks.push(['自检执行未抛错：' + (error instanceof Error ? error.message : String(error)), false])
  } finally {
    try {
      cleanup()
    } catch {
      // 清理失败不影响结论
    }
    try {
      closeDatabase()
    } catch {
      // 忽略
    }
  }

  const failed = checks.filter(([, ok]) => !ok)
  for (const [name, ok] of checks) console.log((ok ? '  ✓ ' : '  ✗ ') + name)
  console.log('---')
  console.log('通过 ' + (checks.length - failed.length) + '/' + checks.length + ' 项检查')
  if (failed.length > 0) {
    console.log('M14_SMOKE_FAILED')
    app.exit(1)
    return
  }
  console.log('M14_SMOKE_OK')
  app.exit(0)
}
