import Database from 'better-sqlite3'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { getProject, listBriefs, listDrafts, listProjects, saveDraft } from './db/repositories'
import { importVelaDatabase, resolveVelaDbPath } from './import/vela'
import { buildChapterContext } from './llm/context'

/**
 * M5 端到端自检：`electron . --smoke-m5`
 * 覆盖「导入 Vela 工程 → 映射到本项目模型 → 直接继续写作」这条验收链路。
 * 这里手工造一个 Vela 形态的库（project_core / blueprints / drafts），验证列名容错映射。
 */
const WORKSPACE = join(app.getPath('temp'), 'inkwell-vela-smoke', 'DemoProject')
const VELA_DB = join(WORKSPACE, 'vela.db')

/** 造一个「Vela 形态」的源库 */
function createVelaFixture(): void {
  rmSync(join(app.getPath('temp'), 'inkwell-vela-smoke'), { recursive: true, force: true })
  mkdirSync(WORKSPACE, { recursive: true })

  const db = new Database(VELA_DB)
  db.exec(`
    CREATE TABLE project_core (
      id INTEGER PRIMARY KEY,
      name TEXT,
      genre TEXT,
      total_chapters INTEGER,
      words_per_chapter INTEGER,
      premise TEXT,
      worldbuilding TEXT,
      protagonist TEXT,
      golden_finger TEXT,
      style TEXT,
      global_guidance TEXT,
      core_outline TEXT
    );
    CREATE TABLE blueprints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chapter_number INTEGER,
      volume_index INTEGER,
      title TEXT,
      purpose TEXT,
      key_events TEXT,
      characters TEXT,
      scene_beats TEXT,
      suspense_hook TEXT
    );
    CREATE TABLE drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chapter_number INTEGER,
      revision INTEGER,
      status TEXT,
      content TEXT
    );
  `)

  db.prepare(
    `INSERT INTO project_core VALUES (1, '山海剑歌', '仙侠', 40, 2800,
      '少年捡到一柄会说话的古剑', '九州修真界，剑修为尊', '林川，山野少年',
      '古剑中封存着上古剑修残魂', '克制冷峻', '每章留钩子', '第一卷 山雨：开端、发展、高潮')`
  ).run()

  const brief = db.prepare(
    `INSERT INTO blueprints (chapter_number, volume_index, title, purpose, key_events, characters, scene_beats, suspense_hook)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  brief.run(1, 1, '雨夜相逢', '让林川与古剑相遇', '雨夜山道，古剑认主', JSON.stringify(['林川', '古剑']), JSON.stringify(['山雨欲来', '意外相逢']), '古剑为何认主？')
  brief.run(2, 1, '立约', '林川与残魂立下三年之约', '残魂现身，立下约定', JSON.stringify(['林川', '残魂']), JSON.stringify(['残魂现身', '立约']), '三年后会发生什么？')

  db.prepare(`INSERT INTO drafts (chapter_number, revision, status, content) VALUES (?, ?, ?, ?)`).run(
    1,
    1,
    'finalized',
    '雨夜，山道湿滑。林川握紧那柄古剑，剑身微颤，仿佛回应着他的心跳。'
  )
  db.close()
}

export async function runSmokeM5(): Promise<void> {
  const checks: Array<[string, boolean]> = []

  try {
    createVelaFixture()

    // ---------- 导入 ----------
    const result = importVelaDatabase(WORKSPACE)
    const project = getProject(result.project.id)
    checks.push(['导入返回新项目', project !== null && project.name === '山海剑歌'])
    checks.push([
      '项目设定字段完成映射',
      project?.genre === '仙侠' &&
        project.totalChapters === 40 &&
        project.wordsPerChapter === 2800 &&
        project.premise.includes('古剑') &&
        project.coreOutline.includes('第一卷')
    ])
    checks.push(['细纲按容错列名导入 2 章', result.briefs === 2 && listBriefs(result.project.id).length === 2])
    const brief2 = listBriefs(result.project.id).find((item) => item.chapterNo === 2)
    checks.push([
      '细纲 JSON 字段被解析为数组',
      brief2?.characters.includes('林川') === true && (brief2?.sceneBeats.length ?? 0) === 2
    ])
    checks.push(['正文导入 1 章', result.drafts === 1 && listDrafts(result.project.id).length === 1])

    // ---------- 导入后可继续写作 ----------
    const bundle = buildChapterContext(result.project.id, 2)
    checks.push(['能从导入的数据装配上下文', bundle !== null && bundle.brief?.title === '立约'])
    checks.push(['上一章正文作为前情提要进入上下文', (bundle?.context.previousExcerpt ?? '').includes('林川握紧那柄古剑')])
    checks.push(['导入的设定进入写作上下文', (bundle?.context.coreOutline ?? '').includes('第一卷')])

    const continued = saveDraft({
      projectId: result.project.id,
      chapterNo: 1,
      version: 2,
      status: 'revised',
      source: 'continue',
      content: `${listDrafts(result.project.id)[0].content}\n\n古剑忽然睁开了眼。`
    })
    checks.push(['可在导入项目上追加新版本继续写作', continued.version === 2 && continued.content.includes('古剑忽然睁开了眼')])

    // ---------- 容错与报错 ----------
    checks.push(['支持直接选择 .vela 目录', resolveVelaDbPath(WORKSPACE) === VELA_DB])

    const emptyDir = join(app.getPath('temp'), 'inkwell-vela-empty')
    rmSync(emptyDir, { recursive: true, force: true })
    mkdirSync(emptyDir, { recursive: true })
    let dirError = ''
    try {
      resolveVelaDbPath(emptyDir)
    } catch (error) {
      dirError = error instanceof Error ? error.message : String(error)
    }
    checks.push(['目录里没有 vela.db 时给出可读报错', dirError.includes('vela.db')])

    const bogus = join(emptyDir, 'bogus.db')
    const bogusDb = new Database(bogus)
    bogusDb.exec('CREATE TABLE something_else (id INTEGER)')
    bogusDb.close()
    let tableError = ''
    try {
      importVelaDatabase(bogus)
    } catch (error) {
      tableError = error instanceof Error ? error.message : String(error)
    }
    checks.push(['非 Vela 库时给出可读报错', tableError.includes('project_core')])

    checks.push(['导入后项目出现在书架列表', listProjects().some((item) => item.id === result.project.id)])

    for (const [name, passed] of checks) {
      console.log(`[smoke-m5] ${passed ? '✓' : '✗'} ${name}`)
    }
    const allPassed = checks.every(([, passed]) => passed)
    console.log(`[smoke-m5] result: ${allPassed ? 'M5_VELA_OK' : 'M5_VELA_FAILED'}`)
    process.exitCode = allPassed ? 0 : 1
  } catch (error) {
    console.log(`[smoke-m5] result: M5_VELA_FAILED (${error instanceof Error ? error.message : String(error)})`)
    process.exitCode = 1
  } finally {
    app.quit()
  }
}