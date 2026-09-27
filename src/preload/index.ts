import { IpcChannel } from '@shared/ipc'
import type {
  BriefSaveInput,
  DraftSaveInput,
  GenerateEvent,
  GenerateStartInput,
  InkwellApi,
  ProjectCreateInput,
  ProjectUpdateInput,
  ProviderSaveInput
} from '@shared/types'
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

/** 渲染进程唯一可用的桥接 API：仅暴露白名单方法，不泄漏 ipcRenderer 本体 */
const api: InkwellApi = {
  project: {
    list: () => ipcRenderer.invoke(IpcChannel.projectList),
    get: (id: number) => ipcRenderer.invoke(IpcChannel.projectGet, id),
    create: (input: ProjectCreateInput) => ipcRenderer.invoke(IpcChannel.projectCreate, input),
    update: (input: ProjectUpdateInput) => ipcRenderer.invoke(IpcChannel.projectUpdate, input),
    remove: (id: number) => ipcRenderer.invoke(IpcChannel.projectRemove, id)
  },
  brief: {
    list: (projectId: number) => ipcRenderer.invoke(IpcChannel.briefList, projectId),
    save: (input: BriefSaveInput) => ipcRenderer.invoke(IpcChannel.briefSave, input),
    remove: (id: number) => ipcRenderer.invoke(IpcChannel.briefRemove, id)
  },
  draft: {
    list: (projectId: number) => ipcRenderer.invoke(IpcChannel.draftList, projectId),
    save: (input: DraftSaveInput) => ipcRenderer.invoke(IpcChannel.draftSave, input),
    remove: (id: number) => ipcRenderer.invoke(IpcChannel.draftRemove, id)
  },
  provider: {
    list: () => ipcRenderer.invoke(IpcChannel.providerList),
    save: (input: ProviderSaveInput) => ipcRenderer.invoke(IpcChannel.providerSave, input),
    remove: (id: number) => ipcRenderer.invoke(IpcChannel.providerRemove, id),
    test: (input: ProviderSaveInput) => ipcRenderer.invoke(IpcChannel.providerTest, input)
  },
  generate: {
    start: (input: GenerateStartInput) => ipcRenderer.invoke(IpcChannel.generateStart, input),
    abort: (requestId: string) => ipcRenderer.invoke(IpcChannel.generateAbort, requestId),
    onEvent: (listener: (event: GenerateEvent) => void) => {
      const handler = (_event: IpcRendererEvent, payload: GenerateEvent): void => listener(payload)
      ipcRenderer.on(IpcChannel.generateEvent, handler)
      return () => {
        ipcRenderer.removeListener(IpcChannel.generateEvent, handler)
      }
    }
  },
  app: {
    dbPath: () => ipcRenderer.invoke(IpcChannel.appDbPath)
  }
}

contextBridge.exposeInMainWorld('inkwell', api)