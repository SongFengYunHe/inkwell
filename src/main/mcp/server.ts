import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ChapterBrief, ChapterDraft, Project } from '@shared/types'
import { z } from 'zod'
import {
  getProject,
  listBriefs,
  listDrafts,
  listProjects,
  saveBrief,
  saveDraft
} from '../db/repositories'
import { buildChapterContext } from '../llm/context'
import { buildBriefExpandMessages, buildMessagesFor } from '../prompts/zh-CN'

interface TextBlock {
  type: 'text'
  text: string
}

interface ToolResult {
  /** SDK 的 CallToolResult 允许附加字段，需要索引签名才可赋值 */
  [key: string]: unknown
  content: TextBlock[]
  isError?: boolean
}

function text(main: string, extra?: string): ToolResult {
  const content: TextBlock[] = [{ type: 'text', text: main }]
  if (extra) content.push({ type: 'text', text: extra })
  return { content }
}

function fail(message: string): ToolResult {
  return { content: [{ type: 'text', text: `错误：${message}` }], isError: true }
}

function renderMessages(messages: Array<{ role: string; content: string }>): string {
  return messages.map((message) => `===== ${message.role} =====\n${message.content}`).join('\n\n')
}

function selectProject(projectId?: number): Project | null {
  if (projectId !== undefined) return getProject(projectId)
  return listProjects()[0] ?? null
}

function writtenChapters(drafts: ChapterDraft[]): Set<number> {
  return new Set(drafts.filter((item) => item.content.trim()).map((item) => item.chapterNo))
}

function firstUnwrittenChapter(project: Project, written: Set<number>): number | null {
  for (let chapterNo = 1; chapterNo <= project.totalChapters; chapterNo += 1) {
    if (!written.has(chapterNo)) return chapterNo
  }
  return null
}

/** 轻量确定性审稿（不含模型调用）：M3/M4 会替换为完整的多维审计 */
function reviewChapter(project: Project, brief: ChapterBrief | null, content: string): Array<{
  check: string
  passed: boolean
  detail: string
}> {
  const plain = content.replace(/\s/g, '')
  const target = project.wordsPerChapter
  const lengthOk = plain.length >= target * 0.7 && plain.length <= target * 1.3
  const markdownLike = /(^|\n)\s*#{1,6}\s|(^|\n)\s*[-*]\s|\*\*/.test(content)
  const hasTitleLine = /(^|\n)\s*第\s*[0-9一二三四五六七八九十]+\s*章/.test(content)
  const aiPhrases = ['总而言之', '综上所述', '值得注意的是', '在这个', '不得不提的是', '让我们']
  const hitPhrases = aiPhrases.filter((phrase) => content.includes(phrase))
  const missingCharacters = (brief?.characters ?? []).filter((name) => name && !content.includes(name))

  return [
    {
      check: '字数接近目标',
      passed: lengthOk,
      detail: `当前 ${plain.length} 字，目标 ${target} 字（允许 ±30%）`
    },
    {
      check: '不含 Markdown 标记',
      passed: !markdownLike,
      detail: markdownLike ? '疑似包含 # / 列表 / 加粗等标记' : '未发现 Markdown 标记'
    },
    {
      check: '不含章节标题行',
      passed: !hasTitleLine,
      detail: hasTitleLine ? '正文里出现了「第 N 章」标题行，应只保留正文' : '未发现标题行'
    },
    {
      check: '无明显 AI 腔套话',
      passed: hitPhrases.length === 0,
      detail: hitPhrases.length ? `命中：${hitPhrases.join('、')}` : '未命中内置套话表'
    },
    {
      check: '细纲角色均已出场',
      passed: missingCharacters.length === 0,
      detail: missingCharacters.length ? `未出现：${missingCharacters.join('、')}` : '细纲角色全部出现'
    }
  ]
}

/** 组装 Inkwell 的 MCP Server（stdio），供外部 Agent 驱动整本创作 */
export function createInkwellMcpServer(): McpServer {
  const server = new McpServer({ name: 'inkwell', version: '0.1.0' })

  server.registerTool(
    'inkwell_status',
    {
      title: '项目进度总览',
      description: '列出所有项目及其进度（已填细纲章数 / 已生成正文章数 / 下一待写章节）。',
      inputSchema: {}
    },
    async () => {
      const projects = listProjects()
      if (projects.length === 0) return text('还没有任何项目。请先在 Inkwell 桌面端创建项目并填写一句话灵感。')

      const payload = projects.map((project) => {
        const briefs = listBriefs(project.id)
        const drafts = listDrafts(project.id)
        const written = writtenChapters(drafts)
        return {
          projectId: project.id,
          name: project.name,
          genre: project.genre,
          totalChapters: project.totalChapters,
          briefedChapters: briefs.length,
          writtenChapters: written.size,
          nextChapter: firstUnwrittenChapter(project, written)
        }
      })
      return text(JSON.stringify(payload, null, 2))
    }
  )

  server.registerTool(
    'inkwell_next_task',
    {
      title: '领取下一个写作任务',
      description:
        '返回下一个待处理章节：若该章没有细纲则给出细纲生成提示词（用 inkwell_save_brief 提交），' +
        '否则给出正文生成提示词（用 inkwell_save_draft 提交纯正文）。整本写完后返回 done=true。',
      inputSchema: { projectId: z.number().int().positive().optional() }
    },
    async ({ projectId }) => {
      const project = selectProject(projectId)
      if (!project) return fail('找不到项目，请先在 Inkwell 中创建')

      const drafts = listDrafts(project.id)
      const written = writtenChapters(drafts)
      const chapterNo = firstUnwrittenChapter(project, written)
      if (chapterNo === null) {
        return text(JSON.stringify({ done: true, projectId: project.id, message: '整本正文已写完' }, null, 2))
      }

      const bundle = buildChapterContext(project.id, chapterNo)
      if (!bundle) return fail(`第 ${chapterNo} 章上下文装配失败`)

      if (!bundle.brief) {
        const messages = buildBriefExpandMessages({
          bookTitle: project.name,
          genre: project.genre,
          coreOutline: project.coreOutline,
          chapterNo,
          current: { title: '', purpose: '', keyEvents: '', characters: [], sceneBeats: [], suspenseHook: '' }
        })
        return text(
          JSON.stringify(
            {
              done: false,
              projectId: project.id,
              chapterNo,
              kind: 'needs_brief',
              instruction: '按提示词生成细纲 JSON，然后调用 inkwell_save_brief 提交'
            },
            null,
            2
          ),
          renderMessages(messages)
        )
      }

      return text(
        JSON.stringify(
          {
            done: false,
            projectId: project.id,
            chapterNo,
            chapterTitle: bundle.brief.title,
            kind: 'needs_draft',
            targetWords: project.wordsPerChapter,
            instruction: '按提示词写出章节正文（纯文本），然后调用 inkwell_save_draft 提交'
          },
          null,
          2
        ),
        renderMessages(buildMessagesFor('draft', bundle.context))
      )
    }
  )

  server.registerTool(
    'inkwell_get_context',
    {
      title: '获取某章上下文包',
      description: '返回指定章节的完整上下文（设定 / 总大纲 / 本章细纲 / 前情提要）与写作提示词。',
      inputSchema: {
        projectId: z.number().int().positive(),
        chapterNo: z.number().int().min(1)
      }
    },
    async ({ projectId, chapterNo }) => {
      const bundle = buildChapterContext(projectId, chapterNo)
      if (!bundle) return fail(`项目 ${projectId} 不存在`)

      const summary = {
        projectId,
        chapterNo,
        chapterTitle: bundle.brief?.title ?? '',
        hasBrief: bundle.brief !== null,
        hasDraft: Boolean(bundle.latestDraft?.content.trim()),
        targetWords: bundle.project.wordsPerChapter
      }
      return text(JSON.stringify(summary, null, 2), renderMessages(buildMessagesFor('draft', bundle.context)))
    }
  )

  server.registerTool(
    'inkwell_save_brief',
    {
      title: '保存章节细纲',
      description: '写入某一章的细纲（细纲是生成正文的唯一必需输入）。',
      inputSchema: {
        projectId: z.number().int().positive(),
        chapterNo: z.number().int().min(1),
        title: z.string().max(200).optional(),
        purpose: z.string().max(4000).optional(),
        keyEvents: z.string().max(20000).optional(),
        characters: z.array(z.string().max(80)).optional(),
        sceneBeats: z.array(z.string().max(2000)).optional(),
        suspenseHook: z.string().max(2000).optional()
      }
    },
    async (input) => {
      if (!getProject(input.projectId)) return fail(`项目 ${input.projectId} 不存在`)
      const saved = saveBrief({
        projectId: input.projectId,
        chapterNo: input.chapterNo,
        title: input.title ?? '',
        purpose: input.purpose ?? '',
        keyEvents: input.keyEvents ?? '',
        characters: input.characters ?? [],
        sceneBeats: input.sceneBeats ?? [],
        suspenseHook: input.suspenseHook ?? ''
      })
      return text(
        JSON.stringify(
          { ok: true, briefId: saved.id, chapterNo: saved.chapterNo, title: saved.title, sceneBeats: saved.sceneBeats.length },
          null,
          2
        )
      )
    }
  )

  server.registerTool(
    'inkwell_save_draft',
    {
      title: '回填章节正文',
      description: '把写好的章节正文落盘为新版本（纯文本，不要带章节标题与 Markdown）。',
      inputSchema: {
        projectId: z.number().int().positive(),
        chapterNo: z.number().int().min(1),
        text: z.string().min(1).max(2_000_000)
      }
    },
    async ({ projectId, chapterNo, text: content }) => {
      if (!getProject(projectId)) return fail(`项目 ${projectId} 不存在`)

      const versions = listDrafts(projectId).filter((item) => item.chapterNo === chapterNo)
      const saved = saveDraft({
        projectId,
        chapterNo,
        version: (versions[0]?.version ?? 0) + 1,
        status: 'draft',
        source: 'write',
        content
      })
      return text(JSON.stringify({ ok: true, chapterNo, version: saved.version, wordCount: saved.wordCount }, null, 2))
    }
  )

  server.registerTool(
    'inkwell_review',
    {
      title: '章节自检',
      description: '对某章正文做轻量确定性检查（字数 / Markdown 残留 / 标题行 / AI 腔套话 / 细纲角色覆盖）。',
      inputSchema: {
        projectId: z.number().int().positive(),
        chapterNo: z.number().int().min(1),
        text: z.string().max(2_000_000).optional()
      }
    },
    async ({ projectId, chapterNo, text: provided }) => {
      const bundle = buildChapterContext(projectId, chapterNo)
      if (!bundle) return fail(`项目 ${projectId} 不存在`)

      const content = provided ?? bundle.latestDraft?.content ?? ''
      if (!content.trim()) return fail('没有可检查的正文：请先传入 text 或先生成本章')

      const checks = reviewChapter(bundle.project, bundle.brief, content)
      return text(
        JSON.stringify(
          { chapterNo, passed: checks.every((item) => item.passed), checks },
          null,
          2
        )
      )
    }
  )

  return server
}