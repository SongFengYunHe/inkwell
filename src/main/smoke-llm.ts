import { createServer } from 'node:http'
import { app } from 'electron'
import { createProject, deleteProject, listProjects, listDrafts, saveBrief, updateProject } from './db/repositories'
import { runGeneration } from './llm/generate'
import { deleteProvider, listProviders, saveProvider } from './providers/store'

/**
 * M1 端到端自检：`electron . --smoke-llm`
 * 起一个本地 OpenAI 兼容 SSE 假端点，跑完整的「细纲 → 流式生成 → 落盘」链路，
 * 无需任何真实 API Key。使用独立临时 userData，不污染真实数据。
 */
const PROJECT_NAME = '__inkwell_smoke_llm__'
const CANNED = '夜色如墨，山道上只余一人一剑。风起时，剑鸣如龙吟，惊起满林宿鸟。'

interface MockState {
  lastRequestBody: string
}

function startMockServer(state: MockState): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || !req.url?.includes('/chat/completions')) {
      res.writeHead(404).end('not found')
      return
    }

    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      state.lastRequestBody = Buffer.concat(chunks).toString('utf8')

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      })

      const chars = Array.from(CANNED)
      let index = 0
      const timer = setInterval(() => {
        if (index >= chars.length) {
          clearInterval(timer)
          res.write('data: [DONE]\n\n')
          res.end()
          return
        }
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chars[index] } }] })}\n\n`)
        index += 1
      }, 1)
    })
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({
        baseUrl: `http://127.0.0.1:${port}/v1`,
        close: () => new Promise<void>((done) => server.close(() => done()))
      })
    })
  })
}

export async function runSmokeLlm(): Promise<void> {
  const state: MockState = { lastRequestBody: '' }
  const mock = await startMockServer(state)
  const checks: Array<[string, boolean]> = []

  try {
    // 清空接入配置与旧测试项目，保证结果可重复
    for (const existing of listProviders()) deleteProvider(existing.id)
    const stale = listProjects().find((item) => item.name === PROJECT_NAME)
    if (stale) deleteProject(stale.id)

    const project = createProject({
      name: PROJECT_NAME,
      genre: '仙侠',
      totalChapters: 3,
      premise: '少年在山道上捡到一柄会说话的古剑'
    })
    updateProject({
      id: project.id,
      coreOutline: '第一卷\n第一章：开端\n第二章：发展\n第三章：结局',
      protagonist: '林川',
      style: '克制冷峻，重意境'
    })
    saveBrief({
      projectId: project.id,
      chapterNo: 1,
      title: '开端',
      purpose: '让林川与古剑相遇并立下约定',
      characters: ['林川', '古剑'],
      sceneBeats: ['山雨欲来', '意外相逢'],
      suspenseHook: '古剑为何认主？'
    })

    saveProvider({ name: 'smoke-mock', baseUrl: mock.baseUrl, model: 'mock-model', apiKey: 'sk-smoke' })

    // 1) 按细纲生成单章
    const streamed: string[] = []
    const draft = await runGeneration({
      input: { requestId: 'smoke-draft', projectId: project.id, chapterNo: 1, mode: 'draft' },
      signal: new AbortController().signal,
      onDelta: (text) => streamed.push(text)
    })

    checks.push(['流式增量与最终文本一致', streamed.join('') === CANNED])
    checks.push(['草稿内容与模型输出一致', draft.content === CANNED])
    checks.push(['草稿为第 1 版且 source=write', draft.version === 1 && draft.source === 'write'])
    checks.push(['字数已统计', draft.wordCount === CANNED.length])
    checks.push(['请求体带上了本章细纲', state.lastRequestBody.includes('让林川与古剑相遇并立下约定')])
    checks.push(['请求体带上了总大纲', state.lastRequestBody.includes('第一章：开端')])

    // 2) 重写一次 → 生成新版本
    const rewritten = await runGeneration({
      input: { requestId: 'smoke-rewrite', projectId: project.id, chapterNo: 1, mode: 'rewrite' },
      signal: new AbortController().signal,
      onDelta: () => undefined
    })
    checks.push(['重写生成第 2 版且 source=rewrite', rewritten.version === 2 && rewritten.source === 'rewrite'])

    const persisted = listDrafts(project.id).filter((item) => item.chapterNo === 1)
    checks.push(['两次生成均已落盘', persisted.length === 2])

    for (const [name, passed] of checks) {
      console.log(`[smoke-llm] ${passed ? '✓' : '✗'} ${name}`)
    }

    const allPassed = checks.every(([, passed]) => passed)
    console.log(`[smoke-llm] result: ${allPassed ? 'M1_LLM_PIPELINE_OK' : 'M1_LLM_PIPELINE_FAILED'}`)
    process.exitCode = allPassed ? 0 : 1
  } catch (error) {
    console.log(`[smoke-llm] result: M1_LLM_PIPELINE_FAILED (${error instanceof Error ? error.message : String(error)})`)
    process.exitCode = 1
  } finally {
    await mock.close()
    app.quit()
  }
}