import {
  IpcChannel,
  auditAbortSchema,
  backupNameSchema,
  bookAuditSchema,
  briefExpandSchema,
  briefSaveSchema,
  chapterQuerySchema,
  draftSaveSchema,
  exportSchema,
  exportTaskSchema,
  fixChapterSchema,
  generateStartSchema,
  idSchema,
  importAnalyzeSchema,
  importCommitSchema,
  importSessionSchema,
  importUpdateItemSchema,
  importValidateSchema,
  libraryCreateSchema,
  libraryIdSchema,
  libraryLocateSchema,
  libraryMigrateSchema,
  libraryRemoveSchema,
  libraryRenameSchema,
  librarySettingsSchema,
  pathSchema,
  pipelineStartSchema,
  pipelineSteerSchema,
  projectCreateSchema,
  projectIdSchema,
  projectUpdateSchema,
  providerSaveSchema,
  requestIdSchema,
  roleRouteSaveSchema,
  searchQuerySchema,
  statSetGoalSchema,
  trashItemSchema,
  wizardStartSchema
} from '@shared/ipc'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import type {
  BookAuditEvent,
  GenerateEvent,
  ImportEvent,
  McpLaunchConfig,
  MigrationEvent,
  PipelineEvent,
  PipelineRun,
  WizardEvent
} from '@shared/types'
import { app, dialog, ipcMain, session, shell, type WebContents } from 'electron'
import { exportChapterTask } from '../bridge/task-slip'
import { getDatabasePath } from '../db/client'
import * as repo from '../db/repositories'
import { importVelaDatabase } from '../import/vela'
import {
  analyzeImport,
  cancelSession,
  commitSession,
  getSession,
  revalidateSession,
  updateImportItem
} from '../import/session'
import { getLatestReview, saveReview } from '../db/memory-repo'
import { createRun, latestRun, updateRun } from '../db/pipeline-repo'
import { auditChapter } from '../engine/audit'
import { auditBook, estimateBookAudit } from '../engine/audit-book'
import { fixChapter } from '../engine/fix'
import { getTruthFiles } from '../engine/truth'
import { rebuildMemory } from '../engine/pipeline'
import { exportProject } from '../export'
import { buildChapterContext } from '../llm/context'
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
import { backupsDirPath, createBackup, deleteBackup, listBackups, restoreBackup } from '../db/backup'
import { emptyTrash, listTrash, purgeTrash, restoreTrash } from '../db/trash'
import { estimateMigrationBytes, migrateActiveLibraryTo } from '../library/migrate'
import { computeDirSize, precheckLibraryPath } from '../library/precheck'
import {
  addLibrary,
  createLibrary,
  dismissMigration,
  getBootstrapState,
  getSettings,
  listLibraries,
  locateLibrary,
  purgeLegacyData,
  removeLibrary,
  renameLibrary,
  saveSettings,
  switchLibrary
} from '../library/registry'
import { registerAborter, registerCleanup, unregisterAborter } from '../lifecycle'
import { search } from '../search/query'
import { getStatSummary, setGoal } from '../stat/goal'

/** 正在进行的可中断任务，key 为渲染进程生成的 requestId */
const activeJobs = new Map<string, AbortController>()

/** 连写请求 id 集合（退出时统一中断，保证断点写回） */
const activePipelineIds = new Set<string>()

/** M8：整本审计任务（可中止），key 为 taskId */
const activeAuditTasks = new Map<string, AbortController>()

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
  // 退出时中断所有在途连写，让断点写回 pipeline_step
  registerCleanup(() => {
    for (const requestId of activePipelineIds) abortPipeline(requestId)
    activePipelineIds.clear()
    for (const controller of activeAuditTasks.values()) controller.abort()
    activeAuditTasks.clear()
  })

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
  ipcMain.handle(IpcChannel.projectImportVela, async () => {
    const picked = await dialog.showOpenDialog({
      title: '选择 Vela 工程（.vela 目录或 vela.db）',
      properties: ['openFile', 'openDirectory'],
      filters: [
        { name: 'Vela 工程', extensions: ['vela', 'db', 'sqlite', 'sqlite3'] },
        { name: '全部文件', extensions: ['*'] }
      ]
    })
    if (picked.canceled || picked.filePaths.length === 0) return null
    return importVelaDatabase(picked.filePaths[0])
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

  /* --------------------------- M4 审稿与一键修复 --------------------------- */
  ipcMain.handle(IpcChannel.draftAudit, async (_event, raw: unknown) => {
    const input = chapterQuerySchema.parse(raw)
    const bundle = buildChapterContext(input.projectId, input.chapterNo)
    if (!bundle) throw new Error(`项目不存在：${input.projectId}`)
    if (!bundle.latestDraft?.content.trim()) throw new Error('本章还没有正文，无法审稿')

    const previous = repo.listDrafts(input.projectId).find((item) => item.chapterNo === input.chapterNo - 1)?.content ?? ''
    const report = await auditChapter({
      project: bundle.project,
      brief: bundle.brief,
      content: bundle.latestDraft.content,
      previousContent: previous,
      useModel: true
    })
    saveReview(input.projectId, input.chapterNo, bundle.latestDraft.id, report)
    return report
  })

  ipcMain.handle(IpcChannel.draftFix, async (_event, raw: unknown) => {
    const input = fixChapterSchema.parse(raw)
    return fixChapter({
      projectId: input.projectId,
      chapterNo: input.chapterNo,
      useModel: input.useModel ?? true
    })
  })

  /* ------------------------------- M4 导出 ------------------------------- */
  ipcMain.handle(IpcChannel.exportProject, async (_event, raw: unknown) => {
    const input = exportSchema.parse(raw)
    return exportProject(input, join(app.getPath('documents'), 'Inkwell 导出'))
  })

  ipcMain.handle(IpcChannel.exportOpenDir, async (_event, dir: unknown) => {
    await shell.openPath(pathSchema.parse(dir))
  })

  /* -------------------------------- 模型接入 ------------------------------- */
  ipcMain.handle(IpcChannel.providerList, () => listProviders())
  ipcMain.handle(IpcChannel.providerSave, (_event, input: unknown) => {
    const parsed = providerSaveSchema.parse(input)
    // 自定义端点必须先确认使用须知（计划书 §6.4 / §11）
    if (parsed.kind === 'custom-reverse-proxy') {
      const accepted = parsed.riskAccepted ?? (parsed.id ? getProviderById(parsed.id)?.dto.riskAccepted ?? false : false)
      if (!accepted) throw new Error('自定义端点需要先勾选并确认使用须知后才能保存')
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
    registerAborter(controller)
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
        unregisterAborter(controller)
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
    registerAborter(controller)
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
        unregisterAborter(controller)
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
    activePipelineIds.add(requestId)
    void runPipeline({ requestId, run, useModelAudit: true, emit: send })
      .catch((error: unknown) => {
        send({
          requestId,
          type: 'error',
          run: null,
          message: error instanceof Error ? error.message : String(error)
        })
      })
      .finally(() => {
        activePipelineIds.delete(requestId)
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
  ipcMain.handle(IpcChannel.appMcpLaunch, (): McpLaunchConfig => {
    const entry = join(app.getAppPath(), 'out', 'main', 'mcp.js')

    // 安装版：mcp.js 位于 app.asar 归档内，普通 Node 读不了 asar；
    // 改用应用自带的 Electron 运行时（ELECTRON_RUN_AS_NODE=1），等价于一个 Node 进程，
    // 且自带 asar 支持，无需用户另装 Node。
    if (app.isPackaged) {
      const command = process.execPath
      const env = { ELECTRON_RUN_AS_NODE: '1' }
      return {
        mode: 'electron',
        entry,
        command,
        args: [entry],
        env,
        configJson: JSON.stringify({ mcpServers: { inkwell: { command, args: [entry], env } } }, null, 2)
      }
    }

    // 开发模式：源码目录里直接跑系统 Node
    const command = 'node'
    return {
      mode: 'node',
      entry,
      command,
      args: [entry],
      env: {},
      configJson: JSON.stringify({ mcpServers: { inkwell: { command, args: [entry] } } }, null, 2)
    }
  })

  /* ============================== M6：多书库 ============================== */
  ipcMain.handle(IpcChannel.libraryBootstrap, () => getBootstrapState())
  ipcMain.handle(IpcChannel.libraryList, () => listLibraries())
  ipcMain.handle(IpcChannel.libraryCreate, (_event, raw: unknown) => createLibrary(libraryCreateSchema.parse(raw)))
  ipcMain.handle(IpcChannel.libraryAdd, (_event, raw: unknown) => addLibrary(libraryCreateSchema.parse(raw)))
  ipcMain.handle(IpcChannel.librarySwitch, (_event, id: unknown) => switchLibrary(libraryIdSchema.parse(id)))
  ipcMain.handle(IpcChannel.libraryLocate, (_event, raw: unknown) => locateLibrary(libraryLocateSchema.parse(raw)))
  ipcMain.handle(IpcChannel.libraryRemove, (_event, raw: unknown) => removeLibrary(libraryRemoveSchema.parse(raw)))
  ipcMain.handle(IpcChannel.libraryRename, (_event, raw: unknown) => renameLibrary(libraryRenameSchema.parse(raw)))
  ipcMain.handle(IpcChannel.libraryPrecheck, (_event, target: unknown) =>
    precheckLibraryPath(pathSchema.parse(target))
  )
  ipcMain.handle(IpcChannel.librarySettings, () => getSettings())
  ipcMain.handle(IpcChannel.librarySaveSettings, (_event, raw: unknown) =>
    saveSettings(librarySettingsSchema.parse(raw))
  )
  ipcMain.handle(IpcChannel.libraryDismissMigration, () => {
    dismissMigration()
  })
  ipcMain.handle(IpcChannel.libraryPurgeLegacy, () => purgeLegacyData())

  ipcMain.handle(IpcChannel.libraryMigrate, (event, raw: unknown) => {
    const input = libraryMigrateSchema.parse(raw)
    const sender = event.sender
    const emitMigration = (payload: MigrationEvent): void =>
      emit<MigrationEvent>(sender, IpcChannel.libraryMigrationEvent, payload)

    const precheck = precheckLibraryPath(input.targetPath, { sourceBytes: estimateMigrationBytes() })
    for (const warning of precheck.warnings) {
      emitMigration({ type: 'progress', progress: { phase: 'precheck', message: warning, percent: 5 } })
    }

    const result = migrateActiveLibraryTo(input.targetPath, {
      onProgress: (progress) => emitMigration({ type: 'progress', progress })
    })
    emitMigration({ type: 'done', result })
    return result
  })

  /* ============================== M6：回收站 ============================== */
  ipcMain.handle(IpcChannel.trashList, () => listTrash())
  ipcMain.handle(IpcChannel.trashRestore, (_event, raw: unknown) => restoreTrash(trashItemSchema.parse(raw)))
  ipcMain.handle(IpcChannel.trashPurge, (_event, raw: unknown) => {
    purgeTrash(trashItemSchema.parse(raw))
  })
  ipcMain.handle(IpcChannel.trashEmpty, () => emptyTrash())

  /* =============================== M6：备份 =============================== */
  ipcMain.handle(IpcChannel.backupList, () => listBackups())
  ipcMain.handle(IpcChannel.backupCreate, () => createBackup('manual'))
  ipcMain.handle(IpcChannel.backupRestore, (_event, name: unknown) => restoreBackup(backupNameSchema.parse(name)))
  ipcMain.handle(IpcChannel.backupDelete, (_event, name: unknown) => {
    deleteBackup(backupNameSchema.parse(name))
  })
  ipcMain.handle(IpcChannel.backupReveal, async () => {
    await shell.openPath(backupsDirPath())
  })

  /* ============================= M6：应用杂项 ============================= */
  ipcMain.handle(IpcChannel.appPickFolder, async () => {
    const picked = await dialog.showOpenDialog({
      title: '选择目录',
      properties: ['openDirectory', 'createDirectory']
    })
    if (picked.canceled || picked.filePaths.length === 0) return null
    return picked.filePaths[0]
  })
  ipcMain.handle(IpcChannel.appOpenPath, async (_event, target: unknown) => {
    await shell.openPath(pathSchema.parse(target))
  })
  ipcMain.handle(IpcChannel.appClearCache, async () => {
    const userData = app.getPath('userData')
    let freedBytes = 0
    for (const dir of ['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache']) {
      const target = join(userData, dir)
      try {
        freedBytes += computeDirSize(target)
        rmSync(target, { recursive: true, force: true })
      } catch {
        // 单个缓存目录清理失败不影响其余
      }
    }
    try {
      await session.defaultSession.clearCache()
    } catch {
      // 忽略清缓存失败
    }
    return { freedBytes }
  })

  ipcMain.handle(IpcChannel.appPickFile, async () => {
    const picked = await dialog.showOpenDialog({
      title: '选择要导入的文档',
      properties: ['openFile'],
      filters: [
        { name: '支持的文档', extensions: ['txt', 'md', 'markdown', 'json', 'docx', 'epub', 'vela', 'db'] },
        { name: '全部文件', extensions: ['*'] }
      ]
    })
    if (picked.canceled || picked.filePaths.length === 0) return null
    return picked.filePaths[0]
  })

  /* ============================== M7：内容导入 ============================== */
  ipcMain.handle(IpcChannel.importAnalyze, async (event, raw: unknown) => {
    const input = importAnalyzeSchema.parse(raw)
    const sender = event.sender
    return analyzeImport(input, {
      onProgress: (progress) =>
        emit<ImportEvent>(sender, IpcChannel.importEvent, { type: 'progress', progress })
    })
  })
  ipcMain.handle(IpcChannel.importSession, (_event, id: unknown) =>
    getSession(importSessionSchema.shape.id.parse(id))
  )
  ipcMain.handle(IpcChannel.importUpdateItem, (_event, raw: unknown) =>
    updateImportItem(importUpdateItemSchema.parse(raw))
  )
  ipcMain.handle(IpcChannel.importValidate, (_event, raw: unknown) =>
    revalidateSession(importValidateSchema.parse(raw))
  )
  ipcMain.handle(IpcChannel.importCommit, (_event, id: unknown) =>
    commitSession(importCommitSchema.shape.sessionId.parse(id))
  )
  ipcMain.handle(IpcChannel.importCancel, (_event, id: unknown) => {
    cancelSession(importCommitSchema.shape.sessionId.parse(id))
  })

  /* ============================== M8：检索与统计 ============================== */

  ipcMain.handle(IpcChannel.searchQuery, (_event, raw: unknown) => search(searchQuerySchema.parse(raw)))

  ipcMain.handle(IpcChannel.statSummary, () => getStatSummary())
  ipcMain.handle(IpcChannel.statSetGoal, (_event, raw: unknown) => {
    setGoal(statSetGoalSchema.parse(raw))
    return getStatSummary()
  })

  ipcMain.handle(IpcChannel.auditBook, (event, raw: unknown) => {
    const input = bookAuditSchema.parse(raw)
    const useModel = input.useModel === true
    // 模型语义审计必须先给 token 预估并二次确认（避免「整本审计烧 token」）
    if (useModel && input.confirm !== true) {
      return { taskId: '', needsConfirm: true, estimate: estimateBookAudit(input.projectId) }
    }

    const taskId = `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const controller = new AbortController()
    activeAuditTasks.set(taskId, controller)
    registerAborter(controller)
    const sender = event.sender

    // 推迟到下一轮事件循环启动，确保 IPC 先把 {taskId} 返回给渲染进程
    setTimeout(() => {
      void (async () => {
        try {
          const summary = await auditBook({
            projectId: input.projectId,
            useModel,
            signal: controller.signal,
            onProgress: (progress) =>
              emit<BookAuditEvent>(sender, IpcChannel.auditEvent, { taskId, type: 'progress', progress })
          })
          emit<BookAuditEvent>(sender, IpcChannel.auditEvent, { taskId, type: 'done', summary })
        } catch (error) {
          emit<BookAuditEvent>(sender, IpcChannel.auditEvent, {
            taskId,
            type: 'error',
            message: jobErrorMessage(error, controller.signal.aborted)
          })
        } finally {
          activeAuditTasks.delete(taskId)
          unregisterAborter(controller)
        }
      })()
    }, 0).unref?.()

    return { taskId, needsConfirm: false, estimate: null }
  })
  ipcMain.handle(IpcChannel.auditAbort, (_event, raw: unknown) => {
    activeAuditTasks.get(auditAbortSchema.parse(raw).taskId)?.abort()
  })
}