import { deflateRawSync } from 'node:zlib'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { closeDatabase, initDatabase } from './db/client'
import { createProject, listBriefs, saveBrief, saveDraft } from './db/repositories'
import { listTrash } from './db/trash'
import { analyzeImport, cancelSession, commitSession, getSession, updateImportItem } from './import/session'
import { detectEncoding } from './import/encoding'
import { readDocxFromBuffer, readEpubFromBuffer, readSourceFromPath } from './import/text'
import { parseOutline } from './import/outline/parser'
import { validateTree } from './import/outline/validate'

/**
 * M7 端到端自检：`electron . --smoke-m7`
 * 覆盖：编码探测 / ZIP 读回（自造 docx + epub，覆盖 method=8 deflate）/ 分层解析（含卷+章混合）/
 *      字段抽取命中率 / 差异预览（含冲突与 update 前软删除）/ 提交落库 / 取消不落库。
 * 无外部依赖，fixtures 固化在 src/main/smoke/fixtures/。
 */
const BASE = join(app.getPath('temp'), 'inkwell-m7-smoke')

/* ------------------------------- 造 ZIP（deflate） ------------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (let index = 0; index < data.length; index += 1) {
    crc = CRC_TABLE[(crc ^ data[index]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

interface ZipInput {
  name: string
  data: Buffer | string
}

/** 用手工构造的 deflate（method=8）ZIP，验证 zip-reader 的解压路径 */
function buildDeflateZip(entries: ZipInput[]): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8')
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8')
    const deflated = deflateRawSync(raw)
    const crc = crc32(raw)

    const local = Buffer.alloc(30 + nameBytes.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(deflated.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)
    nameBytes.copy(local, 30)
    localParts.push(local, deflated)

    const central = Buffer.alloc(46 + nameBytes.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(deflated.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    nameBytes.copy(central, 46)
    centralParts.push(central)

    offset += local.length + deflated.length
  }

  const centralBuf = Buffer.concat(centralParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...localParts, centralBuf, eocd])
}

function buildDocxFixture(): Buffer {
  const document = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>',
    '<w:p><w:r><w:t>第一章 雨夜相逢</w:t></w:r></w:p>',
    '<w:p><w:r><w:t>本章目的：让林川与古剑相遇</w:t></w:r></w:p>',
    '<w:p><w:r><w:t>关键事件：雨夜山道，古剑认主</w:t></w:r></w:p>',
    '<w:p><w:r><w:t>出场角色：林川、古剑</w:t></w:r></w:p>',
    '<w:p><w:r><w:t>悬念钩子：古剑为何认主</w:t></w:r></w:p>',
    '<w:p><w:r><w:t>烟&amp;雨</w:t></w:r></w:p>',
    '<w:p><w:r><w:t xml:space="preserve">A</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>B</w:t></w:r></w:p>',
    '<w:p><w:r><w:t>line1</w:t><w:br/><w:t>line2</w:t></w:r></w:p>',
    '</w:body></w:document>'
  ].join('')
  return buildDeflateZip([
    { name: '[Content_Types].xml', data: '<Types/>' },
    { name: 'word/document.xml', data: document }
  ])
}

function buildEpubFixture(): Buffer {
  const container =
    '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'
  const opf =
    '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>'
  const c1 =
    '<html><head><title>x</title></head><body><h1>第一章 雨夜相逢</h1><p>本章目的：让林川与古剑相遇</p><p>关键事件：雨夜山道</p></body></html>'
  return buildDeflateZip([
    { name: 'META-INF/container.xml', data: container },
    { name: 'OEBPS/content.opf', data: opf },
    { name: 'OEBPS/c1.xhtml', data: c1 }
  ])
}

/* --------------------------------- 工具 --------------------------------- */

function fixtureText(name: string): string {
  const path = join(app.getAppPath(), 'src', 'main', 'smoke', 'fixtures', name)
  if (!existsSync(path)) throw new Error(`缺少 fixture：${path}`)
  return readFileSync(path, 'utf8')
}

function fieldHitRate(tree: ReturnType<typeof parseOutline>): number {
  let total = 0
  let matched = 0
  for (const volume of tree.volumes) {
    for (const chapter of volume.chapters) {
      for (const key of Object.keys(chapter.fields) as Array<keyof typeof chapter.fields>) {
        const field = chapter.fields[key]
        if (field.value.trim()) {
          total += 1
          if (!field.heuristic) matched += 1
        }
      }
    }
  }
  return total === 0 ? 0 : matched / total
}

export async function runSmokeM7(): Promise<void> {
  const checks: Array<[string, boolean]> = []

  try {
    rmSync(BASE, { recursive: true, force: true })
    mkdirSync(BASE, { recursive: true })
    // 与 --smoke 系列共用 userData：清掉上一轮遗留的配置
    rmSync(join(app.getPath('userData'), 'config.json'), { force: true })

    // 自检专用数据库：共用 inkwell.db 可能残留历史 schema（例如软删除的部分索引未生效），
    // 这里改用独立文件并删旧重建，保证每次都是全新迁移、结果可重复。
    const m7Db = join(app.getPath('userData'), 'inkwell-m7.db')
    closeDatabase()
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${m7Db}${suffix}`, { force: true })
    initDatabase(m7Db, { journalMode: 'DELETE' })

    /* ------------------------------ 编码探测 ------------------------------ */
    const utf8 = detectEncoding(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('第一章', 'utf8')]))
    checks.push(['编码探测：UTF-8 BOM', utf8.encoding === 'utf-8' && utf8.hadBom && utf8.text.startsWith('第一章')])

    const u16le = detectEncoding(Buffer.from('\uFEFF第一章', 'utf16le'))
    checks.push(['编码探测：UTF-16LE', u16le.encoding === 'utf-16le' && u16le.text.includes('第一章')])

    const be = Buffer.from('第一章', 'utf16le')
    be.swap16()
    const u16be = detectEncoding(Buffer.concat([Buffer.from([0xfe, 0xff]), be]))
    checks.push(['编码探测：UTF-16BE', u16be.encoding === 'utf-16be' && u16be.text.includes('第一章')])

    const gbk = detectEncoding(Buffer.from([0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2]))
    checks.push(['编码探测：GBK', gbk.encoding === 'gbk' && gbk.text === '第一章'])

    /* ------------------------- ZIP 读回：DOCX / EPUB ------------------------- */
    const docx = readDocxFromBuffer(buildDocxFixture())
    checks.push([
      'DOCX 提取（deflate）：段落文本',
      docx.lines.includes('第一章 雨夜相逢') && docx.lines.some((line) => line.includes('让林川与古剑相遇'))
    ])
    checks.push([
      'DOCX 提取：制表符与软换行',
      docx.lines.some((line) => line === 'A\tB') && docx.lines.includes('line1') && docx.lines.includes('line2')
    ])
    checks.push(['DOCX 提取：XML 实体解码', docx.lines.some((line) => line.includes('烟&雨'))])

    const epub = readEpubFromBuffer(buildEpubFixture())
    checks.push([
      'EPUB 提取（deflate）：标题与正文',
      epub.lines.includes('# 第一章 雨夜相逢') && epub.lines.some((line) => line.includes('让林川与古剑相遇'))
    ])

    // 按路径识别 + .lnk 报错
    const docxPath = join(BASE, 'sample.docx')
    writeFileSync(docxPath, buildDocxFixture())
    const viaPath = readSourceFromPath(docxPath)
    checks.push(['按路径识别 .docx', viaPath.kind === 'docx' && viaPath.lines.length > 0])

    let lnkError = ''
    try {
      readSourceFromPath(join(BASE, 'shortcut.lnk'))
    } catch (error) {
      lnkError = error instanceof Error ? error.message : String(error)
    }
    checks.push(['.lnk 明确报「不支持快捷方式」', lnkError.includes('快捷方式')])

    /* ------------------------------ 分层解析 ------------------------------ */
    const volumes = parseOutline(fixtureText('outline-volumes.md'))
    checks.push([
      '分层：纯 md 分卷版（2 卷 3 章）',
      volumes.hasVolume &&
        volumes.volumes.length === 2 &&
        volumes.volumes[0].chapters.length === 2 &&
        volumes.volumes[1].chapters.length === 1
    ])
    checks.push(['分层：第二卷章节 volumeIdx = 2', volumes.volumes[1].chapters[0]?.volumeIdx === 2])
    checks.push(['分层：Markdown 标题风格识别', volumes.headingStyle === 'markdown'])

    const flat = parseOutline(fixtureText('outline-flat.md'))
    checks.push([
      '分层：无分卷版全部 volumeIdx = 0',
      !flat.hasVolume &&
        flat.volumes.length === 1 &&
        flat.volumes[0].index === 0 &&
        flat.volumes[0].chapters.every((chapter) => chapter.volumeIdx === 0)
    ])
    checks.push(['分层：无分卷版 3 章', flat.volumes[0].chapters.length === 3])
    checks.push(['分层：中文标题风格识别', flat.headingStyle === 'chinese'])

    const mixed = parseOutline(fixtureText('outline-mixed.md'))
    checks.push([
      '分层：卷+章混合版（以 # 为骨架）',
      mixed.hasVolume && mixed.headingStyle === 'mixed' && mixed.volumes.length === 2
    ])
    checks.push([
      '分层：混合版卷内章归属正确',
      mixed.volumes[0].chapters.length === 2 &&
        mixed.volumes[0].chapters[0]?.volumeIdx === 1 &&
        mixed.volumes[1].chapters.length === 1
    ])

    /* ------------------------------ 字段抽取 ------------------------------ */
    const rate = Math.min(fieldHitRate(volumes), fieldHitRate(flat), fieldHitRate(mixed))
    checks.push([`字段抽取命中率 ≥ 90%（实测 ${(rate * 100).toFixed(0)}%）`, rate >= 0.9])

    const heuristicTree = parseOutline('第一章 无标注\n\n林川在雨夜遇到古剑。\n古剑忽然开口说话。')
    const heuristicChapter = heuristicTree.volumes[0]?.chapters[0]
    checks.push([
      '未标注内容按启发式归类并标记',
      heuristicChapter?.fields.purpose.heuristic === true && heuristicChapter.fields.purpose.value.includes('林川')
    ])

    /* ------------------------------ 体检表 ------------------------------ */
    const report = validateTree(volumes)
    checks.push(['体检表：行数 = 章节数', report.rows.length === 3])
    checks.push(['体检表：必填项通过率 100%', report.passRate === 100 && report.totalMissing === 0])

    /* ---------------------------- 差异预览与提交 ---------------------------- */
    const project = createProject({ name: '导入自检项目' })
    saveBrief({ projectId: project.id, chapterNo: 1, title: '旧第一章', purpose: '旧目的' })
    saveDraft({ projectId: project.id, chapterNo: 1, version: 1, source: 'write', content: '既有正文……' })
    saveBrief({ projectId: project.id, chapterNo: 2, title: '旧第二章', purpose: '旧目的2' })

    const session = await analyzeImport({ text: fixtureText('outline-flat.md'), kind: 'md', projectId: project.id })
    const item1 = session.items.find((item) => item.chapterNo === 1)
    const item2 = session.items.find((item) => item.chapterNo === 2)
    const item3 = session.items.find((item) => item.chapterNo === 3)

    checks.push([
      '差异预览：已有正文 → 冲突且默认不勾选',
      item1?.action === 'conflict' && item1?.enabled === false && item1?.hasDraft === true
    ])
    checks.push(['差异预览：已有细纲无正文 → 更新且默认勾选', item2?.action === 'update' && item2?.enabled === true])
    checks.push(['差异预览：不存在 → 新建且默认勾选', item3?.action === 'create' && item3?.enabled === true])
    checks.push([
      '差异预览：字段级 diff 有新旧值',
      item2?.diff.find((diff) => diff.field === 'purpose')?.oldValue === '旧目的2' &&
        item2?.diff.find((diff) => diff.field === 'purpose')?.changed === true
    ])
    checks.push([
      '差异预览：统计（新建1 更新1 冲突1）',
      session.stats.create === 1 && session.stats.update === 1 && session.stats.conflict === 1
    ])

    const afterUpdate = updateImportItem({ sessionId: session.id, itemId: item1!.id, action: 'update' })
    checks.push(['改 action 为 update 后自动勾选', afterUpdate.items.find((item) => item.id === item1!.id)?.enabled === true])

    const commitResult = commitSession(session.id)
    const briefs = listBriefs(project.id)
    checks.push(['提交：落库 3 章', commitResult.committed === 3 && briefs.length === 3])

    const chapter1 = briefs.find((brief) => brief.chapterNo === 1)
    checks.push([
      '提交：字段写入正确',
      chapter1?.title.includes('雨夜相逢') === true &&
        chapter1?.purpose.includes('林川') === true &&
        chapter1?.characters.includes('林川') === true &&
        chapter1?.sceneBeats.length === 2
    ])
    checks.push([
      '提交：更新前旧细纲已移入回收站（软删除）',
      listTrash().some((item) => item.kind === 'chapter' && item.chapterNo === 2)
    ])
    checks.push(['提交后会话状态为 committed', getSession(session.id)?.status === 'committed'])

    // 取消不落库
    const session2 = await analyzeImport({ text: fixtureText('outline-volumes.md'), kind: 'md', projectId: project.id })
    cancelSession(session2.id)
    checks.push([
      '取消后不落库',
      getSession(session2.id)?.status === 'cancelled' && listBriefs(project.id).length === 3
    ])

    // 无项目解析：全部为新建
    const noProject = await analyzeImport({ text: fixtureText('outline-flat.md'), kind: 'md' })
    checks.push([
      '无目标项目解析：全部为新建',
      noProject.projectId === null && noProject.items.every((item) => item.action === 'create')
    ])

    for (const [name, passed] of checks) {
      console.log(`[smoke-m7] ${passed ? '✓' : '✗'} ${name}`)
    }
    const allPassed = checks.every(([, passed]) => passed)
    console.log(`[smoke-m7] result: ${allPassed ? 'M7_IMPORT_OK' : 'M7_IMPORT_FAILED'}`)
    process.exitCode = allPassed ? 0 : 1
  } catch (error) {
    for (const [name, passed] of checks) {
      console.log(`[smoke-m7] ${passed ? '✓' : '✗'} ${name}`)
    }
    console.log(`[smoke-m7] result: M7_IMPORT_FAILED (${error instanceof Error ? error.message : String(error)})`)
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