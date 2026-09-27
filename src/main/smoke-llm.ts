import { createServer } from 'node:http'
import { app } from 'electron'
import {
  createProject,
  deleteProject,
  getProject,
  listBriefs,
  listDrafts,
  listProjects
} from './db/repositories'
import { expandBrief } from './llm/brief'
import { runGeneration } from './llm/generate'
import { runWizard } from './llm/wizard'
import { deleteProvider, listProviders, saveProvider } from './providers/store'

/**
 * M1 / M1.5 端到端自检：`electron . --smoke-llm`
 * 起一个本地 OpenAI 兼容假端点（会根据提示词返回不同的 JSON / 正文），
 * 跑完整链路：向导（大纲+细纲）→ 按细纲生成 → 续写 → 重写 → 细纲扩写。
 * 无需任何真实 API Key，使用独立临时 userData。
 */
const PROJECT_NAME = '__inkwell_smoke_llm__'
const PROSE = '夜色如墨，山道上只余一人一剑。风起时，剑鸣如龙吟，惊起满林宿鸟。'

const OUTLINE_JSON = JSON.stringify({
  premise: '少年林川在山道上捡到一柄会说话的古剑，从此卷入修真界的旧怨。',
  worldbuilding: '九州修真界，剑修为尊，古剑为上古遗物。',
  protagonist: '林川，十六岁山野少年，性情坚韧。',
  goldenFinger: '古剑中封存着一位上古剑修的残魂，可授剑诀。',
  style: '克制冷峻，重意境',
  coreOutline: '第一卷 山雨\n第一章：开端\n第二章：发展\n第三章：结局'
})

const BRIEFS_JSON = JSON.stringify(
  [1, 2, 3].map((no) => ({
    chapterNo: no,
    title: `第${no}章标题`,
    purpose: `第${no}章的目的`,
    keyEvents: `第${no}章的关键事件`,
    characters: ['林川', '古剑'],
    sceneBeats: ['节拍一', '节拍二', '节拍三'],
    suspenseHook: `第${no}章的钩子`
  }))
)

const EXPAND_JSON = JSON.stringify({
  chapterNo: 1,
  title: '开端（强化）',
  purpose: '让林川与古剑相遇并立下约定',
  keyEvents: '雨夜山道相遇，古剑认主，立下三年之约',
  characters: ['林川', '古剑', '山神'],
  sceneBeats: ['山雨欲来', '意外相逢', '立约'],
  suspenseHook: '古剑为何认主？'
})

/** 假模型：按提示词特征返回不同结果，模拟真实的结构化输出能力 */
function pickResponse(body: string): string {
  if (body.includes('扩展为一部长篇小说的设定与总大纲')) return OUTLINE_JSON
  if (body.includes('逐章编写细纲')) return BRIEFS_JSON
  if (body.includes('补全并强化')) return EXPAND_JSON
  return PROSE
}

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
      const body = Buffer.concat(chunks).toString('utf8')
      state.lastRequestBody = body
      const text = pickResponse(body)

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      })

      const chars = Array.from(text)
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
  const signal = new AbortController().signal

  try {
    for (const existing of listProviders()) deleteProvider(existing.id)
    const stale = listProjects().find((item) => item.name === PROJECT_NAME)
    if (stale) deleteProject(stale.id)

    const project = createProject({
      name: PROJECT_NAME,
      genre: '仙侠',
      totalChapters: 3,
      premise: '少年在山道上捡到一柄会说话的古剑'
    })
    saveProvider({ name: 'smoke-mock', baseUrl: mock.baseUrl, model: 'mock-model', apiKey: 'sk-smoke' })

    // ---------- M1.5：新建向导 ----------
    const progress: string[] = []
    const wizardResult = await runWizard({
      projectId: project.id,
      signal,
      onProgress: (item) => progress.push(`${item.phase}:${item.completed}/${item.total}`)
    })

    const afterWizard = getProject(project.id)
    const wizardBriefs = listBriefs(project.id)

    checks.push(['向导返回创建了 3 章细纲', wizardResult.briefsCreated === 3])
    checks.push(['向导过程有进度回调', progress.length >= 3 && progress.some((item) => item.startsWith('done:'))])
    checks.push(['向导写入了总大纲', afterWizard?.coreOutline.includes('第一章：开端') === true])
    checks.push(['向导写入了设定', (afterWizard?.worldbuilding.length ?? 0) > 0 && (afterWizard?.style ?? '') === '克制冷峻，重意境'])
    checks.push(['细纲数量为 3 且标题正确', wizardBriefs.length === 3 && wizardBriefs[0].title === '第1章标题'])
    checks.push(['细纲节拍已落库', wizardBriefs[1].sceneBeats.length === 3 && wizardBriefs[1].characters[0] === '林川'])

    // ---------- M1.5：细纲 AI 扩写 ----------
    const suggestion = await expandBrief({
      projectId: project.id,
      chapterNo: 1,
      current: { title: '', purpose: '', keyEvents: '', characters: [], sceneBeats: [], suspenseHook: '' },
      signal
    })
    checks.push(['细纲扩写返回建议', suggestion.title === '开端（强化）' && suggestion.sceneBeats.length === 3])

    // ---------- M1：按细纲生成单章 ----------
    const streamed: string[] = []
    const draft = await runGeneration({
      input: { requestId: 'smoke-draft', projectId: project.id, chapterNo: 1, mode: 'draft' },
      signal,
      onDelta: (text) => streamed.push(text)
    })
    checks.push(['流式增量与最终文本一致', streamed.join('') === PROSE])
    checks.push(['草稿为第 1 版且 source=write', draft.version === 1 && draft.source === 'write'])
    checks.push(['请求体带上了本章细纲', state.lastRequestBody.includes('第1章的目的')])
    checks.push(['请求体带上了总大纲', state.lastRequestBody.includes('第一章：开端')])

    // ---------- M1：续写 ----------
    const continued = await runGeneration({
      input: { requestId: 'smoke-continue', projectId: project.id, chapterNo: 1, mode: 'continue' },
      signal,
      onDelta: () => undefined
    })
    checks.push([
      '续写在上文基础上追加且升级为第 2 版',
      continued.version === 2 && continued.source === 'continue' && continued.content.startsWith(PROSE)
    ])

    // ---------- M1：重写 ----------
    const rewritten = await runGeneration({
      input: { requestId: 'smoke-rewrite', projectId: project.id, chapterNo: 1, mode: 'rewrite' },
      signal,
      onDelta: () => undefined
    })
    checks.push([
      '重写生成第 3 版且内容被替换',
      rewritten.version === 3 && rewritten.source === 'rewrite' && rewritten.content === PROSE
    ])

    const persisted = listDrafts(project.id).filter((item) => item.chapterNo === 1)
    checks.push(['三次生成均已落盘', persisted.length === 3])

    for (const [name, passed] of checks) {
      console.log(`[smoke-llm] ${passed ? '✓' : '✗'} ${name}`)
    }

    const allPassed = checks.every(([, passed]) => passed)
    console.log(`[smoke-llm] result: ${allPassed ? 'PIPELINE_OK' : 'PIPELINE_FAILED'}`)
    process.exitCode = allPassed ? 0 : 1
  } catch (error) {
    console.log(`[smoke-llm] result: PIPELINE_FAILED (${error instanceof Error ? error.message : String(error)})`)
    process.exitCode = 1
  } finally {
    await mock.close()
    app.quit()
  }
}