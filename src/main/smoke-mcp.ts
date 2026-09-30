import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { app } from 'electron'
import {
  createProject,
  deleteProject,
  listBriefs,
  listDrafts,
  listProjects,
  saveBrief
} from './db/repositories'
import { getDatabasePath } from './db/client'
import { deleteProvider, listProviders } from './providers/store'

/**
 * M2 端到端自检：`electron . --smoke-mcp`
 * 以真实 MCP 协议（stdio）拉起 out/main/mcp.js，扮演外部 Agent 走完
 * 「status → next_task → save_draft ×5」的自动写作循环。
 * 覆盖 M2 验收里「用 Agent 经 MCP 自动写完 ≥5 章」的协议部分（模型调用由 Agent 负责）。
 */
const PROJECT_NAME = '__inkwell_smoke_mcp__'
const TOTAL_CHAPTERS = 6
const CHAPTERS_TO_WRITE = 5
const WORDS_PER_CHAPTER = 300
const CHARACTERS = ['林川', '古剑']

/** 造一段长度接近目标字数、且通过确定性自检的正文 */
function fakeChapter(): string {
  const sentence = '夜色如墨，林川握紧了那柄古剑。'
  return sentence.repeat(Math.ceil(WORDS_PER_CHAPTER / sentence.length))
}

/** 取第 index 个内容块的文本（第 0 块约定为 JSON 元数据） */
function blockText(result: { content?: unknown }, index = 0): string {
  const content = Array.isArray(result.content) ? result.content : []
  const block = content[index]
  return block && typeof block === 'object' && 'text' in block ? String((block as { text: unknown }).text) : ''
}

/** 拼接全部内容块，用于检索提示词内容 */
function allText(result: { content?: unknown }): string {
  const content = Array.isArray(result.content) ? result.content : []
  return content
    .map((block) => (block && typeof block === 'object' && 'text' in block ? String((block as { text: unknown }).text) : ''))
    .join('\n\n')
}

interface ToolCaller {
  callTool(args: { name: string; arguments: Record<string, unknown> }): Promise<{ content?: unknown; isError?: boolean }>
}

export async function runSmokeMcp(): Promise<void> {
  const checks: Array<[string, boolean]> = []
  let client: Client | null = null

  try {
    // ---- 准备数据（不依赖模型）：一个 6 章的项目 + 6 章细纲 ----
    for (const existing of listProviders()) deleteProvider(existing.id)
    const stale = listProjects().find((item) => item.name === PROJECT_NAME)
    if (stale) deleteProject(stale.id)

    const project = createProject({
      name: PROJECT_NAME,
      genre: '仙侠',
      totalChapters: TOTAL_CHAPTERS,
      premise: '少年在山道上捡到一柄会说话的古剑'
    })
    for (let chapterNo = 1; chapterNo <= TOTAL_CHAPTERS; chapterNo += 1) {
      saveBrief({
        projectId: project.id,
        chapterNo,
        title: `第${chapterNo}章`,
        purpose: `第${chapterNo}章的目的`,
        keyEvents: `第${chapterNo}章的关键事件`,
        characters: CHARACTERS,
        sceneBeats: ['节拍一', '节拍二', '节拍三'],
        suspenseHook: `第${chapterNo}章的钩子`
      })
    }

    // ---- 以真实 MCP 协议连接独立进程 ----
    // 默认用系统 node 跑源码产物；可用环境变量改跑「安装版」入口：
    //   INKWELL_MCP_COMMAND=<Inkwell.exe> INKWELL_MCP_ENTRY=<app.asar/out/main/mcp.js> INKWELL_MCP_ELECTRON=1
    const entry = process.env.INKWELL_MCP_ENTRY ?? join(process.cwd(), 'out', 'main', 'mcp.js')
    const command = process.env.INKWELL_MCP_COMMAND ?? process.env.INKWELL_NODE ?? 'node'
    const extraEnv: Record<string, string> =
      process.env.INKWELL_MCP_ELECTRON === '1' ? { ELECTRON_RUN_AS_NODE: '1' } : {}

    const transport = new StdioClientTransport({
      command,
      args: [entry],
      env: { ...process.env, ...extraEnv, INKWELL_DB: getDatabasePath() }
    })

    client = new Client({ name: 'inkwell-smoke', version: '0.1.0' })
    await client.connect(transport)
    checks.push(['MCP 连接建立成功', true])

    const toolNames = (await client.listTools()).tools.map((tool) => tool.name)
    const expectedTools = [
      'inkwell_status',
      'inkwell_next_task',
      'inkwell_get_context',
      'inkwell_save_brief',
      'inkwell_save_draft',
      'inkwell_memory',
      'inkwell_review'
    ]
    checks.push(['全部工具均已暴露', expectedTools.every((name) => toolNames.includes(name))])

    const caller = client as unknown as ToolCaller

    // ---- 初始状态 ----
    const initialStatus = JSON.parse(
      blockText(await caller.callTool({ name: 'inkwell_status', arguments: {} }))
    ) as Array<{ projectId: number; briefedChapters: number; writtenChapters: number; nextChapter: number }>
    const mine = initialStatus.find((item) => item.projectId === project.id)
    checks.push([
      'status 正确报告进度（6 章细纲 / 0 章正文 / 下一章=1）',
      mine?.briefedChapters === TOTAL_CHAPTERS && mine?.writtenChapters === 0 && mine?.nextChapter === 1
    ])

    // ---- 扮演 Agent：领任务 → 回填正文，写满 5 章 ----
    let wroteChapters = 0
    let promptCarriedBrief = false
    for (let round = 0; round < CHAPTERS_TO_WRITE; round += 1) {
      const taskResult = await caller.callTool({ name: 'inkwell_next_task', arguments: { projectId: project.id } })
      const meta = JSON.parse(blockText(taskResult)) as { done: boolean; chapterNo: number; kind: string }
      if (meta.done || meta.kind !== 'needs_draft') break

      if (allText(taskResult).includes(`第${meta.chapterNo}章的目的`)) promptCarriedBrief = true

      const saved = await caller.callTool({
        name: 'inkwell_save_draft',
        arguments: { projectId: project.id, chapterNo: meta.chapterNo, text: fakeChapter() }
      })
      const savedMeta = JSON.parse(blockText(saved)) as { ok: boolean; version: number }
      if (savedMeta.ok && savedMeta.version === 1) wroteChapters += 1
    }

    checks.push([`经 MCP 自动写完 ${CHAPTERS_TO_WRITE} 章`, wroteChapters === CHAPTERS_TO_WRITE])
    checks.push(['next_task 返回的提示词包含本章细纲', promptCarriedBrief])

    // ---- 写后状态 ----
    const afterStatus = JSON.parse(
      blockText(await caller.callTool({ name: 'inkwell_status', arguments: {} }))
    ) as Array<{ projectId: number; writtenChapters: number; nextChapter: number }>
    const after = afterStatus.find((item) => item.projectId === project.id)
    checks.push([
      'status 反映已写 5 章且下一章=6',
      after?.writtenChapters === CHAPTERS_TO_WRITE && after?.nextChapter === TOTAL_CHAPTERS
    ])

    // ---- 确定性自检 ----
    const review = JSON.parse(
      blockText(
        await caller.callTool({ name: 'inkwell_review', arguments: { projectId: project.id, chapterNo: 1 } })
      )
    ) as { passed: boolean; checks: Array<{ check: string; passed: boolean }> }
    checks.push(['inkwell_review 返回结构化结果', Array.isArray(review.checks) && review.checks.length >= 5])

    // ---- 落盘校验（不经 MCP，直接读库） ----
    const storedDrafts = listDrafts(project.id).filter((item) => item.content.trim())
    checks.push(['MCP 写入的正文确实落到了同一个库', storedDrafts.length === CHAPTERS_TO_WRITE])
    checks.push(['细纲未被 MCP 流程破坏', listBriefs(project.id).length === TOTAL_CHAPTERS])

    for (const [name, passed] of checks) {
      console.log(`[smoke-mcp] ${passed ? '✓' : '✗'} ${name}`)
    }
    const allPassed = checks.every(([, passed]) => passed)
    console.log(`[smoke-mcp] result: ${allPassed ? 'MCP_PIPELINE_OK' : 'MCP_PIPELINE_FAILED'}`)
    process.exitCode = allPassed ? 0 : 1
  } catch (error) {
    console.log(`[smoke-mcp] result: MCP_PIPELINE_FAILED (${error instanceof Error ? error.message : String(error)})`)
    process.exitCode = 1
  } finally {
    await client?.close().catch(() => undefined)
    app.quit()
  }
}