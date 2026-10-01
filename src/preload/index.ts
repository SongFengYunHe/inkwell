import { IpcChannel } from '@shared/ipc'
import type {
  BriefExpandInput,
  BriefSaveInput,
  DraftSaveInput,
  ExportInput,
  FixChapterInput,
  GenerateEvent,
  GenerateStartInput,
  ImportAnalyzeInput,
  ImportEvent,
  ImportUpdateItemInput,
  ImportValidateInput,
  InkwellApi,
  LibrarySettings,
  LlmRoleName,
  MigrationEvent,
  MigrationRequest,
  PipelineEvent,
  PipelineStartInput,
  ProjectCreateInput,
  ProjectUpdateInput,
  ProviderSaveInput,
  RoleRouteSaveInput,
  WizardEvent,
  WizardStartInput
} from '@shared/types'
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'

/** 渲染进程唯一可用的桥接 API：仅暴露白名单方法，不泄漏 ipcRenderer 本体 */
const api: InkwellApi = {
  project: {
    list: () => ipcRenderer.invoke(IpcChannel.projectList),
    get: (id: number) => ipcRenderer.invoke(IpcChannel.projectGet, id),
    create: (input: ProjectCreateInput) => ipcRenderer.invoke(IpcChannel.projectCreate, input),
    update: (input: ProjectUpdateInput) => ipcRenderer.invoke(IpcChannel.projectUpdate, input),
    remove: (id: number) => ipcRenderer.invoke(IpcChannel.projectRemove, id),
    importVela: () => ipcRenderer.invoke(IpcChannel.projectImportVela)
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
    remove: (id: number) => ipcRenderer.invoke(IpcChannel.draftRemove, id),
    audit: (projectId: number, chapterNo: number) =>
      ipcRenderer.invoke(IpcChannel.draftAudit, { projectId, chapterNo }),
    fix: (input: FixChapterInput) => ipcRenderer.invoke(IpcChannel.draftFix, input)
  },
  export: {
    project: (input: ExportInput) => ipcRenderer.invoke(IpcChannel.exportProject, input),
    openDir: (path: string) => ipcRenderer.invoke(IpcChannel.exportOpenDir, path)
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
    mcpEntry: () => ipcRenderer.invoke(IpcChannel.appMcpEntry),
    mcpLaunch: () => ipcRenderer.invoke(IpcChannel.appMcpLaunch),
    pickFolder: () => ipcRenderer.invoke(IpcChannel.appPickFolder),
    pickFile: () => ipcRenderer.invoke(IpcChannel.appPickFile),
    openPath: (path: string) => ipcRenderer.invoke(IpcChannel.appOpenPath, path),
    clearCache: () => ipcRenderer.invoke(IpcChannel.appClearCache)
  },
  library: {
    bootstrap: () => ipcRenderer.invoke(IpcChannel.libraryBootstrap),
    list: () => ipcRenderer.invoke(IpcChannel.libraryList),
    create: (input: { name: string; path: string }) => ipcRenderer.invoke(IpcChannel.libraryCreate, input),
    add: (input: { name: string; path: string }) => ipcRenderer.invoke(IpcChannel.libraryAdd, input),
    switch: (id: string) => ipcRenderer.invoke(IpcChannel.librarySwitch, id),
    locate: (input: { id: string; path: string }) => ipcRenderer.invoke(IpcChannel.libraryLocate, input),
    remove: (input: { id: string; deleteFiles: boolean }) => ipcRenderer.invoke(IpcChannel.libraryRemove, input),
    rename: (input: { id: string; name: string }) => ipcRenderer.invoke(IpcChannel.libraryRename, input),
    precheck: (path: string) => ipcRenderer.invoke(IpcChannel.libraryPrecheck, path),
    migrate: (input: MigrationRequest) => ipcRenderer.invoke(IpcChannel.libraryMigrate, input),
    dismissMigration: () => ipcRenderer.invoke(IpcChannel.libraryDismissMigration),
    purgeLegacy: () => ipcRenderer.invoke(IpcChannel.libraryPurgeLegacy),
    settings: () => ipcRenderer.invoke(IpcChannel.librarySettings),
    saveSettings: (settings: Partial<LibrarySettings>) =>
      ipcRenderer.invoke(IpcChannel.librarySaveSettings, settings)
  },
  trash: {
    list: () => ipcRenderer.invoke(IpcChannel.trashList),
    restore: (item: { kind: 'project' | 'chapter'; id: number }) => ipcRenderer.invoke(IpcChannel.trashRestore, item),
    purge: (item: { kind: 'project' | 'chapter'; id: number }) => ipcRenderer.invoke(IpcChannel.trashPurge, item),
    empty: () => ipcRenderer.invoke(IpcChannel.trashEmpty)
  },
  backup: {
    list: () => ipcRenderer.invoke(IpcChannel.backupList),
    create: () => ipcRenderer.invoke(IpcChannel.backupCreate),
    restore: (name: string) => ipcRenderer.invoke(IpcChannel.backupRestore, name),
    remove: (name: string) => ipcRenderer.invoke(IpcChannel.backupDelete, name),
    reveal: () => ipcRenderer.invoke(IpcChannel.backupReveal)
  },
  import: {
    analyze: (input: ImportAnalyzeInput) => ipcRenderer.invoke(IpcChannel.importAnalyze, input),
    session: (id: string) => ipcRenderer.invoke(IpcChannel.importSession, id),
    updateItem: (input: ImportUpdateItemInput) => ipcRenderer.invoke(IpcChannel.importUpdateItem, input),
    validate: (input: ImportValidateInput) => ipcRenderer.invoke(IpcChannel.importValidate, input),
    commit: (sessionId: string) => ipcRenderer.invoke(IpcChannel.importCommit, sessionId),
    cancel: (sessionId: string) => ipcRenderer.invoke(IpcChannel.importCancel, sessionId),
    onEvent: (listener: (event: ImportEvent) => void) => {
      const handler = (_event: IpcRendererEvent, payload: ImportEvent): void => listener(payload)
      ipcRenderer.on(IpcChannel.importEvent, handler)
      return () => {
        ipcRenderer.removeListener(IpcChannel.importEvent, handler)
      }
    }
  },
  resolveDropPath: (file: File) => webUtils.getPathForFile(file),
  onMigrationEvent: (listener: (event: MigrationEvent) => void) => {
    const handler = (_event: IpcRendererEvent, payload: MigrationEvent): void => listener(payload)
    ipcRenderer.on(IpcChannel.libraryMigrationEvent, handler)
    return () => {
      ipcRenderer.removeListener(IpcChannel.libraryMigrationEvent, handler)
    }
  }
} as InkwellApi

contextBridge.exposeInMainWorld('inkwell', api)