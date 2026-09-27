import { app } from 'electron'
import { getDatabasePath } from './db/client'
import { createProject, listBriefs, listProjects, saveBrief, updateProject } from './db/repositories'

/**
 * 冒烟自检：`electron . --smoke`
 * 第一次运行写入项目 + 大纲 + 细纲；第二次运行读回校验，用于验证「重启后数据仍在」。
 * 使用独立的临时 userData 目录，不污染真实用户数据。
 */
const SMOKE_PROJECT_NAME = '__inkwell_smoke__'
const SMOKE_OUTLINE = '第一卷\n第一章：开端\n第二章：发展\n第三章：结局'

export function runSmoke(): void {
  const existing = listProjects().find((p) => p.name === SMOKE_PROJECT_NAME)

  if (!existing) {
    const created = createProject({
      name: SMOKE_PROJECT_NAME,
      genre: '测试题材',
      totalChapters: 3,
      premise: '一句灵感：少年捡到会说话的古剑'
    })
    updateProject({ id: created.id, coreOutline: SMOKE_OUTLINE, protagonist: '林川' })
    saveBrief({
      projectId: created.id,
      chapterNo: 1,
      title: '开端',
      purpose: '验证细纲持久化',
      characters: ['林川', '古剑'],
      sceneBeats: ['山雨欲来', '意外相逢'],
      suspenseHook: '古剑为何认主？'
    })
    console.log(`[smoke] first-run created project#${created.id}, briefs=${listBriefs(created.id).length}`)
    console.log(`[smoke] result: FIRST_RUN_OK db=${getDatabasePath()}`)
    process.exitCode = 0
    app.quit()
    return
  }

  const briefs = listBriefs(existing.id)
  const first = briefs.find((b) => b.chapterNo === 1)
  const persisted =
    existing.coreOutline === SMOKE_OUTLINE &&
    existing.protagonist === '林川' &&
    first !== undefined &&
    first.sceneBeats.length === 2 &&
    first.characters[0] === '林川'

  console.log(
    `[smoke] second-run project#${existing.id}, briefs=${briefs.length}, outline="${existing.coreOutline.replace(/\n/g, '|')}"`
  )
  console.log(`[smoke] result: ${persisted ? 'PERSISTENCE_OK' : 'PERSISTENCE_FAILED'}`)
  process.exitCode = persisted ? 0 : 1
  app.quit()
}