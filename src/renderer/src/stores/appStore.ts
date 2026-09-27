import type {
  BriefSaveInput,
  ChapterBrief,
  Project,
  ProjectCreateInput,
  ProjectUpdateInput
} from '@shared/types'
import { create } from 'zustand'

interface AppState {
  projects: Project[]
  activeProjectId: number | null
  briefs: ChapterBrief[]
  loading: boolean
  error: string | null

  clearError: () => void
  loadProjects: () => Promise<void>
  createProject: (input: ProjectCreateInput) => Promise<void>
  removeProject: (id: number) => Promise<void>
  selectProject: (id: number | null) => Promise<void>
  updateProject: (input: ProjectUpdateInput) => Promise<void>
  saveBrief: (input: BriefSaveInput) => Promise<void>
  removeBrief: (id: number) => Promise<void>
  reloadBriefs: () => Promise<void>
}

/** 统一收敛错误信息，避免每个动作各写一遍 try/catch */
async function guard<T>(set: (partial: Partial<AppState>) => void, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    set({ loading: true, error: null })
    return await fn()
  } catch (err) {
    set({ error: err instanceof Error ? err.message : String(err) })
    return undefined
  } finally {
    set({ loading: false })
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  projects: [],
  activeProjectId: null,
  briefs: [],
  loading: false,
  error: null,

  clearError: () => set({ error: null }),

  loadProjects: async () => {
    const projects = await guard(set, () => window.inkwell.project.list())
    if (projects) set({ projects })
  },

  createProject: async (input) => {
    const created = await guard(set, () => window.inkwell.project.create(input))
    if (!created) return
    set({ projects: [created, ...get().projects] })
    await get().selectProject(created.id)
  },

  removeProject: async (id) => {
    await guard(set, () => window.inkwell.project.remove(id))
    if (get().activeProjectId === id) set({ activeProjectId: null, briefs: [] })
    await get().loadProjects()
  },

  selectProject: async (id) => {
    if (id === null) {
      set({ activeProjectId: null, briefs: [] })
      return
    }
    set({ activeProjectId: id })
    await get().reloadBriefs()
  },

  updateProject: async (input) => {
    const updated = await guard(set, () => window.inkwell.project.update(input))
    if (!updated) return
    set({ projects: get().projects.map((p) => (p.id === updated.id ? updated : p)) })
  },

  saveBrief: async (input) => {
    const saved = await guard(set, () => window.inkwell.brief.save(input))
    if (!saved) return
    await get().reloadBriefs()
  },

  removeBrief: async (id) => {
    await guard(set, () => window.inkwell.brief.remove(id))
    await get().reloadBriefs()
  },

  reloadBriefs: async () => {
    const projectId = get().activeProjectId
    if (projectId === null) {
      set({ briefs: [] })
      return
    }
    const briefs = await guard(set, () => window.inkwell.brief.list(projectId))
    if (briefs) set({ briefs })
  }
}))