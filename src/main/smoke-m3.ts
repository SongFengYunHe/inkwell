import { createServer } from 'node:http'
import { app } from 'electron'
import type { PipelineEvent } from '@shared/types'
import {
  createProject,
  deleteProject,
  listBriefs,
  listDrafts,
  listProjects
} from './db/repositories'
import { getLatestReview, listCharacters, listMemoryChapters, listThreads } from './db/memory-repo'
import { createRun, listSteps, latestRun, updateRun } from './db/pipeline-repo'
import { getTruthFiles } from './engine/truth'
import { abortPipeline, runPipeline } from './engine/run'
import { runWizard } from './llm/wizard'
import { deleteProvider, listProviders, saveProvider } from './providers/store'

/**
 * M3 端到端自检：`electron . --smoke-m3`
 * 起一个本地 OpenAI 兼容假端点，覆盖：
 *   向导出细纲 → 连写整本（装配/起草/审计/记忆）→ 真相文件投影
 *   → 中途「杀进程式中断」→ 从断点续跑写完全本 → 校验断点复用与记忆幂等。
 * 同时验证 Steer 注入会进入写作提示词。无需任何真实 API Key。
 */
const PROJECT_NAME = '__inkwell_smoke_m3__'
const TOTAL_CHAPTERS = 6
const WORDS_PER_CHAPTER = 300

const OUTLINE_JSON = JSON.stringify({
  premise: '少年林川在山道上捡到一柄会说话的古剑，从此卷入修真界的旧怨。',
  worldbuilding: '九州修真界，剑修为尊，古剑为上古遗物。',
  protagonist: '林川，十六岁山野少年，性情坚韧。',
  goldenFinger: '古剑中封存着一位上古剑修的残魂，可授剑诀。',
  style: '克制冷峻，重意境',
  coreOutline: '第一卷 山雨\n第一章：开端\n第二章：发展\n第三章：结局'
})

const BRIEFS_JSON = JSON.stringify(
  Array.from({ length: TOTAL_CHAPTERS }, (_, index) => index + 1).map((no) => ({
    chapterNo: no,
    title: `第${no}章标题`,
    purpose: `第${no}章的目的`,
    keyEvents: '夜色,山道,古剑',
    characters: ['林川', '古剑'],
    sceneBeats: ['夜行', '遇人', '惊变'],
    suspenseHook: '剑鸣'
  }))
)

const MEMORY_JSON = JSON.stringify({
  summary: '林川夜行山道，遇一受伤之人，火把逼近，古剑震颤。',
  characterStates: [
    { name: '林川', state: '警觉', location: '山道', power: '未觉醒', items: ['古剑'], recent: '夜行遇人' },
    { name: '古剑', state: '震颤', location: '林川手中', power: '沉寂', items: [], recent: '回应危机' }
  ],
  continuityFacts: {
    worldState: '山道出现来历不明的追兵',
    timeline: '当夜',
    resourceLedger: '林川获得古剑',
    facts: ['古剑会在危机时震颤']
  },
  threadUpdates: [{ title: '古剑认主', type: 'hook', event: 'planted', evidence: '古剑在掌中震颤' }]
})

const AUDIT_JSON = JSON.stringify({ issues: [] })

const PROSE_PARAGRAPHS = [
  '夜色如墨，山道上一人一剑，林川握紧了那柄古剑。风从谷底卷上来，吹得衣袍猎猎作响。古剑在他掌中轻轻震颤，像是在回应什么。林川停下脚步，侧耳细听山道深处的动静。远处传来一声闷响，像是有什么重物坠地。',
  '他压低身形，沿着碎石小径缓缓靠近。月光破开云层，照见崖边一道模糊的人影。那人背对着他，肩头似乎受了伤。林川握剑的手紧了紧，终究还是走了过去。剑鸣骤起，惊起满林宿鸟。',
  '崖边的人缓缓回头，露出一张苍白的面孔。林川认得这张脸，却想不起在哪里见过。对方嘴唇动了动，吐出两个字。话音未落，山道尽头亮起一串火把。林川下意识后退半步，剑尖已指向来路。火把越来越近，脚步声杂乱而急促。'
]

const PROSE = PROSE_PARAGRAPHS.join('\n')

interface MockState {
  bodies: string[]
}

/** 假模型：按提示词特征返回不同结果，模拟真实的结构化输出能力 */
function pickResponse(body: string): string {
  if (body.includes('扩展为一部长篇小说的设定与总大纲')) return OUTLINE_JSON
  if (body.includes('逐章编写细纲')) return BRIEFS_JSON
  if (body.includes('建立记忆快照')) return MEMORY_JSON
  if (body.includes('一致性审计')) return AUDIT_JSON
  return PROSE
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
      state.bodies.push(body)
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

export async function runSmokeM3(): Promise<void> {
  const state: MockState = { bodies: [] }
  const mock = await startMockServer(state)
  const checks: Array<[string, boolean]> = []

  try {
    for (const existing of listProviders()) deleteProvider(existing.id)
    const stale = listProjects().find((item) => item.name === PROJECT_NAME)
    if (stale) deleteProject(stale.id)

    const project = createProject({
      name: PROJECT_NAME,
      genre: '仙侠',
      totalChapters: TOTAL_CHAPTERS,
      wordsPerChapter: WORDS_PER_CHAPTER,
      premise: '少年在山道上捡到一柄会说话的古剑'
    })
    saveProvider({ name: 'smoke-mock', baseUrl: mock.baseUrl, model: 'mock-model', apiKey: 'sk-smoke' })

    // ---------- 向导：一句话灵感 → 全部细纲 ----------
    await runWizard({ projectId: project.id, signal: new AbortController().signal, onProgress: () => undefined })
    checks.push(['向导生成全部细纲', listBriefs(project.id).length === TOTAL_CHAPTERS])

    // ---------- 连写：全自动写完 6 章 ----------
    const firstRun = createRun({ projectId: project.id, fromCh: 1, toCh: TOTAL_CHAPTERS, requireAccept: false })
    const events: PipelineEvent[] = []
    await runPipeline({
      requestId: 'smoke-m3-run-1',
      run: firstRun,
      useModelAudit: true,
      emit: (event) => events.push(event)
    })

    const afterFirst = latestRun(project.id)
    const drafts = listDrafts(project.id).filter((item) => item.content.trim())
    const memories = listMemoryChapters(project.id)

    checks.push(['连写任务标记为完成', afterFirst?.status === 'done'])
    checks.push(['自动写完 6 章正文', drafts.length === TOTAL_CHAPTERS])
    checks.push(['每章都建立了记忆快照', memories.length === TOTAL_CHAPTERS])
    checks.push(['连写过程推送了章节完成事件', events.some((item) => item.type === 'chapter_done')])

    // ---------- 审计报告（13 个确定性维度 + 语义维度） ----------
    const review = getLatestReview(project.id, 1)
    checks.push(['第 1 章生成了审计报告', review !== null && review.checks.length >= 13])
    checks.push(['假模型正文通过了确定性审计（无 error 级问题）', review?.passed === true])
    checks.push(['审计由 reviewer 模型参与补充语义维度', review?.modelAssisted === true])

    // ---------- 记忆投影：角色矩阵 + 伏笔台账 ----------
    const characters = listCharacters(project.id)
    const threads = listThreads(project.id)
    checks.push(['角色矩阵已投影（含林川）', characters.some((item) => item.name === '林川' && item.csUpdatedCh > 0)])
    checks.push(['伏笔台账已登记（古剑认主）', threads.some((item) => item.title === '古剑认主')])

    // ---------- 七个真相文件 ----------
    const truth = getTruthFiles(project.id)
    checks.push([
      '七个真相文件齐备',
      truth.worldState.length > 0 &&
        truth.characterMatrix.length >= 2 &&
        truth.pendingHooks.length >= 1 &&
        truth.chapterSummaries.length === TOTAL_CHAPTERS &&
        truth.subplotBoard.length >= 0 &&
        truth.timeline.length > 0 &&
        truth.resourceLedger.length > 0
    ])
    checks.push(['章节摘要链覆盖全部章节', truth.chapterSummaries.length === TOTAL_CHAPTERS])

    // ---------- 断点恢复：中断 → 续跑 ----------
    const secondRun = createRun({ projectId: project.id, fromCh: 1, toCh: TOTAL_CHAPTERS, requireAccept: false })
    let doneCount = 0
    await runPipeline({
      requestId: 'smoke-m3-run-2',
      run: secondRun,
      useModelAudit: false,
      emit: (event) => {
        if (event.type === 'chapter_done') {
          doneCount += 1
          if (doneCount === 2) {
            // 模拟用户在中途停止（等价于杀进程前最后一次可恢复的状态）
            abortPipeline('smoke-m3-run-2')
          }
        }
      }
    })

    const interrupted = latestRun(project.id)
    const stepsAfterInterrupt = listSteps(secondRun.id)
    checks.push(['中断后状态为 aborted', interrupted?.status === 'aborted'])
    checks.push(['中断后 cursor 停在断点章', (interrupted?.cursor ?? 0) === 3])
    checks.push([
      '断点前已完成的章节步骤均已落盘（可复用）',
      stepsAfterInterrupt.filter((step) => step.chapterNo <= 2 && step.ok).length >= 8
    ])

    // 从断点继续同一个 run：只补写第 3 章及其之后
    const resumedRun = updateRun(secondRun.id, { status: 'running' })
    const resumeEvents: PipelineEvent[] = []
    await runPipeline({
      requestId: 'smoke-m3-run-2-resume',
      run: resumedRun,
      useModelAudit: false,
      emit: (event) => resumeEvents.push(event)
    })

    const afterResume = latestRun(project.id)
    const chaptersWrittenAfterResume = new Set(
      resumeEvents.filter((item) => item.type === 'chapter_done').map((item) => item.chapterNo)
    )
    checks.push(['续跑后任务完成', afterResume?.status === 'done'])
    checks.push([
      '续跑只补写了断点之后的章节（未重跑第 1、2 章）',
      chaptersWrittenAfterResume.has(3) && !chaptersWrittenAfterResume.has(1) && !chaptersWrittenAfterResume.has(2)
    ])
    checks.push([
      '续跑后覆盖的章节数仍为 6（记忆按章幂等，未丢失已写章节）',
      new Set(listDrafts(project.id).filter((item) => item.content.trim()).map((item) => item.chapterNo)).size ===
        TOTAL_CHAPTERS
    ])

    // ---------- 记忆幂等：重跑后仍是 6 条快照 ----------
    checks.push(['重跑后记忆快照未膨胀', listMemoryChapters(project.id).length === TOTAL_CHAPTERS])

    // ---------- Steer 注入 ----------
    const thirdRun = createRun({ projectId: project.id, fromCh: 1, toCh: 1, requireAccept: false })
    updateRun(thirdRun.id, { steerGuidance: '__STEER_MARKER__' })
    await runPipeline({
      requestId: 'smoke-m3-run-3',
      run: updateRun(thirdRun.id, { status: 'running', steerGuidance: '__STEER_MARKER__' }),
      useModelAudit: false,
      emit: () => undefined
    })
    checks.push(['Steer 要求进入了写作提示词', state.bodies.some((body) => body.includes('__STEER_MARKER__'))])

    for (const [name, passed] of checks) {
      console.log(`[smoke-m3] ${passed ? '✓' : '✗'} ${name}`)
    }
    const allPassed = checks.every(([, passed]) => passed)
    console.log(`[smoke-m3] result: ${allPassed ? 'M3_PIPELINE_OK' : 'M3_PIPELINE_FAILED'}`)
    process.exitCode = allPassed ? 0 : 1
  } catch (error) {
    console.log(`[smoke-m3] result: M3_PIPELINE_FAILED (${error instanceof Error ? error.message : String(error)})`)
    process.exitCode = 1
  } finally {
    await mock.close()
    app.quit()
  }
}