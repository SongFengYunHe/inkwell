import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ExportFile, ExportFormat, ExportInput, ExportResult, Project } from '@shared/types'
import { getProject, listBriefs, listDrafts } from '../db/repositories'
import { buildZip } from './zip'

interface ExportChapter {
  chapterNo: number
  title: string
  volumeIdx: number
  content: string
}

interface ExportVolume {
  index: number
  chapters: ExportChapter[]
}

/* -------------------------------- 通用工具 -------------------------------- */

/** 文件名安全化（跨平台） */
export function safeFileName(name: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.slice(0, 80) || '未命名'
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** 把正文按空行切成段落 */
function toParagraphs(content: string): string[] {
  return content
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function countChars(text: string): number {
  return text.replace(/\s/g, '').length
}

/** 汇总项目正文：按章聚合 → 按卷分组 */
function collectBook(project: Project): { volumes: ExportVolume[]; skipped: number[]; totalChars: number } {
  const drafts = listDrafts(project.id)
  const briefs = listBriefs(project.id)
  const briefMap = new Map(briefs.map((brief) => [brief.chapterNo, brief]))
  const latestContent = new Map<number, string>()

  for (const draft of drafts) {
    if (!draft.content.trim()) continue
    const current = latestContent.get(draft.chapterNo)
    if (current === undefined) latestContent.set(draft.chapterNo, draft.content)
  }

  const skipped: number[] = []
  const chapters: ExportChapter[] = []
  for (let chapterNo = 1; chapterNo <= project.totalChapters; chapterNo += 1) {
    const content = latestContent.get(chapterNo)
    if (!content) {
      if (briefMap.has(chapterNo)) skipped.push(chapterNo)
      continue
    }
    const brief = briefMap.get(chapterNo)
    chapters.push({
      chapterNo,
      title: brief?.title || `第 ${chapterNo} 章`,
      volumeIdx: brief?.volumeIdx ?? 1,
      content
    })
  }

  const volumeMap = new Map<number, ExportVolume>()
  for (const chapter of chapters) {
    let volume = volumeMap.get(chapter.volumeIdx)
    if (!volume) {
      volume = { index: chapter.volumeIdx, chapters: [] }
      volumeMap.set(chapter.volumeIdx, volume)
    }
    volume.chapters.push(chapter)
  }

  const volumes = [...volumeMap.values()].sort((a, b) => a.index - b.index)
  const totalChars = chapters.reduce((sum, chapter) => sum + countChars(chapter.content), 0)
  return { volumes, skipped, totalChars }
}

/* ---------------------------------- TXT ---------------------------------- */

function buildTxt(project: Project, volumes: ExportVolume[]): string {
  const lines: string[] = [project.name, `题材：${project.genre || '未设置'}`, '']
  for (const volume of volumes) {
    if (volumes.length > 1) lines.push(`第 ${volume.index} 卷`, '')
    for (const chapter of volume.chapters) {
      lines.push(`第 ${chapter.chapterNo} 章　${chapter.title}`, '', chapter.content.trim(), '')
    }
  }
  // 加 BOM，方便 Windows 记事本识别 UTF-8
  return `\uFEFF${lines.join('\n')}`
}

/* ----------------------------------- MD ----------------------------------- */

function buildMd(project: Project, volumes: ExportVolume[], totalChars: number, chapterCount: number): string {
  const lines: string[] = [`# ${project.name}`, '']
  if (project.genre) lines.push(`> 题材：${project.genre}`)
  lines.push(`> 共 ${chapterCount} 章 · 约 ${totalChars} 字`, '')

  lines.push('## 目录', '')
  for (const volume of volumes) {
    if (volumes.length > 1) lines.push(`- **第 ${volume.index} 卷**`)
    const indent = volumes.length > 1 ? '  ' : ''
    for (const chapter of volume.chapters) {
      lines.push(`${indent}- 第 ${chapter.chapterNo} 章 ${chapter.title}`)
    }
  }
  lines.push('')

  for (const volume of volumes) {
    if (volumes.length > 1) lines.push(`## 第 ${volume.index} 卷`, '')
    for (const chapter of volume.chapters) {
      lines.push(`### 第 ${chapter.chapterNo} 章 ${chapter.title}`, '')
      lines.push(...toParagraphs(chapter.content))
      lines.push('')
    }
  }

  return lines.join('\n')
}

/* --------------------------------- DOCX ---------------------------------- */

function docxParagraph(text: string, options?: { bold?: boolean; size?: number; center?: boolean }): string {
  const props = options?.center ? '<w:pPr><w:jc w:val="center"/></w:pPr>' : ''
  const runProps = [options?.bold ? '<w:b/>' : '', options?.size ? `<w:sz w:val="${options.size}"/>` : ''].join('')
  const rpr = runProps ? `<w:rPr>${runProps}</w:rPr>` : ''
  return `<w:p>${props}<w:r>${rpr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
}

function buildDocx(project: Project, volumes: ExportVolume[]): Buffer {
  const body: string[] = []
  body.push(docxParagraph(project.name, { bold: true, size: 44, center: true }))
  if (project.genre) body.push(docxParagraph(`题材：${project.genre}`, { size: 20, center: true }))

  for (const volume of volumes) {
    if (volumes.length > 1) body.push(docxParagraph(`第 ${volume.index} 卷`, { bold: true, size: 32 }))
    for (const chapter of volume.chapters) {
      body.push(docxParagraph(`第 ${chapter.chapterNo} 章　${chapter.title}`, { bold: true, size: 28 }))
      for (const paragraph of toParagraphs(chapter.content)) {
        body.push(docxParagraph(paragraph, { size: 24 }))
      }
    }
  }

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`

  return buildZip([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rels },
    { name: 'word/document.xml', data: documentXml }
  ])
}

/* --------------------------------- EPUB ---------------------------------- */

function xhtmlPage(title: string, bodyHtml: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN" lang="zh-CN"><head><meta charset="utf-8"/><title>${escapeXml(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body>${bodyHtml}</body></html>`
}

function buildEpub(project: Project, volumes: ExportVolume[]): Buffer {
  const chapters = volumes.flatMap((volume) => volume.chapters)
  const identifier = `urn:inkwell:${project.id}`
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z')

  const files: Array<{ name: string; data: Buffer | string }> = []
  // mimetype 必须是第一个条目且不压缩（store）
  files.push({ name: 'mimetype', data: 'application/epub+zip' })
  files.push({
    name: 'META-INF/container.xml',
    data: `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
  })

  files.push({
    name: 'OEBPS/style.css',
    data: 'body{font-family:serif;line-height:1.8;margin:1em;}h1,h2{text-align:center;}p{text-indent:2em;margin:0.4em 0;}'
  })

  // 标题页 + 各章 xhtml
  const titleBody = `<h1>${escapeXml(project.name)}</h1>${project.genre ? `<p>题材：${escapeXml(project.genre)}</p>` : ''}`
  files.push({ name: 'OEBPS/title.xhtml', data: xhtmlPage(project.name, titleBody) })

  const chapterFiles: Array<{ id: string; href: string; title: string }> = []
  chapters.forEach((chapter, index) => {
    const href = `chapter-${String(index + 1).padStart(4, '0')}.xhtml`
    const id = `chap${index + 1}`
    const heading = `第 ${chapter.chapterNo} 章　${chapter.title}`
    const paragraphs = toParagraphs(chapter.content)
      .map((paragraph) => `<p>${escapeXml(paragraph)}</p>`)
      .join('')
    files.push({ name: `OEBPS/${href}`, data: xhtmlPage(heading, `<h2>${escapeXml(heading)}</h2>${paragraphs}`) })
    chapterFiles.push({ id, href, title: heading })
  })

  const manifestItems = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
    '<item id="css" href="style.css" media-type="text/css"/>',
    '<item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>',
    ...chapterFiles.map((chapter) => `<item id="${chapter.id}" href="${chapter.href}" media-type="application/xhtml+xml"/>`)
  ].join('')

  const spineItems = [
    '<itemref idref="title"/>',
    ...chapterFiles.map((chapter) => `<itemref idref="${chapter.id}"/>`)
  ].join('')

  files.push({
    name: 'OEBPS/content.opf',
    data: `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">${escapeXml(identifier)}</dc:identifier>
<dc:title>${escapeXml(project.name)}</dc:title>
<dc:language>zh-CN</dc:language>
${project.genre ? `<dc:subject>${escapeXml(project.genre)}</dc:subject>` : ''}
<meta property="dcterms:modified">${now}</meta>
</metadata>
<manifest>${manifestItems}</manifest>
<spine toc="ncx">${spineItems}</spine>
</package>`
  })

  const navList = chapterFiles
    .map((chapter) => `<li><a href="${chapter.href}">${escapeXml(chapter.title)}</a></li>`)
    .join('')
  files.push({
    name: 'OEBPS/nav.xhtml',
    data: xhtmlPage(
      '目录',
      `<nav xmlns:epub="http://www.idpf.org/2007/ops" epub:type="toc" id="toc"><h1>目录</h1><ol>${navList}</ol></nav>`
    )
  })

  const navPoints = chapterFiles
    .map(
      (chapter, index) =>
        `<navPoint id="navPoint-${index + 1}" playOrder="${index + 1}"><navLabel><text>${escapeXml(
          chapter.title
        )}</text></navLabel><content src="${chapter.href}"/></navPoint>`
    )
    .join('')
  files.push({
    name: 'OEBPS/toc.ncx',
    data: `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="${escapeXml(
      identifier
    )}"/></head><docTitle><text>${escapeXml(project.name)}</text></docTitle><navMap>${navPoints}</navMap></ncx>`
  })

  return buildZip(files)
}

/* ------------------------------- 导出入口 ------------------------------- */

/**
 * 导出成书（计划书 §10 M4）：TXT / MD / DOCX / EPUB，分卷 + 目录。
 * 只导出有正文的章节；缺章会在 `skippedChapters` 里返回。
 */
export async function exportProject(input: ExportInput, defaultDir: string): Promise<ExportResult> {
  const project = getProject(input.projectId)
  if (!project) throw new Error(`项目不存在：${input.projectId}`)
  if (input.formats.length === 0) throw new Error('至少选择一种导出格式')

  const { volumes, skipped, totalChars } = collectBook(project)
  if (volumes.length === 0) throw new Error('还没有任何正文可导出，先写几章吧')

  const dir = input.outDir?.trim() || join(defaultDir, safeFileName(project.name))
  await mkdir(dir, { recursive: true })

  const chapterCount = volumes.reduce((sum, volume) => sum + volume.chapters.length, 0)
  const files: ExportFile[] = []

  const write = async (format: ExportFormat, extension: string, data: Buffer | string): Promise<void> => {
    const path = join(dir, `${safeFileName(project.name)}.${extension}`)
    await writeFile(path, data)
    const bytes = Buffer.isBuffer(data) ? data.length : Buffer.byteLength(data, 'utf8')
    files.push({ format, path, bytes, chapters: chapterCount })
  }

  for (const format of input.formats) {
    switch (format) {
      case 'txt':
        await write('txt', 'txt', buildTxt(project, volumes))
        break
      case 'md':
        await write('md', 'md', buildMd(project, volumes, totalChars, chapterCount))
        break
      case 'docx':
        await write('docx', 'docx', buildDocx(project, volumes))
        break
      case 'epub':
        await write('epub', 'epub', buildEpub(project, volumes))
        break
    }
  }

  return { dir, bookTitle: project.name, files, skippedChapters: skipped }
}