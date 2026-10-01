import { existsSync, readFileSync, rmSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { createProject, deleteProject, listProjects, saveBrief, saveDraft } from './db/repositories'
import { saveVolume } from './db/volume-repo'
import { listTrash, purgeTrash } from './db/trash'
import { exportProject } from './export'
import { exportPdf } from './export/pdf'
import { applyThemePack, buildThemePack } from './pack/theme-pack'
import { DEFAULT_REQUIRED_FIELDS } from './import/outline/patterns'
import { listPromptTemplates, resetPromptTemplate, savePromptTemplate } from './prompts/registry'

/**
 * M11（产出与分发）端到端自检：electron . --smoke-m11
 *
 * 覆盖：
 *   - PDF 导出：真的生成非空文件、头部 4 字节 \`%PDF\`、bytes > 1000（临时目录，测完删除）；
 *   - R9：导出成书使用用户填写的卷名，不再写死「第 N 卷」；
 *   - 题材包：buildThemePack → JSON → applyThemePack 往返一致；未知 key 跳过；
 *     非法包（packVersion=2 / 字段类型错误 / null）抛中文错误。
 */
const PROJECT_PREFIX = '__inkwell_smoke_m11__'
const OVERRIDE_KEY = 'chapter.draft'
const OVERRIDE_SYSTEM = 'smoke-m11 专用系统提示词'
const OVERRIDE_INSTRUCTION = 'smoke-m11 专用指令块 {{chapterNo}}'

const CH1 = '第一卷山雨的开篇正文。\n\n第二段：林川在雨夜山道上遇见了那柄古剑。'
const CH2 = '第二卷夜行的正文。\n\n第二段：古剑在夜色中轻鸣，山雨落在剑鞘上。'

function catchError(run: () => unknown): string {
  try {
    run()
    return ''
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

function cleanup(): void {
  for (const item of listProjects()) {
    if (item.name.startsWith(PROJECT_PREFIX)) deleteProject(item.id)
  }
  for (const item of listTrash()) purgeTrash({ kind: item.kind, id: item.id })
  try {
    resetPromptTemplate(OVERRIDE_KEY)
  } catch {
    // 数据库未就绪时忽略
  }
}

function readPdf(path: string): Buffer {
  return existsSync(path) ? readFileSync(path) : Buffer.alloc(0)
}

export async function runSmokeM11(): Promise<void> {
  const checks: Array<[string, boolean]> = []
  const tempDirs: string[] = []

  try {
    cleanup()

    const project = createProject({ name: PROJECT_PREFIX, genre: '仙侠', totalChapters: 2 })
    saveBrief({ projectId: project.id, chapterNo: 1, volumeIdx: 1, title: '开端', purpose: '雨夜相遇' })
    saveBrief({ projectId: project.id, chapterNo: 2, volumeIdx: 2, title: '夜行', purpose: '持剑夜行' })
    saveDraft({
      projectId: project.id,
      chapterNo: 1,
      version: 1,
      status: 'draft',
      source: 'write',
      content: CH1
    })
    saveDraft({
      projectId: project.id,
      chapterNo: 2,
      version: 1,
      status: 'draft',
      source: 'write',
      content: CH2
    })
    saveVolume({ projectId: project.id, idx: 1, title: '第一卷 山雨' })

    /* ---------------------------------- PDF ---------------------------------- */
    const pdfDir = await mkdtemp(join(tmpdir(), 'inkwell-m11-pdf-'))
    tempDirs.push(pdfDir)
    const pdfFiles = await exportPdf({ projectId: project.id, outDir: pdfDir })
    const pdfFile = pdfFiles[0]
    checks.push(['PDF 导出一个文件且格式为 pdf', pdfFiles.length === 1 && pdfFile?.format === 'pdf'])
    const pdfBytes = pdfFile ? readPdf(pdfFile.path) : Buffer.alloc(0)
    checks.push(['PDF 文件非空且 > 1000 字节', pdfBytes.length > 1000])
    checks.push(['PDF 头部 4 字节为 %PDF', pdfBytes.subarray(0, 4).toString('latin1') === '%PDF'])
    checks.push([
      'PDF 统计章节数且字节数与落盘一致',
      pdfFile?.chapters === 2 && pdfFile?.bytes === pdfBytes.length
    ])

    const entryDir = await mkdtemp(join(tmpdir(), 'inkwell-m11-entry-'))
    tempDirs.push(entryDir)
    const entryResult = await exportProject({ projectId: project.id, formats: ['pdf'], outDir: entryDir }, '')
    const entryPdf = entryResult.files.find((file) => file.format === 'pdf')
    checks.push(['导出总入口支持 pdf 格式', entryPdf !== undefined && existsSync(entryPdf.path)])

    /* ------------------------------ R9 卷名生效 ------------------------------ */
    const txtDir = await mkdtemp(join(tmpdir(), 'inkwell-m11-txt-'))
    tempDirs.push(txtDir)
    const txtResult = await exportProject({ projectId: project.id, formats: ['txt'], outDir: txtDir }, '')
    const txtPath = txtResult.files.find((file) => file.format === 'txt')?.path ?? ''
    const txt = txtPath ? readFileSync(txtPath, 'utf8') : ''
    checks.push(['TXT 使用用户填写的卷名', txt.includes('第一卷 山雨')])
    checks.push(['TXT 不再出现「第 1 卷」回退写法', !txt.includes('第 1 卷')])
    checks.push(['未命名的卷仍回退「第 2 卷」', txt.includes('第 2 卷')])

    /* ------------------------------ 题材包往返 ------------------------------ */
    savePromptTemplate({ key: OVERRIDE_KEY, system: OVERRIDE_SYSTEM, instruction: OVERRIDE_INSTRUCTION })
    const pack = buildThemePack({
      name: 'smoke-m11 题材包',
      description: 'M11 自检用',
      includePrompts: true,
      genres: [{ name: '仙侠', chapters: 200, style: '克制冷峻' }]
    })
    checks.push(['包版本为 1', pack.packVersion === 1])
    checks.push(['包记录应用版本与导出时间', pack.appVersion.length > 0 && pack.exportedAt > 0])
    checks.push([
      '包内必填字段来自默认模板',
      pack.requiredFields.length === DEFAULT_REQUIRED_FIELDS.length && pack.requiredFields.includes('purpose')
    ])
    const packedOverride = pack.promptOverrides.find((item) => item.key === OVERRIDE_KEY)
    checks.push([
      '包内包含被覆写的提示词',
      packedOverride?.system === OVERRIDE_SYSTEM && packedOverride?.instruction === OVERRIDE_INSTRUCTION
    ])
    checks.push([
      'includePrompts=false 时不打包提示词',
      buildThemePack({ name: 'no-prompts', includePrompts: false }).promptOverrides.length === 0
    ])

    // 额外塞一条未知 key，验证「跳过并计数」而不是整体失败
    const knownCount = pack.promptOverrides.length
    const wire = {
      ...pack,
      promptOverrides: [
        ...pack.promptOverrides,
        { key: '__inkwell_smoke_m11_unknown__', system: 'x', instruction: 'y' }
      ]
    }
    const json = JSON.stringify(wire)
    resetPromptTemplate(OVERRIDE_KEY)
    const applied = applyThemePack(JSON.parse(json) as unknown)
    checks.push(['导入统计题材数量', applied.genresAdded === 1])
    checks.push(['导入跳过未知 key 并只统计成功项', applied.promptsApplied === knownCount])
    checks.push(['导入回填必填字段字符串', applied.requiredFields.split(',').includes('purpose')])
    const appliedTemplate = listPromptTemplates().find((item) => item.key === OVERRIDE_KEY)
    checks.push([
      '导入后覆写生效且内容与包内一致',
      appliedTemplate?.overridden === true &&
        appliedTemplate?.system === OVERRIDE_SYSTEM &&
        appliedTemplate?.instruction === OVERRIDE_INSTRUCTION
    ])

    const badVersion = catchError(() => applyThemePack({ ...pack, packVersion: 2 }))
    checks.push(['非法包（packVersion=2）抛中文错误', badVersion.includes('版本')])
    const badType = catchError(() => applyThemePack({ ...pack, promptOverrides: 'oops' }))
    checks.push(['非法包（字段类型错误）被拒绝', badType.includes('类型')])
    const badNull = catchError(() => applyThemePack(null))
    checks.push(['非法包（null）被拒绝', badNull.length > 0])
  } catch (error) {
    checks.push(['自检执行未抛错：' + (error instanceof Error ? error.message : String(error)), false])
  } finally {
    cleanup()
    for (const dir of tempDirs) {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // 清理失败不影响结论
      }
    }
  }

  const failed = checks.filter(([, ok]) => !ok)
  for (const [name, ok] of checks) console.log((ok ? '  ✓ ' : '  ✗ ') + name)
  console.log('---')
  console.log('通过 ' + (checks.length - failed.length) + '/' + checks.length + ' 项检查')
  if (failed.length > 0) {
    console.log('M11_SMOKE_FAILED')
    app.exit(1)
    return
  }
  console.log('M11_SMOKE_OK')
  app.exit(0)
}
