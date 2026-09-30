import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
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
import { getLatestReview, saveReview } from './db/memory-repo'
import { auditChapter } from './engine/audit'
import { fixChapter } from './engine/fix'
import { applyStyleRules } from './engine/rules'
import { exportProject } from './export'
import { buildZip, extractZipEntry, listZipEntries } from './export/zip'
import { deleteProvider, listProviders, saveProvider } from './providers/store'

/**
 * M4 端到端自检：`electron . --smoke-m4`
 * 覆盖「审计 → 一键修复 → 重审」闭环与四种格式导出（TXT / MD / DOCX / EPUB）。
 * 导出用的是内置 ZIP 写入器，这里再用内置 ZIP 读取器回读校验容器结构。
 */
const PROJECT_NAME = '__inkwell_smoke_m4__'
const TOTAL_CHAPTERS = 3

/** 含 AI 腔 / 重复标点 / 叠词的原始正文，用来触发确定性规则 */
const RAW_PROSE = [
  '总而言之，夜色如墨，山道上一人一剑。林川握紧了那柄古剑！！！风从谷底卷上来，吹得衣袍猎猎作响。古剑在他掌中轻轻震颤。',
  '他非常非常小心地压低身形，沿着碎石小径缓缓靠近。月光破开云层，照见崖边一道模糊的人影。那人背对着他，肩头似乎受了伤。',
  '林川握剑的手紧了紧，终究还是走了过去。剑鸣骤起，惊起满林宿鸟。崖边的人缓缓回头，露出一张苍白的面孔。林川认得这张脸，却想不起在哪里见过。',
  '对方嘴唇动了动，吐出两个字。话音未落，山道尽头亮起一串火把。林川下意识后退半步，剑尖已指向来路。火把越来越近，脚步声杂乱而急促。'
].join('\n')

/** 模型定点修复后的正文（已去 AI 味） */
const FIXED_PROSE = RAW_PROSE.replace('总而言之，', '').replace('！！！', '！').replace('非常非常', '非常')

const AUDIT_JSON = JSON.stringify({
  issues: [{ dimension: 'OOC 出戏', severity: 'warn', detail: '林川的谨慎与其冲动行为略有出入', evidence: '剑尖已指向来路' }]
})

interface MockState {
  bodies: string[]
}

function pickResponse(body: string): string {
  if (body.includes('定点修复')) return FIXED_PROSE
  if (body.includes('一致性审计')) return AUDIT_JSON
  return RAW_PROSE
}

function startMockServer(state: MockState): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || !req.url?.includes('/chat/completions')) {
      res.writeHead(404).end('not found')
      return
    }
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      state.bodies.push(body)
      const text = pickResponse(body)

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      })
      const chars = Array.from(text)
      let index = 0
      const timer = setInterval(() => {
        if (index >= chars.length) {
          clearInterval(timer)
          res.write('data: [DONE]\n\n')
          res.end()
          return
        }
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chars[index] } }] })}\n\n`)
        index += 1
      }, 1)
    })
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({
        baseUrl: `http://127.0.0.1:${port}/v1`,
        close: () => new Promise<void>((done) => server.close(() => done()))
      })
    })
  })
}

export async function runSmokeM4(): Promise<void> {
  const state: MockState = { bodies: [] }
  const mock = await startMockServer(state)
  const checks: Array<[string, boolean]> = []
  const outDir = join(app.getPath('temp'), 'inkwell-m4-export')

  try {
    for (const existing of listProviders()) deleteProvider(existing.id)
    const stale = listProjects().find((item) => item.name === PROJECT_NAME)
    if (stale) deleteProject(stale.id)

    const project = createProject({
      name: PROJECT_NAME,
      genre: '仙侠',
      totalChapters: TOTAL_CHAPTERS,
      wordsPerChapter: 300,
      premise: '少年在山道上捡到一柄会说话的古剑'
    })
    saveProvider({ name: 'smoke-mock', baseUrl: mock.baseUrl, model: 'mock-model', apiKey: 'sk-smoke' })

    // 3 章细纲；只写前 2 章，第 3 章留空以验证 exportedChapters 跳过逻辑
    for (let chapterNo = 1; chapterNo <= TOTAL_CHAPTERS; chapterNo += 1) {
      saveBrief({
        projectId: project.id,
        chapterNo,
        title: `第${chapterNo}章标题`,
        purpose: `第${chapterNo}章的目的`,
        keyEvents: '夜色,山道,古剑',
        characters: ['林川', '古剑'],
        sceneBeats: ['夜行', '遇人'],
        suspenseHook: '剑鸣'
      })
    }
    for (const chapterNo of [1, 2]) {
      saveDraft({ projectId: project.id, chapterNo, version: 1, status: 'draft', source: 'write', content: RAW_PROSE })
    }

    // ---------- 反 AI 味确定性规则 ----------
    const styled = applyStyleRules(RAW_PROSE)
    const ruleNames = new Set(styled.changes.map((change) => change.rule))
    checks.push(['规则删除了句首套话「总而言之，」', !styled.content.includes('总而言之')])
    checks.push(['规则压缩了重复感叹号', !styled.content.includes('！！！') && styled.content.includes('！')])
    checks.push(['规则压缩了叠词「非常非常」', !styled.content.includes('非常非常')])
    checks.push(['规则记录了逐条变更', ruleNames.has('删除句首套话') && ruleNames.has('重复感叹/问号压缩')])
    checks.push(['规则未改动情节信息量（长度接近）', Math.abs(styled.content.length - RAW_PROSE.length) < 30])

    // ---------- 审计可定位到段落 ----------
    const brief1 = listBriefs(project.id).find((item) => item.chapterNo === 1) ?? null
    const auditBefore = await auditChapter({
      project,
      brief: brief1,
      content: RAW_PROSE,
      previousContent: '',
      useModel: true
    })
    saveReview(project.id, 1, 1, auditBefore)
    const located = auditBefore.checks.filter((check) => !check.passed && check.paragraph !== undefined)
    checks.push(['审计维度数 ≥ 14', auditBefore.checks.length >= 14])
    checks.push(['审计报告可定位到具体段落', located.length >= 1])
    checks.push(['审计包含模型语义维度', auditBefore.checks.some((check) => check.dimension.startsWith('语义·'))])
    checks.push(['审计识别出标点问题', auditBefore.checks.some((check) => check.dimension === '标点使用规范' && !check.passed)])

    // ---------- 一键修复（含模型定点修复） ----------
    const fixed = await fixChapter({ projectId: project.id, chapterNo: 1, useModel: true })
    checks.push(['一键修复新增了版本且 source=fix', !fixed.noop && fixed.draft.source === 'fix' && fixed.draft.version === 2])
    checks.push(['一键修复去掉了 AI 腔与重复标点', !fixed.draft.content.includes('总而言之') && !fixed.draft.content.includes('！！！')])
    checks.push(['一键修复使用了模型定点修复', fixed.modelUsed === true])
    checks.push([
      '重审后评分提升',
      fixed.auditBefore !== null && fixed.auditAfter !== null && fixed.auditAfter.score > fixed.auditBefore.score
    ])
    checks.push(['修复结果落库为最新审计', getLatestReview(project.id, 1)?.score === fixed.auditAfter?.score])

    // ---------- 无问题时不重复落版 ----------
    const again = await fixChapter({ projectId: project.id, chapterNo: 1, useModel: true })
    checks.push(['无可修复项时不新增版本', again.noop === true])
    checks.push(['修复未膨胀版本数', listDrafts(project.id).filter((item) => item.chapterNo === 1).length === 2])

    // ---------- 导出四种格式 ----------
    const exported = await exportProject({ projectId: project.id, formats: ['txt', 'md', 'docx', 'epub'], outDir }, '')
    checks.push(['导出返回四个文件', exported.files.length === 4])
    checks.push(['跳过无正文的第 3 章', exported.skippedChapters.join(',') === '3'])
    checks.push(['每个文件均已落盘且非空', exported.files.every((file) => existsSync(file.path) && file.bytes > 0)])

    const fileOf = (format: string): string => exported.files.find((file) => file.format === format)?.path ?? ''

    const txt = readFileSync(fileOf('txt'), 'utf8')
    checks.push(['TXT 含书名与章节', txt.includes(PROJECT_NAME) && txt.includes('第 1 章') && txt.includes('第2章标题')])
    checks.push(['TXT 带 BOM（便于 Windows 识别）', txt.charCodeAt(0) === 0xfeff])

    const md = readFileSync(fileOf('md'), 'utf8')
    checks.push(['MD 含书名 / 目录 / 章节标题', md.includes(`# ${PROJECT_NAME}`) && md.includes('## 目录') && md.includes('### 第 1 章')])

    const docx = readFileSync(fileOf('docx'))
    const docxEntries = listZipEntries(docx)
    const documentXml = extractZipEntry(docx, 'word/document.xml')?.toString('utf8') ?? ''
    checks.push(['DOCX 为合法 ZIP 且含必要部件', docxEntries.includes('[Content_Types].xml') && docxEntries.includes('word/document.xml')])
    checks.push(['DOCX 文档体包含书名与章节', documentXml.includes('<w:document') && documentXml.includes(PROJECT_NAME)])

    const epub = readFileSync(fileOf('epub'))
    const epubEntries = listZipEntries(epub)
    const mimetype = extractZipEntry(epub, 'mimetype')?.toString('utf8') ?? ''
    checks.push([
      'EPUB 含 mimetype / container / OPF / 目录',
      epubEntries.includes('mimetype') &&
        epubEntries.includes('META-INF/container.xml') &&
        epubEntries.includes('OEBPS/content.opf') &&
        epubEntries.includes('OEBPS/nav.xhtml') &&
        epubEntries.includes('OEBPS/toc.ncx')
    ])
    checks.push(['EPUB mimetype 内容正确', mimetype === 'application/epub+zip'])
    checks.push(['EPUB 按章生成 xhtml', epubEntries.filter((name) => name.startsWith('OEBPS/chapter-')).length === 2])

    // ---------- ZIP 写入器自检（往返一致性） ----------
    const roundTrip = buildZip([{ name: 'a.txt', data: '你好，世界' }, { name: 'dir/b.bin', data: Buffer.from([1, 2, 3]) }])
    checks.push([
      'ZIP 写入 / 读取往返一致',
      listZipEntries(roundTrip).join(',') === 'a.txt,dir/b.bin' &&
        extractZipEntry(roundTrip, 'a.txt')?.toString('utf8') === '你好，世界'
    ])

    for (const [name, passed] of checks) {
      console.log(`[smoke-m4] ${passed ? '✓' : '✗'} ${name}`)
    }
    const allPassed = checks.every(([, passed]) => passed)
    console.log(`[smoke-m4] result: ${allPassed ? 'M4_EXPORT_OK' : 'M4_EXPORT_FAILED'}`)
    process.exitCode = allPassed ? 0 : 1
  } catch (error) {
    console.log(`[smoke-m4] result: M4_EXPORT_FAILED (${error instanceof Error ? error.message : String(error)})`)
    process.exitCode = 1
  } finally {
    await mock.close()
    app.quit()
  }
}