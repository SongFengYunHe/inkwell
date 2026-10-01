/**
 * 编码探测链（计划书 §4.2）：
 *   1. BOM（UTF-8 / UTF-16LE / UTF-16BE）优先
 *   2. 无 BOM：先按 utf-8 解码（fatal:false），U+FFFD 比例 < 0.1% 判为 UTF-8
 *   3. 否则试 GBK（Electron 主进程自带完整 ICU，TextDecoder('gbk') 可用）
 *   4. 仍乱码：返回候选列表供 UI 手动切换
 */

import { TextDecoder as NodeTextDecoder } from 'node:util'

export interface EncodingDetection {
  /** 最终采用的编码标签 */
  encoding: string
  /** 解码后的文本（已去 BOM） */
  text: string
  /** 是否命中 BOM */
  hadBom: boolean
  /** 是否低置信度（建议 UI 让用户手动确认编码） */
  uncertain: boolean
  warnings: string[]
}

/** UI 手动切换的候选编码列表 */
export function encodingCandidates(): string[] {
  return ['utf-8', 'gbk', 'gb18030', 'big5', 'utf-16le']
}

function countReplacement(text: string): number {
  let count = 0
  for (const char of text) {
    if (char === '\uFFFD') count += 1
  }
  return count
}

/** 尝试构造一个解码器；不可用返回 null（用于探测环境是否支持该编码） */
function makeDecoder(label: string): NodeTextDecoder | null {
  try {
    return new NodeTextDecoder(label, { fatal: false })
  } catch {
    return null
  }
}

/** UTF-16BE 手工解码：交换字节后按 LE 解码（避免依赖具体 ICU 标签） */
function decodeUtf16be(buffer: Buffer): string {
  const swapped = Buffer.from(buffer)
  swapped.swap16()
  return swapped.toString('utf16le')
}

/** 去掉开头的 BOM（若存在） */
function stripBom(buffer: Buffer): Buffer {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3)
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2)
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) return buffer.subarray(2)
  return buffer
}

/** 按指定编码解码（自动去 BOM） */
export function decodeWithEncoding(buffer: Buffer, encoding: string): string {
  const body = stripBom(buffer)
  const label = encoding.toLowerCase()
  if (label === 'utf-16be') return decodeUtf16be(body)
  const decoder = makeDecoder(label)
  if (!decoder) throw new Error(`不支持的编码：${encoding}`)
  return decoder.decode(body)
}

/** 探测缓冲区编码并解码 */
export function detectEncoding(buffer: Buffer): EncodingDetection {
  const warnings: string[] = []

  // 1. BOM
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { encoding: 'utf-8', text: buffer.subarray(3).toString('utf8'), hadBom: true, uncertain: false, warnings }
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { encoding: 'utf-16le', text: buffer.subarray(2).toString('utf16le'), hadBom: true, uncertain: false, warnings }
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return { encoding: 'utf-16be', text: decodeUtf16be(buffer.subarray(2)), hadBom: true, uncertain: false, warnings }
  }

  // 2. 无 BOM：先试 UTF-8
  const utf8 = buffer.toString('utf8')
  const utf8Bad = countReplacement(utf8)
  const total = Math.max(1, utf8.length)
  if (utf8Bad / total < 0.001) {
    if (utf8Bad > 0) warnings.push(`疑似 UTF-8：存在 ${utf8Bad} 个无法解码字符，已忽略`)
    return { encoding: 'utf-8', text: utf8, hadBom: false, uncertain: false, warnings }
  }

  // 3. 试 GBK
  const gbkDecoder = makeDecoder('gbk')
  if (gbkDecoder) {
    const gbk = gbkDecoder.decode(buffer)
    const gbkBad = countReplacement(gbk)
    if (gbkBad / Math.max(1, gbk.length) < 0.001) {
      warnings.push('未检测到 BOM，已按 GBK 解码')
      return { encoding: 'gbk', text: gbk, hadBom: false, uncertain: false, warnings }
    }
  } else {
    warnings.push('当前环境不支持 GBK 解码，中文文件可能显示异常')
  }

  // 4. 低置信度：返回 GB18030 结果，交由 UI 手动确认
  const fallbackDecoder = makeDecoder('gb18030') ?? makeDecoder('gbk')
  const text = fallbackDecoder ? fallbackDecoder.decode(buffer) : utf8
  warnings.push('编码无法确定，已按 GB18030 预览，可在导入界面手动切换编码')
  return { encoding: 'gb18030', text, hadBom: false, uncertain: true, warnings }
}