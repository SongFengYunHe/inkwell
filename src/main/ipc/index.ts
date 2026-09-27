import {
  IpcChannel,
  briefSaveSchema,
  draftSaveSchema,
  generateStartSchema,
  idSchema,
  projectCreateSchema,
  projectIdSchema,
  projectUpdateSchema,
  providerSaveSchema,
  requestIdSchema
} from '@shared/ipc'
import type { GenerateEvent } from '@shared/types'
import { ipcMain, type WebContents } from 'electron'
import { getDatabasePath } from '../db/client'
import * as repo from '../db/repositories'
import { runGeneration } from '../llm/generate'
import { createOpenAiCompatibleProvider } from '../providers/openai-compatible'
import { deleteProvider, getProviderSecret, listProviders, saveProvider } from '../providers/store'

/** 正在进行的生成请求，key 为渲染进程生成的 requestId */
const activeGenerations = new Map<string, AbortController>()

function emit(sender: WebContents, event: GenerateEvent): void {
  if (!sender.isDestroyed()) sender.send(IpcChannel.generateEvent, event)
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
  ipcMain.handle(IpcChannel.providerSave, (_event, input: unknown) => saveProvider(providerSaveSchema.parse(input)))
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
      model: input.model
    })
    return provider.health()
  })

  /* -------------------------------- 单章生成 ------------------------------- */
  ipcMain.handle(IpcChannel.generateStart, (event, raw: unknown) => {
    const input = generateStartSchema.parse(raw)
    if (activeGenerations.has(input.requestId)) throw new Error('重复的生成请求标识')

    const controller = new AbortController()
    activeGenerations.set(input.requestId, controller)
    const sender = event.sender

    void (async () => {
      try {
        const draft = await runGeneration({
          input,
          signal: controller.signal,
          onDelta: (text) => emit(sender, { requestId: input.requestId, type: 'delta', text })
        })
        emit(sender, { requestId: input.requestId, type: 'done', draft })
      } catch (error) {
        const message = controller.signal.aborted
          ? '已停止生成'
          : error instanceof Error
            ? error.message
            : String(error)
        emit(sender, { requestId: input.requestId, type: 'error', message })
      } finally {
        activeGenerations.delete(input.requestId)
      }
    })()
  })

  ipcMain.handle(IpcChannel.generateAbort, (_event, requestId: unknown) => {
    activeGenerations.get(requestIdSchema.parse(requestId))?.abort()
  })

  ipcMain.handle(IpcChannel.appDbPath, () => getDatabasePath())
}