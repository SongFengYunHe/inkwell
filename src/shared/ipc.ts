import { z } from 'zod'

/** IPC 通道名（主进程与预加载脚本共用，避免字符串漂移） */
export const IpcChannel = {
  projectList: 'project:list',
  projectGet: 'project:get',
  projectCreate: 'project:create',
  projectUpdate: 'project:update',
  projectRemove: 'project:remove',
  briefList: 'brief:list',
  briefSave: 'brief:save',
  briefRemove: 'brief:remove',
  draftList: 'draft:list',
  draftSave: 'draft:save',
  draftRemove: 'draft:remove',
  appDbPath: 'app:db-path'
} as const

export type IpcChannelName = (typeof IpcChannel)[keyof typeof IpcChannel]

export const idSchema = z.number().int().positive()

export const projectIdSchema = z.number().int().positive()

export const projectCreateSchema = z.object({
  name: z.string().trim().min(1, '项目名不能为空').max(120),
  genre: z.string().max(60).optional(),
  totalChapters: z.number().int().min(1).max(10_000).optional(),
  wordsPerChapter: z.number().int().min(200).max(20_000).optional(),
  premise: z.string().max(4_000).optional()
})

export const projectUpdateSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(120).optional(),
  genre: z.string().max(60).optional(),
  targetAudience: z.string().max(120).optional(),
  totalChapters: z.number().int().min(1).max(10_000).optional(),
  wordsPerChapter: z.number().int().min(200).max(20_000).optional(),
  language: z.string().max(30).optional(),
  style: z.string().max(4_000).optional(),
  premise: z.string().max(20_000).optional(),
  worldbuilding: z.string().max(200_000).optional(),
  protagonist: z.string().max(200_000).optional(),
  goldenFinger: z.string().max(200_000).optional(),
  globalGuidance: z.string().max(200_000).optional(),
  coreOutline: z.string().max(500_000).optional()
})

export const briefSaveSchema = z.object({
  id: idSchema.optional(),
  projectId: projectIdSchema,
  chapterNo: z.number().int().min(1).max(99_999),
  volumeIdx: z.number().int().min(0).max(9_999).optional(),
  title: z.string().max(200).optional(),
  role: z.string().max(60).optional(),
  purpose: z.string().max(4_000).optional(),
  keyEvents: z.string().max(20_000).optional(),
  characters: z.array(z.string().max(80)).max(200).optional(),
  sceneBeats: z.array(z.string().max(2_000)).max(200).optional(),
  suspenseHook: z.string().max(2_000).optional(),
  userGuidance: z.string().max(4_000).optional(),
  notes: z.string().max(4_000).optional()
})

export const draftSaveSchema = z.object({
  id: idSchema.optional(),
  projectId: projectIdSchema,
  chapterNo: z.number().int().min(1).max(99_999),
  version: z.number().int().min(1).max(9_999).optional(),
  status: z.enum(['draft', 'revised', 'finalized', 'archived']).optional(),
  source: z.enum(['write', 'rewrite']).optional(),
  content: z.string().max(2_000_000).optional()
})