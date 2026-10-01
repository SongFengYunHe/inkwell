import { closeSync, existsSync, openSync, readFileSync, readdirSync, readSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { detectEncoding } from './encoding'
import { extractDocx } from './docx'
import { extractEpub } from './epub'
import { openZip, openZipFile } from './zip-reader'
import { resolveVelaDbPath } from './vela'

/**
 * 统一导入入口（计划书 §4.2）：给一个路径或一段文本，返回便于解析管线消费的中间结构。
 * 支持 txt / md / json / docx / epub / vela（目录或库文件）/ 手动粘贴。
 */

export type ImportKind = 'txt' | 'md' | 'docx' | 'epub' | 'json' | 'vela' | 'manual'

export interface ImportSource {
  kind: ImportKind
  lines: string[]
  warnings: string[]
  encoding?: string
  /** 原始全文（正文导入 / 预览用） */
  text?: string
  /** 建议标题（首个标题行 / 文件名） */
  title?: string
  /** vela 工程的数据库文件路径 */
  velaDbPath?: string
}

/** 超过 50MB 拒绝导入 */
const MAX_BYTES = 50 * 1024 * 1024
/** 超过 20MB 走分块读取 */
const CHUNK_THRESHOLD = 20 * 1024 * 1024
const CHUNK_SIZE = 4 * 1024 * 1024

const TEXT_EXT = new Set(['.txt', '.md', '.markdown', '.json'])
const ZIP_EXT = new Set(['.docx', '.epub'])
const DB_EXT = new Set(['.db', '.sqlite', '.sqlite3', '.vela'])

/** 目录递归时可识别的文件扩展名 */
export function isRecognizableFile(name: string): boolean {
  const ext = extname(name).toLowerCase()
  return TEXT_EXT.has(ext) || ZIP_EXT.has(ext) || DB_EXT.has(ext)
}

function readFileBuffer(filePath: string): Buffer {
  const size = statSync(filePath).size
  if (size > MAX_BYTES) throw new Error(`文件过大（${(size / 1024 / 1024).toFixed(1)}MB），暂不支持导入（上限 50MB）`)

  if (size <= CHUNK_THRESHOLD) return readFileSync(filePath)

  // 大文件分块读取，避免一次性占用过多内存
  const fd = openSync(filePath, 'r')
  const chunks: Buffer[] = []
  try {
    let position = 0
    while (position < size) {
      const length = Math.min(CHUNK_SIZE, size - position)
      const buffer = Buffer.allocUnsafe(length)
      const read = readSync(fd, buffer, 0, length, position)
      if (read <= 0) break
      chunks.push(read === length ? buffer : buffer.subarray(0, read))
      position += read
    }
  } finally {
    closeSync(fd)
  }
  return Buffer.concat(chunks)
}

/** 读取文本文件并探测编码 */
function readTextSource(filePath: string): ImportSource {
  const buffer = readFileBuffer(filePath)
  const detection = detectEncoding(buffer)
  const lines = detection.text.split(/\r\n?|\n/)
  return {
    kind: extname(filePath).toLowerCase() === '.json' ? 'json' : 'txt',
    lines,
    warnings: detection.warnings,
    encoding: detection.encoding,
    text: detection.text,
    title: basename(filePath, extname(filePath))
  }
}

/** 把通用 JSON 结构或本项目导出结构转成带标签的行 */
function readJsonSource(filePath: string, rawText: string): ImportSource {
  const warnings: string[] = []
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    warnings.push('JSON 解析失败，已按纯文本处理')
    return { kind: 'json', lines: rawText.split(/\r\n?|\n/), warnings, text: rawText, title: basename(filePath, extname(filePath)) }
  }

  const lines: string[] = []
  let title = ''

  const array = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object'
      ? ((parsed as Record<string, unknown>).chapters ?? (parsed as Record<string, unknown>).briefs)
      : null

  if (Array.isArray(array)) {
    for (const entry of array) {
      if (!entry || typeof entry !== 'object') continue
      const row = entry as Record<string, unknown>
      const chapterNo = Number(row.chapterNo ?? row.chapter_no ?? row.no ?? 0)
      const entryTitle = textOf(row.title ?? row.name)
      if (chapterNo > 0) {
        lines.push(`第${chapterNo}章 ${entryTitle}`.trim())
        lines.push(...labeled(`本章目的`, textOf(row.purpose ?? row.goal)))
        lines.push(...labeled(`关键事件`, textOf(row.keyEvents ?? row.key_events ?? row.events)))
        lines.push(...labeled(`出场角色`, listOf(row.characters)))
        lines.push(...labeled(`悬念钩子`, textOf(row.suspenseHook ?? row.hook)))
        lines.push(...labeled(`场景节拍`, listOf(row.sceneBeats)))
        lines.push(...labeled(`额外要求`, textOf(row.userGuidance)))
        lines.push(...labeled(`备注`, textOf(row.notes)))
      } else {
        // 通用 [{title, content}] 结构
        const content = textOf(row.content ?? row.text ?? row.body)
        if (entryTitle) lines.push(entryTitle)
        if (content) lines.push(...content.split(/\r\n?|\n/))
      }
      lines.push('')
    }
  } else if (parsed && typeof parsed === 'object') {
    const row = parsed as Record<string, unknown>
    title = textOf(row.name ?? row.title ?? row.bookTitle)
    const core = textOf(row.coreOutline ?? row.core_outline ?? row.outline)
    if (core) lines.push(...core.split(/\r\n?|\n/))
  }

  if (lines.length === 0) {
    warnings.push('未识别的 JSON 结构，已按格式化文本处理')
    lines.push(JSON.stringify(parsed, null, 2))
  }

  return { kind: 'json', lines, warnings, text: lines.join('\n'), title: title || basename(filePath, extname(filePath)) }
}

function textOf(value: unknown): string {
  if (value === undefined || value === null) return ''
  return String(value)
}

function listOf(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => textOf(item)).filter(Boolean).join('、')
  return textOf(value)
}

/** `标签：内容` 只在内容非空时输出 */
function labeled(label: string, value: string): string[] {
  return value.trim() ? [`${label}：${value.trim()}`] : []
}

/** 递归收集目录下可识别的文件 */
function collectRecognizableFiles(dir: string, acc: string[], depth = 0): void {
  if (depth > 6) return
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.startsWith('.')) continue
    const full = join(dir, entry)
    let stat: ReturnType<typeof statSync>
    try {
      stat = statSync(full)
    } catch {
      continue
    }
    if (stat.isDirectory()) collectRecognizableFiles(full, acc, depth + 1)
    else if (isRecognizableFile(entry)) acc.push(full)
  }
}

function isVelaDb(filePath: string): boolean {
  return basename(filePath).toLowerCase() === 'vela.db' || DB_EXT.has(extname(filePath).toLowerCase())
}

/** 读取单个文件为导入源 */
function readSingleFile(filePath: string, overrideKind?: string): ImportSource {
  const ext = extname(filePath).toLowerCase()
  const kind = overrideKind ?? ''

  if (kind === 'vela' || (!overrideKind && isVelaDb(filePath))) {
    return {
      kind: 'vela',
      lines: [],
      warnings: ['Vela 工程请使用「导入 Vela 项目」入口'],
      velaDbPath: resolveVelaDbPath(filePath)
    }
  }

  if (kind === 'docx' || ext === '.docx') {
    const archive = openZipFile(filePath)
    const result = extractDocx(archive)
    return { kind: 'docx', lines: result.lines, warnings: result.warnings, title: basename(filePath, ext) }
  }

  if (kind === 'epub' || ext === '.epub') {
    const archive = openZipFile(filePath)
    const result = extractEpub(archive)
    return { kind: 'epub', lines: result.lines, warnings: result.warnings, title: basename(filePath, ext) }
  }

  if (kind === 'json' || ext === '.json') {
    const buffer = readFileBuffer(filePath)
    const detection = detectEncoding(buffer)
    return readJsonSource(filePath, detection.text)
  }

  if (kind === 'md' || ext === '.md' || ext === '.markdown') {
    const source = readTextSource(filePath)
    return { ...source, kind: 'md' }
  }

  // 其余按 txt 处理
  return readTextSource(filePath)
}

/** 从路径（文件 / 目录）读取导入源 */
export function readSourceFromPath(inputPath: string, overrideKind?: string): ImportSource {
  if (extname(inputPath).toLowerCase() === '.lnk') {
    throw new Error('不支持快捷方式，请拖入目标文件')
  }
  if (!existsSync(inputPath)) throw new Error(`路径不存在：${inputPath}`)

  const stat = statSync(inputPath)
  if (stat.isDirectory()) {
    // 目录里若有 vela.db，视为 Vela 工程
    try {
      const dbPath = resolveVelaDbPath(inputPath)
      return { kind: 'vela', lines: [], warnings: ['Vela 工程请使用「导入 Vela 项目」入口'], velaDbPath: dbPath }
    } catch {
      // 不是 Vela 目录，继续按普通目录处理
    }

    const files: string[] = []
    collectRecognizableFiles(inputPath, files)
    if (files.length === 0) throw new Error('目录中没有可识别的文档（支持 txt / md / json / docx / epub）')

    const lines: string[] = []
    const warnings: string[] = []
    let title = ''
    for (const file of files) {
      const source = readSingleFile(file)
      if (source.kind === 'vela') continue
      if (!title && source.title) title = source.title
      lines.push(...source.lines)
      lines.push('')
      warnings.push(...source.warnings.map((item) => `${basename(file)}：${item}`))
    }
    warnings.unshift(`目录包含 ${files.length} 个文件，已合并导入`)
    return { kind: overrideKind ? (overrideKind as ImportKind) : 'txt', lines, warnings, title }
  }

  const source = readSingleFile(inputPath, overrideKind)
  if (!source.title) source.title = basename(inputPath, extname(inputPath))
  return source
}

/** 从一段文本（粘贴导入）构造导入源 */
export function readSourceFromText(text: string, kind: ImportKind = 'manual'): ImportSource {
  return {
    kind,
    lines: text.split(/\r\n?|\n/),
    warnings: [],
    text,
    title: ''
  }
}

/** 便捷：从 zip 缓冲区直接提取（自检用） */
export function readDocxFromBuffer(buffer: Buffer): ImportSource {
  const result = extractDocx(openZip(buffer))
  return { kind: 'docx', lines: result.lines, warnings: result.warnings }
}

/** 便捷：从 zip 缓冲区提取 epub（自检用） */
export function readEpubFromBuffer(buffer: Buffer): ImportSource {
  const result = extractEpub(openZip(buffer))
  return { kind: 'epub', lines: result.lines, warnings: result.warnings }
}