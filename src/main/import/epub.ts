import { posix } from 'node:path'
import { decodeXmlEntities } from './docx'
import type { ZipArchive } from './zip-reader'

/**
 * EPUB 文本提取（计划书 §4.2）：
 *   META-INF/container.xml → content.opf 的 spine 顺序 → 各 XHTML
 *   <h1>–<h6> 当标题行（转成 Markdown `#` 层级），<p>/<div> 当正文行，只取文本。
 */

interface ManifestItem {
  href: string
  mediaType: string
}

function extractXhtml(source: string): string[] {
  let text = source
    .replace(/<head\b[\s\S]*?<\/head>/gi, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')

  text = text.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, inner: string) => {
    return `\n${'#'.repeat(Number(level))} ${inner}\n`
  })
  text = text.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (_m, inner: string) => `\n${inner}\n`)
  text = text.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner: string) => `\n${inner}\n`)
  text = text.replace(/<br\s*\/?>/gi, '\n')
  text = text.replace(/<div\b[^>]*>/gi, '\n').replace(/<\/div>/gi, '\n')
  text = text.replace(/<[^>]+>/g, '')
  text = decodeXmlEntities(text)

  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter((line) => line.length > 0)
}

/** 从 EPUB 归档中按 spine 顺序提取文本 */
export function extractEpub(archive: ZipArchive): { lines: string[]; warnings: string[] } {
  const warnings: string[] = []
  const container = archive.readText('META-INF/container.xml', 'utf8')
  if (container === null) throw new Error('不是有效的 EPUB：缺少 META-INF/container.xml')

  const rootMatch = /full-path\s*=\s*"([^"]+)"/i.exec(container)
  if (!rootMatch) throw new Error('EPUB container.xml 未找到 rootfile（content.opf 路径）')
  const opfPath = decodeURIComponent(rootMatch[1])
  const opf = archive.readText(opfPath, 'utf8')
  if (opf === null) throw new Error(`EPUB 缺少 OPF 文件：${opfPath}`)

  // manifest：id → href
  const manifest = new Map<string, ManifestItem>()
  const itemRe = /<item\b[^>]*\/?>/gi
  let itemMatch: RegExpExecArray | null
  while ((itemMatch = itemRe.exec(opf)) !== null) {
    const tag = itemMatch[0]
    const id = attr(tag, 'id')
    const href = attr(tag, 'href')
    const mediaType = attr(tag, 'media-type')
    if (id && href) manifest.set(id, { href: decodeURIComponent(href), mediaType })
  }

  // spine：读取顺序
  const opfDir = posix.dirname(opfPath)
  const spineRe = /<itemref\b[^>]*\/?>/gi
  const ordered: ManifestItem[] = []
  let spineMatch: RegExpExecArray | null
  while ((spineMatch = spineRe.exec(opf)) !== null) {
    const idref = attr(spineMatch[0], 'idref')
    if (!idref) continue
    const found = manifest.get(idref)
    if (found) ordered.push(found)
  }

  const targets = ordered.length > 0 ? ordered : [...manifest.values()]
  const lines: string[] = []

  for (const item of targets) {
    const mediaType = item.mediaType.toLowerCase()
    const isMarkup = mediaType.includes('xhtml') || mediaType.includes('html') || /\.x?html?$/i.test(item.href)
    if (!isMarkup) continue
    const plainHref = item.href.split('#')[0]
    const entryPath = posix.normalize(posix.join(opfDir, plainHref))
    const content = archive.readText(entryPath, 'utf8')
    if (content === null) {
      warnings.push(`EPUB 中未找到章节文件：${entryPath}`)
      continue
    }
    for (const line of extractXhtml(content)) lines.push(line)
  }

  if (lines.length === 0) warnings.push('EPUB 未提取到任何文本内容')

  return { lines, warnings }
}

function attr(tag: string, name: string): string {
  const match = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag)
  return match ? match[1] : ''
}