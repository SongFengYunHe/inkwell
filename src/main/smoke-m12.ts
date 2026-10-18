import { app } from 'electron'
import { closeDatabase, latestSchemaVersion } from './db/client'
import {
  createProject,
  deleteProject,
  listBriefs,
  listDraftSummaries,
  listProjects,
  saveBrief,
  saveDraft
} from './db/repositories'
import { listTrash, purgeTrash } from './db/trash'
import { drainIndexQueue, enqueueChapterIndex } from './search/index-queue'

/**
 * M12（性能与稳定性）端到端自检：electron . --smoke-m12
 *
 * 覆盖三条 RSS 断言（均为主进程实测值）：
 *   1. 冷启动 RSS（加载任何项目数据之前）；
 *   2. 「打开」100 章项目（批量写库 + 拉正文列表）后 RSS 增幅可控；
 *   3. 连写 10 章并每次都「回书架」拉一次列表，RSS 不得单调增长。
 *
 * 另附两条回归断言：
 *   - R10 正文列表字段裁剪（listDraftSummaries 不含 content）；
 *   - M12-C 索引队列可安全排空（无 embedder 时原地返回、不抛错）；
 *   - 书库 schema 已升到含 embedding_queue 的 v10。
 *
 * 说明：虚拟滚动 / 懒加载是渲染进程侧行为，主进程 RSS 只能作为代理指标，
 * 真正的 UI 抖动仍需人工在 200+ 章项目上验证。
 */
const PROJECT_PREFIX = '__inkwell_smoke_m12__'
const CHAPTERS = 100
const EXTRA = 10
const FILLER = '雨夜山道，少年握紧了那柄古剑，剑鞘上的雨珠顺着纹路滑落。'.repeat(40)

function rssMb(): number {
  return process.memoryUsage().rss / 1024 / 1024
}

function cleanup(): void {
  for (const item of listProjects()) {
    if (item.name.startsWith(PROJECT_PREFIX)) deleteProject(item.id)
  }
  for (const item of listTrash()) purgeTrash({ kind: item.kind, id: item.id })
}

export async function runSmokeM12(): Promise<void> {
  const checks: Array<[string, boolean]> = []

  try {
    cleanup()

    /* ---------------- 1. 冷启动 RSS（加载项目数据之前采样） ---------------- */
    const cold = rssMb()
    checks.push([`冷启动 RSS < 250MB（实测 ${cold.toFixed(0)}MB）`, cold < 250])

    /* ---------------- 2. 打开 100 章项目 ---------------- */
    const project = createProject({ name: PROJECT_PREFIX, genre: '仙侠', totalChapters: CHAPTERS })
    for (let no = 1; no <= CHAPTERS; no += 1) {
      saveBrief({ projectId: project.id, chapterNo: no, title: `第${no}章`, purpose: '推进' })
      saveDraft({
        projectId: project.id,
        chapterNo: no,
        version: 1,
        status: 'draft',
        source: 'write',
        content: FILLER
      })
    }

    const summaries = listDraftSummaries(project.id)
    checks.push([`100 章正文列表返回 ${summaries.length} 条摘要`, summaries.length === CHAPTERS])
    checks.push(['R10 正文列表摘要不含 content 字段（字段裁剪生效）', summaries.every((row) => !('content' in row))])
    checks.push(['细纲数与章节数一致', listBriefs(project.id).length === CHAPTERS])

    const opened = rssMb()
    checks.push([
      `打开 100 章项目后 RSS 增幅可控（+${(opened - cold).toFixed(0)}MB，实测 ${opened.toFixed(0)}MB）`,
      opened - cold < 150
    ])

    /* ---------------- 3. 连写 10 章 → 回书架：RSS 不得单调增长 ---------------- */
    const samples: number[] = [opened]
    for (let no = CHAPTERS + 1; no <= CHAPTERS + EXTRA; no += 1) {
      saveDraft({
        projectId: project.id,
        chapterNo: no,
        version: 1,
        status: 'draft',
        source: 'write',
        content: FILLER
      })
      // 「回书架」= 重新拉一次正文列表（模拟切回章节导航页）
      listDraftSummaries(project.id)
      samples.push(rssMb())
    }
    const monotonic = samples.every((value, index) => index === 0 || value > samples[index - 1])
    const after = samples[samples.length - 1]
    checks.push([
      `连写 10 章回书架 RSS 非单调增长（首 ${samples[0].toFixed(0)}MB → 末 ${after.toFixed(0)}MB）`,
      !monotonic
    ])
    checks.push([
      `连写 10 章后 RSS 未持续膨胀（自打开起增幅 +${(after - opened).toFixed(0)}MB）`,
      after - opened < 150
    ])

    /* ---------------- 4. 回归：索引队列可安全排空 ---------------- */
    enqueueChapterIndex(project.id, 1, 0)
    const drained = await drainIndexQueue()
    checks.push(['M12-C 索引队列可排空且不抛错', typeof drained === 'number' && drained >= 0])

    /* ---------------- 5. 回归：schema 已含 embedding_queue（v10） ---------------- */
    checks.push([
      `书库 schema 已升到 v${latestSchemaVersion()}（含 embedding_queue）`,
      latestSchemaVersion() >= 10
    ])
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
    console.log('M12_SMOKE_FAILED')
    app.exit(1)
    return
  }
  console.log('M12_SMOKE_OK')
  app.exit(0)
}
