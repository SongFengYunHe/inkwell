import type { ParsedChapter, ParsedTree, ParsedVolume } from '@shared/types'
import { classifyHeading, parseChapterNo, parseVolumeNo } from './patterns'
import { extractChapterFields } from './extract-fields'

/**
 * 大纲建树（计划书 §4.3 ①②③④）：
 *   归一化 → 行分类 → 层级推断 → 建树（卷 → 章 → 章内字段块）。
 * 层级对齐规则：
 *   - 同时有 `#` 和「第X章」时以 `#` 为骨架（在 classifyHeading 内实现）；
 *   - 只有「第X章」无卷时全部 volumeIdx = 0。
 */

/** 全角 → 半角：数字 / 冒号 / 括号 / 句点 / 全角空格 */
function toHalfWidth(input: string): string {
  let output = ''
  for (const char of input) {
    const code = char.codePointAt(0) ?? 0
    if (code >= 0xff10 && code <= 0xff19) {
      output += String.fromCharCode(code - 0xfee0) // ０-９
    } else if (code === 0xff1a) {
      output += ':' // ：
    } else if (code === 0xff08) {
      output += '(' // （
    } else if (code === 0xff09) {
      output += ')' // ）
    } else if (code === 0xff0e) {
      output += '.' // ．
    } else if (code === 0x3000) {
      output += ' ' // 全角空格
    } else {
      output += char
    }
  }
  return output
}

/** 归一化：去 BOM、统一换行、全角转半角 */
export function normalizeLines(text: string): string[] {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  return normalized.split('\n').map(toHalfWidth)
}

interface DraftChapter {
  chapterNo: number
  title: string
  volumeIdx: number
  lines: string[]
}

export function buildTree(input: string[] | string): ParsedTree {
  const lines = Array.isArray(input) ? input : normalizeLines(input)

  const volumes: ParsedVolume[] = []
  const coreOutlineLines: string[] = []
  const warnings: string[] = []
  const usedNumbers = new Set<number>()

  let currentVolume: ParsedVolume | null = null
  let currentChapter: DraftChapter | null = null
  let chapterCounter = 0
  let sawVolumeHeading = false
  let sawMarkdown = false
  let sawChinese = false

  const ensureVolume = (index: number, title: string): ParsedVolume => {
    let volume = volumes.find((item) => item.index === index)
    if (!volume) {
      volume = { index, title, chapters: [] }
      volumes.push(volume)
    } else if (title && !volume.title) {
      volume.title = title
    }
    return volume
  }

  const nextFree = (candidate: number): number => {
    let value = Math.max(1, candidate)
    while (usedNumbers.has(value)) value += 1
    usedNumbers.add(value)
    return value
  }

  const flushChapter = (): void => {
    if (!currentChapter) return
    const volume = ensureVolume(currentChapter.volumeIdx, '')
    const { fields } = extractChapterFields(currentChapter.lines)
    const chapter: ParsedChapter = {
      chapterNo: currentChapter.chapterNo,
      title: currentChapter.title,
      volumeIdx: currentChapter.volumeIdx,
      fields,
      rawText: currentChapter.lines.join('\n').trim()
    }
    volume.chapters.push(chapter)
    currentChapter = null
  }

  for (const line of lines) {
    const heading = classifyHeading(line)
    if (!heading) {
      if (!line.trim()) {
        if (currentChapter) currentChapter.lines.push('')
        else if (coreOutlineLines.length > 0) coreOutlineLines.push('')
        continue
      }
      if (currentChapter) currentChapter.lines.push(line)
      else coreOutlineLines.push(line.trim())
      continue
    }

    if (heading.markdownLevel !== null) sawMarkdown = true
    else sawChinese = true

    if (heading.kind === 'volume') {
      flushChapter()
      sawVolumeHeading = true
      const explicit = parseVolumeNo(heading.text)
      const explicitCount = volumes.filter((item) => item.index > 0).length
      const index = explicit ?? explicitCount + 1
      currentVolume = ensureVolume(index, heading.text)
      continue
    }

    // chapter / special
    flushChapter()
    const explicit = heading.kind === 'chapter' ? parseChapterNo(heading.text) : null
    if (explicit !== null && usedNumbers.has(explicit)) {
      warnings.push(`章节号 ${explicit} 重复，已自动顺延`)
    }
    const chapterNo = nextFree(explicit ?? chapterCounter + 1)
    chapterCounter = chapterNo
    currentChapter = {
      chapterNo,
      title: heading.text,
      volumeIdx: currentVolume ? currentVolume.index : 0,
      lines: []
    }
  }
  flushChapter()

  const headingStyle: ParsedTree['headingStyle'] =
    sawMarkdown && sawChinese ? 'mixed' : sawMarkdown ? 'markdown' : sawChinese ? 'chinese' : 'none'

  if (volumes.length === 0 && coreOutlineLines.length === 0) {
    warnings.push('未识别到任何章节或大纲内容')
  }

  return {
    coreOutline: coreOutlineLines.join('\n').trim(),
    volumes,
    hasVolume: sawVolumeHeading,
    headingStyle,
    warnings
  }
}