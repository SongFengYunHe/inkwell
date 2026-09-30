import {
  IpcChannel,
  briefExpandSchema,
  briefSaveSchema,
  chapterQuerySchema,
  draftSaveSchema,
  exportTaskSchema,
  generateStartSchema,
  idSchema,
  pipelineStartSchema,
  pipelineSteerSchema,
  projectCreateSchema,
  projectIdSchema,
  projectUpdateSchema,
  providerSaveSchema,
  requestIdSchema,
  roleRouteSaveSchema,
  wizardStartSchema
} from '@shared/ipc'
import { join } from 'node:path'
import type { GenerateEvent, PipelineEvent, PipelineRun, WizardEvent } from '@shared/types'
import { app, ipcMain, type WebContents } from 'electron'
import { exportChapterTask } from '../bridge/task-slip'
import { getDatabasePath } from '../db/client'
import * as repo from '../db/repositories'
import { getLatestReview } from '../db/memory-repo'
import { createRun, latestRun, updateRun } from '../db/pipeline-repo'
import { getTruthFiles } from '../engine/truth'
import { rebuildMemory } from '../engine/pipeline'
import {
  abortPipeline,
  acceptPipeline,
  getControlRunId,
  pausePipeline,
  rejectPipeline,
  runPipeline,
  skipPipeline,
  steerPipeline
} from '../engine/run'
import { expandBrief } from '../llm/brief'
import { runGeneration } from '../llm/generate'
import { deleteRoute, listRoutes, saveRoute } from '../llm/route'
import { getUsageSummary } from '../llm/usage'
import { runWizard } from '../llm/wizard'
import { createOpenAiCompatibleProvider } from '../providers/openai-compatible'
import {
  deleteProvider,
  getProviderById,
  getProviderSecret,
  listProviders,
  saveProvider
} from '../providers/store'

/** 正在进行的可中断任务，key 为渲染进程生成的 requestId */
const activeJobs = new Map<string, AbortController>()

/** 长任务的失败信息统一格式化 */
function jobErrorMessage(error: unknown, aborted: boolean): string {
  if (aborted) return '已停止'
  return error instanceof Error ? error.message : String(error)
}

function emit<T>(sender: WebContents, channel: string, payload: T): void {
  if (!sender.isDestroyed()) sender.send(channel, payload)
}

/** 注册全部 IPC 处理器；入参一律经 zod 校验后再进入业务层 */
export function registerIpcHandlers(): void {
  /* --------------------------------- 项目 --------------------------------- */
  ipcMain.handle(IpcChannel.projectList, () => repo.listProjects())
  ipcMain.handle(IpcChannel.projectGet, (_event, id: unknown) => repo.getProject(idSchema.parse(id)))
  ipcMain.handle(IpcChannel.projectCreate, (_event, input: unknown) =>
    repo.createProject(projectCreateSchema.parse(input))
  )
  ipcMain.handle(IpcChannel.projectUpdate, (_event, input: unknown) =>
    repo.updateProject(projectUpdateSchema.parse(input))
  )
  ipcMain.handle(IpcChannel.projectRemove, (_event, id: unknown) => {
    repo.deleteProject(idSchema.parse(id))
  })

  /* --------------------------------- 细纲 --------------------------------- */
  ipcMain.handle(IpcChannel.briefList, (_event, projectId: unknown) =>
    repo.listBriefs(projectIdSchema.parse(projectId))
  )
  ipcMain.handle(IpcChannel.briefSave, (_event, input: unknown) => repo.saveBrief(briefSaveSchema.parse(input)))
  ipcMain.handle(IpcChannel.briefRemove, (_event, id: unknown) => {
    repo.deleteBrief(idSchema.parse(id))
  })
  ipcMain.handle(IpcChannel.briefExpand, (_event, raw: unknown) => expandBrief(briefExpandSchema.parse(raw)))

  /* --------------------------------- 正文 --------------------------------- */
  ipcMain.handle(IpcChannel.draftList, (_event, projectId: unknown) =>
    repo.listDrafts(projectIdSchema.parse(projectId))
  )
  ipcMain.handle(IpcChannel.draftSave, (_event, input: unknown) => repo.saveDraft(draftSaveSchema.parse(input)))
  ipcMain.handle(IpcChannel.draftRemove, (_event, id: unknown) => {
    repo.deleteDraft(idSchema.parse(id))
  })

  /* -------------------------------- 模型接入 ------------------------------- */
  ipcMain.handle(IpcChannel.providerList, () => listProviders())
  ipcMain.handle(IpcChannel.providerSave, (_event, input: unknown) => {
    const parsed = providerSaveSchema.parse(input)
    // 反代端点必须先确认风险（计划书 §6.4 / §11）
    if (parsed.kind === 'custom-reverse-proxy') {
      const accepted = parsed.riskAccepted ?? (parsed.id ? getProviderById(parsed.id)?.dto.riskAccepted ?? false : false)
      if (!accepted) throw new Error('自定义反代端点需要先勾选并确认风险提示后才能保存')
    }
    return saveProvider(parsed)
  })
  ipcMain.handle(IpcChannel.providerRemove, (_event, id: unknown) => {
    deleteProvider(idSchema.parse(id))
  })
  ipcMain.handle(IpcChannel.providerTest, (_event, raw: unknown) => {
    const input = providerSaveSchema.parse(raw)
    const apiKey = input.apiKey && input.apiKey.length > 0 ? input.apiKey : input.id ? getProviderSecret(input.id) : ''
    const provider = createOpenAiCompatibleProvider({
      id: 'connection-test',
      baseUrl: input.baseUrl,
      apiKey,
      model: input.model,
      headers: input.headers
    })
    return provider.health()
  })

  /* ------------------------------ 角色-模型路由 ----------------------------- */
  ipcMain.handle(IpcChannel.routeList, () => listRoutes())
  ipcMain.handle(IpcChannel.routeSave, (_event, input: unknown) => saveRoute(roleRouteSaveSchema.parse(input)))
  ipcMain.handle(IpcChannel.routeRemove, (_event, role: unknown) => {
    deleteRoute(roleRouteSaveSchema.shape.role.parse(role))
  })

  /* --------------------------------- 用量 --------------------------------- */
  ipcMain.handle(IpcChannel.usageSummary, () => getUsageSummary())

  /* ------------------------------- 任务单桥 -------------------------------- */
  ipcMain.handle(IpcChannel.bridgeExportTask, (_event, raw: unknown) => {
    const input = exportTaskSchema.parse(raw)
    return exportChapterTask(input.projectId, input.chapterNo)
  })

  /* -------------------------------- 单章生成 ------------------------------- */
  ipcMain.handle(IpcChannel.generateStart, (event, raw: unknown) => {
    const input = generateStartSchema.parse(raw)
    if (activeJobs.has(input.requestId)) throw new Error('重复的生成请求标识')

    const controller = new AbortController()
    activeJobs.set(input.requestId, controller)
    const sender = event.sender

    void (async () => {
      try {
        const draft = await runGeneration({
          input,
          signal: controller.signal,
          onDelta: (text) => emit<GenerateEvent>(sender, IpcChannel.generateEvent, { requestId: input.requestId, type: 'delta', text })
        })
        emit<GenerateEvent>(sender, IpcChannel.generateEvent, { requestId: input.requestId, type: 'done', draft })
      } catch (error) {
        emit<GenerateEvent>(sender, IpcChannel.generateEvent, {
          requestId: input.requestId,
          type: 'error',
          message: jobErrorMessage(error, controller.signal.aborted)
        })
      } finally {
        activeJobs.delete(input.requestId)
      }
    })()
  })

  ipcMain.handle(IpcChannel.generateAbort, (_event, requestId: unknown) => {
    activeJobs.get(requestIdSchema.parse(requestId))?.abort()
  })

  /* -------------------------------- 新建向导 ------------------------------- */
  ipcMain.handle(IpcChannel.wizardStart, (event, raw: unknown) => {
    const input = wizardStartSchema.parse(raw)
    if (activeJobs.has(input.requestId)) throw new Error('重复的向导请求标识')

    const controller = new AbortController()
    activeJobs.set(input.requestId, controller)
    const sender = event.sender

    void (async () => {
      try {
        const result = await runWizard({
          projectId: input.projectId,
          signal: controller.signal,
          onProgress: (progress) =>
            emit<WizardEvent>(sender, IpcChannel.wizardEvent, { requestId: input.requestId, type: 'progress', progress })
        })
        emit<WizardEvent>(sender, IpcChannel.wizardEvent, {
          requestId: input.requestId,
          type: 'done',
          briefsCreated: result.briefsCreated
        })
      } catch (error) {
        emit<WizardEvent>(sender, IpcChannel.wizardEvent, {
          requestId: input.requestId,
          type: 'error',
          message: jobErrorMessage(error, controller.signal.aborted)
        })
      } finally {
        activeJobs.delete(input.requestId)
      }
    })()
  })

  ipcMain.handle(IpcChannel.wizardAbort, (_event, requestId: unknown) => {
    activeJobs.get(requestIdSchema.parse(requestId))?.abort()
  })

  /* ------------------------------ M3 记忆面板 ------------------------------ */
  ipcMain.handle(IpcChannel.memoryTruthFiles, (_event, projectId: unknown) =>
    getTruthFiles(projectIdSchema.parse(projectId))
  )
  ipcMain.handle(IpcChannel.memoryLatestAudit, (_event, raw: unknown) => {
    const input = chapterQuerySchema.parse(raw)
    return getLatestReview(input.projectId, input.chapterNo)
  })
  ipcMain.handle(IpcChannel.memoryRebuild, (_event, projectId: unknown) =>
    rebuildMemory(projectIdSchema.parse(projectId))
  )

  /* ------------------------------ M3 连写队列 ------------------------------ */
  ipcMain.handle(IpcChannel.pipelineLatest, (_event, projectId: unknown) =>
    latestRun(projectIdSchema.parse(projectId))
  )

  /** 把一个 run 交给连写驱动；控制器按 requestId 索引，供暂停 / Steer / 验收指令寻址 */
  const launchPipeline = (sender: WebContents, requestId: string, run: PipelineRun): void => {
    const send = (payload: PipelineEvent): void => emit<PipelineEvent>(sender, IpcChannel.pipelineEvent, payload)
    void runPipeline({ requestId, run, useModelAudit: true, emit: send }).catch((error: unknown) => {
      send({
        requestId,
        type: 'error',
        run: null,
        message: error instanceof Error ? error.message : String(error)
      })
    })
  }

  ipcMain.handle(IpcChannel.pipelineStart, (event, raw: unknown) => {
    const input = pipelineStartSchema.parse(raw)
    if (activeJobs.has(input.requestId)) throw new Error('重复的连写请求标识')

    const project = repo.getProject(input.projectId)
    if (!project) throw new Error(`项目不存在：${input.projectId}`)

    const briefs = repo.listBriefs(input.projectId)
    if (briefs.length === 0) throw new Error('还没有任何细纲，请先生成细纲再连写')

    const fromCh = Math.max(1, input.fromCh ?? 1)
    const toCh = Math.min(input.toCh ?? project.totalChapters, project.totalChapters)
    if (fromCh > toCh) throw new Error('起始章号不能大于结束章号')

    const run = createRun({ projectId: input.projectId, fromCh, toCh, requireAccept: input.requireAccept ?? false })
    launchPipeline(event.sender, input.requestId, run)
  })

  ipcMain.handle(IpcChannel.pipelineResume, (event, raw: unknown) => {
    const input = pipelineSteerSchema.pick({ requestId: true }).extend({ projectId: projectIdSchema }).parse(raw)
    if (activeJobs.has(input.requestId)) throw new Error('重复的连写请求标识')

    const run = latestRun(input.projectId)
    if (!run) throw new Error('没有可继续的连写任务')
    if (run.status === 'running') throw new Error('连写任务正在进行中')
    if (run.status === 'done') throw new Error('该连写任务已全部完成')

    const resumed = updateRun(run.id, { status: 'running', error: '' })
    launchPipeline(event.sender, input.requestId, resumed)
  })

  ipcMain.handle(IpcChannel.pipelinePause, (_event, requestId: unknown) => {
    pausePipeline(requestIdSchema.parse(requestId))
  })
  ipcMain.handle(IpcChannel.pipelineAbort, (_event, requestId: unknown) => {
    abortPipeline(requestIdSchema.parse(requestId))
  })
  ipcMain.handle(IpcChannel.pipelineSkip, (_event, requestId: unknown) => {
    skipPipeline(requestIdSchema.parse(requestId))
  })
  ipcMain.handle(IpcChannel.pipelineAccept, (_event, requestId: unknown) => {
    acceptPipeline(requestIdSchema.parse(requestId))
  })
  ipcMain.handle(IpcChannel.pipelineReject, (_event, requestId: unknown) => {
    rejectPipeline(requestIdSchema.parse(requestId))
  })
  ipcMain.handle(IpcChannel.pipelineSteer, (_event, raw: unknown) => {
    const input = pipelineSteerSchema.parse(raw)
    steerPipeline(input.requestId, input.guidance)
    // 落库：暂停 / 崩溃后续跑时 Steer 仍然生效
    const runId = getControlRunId(input.requestId)
    if (runId !== null) updateRun(runId, { steerGuidance: input.guidance })
  })

  ipcMain.handle(IpcChannel.appDbPath, () => getDatabasePath())
  ipcMain.handle(IpcChannel.appMcpEntry, () => join(app.getAppPath(), 'out', 'main', 'mcp.js'))
}