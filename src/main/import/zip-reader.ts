import { inflateRawSync } from 'node:zlib'
import { readFileSync } from 'node:fs'

/**
 * 极简 ZIP 读取器（零新依赖）。
 * 支持 method=0（store 直读）与 method=8（deflate，用 node:zlib 的 inflateRawSync）。
 * 真实的 docx / epub 都是 deflate，因此必须支持；与 export/zip.ts 的写入器共用签名常量。
 */

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50
/** 最大注释长度，倒扫 EOCD 时最多回退这么多字节 */
const MAX_COMMENT = 0xffff

export interface ZipEntryMeta {
  name: string
  /** 压缩方式：0=store，8=deflate */
  method: number
  compressedSize: number
  uncompressedSize: number
  localOffset: number
  encrypted: boolean
}

/** 读取一个 ZIP 缓冲区，提供列举与按名读取能力 */
export class ZipArchive {
  readonly entries: ZipEntryMeta[]
  private readonly byName: Map<string, ZipEntryMeta>

  constructor(private readonly buffer: Buffer) {
    this.entries = parseCentralDirectory(buffer)
    this.byName = new Map(this.entries.map((entry) => [entry.name, entry]))
  }

  /** 全部条目名（不含目录项） */
  names(): string[] {
    return this.entries.map((entry) => entry.name)
  }

  has(name: string): boolean {
    return this.byName.has(name)
  }

  /** 读取单个条目（不存在返回 null）；加密 / 损坏会抛出中文错误 */
  read(name: string): Buffer | null {
    const entry = this.byName.get(name)
    if (!entry) return null
    return this.readEntry(entry)
  }

  /** 读取并解码为文本（默认 UTF-8） */
  readText(name: string, encoding = 'utf-8'): string | null {
    const data = this.read(name)
    if (!data) return null
    return data.toString(encoding as BufferEncoding)
  }

  private readEntry(entry: ZipEntryMeta): Buffer {
    if (entry.encrypted) throw new Error(`ZIP 条目已加密，无法读取：${entry.name}`)

    const { localOffset } = entry
    if (localOffset + 30 > this.buffer.length || this.buffer.readUInt32LE(localOffset) !== SIG_LOCAL) {
      throw new Error(`ZIP 本地头损坏：${entry.name}`)
    }
    const nameLength = this.buffer.readUInt16LE(localOffset + 26)
    const extraLength = this.buffer.readUInt16LE(localOffset + 28)
    const start = localOffset + 30 + nameLength + extraLength
    const end = start + entry.compressedSize
    if (end > this.buffer.length) throw new Error(`ZIP 条目数据越界：${entry.name}`)

    const raw = this.buffer.subarray(start, end)
    if (entry.method === 0) return Buffer.from(raw)
    if (entry.method === 8) {
      try {
        return inflateRawSync(raw)
      } catch (error) {
        throw new Error(`ZIP 解压失败（deflate）：${entry.name}｜${error instanceof Error ? error.message : String(error)}`)
      }
    }
    throw new Error(`不支持的 ZIP 压缩方式（method=${entry.method}）：${entry.name}`)
  }
}

/** 解析中央目录；跳过以 `/` 结尾的目录项 */
function parseCentralDirectory(buffer: Buffer): ZipEntryMeta[] {
  if (buffer.length < 22) throw new Error('不是合法的 ZIP 文件（长度不足）')

  // 倒扫 EOCD 签名（允许尾部有注释）
  const scanStart = Math.max(0, buffer.length - 22 - MAX_COMMENT)
  let eocd = -1
  for (let index = buffer.length - 22; index >= scanStart; index -= 1) {
    if (buffer.readUInt32LE(index) === SIG_EOCD) {
      eocd = index
      break
    }
  }
  if (eocd < 0) throw new Error('不是合法的 ZIP 文件（未找到中央目录结尾标识）')

  const count = buffer.readUInt16LE(eocd + 10)
  let pointer = buffer.readUInt32LE(eocd + 16)
  const entries: ZipEntryMeta[] = []

  for (let index = 0; index < count; index += 1) {
    if (pointer + 46 > buffer.length || buffer.readUInt32LE(pointer) !== SIG_CENTRAL) {
      throw new Error('ZIP 中央目录损坏')
    }
    const flag = buffer.readUInt16LE(pointer + 8)
    const method = buffer.readUInt16LE(pointer + 10)
    const compressedSize = buffer.readUInt32LE(pointer + 20)
    const uncompressedSize = buffer.readUInt32LE(pointer + 24)
    const nameLength = buffer.readUInt16LE(pointer + 28)
    const extraLength = buffer.readUInt16LE(pointer + 30)
    const commentLength = buffer.readUInt16LE(pointer + 32)
    const localOffset = buffer.readUInt32LE(pointer + 42)
    const name = buffer.toString('utf8', pointer + 46, pointer + 46 + nameLength)

    // 跳过目录项
    if (!name.endsWith('/')) {
      entries.push({
        name,
        method,
        compressedSize,
        uncompressedSize,
        localOffset,
        encrypted: (flag & 0x1) === 0x1
      })
    }
    pointer += 46 + nameLength + extraLength + commentLength
  }

  return entries
}

/** 从缓冲区打开 ZIP 归档 */
export function openZip(buffer: Buffer): ZipArchive {
  return new ZipArchive(buffer)
}

/** 从文件路径打开 ZIP 归档 */
export function openZipFile(filePath: string): ZipArchive {
  let buffer: Buffer
  try {
    buffer = readFileSync(filePath)
  } catch (error) {
    throw new Error(`无法读取文件：${filePath}｜${error instanceof Error ? error.message : String(error)}`)
  }
  return new ZipArchive(buffer)
}