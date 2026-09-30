import { useState, type FormEvent } from 'react'
import ThemeToggle from '../components/ThemeToggle'
import { GENRE_TEMPLATES, findGenreTemplate } from '../data/genres'
import { useAppStore } from '../stores/appStore'

export default function Bookshelf() {
  const projects = useAppStore((s) => s.projects)
  const loading = useAppStore((s) => s.loading)
  const createProject = useAppStore((s) => s.createProject)
  const importVelaProject = useAppStore((s) => s.importVelaProject)
  const openProject = useAppStore((s) => s.openProject)
  const removeProject = useAppStore((s) => s.removeProject)
  const setView = useAppStore((s) => s.setView)

  const [name, setName] = useState('')
  const [genre, setGenre] = useState(GENRE_TEMPLATES[0].name)
  const [totalChapters, setTotalChapters] = useState(GENRE_TEMPLATES[0].chapters)
  const [premise, setPremise] = useState('')

  const template = findGenreTemplate(genre)

  const handleGenreChange = (value: string): void => {
    setGenre(value)
    const next = findGenreTemplate(value)
    // 换题材时带出该题材的推荐章数与文风
    if (next) setTotalChapters(next.chapters)
  }

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    await createProject({
      name: name.trim(),
      genre,
      totalChapters,
      premise: premise.trim(),
      style: template?.style
    })
    setName('')
    setPremise('')
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-8 px-8 py-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">书架</h1>
          <p className="mt-1 text-sm text-stone-500">只需一句话灵感，即可开始一部长篇。</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="mr-1 text-xs text-stone-400">{loading ? '加载中…' : `共 ${projects.length} 个项目`}</span>
          <button
            type="button"
            onClick={() => void importVelaProject()}
            disabled={loading}
            className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm text-stone-600 transition hover:bg-stone-50 disabled:opacity-40"
          >
            导入 Vela 工程
          </button>
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setView('settings')}
            className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm text-stone-600 transition hover:bg-stone-50"
          >
            设置
          </button>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-1 gap-8 overflow-hidden lg:grid-cols-[320px_1fr]">
        <form
          onSubmit={handleCreate}
          className="flex h-fit flex-col gap-4 rounded-xl border border-stone-200 bg-white p-5 shadow-sm"
        >
          <h2 className="text-sm font-medium text-stone-700">新建项目</h2>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-stone-500">书名</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：剑来山海"
              className="rounded-lg border border-stone-200 px-3 py-2 text-sm outline-none focus:border-amber-500"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-stone-500">题材（{GENRE_TEMPLATES.length} 种模板）</span>
            <select
              value={genre}
              onChange={(e) => handleGenreChange(e.target.value)}
              className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm outline-none focus:border-amber-500"
            >
              {GENRE_TEMPLATES.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>
            {template && <span className="text-[11px] text-stone-400">文风建议：{template.style}</span>}
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-stone-500">预计章数</span>
            <input
              type="number"
              min={1}
              max={10000}
              value={totalChapters}
              onChange={(e) => setTotalChapters(Number(e.target.value) || 1)}
              className="rounded-lg border border-stone-200 px-3 py-2 text-sm outline-none focus:border-amber-500"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-stone-500">一句话灵感（可留空）</span>
            <textarea
              value={premise}
              onChange={(e) => setPremise(e.target.value)}
              rows={3}
              placeholder="少年捡到一柄会说话的古剑……"
              className="resize-none rounded-lg border border-stone-200 px-3 py-2 text-sm outline-none focus:border-amber-500"
            />
          </label>

          <button
            type="submit"
            disabled={!name.trim() || loading}
            className="mt-1 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {premise.trim() ? '创建并由 AI 生成大纲' : '创建并进入'}
          </button>
          {premise.trim() && (
            <p className="text-center text-[11px] text-stone-400">将自动生成设定、总大纲与各章细纲</p>
          )}
        </form>

        <section className="overflow-y-auto pr-1">
          {projects.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-stone-300 px-6 text-center text-stone-400">
              <p className="text-sm text-stone-500">还没有项目，三步即可开写</p>
              <ol className="space-y-1 text-xs leading-5">
                <li>1. 左侧填书名、选题材、写一句灵感</li>
                <li>2. 点「创建并由 AI 生成大纲」，自动得到设定 + 总大纲 + 逐章细纲</li>
                <li>3. 进工作区点「连写整本」，或逐章「生成正文」</li>
              </ol>
              <p className="text-xs text-stone-400">已有 Vela 工程？点右上「导入 Vela 工程」继续写。</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {projects.map((project) => (
                <article
                  key={project.id}
                  className="group flex cursor-pointer flex-col justify-between gap-4 rounded-xl border border-stone-200 bg-white p-4 shadow-sm transition hover:border-amber-400 hover:shadow"
                  onClick={() => void openProject(project.id)}
                >
                  <div>
                    <h3 className="truncate text-base font-medium text-stone-800">{project.name}</h3>
                    <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-xs leading-5 text-stone-500">
                      {project.premise || '（暂无一句话灵感）'}
                    </p>
                  </div>
                  <div className="flex items-center justify-between text-xs text-stone-400">
                    <span className="rounded bg-stone-100 px-2 py-0.5 text-stone-600">{project.genre || '未设题材'}</span>
                    <span>{project.totalChapters} 章</span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      void removeProject(project.id)
                    }}
                    className="self-end text-xs text-stone-400 opacity-0 transition hover:text-red-600 group-hover:opacity-100"
                  >
                    删除
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}