import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserWindow } from 'electron'
import type { ExportFile } from '@shared/types'
import { collectBook, safeFileName, volumeHeading, type CollectedBook } from './index'

/**
 * M11 · PDF 导出（计划书 §5.1）
 *
 * 不引入任何新依赖：复用 export/index.ts 的分卷 / 分章装配逻辑（collectBook），
 * 生成一份带封面页、目录与正文的 A4 HTML，交给 Electron 隐藏窗口的
 * webContents.printToPDF 打印成 PDF。
 *
 * 字体取舍（计划书 §10 第 1 问 + §8 风险表）：不内嵌思源宋体，避免安装包体积膨胀，
 * 只按优先级声明系统中文字体栈；个别系统缺字时 Chromium 会回退到默认衬线字体。
 */

/** 中文字体优先：思源宋体 → Noto Serif CJK → 微软雅黑 → 衬线兜底 */
const FONT_STACK = '"Source Han Serif SC", "Noto Serif CJK SC", "Microsoft YaHei", "Songti SC", serif'

/** data: URL 的保守上限：超过则退化为临时 HTML 文件，避免撞上 Chromium 的导航长度限制 */
const MAX_DATA_URL_LENGTH = 1_500_000

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function toParagraphs(content: string): string[] {
  return content
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
}

/** 封面页 + 目录（卷→章）+ 分卷标题 + 正文段落 */
function buildHtml(book: CollectedBook): string {
  const { project, volumes, totalChars } = book
  const chapterCount = volumes.reduce((sum, volume) => sum + volume.chapters.length, 0)

  const toc = volumes
    .map((volume) => {
      const heading = volumeHeading(volume, volumes.length)
      const items = volume.chapters
        .map((chapter) => `<li>第 ${chapter.chapterNo} 章　${escapeHtml(chapter.title)}</li>`)
        .join('')
      const label = heading ? `<p class="toc-volume">${escapeHtml(heading)}</p>` : ''
      return `<li class="toc-group">${label}<ul>${items}</ul></li>`
    })
    .join('')

  const body = volumes
    .map((volume) => {
      const heading = volumeHeading(volume, volumes.length)
      const volumeBlock = heading ? `<h2 class="volume">${escapeHtml(heading)}</h2>` : ''
      const chapters = volume.chapters
        .map((chapter) => {
          const title = `第 ${chapter.chapterNo} 章　${escapeHtml(chapter.title)}`
          const paragraphs = toParagraphs(chapter.content)
            .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
            .join('')
          return `<section class="chapter"><h3>${title}</h3>${paragraphs}</section>`
        })
        .join('')
      return `<section class="volume-block">${volumeBlock}${chapters}</section>`
    })
    .join('')

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(project.name)}</title>
<style>
  @page { size: A4; }
  * { box-sizing: border-box; }
  body { font-family: ${FONT_STACK}; font-size: 12pt; line-height: 1.9; color: #1a1a1a; margin: 0; }
  h1, h2, h3 { font-weight: 600; }
  p { margin: 0 0 0.5em; text-indent: 2em; text-align: justify; }
  .cover { height: 24cm; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; page-break-after: always; }
  .cover h1 { font-size: 30pt; margin: 0 0 0.6em; }
  .cover .meta { font-size: 13pt; color: #444; margin: 0.2em 0; text-indent: 0; }
  .toc { page-break-after: always; }
  .toc h2 { font-size: 18pt; border-bottom: 1px solid #bbb; padding-bottom: 0.2em; }
  .toc ul { list-style: none; padding-left: 0; margin: 0; }
  .toc ul ul { padding-left: 1.6em; }
  .toc li { line-height: 1.8; text-indent: 0; }
  .toc-volume { font-weight: 600; margin: 0.6em 0 0.2em; text-indent: 0; }
  .volume { font-size: 20pt; text-align: center; margin: 0 0 1em; page-break-before: always; }
  .chapter { page-break-before: always; }
  .chapter h3 { font-size: 15pt; margin: 0 0 0.8em; text-align: center; page-break-after: avoid; }
</style></head>
<body>
  <section class="cover">
    <h1>${escapeHtml(project.name)}</h1>
    <p class="meta">题材：${escapeHtml(project.genre || '未设置')}</p>
    <p class="meta">共 ${chapterCount} 章 · 约 ${totalChars} 字</p>
  </section>
  <section class="toc"><h2>目录</h2><ul>${toc}</ul></section>
  ${body}
</body></html>`
}

/** 等页面加载完成；主框架加载失败则抛可读错误（等价于 did-finish-load） */
function waitForLoad(win: BrowserWindow): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onFinish = (): void => {
      win.webContents.removeListener('did-fail-load', onFail)
      resolve()
    }
    const onFail = (
      _event: unknown,
      code: number,
      description: string,
      _url: string,
      isMainFrame: boolean
    ): void => {
      if (!isMainFrame) return
      win.webContents.removeListener('did-finish-load', onFinish)
      reject(new Error(`导出页面加载失败（${code}）：${description}`))
    }
    win.webContents.once('did-finish-load', onFinish)
    win.webContents.on('did-fail-load', onFail)
  })
}

/**
 * 把项目正文导出为 PDF；返回与其它格式一致的 ExportFile[]。
 * 隐藏窗口在 finally 中销毁，任何失败路径都不会留下幽灵窗口。
 */
export async function exportPdf(input: { projectId: number; outDir: string }): Promise<ExportFile[]> {
  const book = collectBook(input.projectId)
  if (book.volumes.length === 0) throw new Error('还没有任何正文可导出，先写几章吧')

  const dir = input.outDir?.trim() || '.'
  await mkdir(dir, { recursive: true })

  const html = buildHtml(book)
  const chapterCount = book.volumes.reduce((sum, volume) => sum + volume.chapters.length, 0)

  let win: BrowserWindow | null = null
  let tempFile: string | null = null
  try {
    win = new BrowserWindow({
      show: false,
      width: 900,
      height: 1200,
      webPreferences: { sandbox: true, javascript: false }
    })

    const loaded = waitForLoad(win)
    const encoded = encodeURIComponent(html)
    if (encoded.length <= MAX_DATA_URL_LENGTH) {
      win.loadURL(`data:text/html;charset=utf-8,${encoded}`).catch(() => undefined)
    } else {
      // 超大正文：data: URL 可能超出 Chromium 导航上限，改为写临时 HTML 再 loadFile
      tempFile = join(dir, `.inkwell-pdf-${Date.now()}.html`)
      await writeFile(tempFile, html, 'utf8')
      win.loadURL(pathToFileURL(tempFile).toString()).catch(() => undefined)
    }
    await loaded

    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0.7, bottom: 0.7, left: 0.75, right: 0.75 }
    })

    const path = join(dir, `${safeFileName(book.project.name)}.pdf`)
    await writeFile(path, pdf)
    return [{ format: 'pdf', path, bytes: pdf.length, chapters: chapterCount }]
  } finally {
    if (win && !win.isDestroyed()) win.destroy()
    if (tempFile) await unlink(tempFile).catch(() => undefined)
  }
}
