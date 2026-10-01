import type { ZipArchive } from './zip-reader'

/**
 * DOCX 文本提取（够用即可，不追求完整 OOXML，计划书 §4.2）。
 *   <w:p>        段落边界
 *   <w:t>        文本
 *   <w:br/>      换行
 *   <w:tab/>     制表符
 * 明确不提取：表格 / 批注 / 页眉页脚 / 图片。
 */

const PARAGRAPH_RE = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>|<w:p\b[^>]*\/>/g
const TEXT_RE = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:t(?:\s[^>]*)?\/>/g

/** 解码 XML 实体（&amp; &lt; &gt; &quot; &apos; &#NNN; &#xHH;） */
export function decodeXmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return ''
  try {
    return String.fromCodePoint(code)
  } catch {
    return ''
  }
}

/** 段落内的换行 / 制表占位符（避免与正文冲突） */
const BR_PLACEHOLDER = '\u0000'
const TAB_PLACEHOLDER = '\u0001'

/** 把一段段落内的 XML 转成若干行文本 */
function paragraphToLines(inner: string): string[] {
  let working = inner
    // 先移除域代码 / 修订删除文本（不提取）
    .replace(/<w:instrText\b[^>]*>[\s\S]*?<\/w:instrText>/g, '')
    .replace(/<w:delText\b[^>]*>[\s\S]*?<\/w:delText>/g, '')
    // <w:br/> 与 <w:tab/> 可能在 <w:t> 之外（run 的子节点），先占位
    .replace(/<w:br(?:\s[^>]*)?\/>/g, BR_PLACEHOLDER)
    .replace(/<w:tab(?:\s[^>]*)?\/>/g, TAB_PLACEHOLDER)

  // 用 <w:t> 的文本替换掉整个 run 内的标签
  working = working.replace(TEXT_RE, (_match, text: string | undefined) => text ?? '')

  // 去掉剩余标签，再解码实体，最后把占位符还原为换行 / 制表符
  return decodeXmlEntities(working.replace(/<[^>]+>/g, ''))
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '\n')
    .replace(/\u0001/g, '\t')
    .split('\n')
}

/** 从 DOCX 归档中提取段落文本 */
export function extractDocx(archive: ZipArchive, documentPath = 'word/document.xml'): {
  lines: string[]
  warnings: string[]
} {
  const xml = archive.readText(documentPath, 'utf8')
  if (xml === null) throw new Error('不是有效的 Word 文档：缺少 word/document.xml')

  const lines: string[] = []
  PARAGRAPH_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = PARAGRAPH_RE.exec(xml)) !== null) {
    const inner = match[1] ?? ''
    for (const line of paragraphToLines(inner)) lines.push(line)
  }

  return {
    lines,
    warnings: ['已忽略表格、批注、页眉页脚与图片，仅提取正文段落']
  }
}