import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BridgeTaskExport } from '@shared/types'
import { app } from 'electron'
import { buildChapterContext } from '../llm/context'
import { buildMessagesFor } from '../prompts/zh-CN'

/**
 * 任务单桥（计划书 §6.3 兜底路径）：
 * 把某章的完整提示词导出为 markdown 文件，交给不支持 MCP 的 Agent 使用，
 * 用户再把返回的正文粘回「正文」页。
 */
export function exportChapterTask(projectId: number, chapterNo: number): BridgeTaskExport {
  const bundle = buildChapterContext(projectId, chapterNo)
  if (!bundle) throw new Error(`项目不存在：${projectId}`)

  const messages = buildMessagesFor('draft', bundle.context)
  const title = bundle.brief?.title ? ` ${bundle.brief.title}` : ''
  const content = [
    `# 写作任务 · ${bundle.project.name} 第 ${chapterNo} 章${title}`,
    '',
    `> 用法：把下面从「## user」开始的整段内容交给任意 AI（ChatGPT / Claude / 网页版都可），`,
    `> 把它产出的正文粘回 Inkwell 的「正文」页即可。`,
    `> 目标字数约 ${bundle.project.wordsPerChapter} 字；只要正文，不要章节标题，不要 Markdown。`,
    '',
    messages.map((message) => `## ${message.role}\n\n${message.content}`).join('\n\n---\n\n'),
    ''
  ].join('\n')

  const dir = join(app.getPath('userData'), 'tasks', `project-${projectId}`)
  mkdirSync(dir, { recursive: true })
  const filePath = join(dir, `chapter_${String(chapterNo).padStart(4, '0')}.task.md`)
  writeFileSync(filePath, content, 'utf8')

  return { path: filePath, content }
}