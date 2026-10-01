import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { closeDatabase } from './db/client'
import { createBackup, listBackups, restoreBackup, rotateBackups } from './db/backup'
import {
  createProject,
  deleteBrief,
  getProject,
  listBriefs,
  listProjects,
  saveBrief,
  saveDraft,
  updateProject
} from './db/repositories'
import { emptyTrash, listTrash, purgeTrash, restoreTrash } from './db/trash'
import { migrateActiveLibraryTo } from './library/migrate'
import { createLibrary, getActiveEntry, getBootstrapState, switchLibrary } from './library/registry'

/**
 * M6 端到端自检：`electron . --smoke-m6`
 * 覆盖：多书库隔离与切换 / 迁移（含中断回滚）/ 软删除回收站往返 / 备份轮转与恢复 / 退出后无 WAL 残留。
 */
const BASE = join(app.getPath('temp'), 'inkwell-m6-smoke')

export async function runSmokeM6(): Promise<void> {
  const checks: Array<[string, boolean]> = []

  try {
    rmSync(BASE, { recursive: true, force: true })
    mkdirSync(BASE, { recursive: true })
    // 冒烟与 --smoke 系列共用 userData：必须清掉上一轮遗留的书库登记
    rmSync(join(app.getPath('userData'), 'config.json'), { force: true })

    // ---------- 冷启动内存（在加载任何项目数据之前采样） ----------
    const rss = process.memoryUsage().rss / 1024 / 1024
    checks.push([`冷启动 RSS < 250MB（实测 ${rss.toFixed(0)}MB）`, rss < 250])

    // ---------- 多书库：创建 / 隔离 / 切换 ----------
    const libA = createLibrary({ name: '书库A', path: join(BASE, 'A') })
    const pA = createProject({ name: '甲书' })
    checks.push(['新建书库后可写入数据', getProject(pA.id)?.name === '甲书'])

    const libB = createLibrary({ name: '书库B', path: join(BASE, 'B') })
    createProject({ name: '乙书' })
    checks.push([
      '切换书库后数据完全隔离（B 看不到 A 的项目）',
      listProjects().length === 1 && listProjects()[0].name === '乙书'
    ])

    switchLibrary(libA.id)
    checks.push(['切回书库 A 后数据仍在', listProjects().length === 1 && listProjects()[0].name === '甲书'])

    // ---------- 软删除 → 回收站 → 恢复 → 彻底删除 ----------
    const brief1 = saveBrief({ projectId: pA.id, chapterNo: 1, title: '第一章', purpose: '开篇' })
    saveDraft({ projectId: pA.id, chapterNo: 1, version: 1, content: '雨夜山道，少年握紧古剑。' })
    deleteBrief(brief1.id)
    checks.push(['软删除后章节不在正常列表', listBriefs(pA.id).length === 0])
    checks.push([
      '回收站能看到被删章节',
      listTrash().some((item) => item.kind === 'chapter' && item.chapterNo === 1 && item.draftCount === 1)
    ])

    const restored1 = restoreTrash({ kind: 'chapter', id: brief1.id })
    checks.push(['恢复章节成功', restored1.ok && listBriefs(pA.id).length === 1])

    // 章节号冲突：删掉第 2 章 → 新建第 2 章 → 恢复旧第 2 章应排到末尾
    const brief2 = saveBrief({ projectId: pA.id, chapterNo: 2, title: '第二章', purpose: '推进' })
    deleteBrief(brief2.id)
    saveBrief({ projectId: pA.id, chapterNo: 2, title: '新的第二章', purpose: '占位' })
    const restored2 = restoreTrash({ kind: 'chapter', id: brief2.id })
    checks.push(['恢复时章节号被占用则自动排到末尾（不覆盖）', restored2.ok && restored2.chapterNo === 3])

    // 彻底删除
    const brief4 = saveBrief({ projectId: pA.id, chapterNo: 4, title: '第四章', purpose: '待删' })
    deleteBrief(brief4.id)
    purgeTrash({ kind: 'chapter', id: brief4.id })
    checks.push(['彻底删除后不再出现在回收站', !listTrash().some((item) => item.kind === 'chapter' && item.id === brief4.id)])

    // 项目级回收站往返
    switchLibrary(libB.id)
    const projectB = listProjects()[0]
    purgeTrash({ kind: 'project', id: projectB.id })
    checks.push(['彻底删除项目后项目消失', listProjects().length === 0])
    switchLibrary(libA.id)

    // ---------- 备份：生成 / 轮转 / 恢复 ----------
    const snap1 = createBackup('manual')
    createBackup('manual')
    checks.push(['备份落到 backups/ 且可列出', existsSync(snap1.path) && listBackups().length >= 2])

    // 伪造 15 份历史备份（跨 15 天，均早于上面两份快照），验证轮转收敛
    const backupsDir = join(libA.path, 'backups')
    const pad = (n: number): string => String(n).padStart(2, '0')
    for (let i = 1; i <= 15; i += 1) {
      const d = new Date(Date.now() - i * 24 * 3600 * 1000)
      const name = `inkwell-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-030000-rotation.db`
      writeFileSync(join(backupsDir, name), 'x')
    }
    const before = listBackups().length
    const rotated = rotateBackups()
    const remaining = listBackups().length
    checks.push([
      `备份轮转生效（17 份 → 删除 ${rotated} 份 → 保留 ${remaining} 份）`,
      before === 17 && rotated > 0 && remaining >= 10 && remaining < before
    ])
    checks.push(['最新快照未被轮转删除', existsSync(snap1.path)])

    updateProject({ id: pA.id, name: '甲书改名' })
    restoreBackup(snap1.name)
    checks.push(['恢复备份后数据回滚到快照时点', getProject(pA.id)?.name === '甲书'])

    // ---------- 迁移：中断回滚 + 完整迁移 ----------
    const sourcePath = getActiveEntry()?.path ?? ''
    const ctrl = new AbortController()
    // R1：迁移现在是异步的（重活在 utilityProcess 里），中断通过 signal / 取消接口生效
    const aborted = await migrateActiveLibraryTo(join(BASE, 'C-aborted'), {
      signal: ctrl.signal,
      onProgress: (progress) => {
        if (progress.phase === 'copy' || progress.phase === 'vacuum') ctrl.abort()
      }
    })
    checks.push(['迁移中断被判为失败', !aborted.ok])
    checks.push(['中断后指针仍指向原书库', getActiveEntry()?.path === sourcePath])
    checks.push(['中断后原书库数据无损', listProjects().some((item) => item.name === '甲书')])

    const targetC = join(BASE, 'C')
    const migrated = await migrateActiveLibraryTo(targetC)
    checks.push(['完整迁移成功', migrated.ok && migrated.library?.path === targetC])
    checks.push(['迁移后数据完整', listProjects().some((item) => item.name === '甲书')])
    checks.push(['目标书库写入 library.json', existsSync(join(targetC, 'library.json'))])
    checks.push(['迁移后指针切到新位置', getActiveEntry()?.path === targetC])

    // ---------- 回收站清空 ----------
    checks.push(['清空回收站返回删除条数', typeof emptyTrash().removed === 'number'])

    // ---------- 退出后：无 WAL 残留 ----------
    const dbPath = join(targetC, 'inkwell.db')
    closeDatabase()
    const wal = `${dbPath}-wal`
    const walSize = existsSync(wal) ? statSync(wal).size : 0
    checks.push([`关闭后 WAL 已 checkpoint（残留 ${walSize} 字节）`, walSize === 0])

    // ---------- 状态接口 ----------
    const state = getBootstrapState()
    checks.push(['状态接口返回活动书库与库列表', state.libraries.length >= 2 && state.activeLibraryId !== null])

    for (const [name, passed] of checks) {
      console.log(`[smoke-m6] ${passed ? '✓' : '✗'} ${name}`)
    }
    const allPassed = checks.every(([, passed]) => passed)
    console.log(`[smoke-m6] result: ${allPassed ? 'M6_LIFECYCLE_OK' : 'M6_LIFECYCLE_FAILED'}`)
    process.exitCode = allPassed ? 0 : 1
  } catch (error) {
    for (const [name, passed] of checks) {
      console.log(`[smoke-m6] ${passed ? '✓' : '✗'} ${name}`)
    }
    console.log(`[smoke-m6] result: M6_LIFECYCLE_FAILED (${error instanceof Error ? error.message : String(error)})`)
    process.exitCode = 1
  } finally {
    // 必须先关库再删目录：Windows 上删除被打开的文件会 EBUSY，
    // 且异常绝不能挡住 app.quit()，否则进程会永远挂住。
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