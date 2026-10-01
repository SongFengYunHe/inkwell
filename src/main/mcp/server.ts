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
import { getTruthFiles } from '../engine/truth'
import { deterministicAudit } from '../engine/audit'
import { commitMemory } from '../engine/memory'
import { buildChapterContext } from '../llm/context'
import { buildBriefExpandMessages, buildMessagesFor } from '../prompts/zh-CN'
import { augmentContext } from '../search/recall'
import { indexChapterDraft } from '../search/vector'

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

/** 轻量确定性审稿（不含模型调用）：复用引擎的 14 个确定性审计维度 */
function reviewChapter(project: Project, brief: ChapterBrief | null, content: string, previousContent: string) {
  return deterministicAudit(project, brief, content, previousContent).map((check) => ({
    check: check.dimension,
    passed: check.passed,
    detail: check.detail,
    paragraph: check.paragraph
  }))
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
        renderMessages(buildMessagesFor('draft', await augmentContext(bundle)))
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
      return text(
        JSON.stringify(summary, null, 2),
        renderMessages(buildMessagesFor('draft', await augmentContext(bundle)))
      )
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
      description:
        '把写好的章节正文落盘为新版本（纯文本，不要带章节标题与 Markdown）。' +
        '若本机已配置抽取模型，会顺带回写本章记忆（摘要 / 角色状态 / 伏笔台账）。',
      inputSchema: {
        projectId: z.number().int().positive(),
        chapterNo: z.number().int().min(1),
        text: z.string().min(1).max(2_000_000)
      }
    },
    async ({ projectId, chapterNo, text: content }) => {
      const project = getProject(projectId)
      if (!project) return fail(`项目 ${projectId} 不存在`)

      const versions = listDrafts(projectId).filter((item) => item.chapterNo === chapterNo)
      const saved = saveDraft({
        projectId,
        chapterNo,
        version: (versions[0]?.version ?? 0) + 1,
        status: 'draft',
        source: 'write',
        content
      })
      // A3：Agent 落盘后同样增量索引，后续章节才能召回（不可用时静默跳过）
      await indexChapterDraft(projectId, chapterNo, saved.id, saved.content)

      // 记忆回写是增强项：没有可用的 extractor 端点时静默跳过，不影响落盘
      let memoryCommitted = false
      try {
        const brief = listBriefs(projectId).find((item) => item.chapterNo === chapterNo) ?? null
        await commitMemory({
          project,
          chapterNo,
          chapterTitle: brief?.title ?? '',
          characters: brief?.characters ?? [],
          draft: saved
        })
        memoryCommitted = true
      } catch {
        memoryCommitted = false
      }

      return text(
        JSON.stringify(
          { ok: true, chapterNo, version: saved.version, wordCount: saved.wordCount, memoryCommitted },
          null,
          2
        )
      )
    }
  )

  server.registerTool(
    'inkwell_memory',
    {
      title: '读取真相文件',
      description:
        '返回项目的七个真相文件（世界状态 / 角色矩阵 / 待处理伏笔 / 章节摘要链 / 支线板 / 时间线 / 资源账本），' +
        '供 Agent 在写作前了解既有设定，避免前后矛盾。',
      inputSchema: { projectId: z.number().int().positive().optional() }
    },
    async ({ projectId }) => {
      const project = selectProject(projectId)
      if (!project) return fail('找不到项目，请先在 Inkwell 中创建')

      const truth = getTruthFiles(project.id)
      const payload = {
        projectId: project.id,
        name: project.name,
        worldState: truth.worldState,
        characterMatrix: truth.characterMatrix.map((item) => ({
          name: item.name,
          state: item.csState,
          location: item.csLocation,
          power: item.csPower,
          recent: item.csRecent,
          updatedChapter: item.csUpdatedCh
        })),
        pendingHooks: truth.pendingHooks.map((item) => ({ title: item.title, type: item.type, status: item.status })),
        chapterSummaries: truth.chapterSummaries,
        subplotBoard: truth.subplotBoard.map((item) => ({ title: item.title, status: item.status })),
        timeline: truth.timeline,
        resourceLedger: truth.resourceLedger
      }
      return text(JSON.stringify(payload, null, 2))
    }
  )

  server.registerTool(
    'inkwell_review',
    {
      title: '章节自检',
      description:
        '对某章正文做 14 项确定性审计（字数 / Markdown / 标题行 / AI 腔 / 角色覆盖 / 关键事件 / 钩子 / ' +
        '段落节奏 / 重复句 / 与上章重复 / 口头禅密度 / 收尾段 / 排比堆砌 / 标点规范），并给出命中的段落序号。',
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

      const previous = listDrafts(projectId).find((item) => item.chapterNo === chapterNo - 1)?.content ?? ''
      const checks = reviewChapter(bundle.project, bundle.brief, content, previous)
      return text(
        JSON.stringify(
          {
            chapterNo,
            passed: checks.every((item) => item.passed),
            dimensions: checks.length,
            checks
          },
          null,
          2
        )
      )
    }
  )

  return server
}