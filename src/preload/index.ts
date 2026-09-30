import { IpcChannel } from '@shared/ipc'
import type {
  BriefExpandInput,
  BriefSaveInput,
  DraftSaveInput,
  GenerateEvent,
  GenerateStartInput,
  InkwellApi,
  LlmRoleName,
  PipelineEvent,
  PipelineStartInput,
  ProjectCreateInput,
  ProjectUpdateInput,
  ProviderSaveInput,
  RoleRouteSaveInput,
  WizardEvent,
  WizardStartInput
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
    remove: (id: number) => ipcRenderer.invoke(IpcChannel.briefRemove, id),
    expand: (input: BriefExpandInput) => ipcRenderer.invoke(IpcChannel.briefExpand, input)
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
  route: {
    list: () => ipcRenderer.invoke(IpcChannel.routeList),
    save: (input: RoleRouteSaveInput) => ipcRenderer.invoke(IpcChannel.routeSave, input),
    remove: (role: LlmRoleName) => ipcRenderer.invoke(IpcChannel.routeRemove, role)
  },
  usage: {
    summary: () => ipcRenderer.invoke(IpcChannel.usageSummary)
  },
  bridge: {
    exportTask: (projectId: number, chapterNo: number) =>
      ipcRenderer.invoke(IpcChannel.bridgeExportTask, { projectId, chapterNo })
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
  wizard: {
    start: (input: WizardStartInput) => ipcRenderer.invoke(IpcChannel.wizardStart, input),
    abort: (requestId: string) => ipcRenderer.invoke(IpcChannel.wizardAbort, requestId),
    onEvent: (listener: (event: WizardEvent) => void) => {
      const handler = (_event: IpcRendererEvent, payload: WizardEvent): void => listener(payload)
      ipcRenderer.on(IpcChannel.wizardEvent, handler)
      return () => {
        ipcRenderer.removeListener(IpcChannel.wizardEvent, handler)
      }
    }
  },
  memory: {
    truthFiles: (projectId: number) => ipcRenderer.invoke(IpcChannel.memoryTruthFiles, projectId),
    latestAudit: (projectId: number, chapterNo: number) =>
      ipcRenderer.invoke(IpcChannel.memoryLatestAudit, { projectId, chapterNo }),
    rebuild: (projectId: number) => ipcRenderer.invoke(IpcChannel.memoryRebuild, projectId)
  },
  pipeline: {
    start: (input: PipelineStartInput) => ipcRenderer.invoke(IpcChannel.pipelineStart, input),
    abort: (requestId: string) => ipcRenderer.invoke(IpcChannel.pipelineAbort, requestId),
    pause: (requestId: string) => ipcRenderer.invoke(IpcChannel.pipelinePause, requestId),
    resume: (requestId: string, projectId: number) =>
      ipcRenderer.invoke(IpcChannel.pipelineResume, { requestId, projectId }),
    steer: (requestId: string, guidance: string) =>
      ipcRenderer.invoke(IpcChannel.pipelineSteer, { requestId, guidance }),
    skip: (requestId: string) => ipcRenderer.invoke(IpcChannel.pipelineSkip, requestId),
    accept: (requestId: string) => ipcRenderer.invoke(IpcChannel.pipelineAccept, requestId),
    reject: (requestId: string) => ipcRenderer.invoke(IpcChannel.pipelineReject, requestId),
    latest: (projectId: number) => ipcRenderer.invoke(IpcChannel.pipelineLatest, projectId),
    onEvent: (listener: (event: PipelineEvent) => void) => {
      const handler = (_event: IpcRendererEvent, payload: PipelineEvent): void => listener(payload)
      ipcRenderer.on(IpcChannel.pipelineEvent, handler)
      return () => {
        ipcRenderer.removeListener(IpcChannel.pipelineEvent, handler)
      }
    }
  },
  app: {
    dbPath: () => ipcRenderer.invoke(IpcChannel.appDbPath),
    mcpEntry: () => ipcRenderer.invoke(IpcChannel.appMcpEntry)
  }
}

contextBridge.exposeInMainWorld('inkwell', api)