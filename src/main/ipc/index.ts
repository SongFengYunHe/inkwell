import {
  IpcChannel,
  briefSaveSchema,
  draftSaveSchema,
  idSchema,
  projectCreateSchema,
  projectIdSchema,
  projectUpdateSchema
} from '@shared/ipc'
import { ipcMain } from 'electron'
import { getDatabasePath } from '../db/client'
import * as repo from '../db/repositories'

/** 注册全部 IPC 处理器；入参一律经 zod 校验后再进入仓库层 */
export function registerIpcHandlers(): void {
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

  ipcMain.handle(IpcChannel.briefList, (_event, projectId: unknown) =>
    repo.listBriefs(projectIdSchema.parse(projectId))
  )
  ipcMain.handle(IpcChannel.briefSave, (_event, input: unknown) => repo.saveBrief(briefSaveSchema.parse(input)))
  ipcMain.handle(IpcChannel.briefRemove, (_event, id: unknown) => {
    repo.deleteBrief(idSchema.parse(id))
  })

  ipcMain.handle(IpcChannel.draftList, (_event, projectId: unknown) =>
    repo.listDrafts(projectIdSchema.parse(projectId))
  )
  ipcMain.handle(IpcChannel.draftSave, (_event, input: unknown) => repo.saveDraft(draftSaveSchema.parse(input)))
  ipcMain.handle(IpcChannel.draftRemove, (_event, id: unknown) => {
    repo.deleteDraft(idSchema.parse(id))
  })

  ipcMain.handle(IpcChannel.appDbPath, () => getDatabasePath())
}