import {
  IpcChannel,
  briefExpandSchema,
  briefSaveSchema,
  draftSaveSchema,
  exportTaskSchema,
  generateStartSchema,
  idSchema,
  projectCreateSchema,
  projectIdSchema,
  projectUpdateSchema,
  providerSaveSchema,
  requestIdSchema,
  roleRouteSaveSchema,
  wizardStartSchema
} from '@shared/ipc'
import { join } from 'node:path'
import type { GenerateEvent, WizardEvent } from '@shared/types'
import { app, ipcMain, type WebContents } from 'electron'
import { exportChapterTask } from '../bridge/task-slip'
import { getDatabasePath } from '../db/client'
import * as repo from '../db/repositories'
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

  ipcMain.handle(IpcChannel.appDbPath, () => getDatabasePath())
  ipcMain.handle(IpcChannel.appMcpEntry, () => join(app.getAppPath(), 'out', 'main', 'mcp.js'))
}