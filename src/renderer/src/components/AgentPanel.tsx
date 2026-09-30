import type { McpLaunchConfig } from '@shared/types'
import { useEffect, useState } from 'react'
import { useAppStore } from '../stores/appStore'
import { BUTTON_GHOST, BUTTON_PRIMARY, INPUT_CLASS, Labeled } from './ui'

const TOOL_DOCS: Array<{ name: string; note: string }> = [
  { name: 'inkwell_status', note: '列出所有项目与进度，判断还有哪些章要写' },
  { name: 'inkwell_next_task', note: '领取下一章任务（含完整提示词与真相文件），细纲缺失时先给细纲任务' },
  { name: 'inkwell_get_context', note: '取指定章的上下文包与写作提示词' },
  { name: 'inkwell_save_brief', note: '写回某章细纲' },
  { name: 'inkwell_save_draft', note: '写回某章正文（纯文本），顺带回写记忆' },
  { name: 'inkwell_memory', note: '读取七个真相文件，避免前后矛盾' },
  { name: 'inkwell_review', note: '14 项确定性自检（字数 / Markdown / AI 腔 / 角色覆盖 / 段落定位等）' }
]

export default function AgentPanel() {
  const projects = useAppStore((s) => s.projects)
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const loading = useAppStore((s) => s.loading)
  const loadProjects = useAppStore((s) => s.loadProjects)
  const exportTask = useAppStore((s) => s.exportTask)
  const importDraft = useAppStore((s) => s.importDraft)

  const [launch, setLaunch] = useState<McpLaunchConfig | null>(null)
  const [copied, setCopied] = useState(false)
  const [projectId, setProjectId] = useState<number>(activeProjectId ?? 0)
  const [chapterNo, setChapterNo] = useState(1)
  const [taskPath, setTaskPath] = useState('')
  const [taskContent, setTaskContent] = useState('')
  const [pasted, setPasted] = useState('')
  const [importNotice, setImportNotice] = useState('')

  useEffect(() => {
    void loadProjects()
    void window.inkwell.app.mcpLaunch().then(setLaunch)
  }, [loadProjects])

  useEffect(() => {
    if (projectId === 0 && projects.length > 0) setProjectId(activeProjectId ?? projects[0].id)
  }, [projects, activeProjectId, projectId])

  const handleCopy = async (): Promise<void> => {
    if (!launch) return
    await navigator.clipboard.writeText(launch.configJson)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleExport = async (): Promise<void> => {
    if (projectId === 0) return
    const result = await exportTask(projectId, chapterNo)
    if (!result) return
    setTaskPath(result.path)
    setTaskContent(result.content)
  }

  const handleImport = async (): Promise<void> => {
    if (projectId === 0 || !pasted.trim()) return
    const saved = await importDraft(projectId, chapterNo, pasted.trim())
    if (!saved) return
    setImportNotice(`已存为第 ${chapterNo} 章 v${saved.version}（${saved.wordCount} 字）`)
    setPasted('')
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-medium text-stone-700">方式 B · Agent 免费额度（MCP）</h2>
        <p className="mt-1 text-xs leading-5 text-stone-500">
          把写作引擎以本机 MCP Server（stdio）暴露给外部 Agent（TRAE WorkBuddy / Claude Code / Cursor 等），
          <strong>模型调用由 Agent 用其自身额度完成</strong>，Inkwell 只负责上下文装配、状态推进与落盘，因此零 API 花费。
        </p>
        <p className="mt-2 text-xs text-stone-500">
          {launch?.mode === 'electron'
            ? '安装版已内置运行方式：把下面这段粘贴到 Agent 的 MCP 配置即可，无需另装 Node。'
            : '开发模式：把下面这段粘贴到 Agent 的 MCP 配置（需本机已装 Node，且已执行过 npm run build）。'}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <button type="button" onClick={() => void handleCopy()} disabled={!launch} className={BUTTON_GHOST}>
            {copied ? '已复制' : '复制配置'}
          </button>
          {launch?.mode === 'electron' && <span className="text-[11px] text-stone-400">入口：{launch.entry}</span>}
        </div>
        <textarea
          readOnly
          rows={10}
          value={launch?.configJson ?? '正在读取…'}
          className={`${INPUT_CLASS} mt-2 resize-none font-mono text-xs`}
          onFocus={(e) => e.currentTarget.select()}
        />

        <div className="mt-4 overflow-hidden rounded-lg border border-stone-200">
          <table className="w-full text-left text-xs text-stone-600">
            <thead className="bg-stone-50 text-stone-400">
              <tr>
                <th className="px-3 py-1.5 font-normal">MCP 工具</th>
                <th className="px-3 py-1.5 font-normal">作用</th>
              </tr>
            </thead>
            <tbody>
              {TOOL_DOCS.map((tool) => (
                <tr key={tool.name} className="border-t border-stone-100">
                  <td className="px-3 py-1.5 font-mono text-stone-700">{tool.name}</td>
                  <td className="px-3 py-1.5">{tool.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-medium text-stone-700">任务单桥（不支持 MCP 时的兜底）</h2>
        <p className="mt-1 text-xs leading-5 text-stone-500">
          导出某一章的任务单（含完整提示词）→ 丢给任意 AI（网页版也行）→ 把产出的正文粘回下面，即可存为本章新版本。
        </p>

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[1fr_140px_auto]">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-stone-500">项目</span>
            <select value={projectId} onChange={(e) => setProjectId(Number(e.target.value))} className={INPUT_CLASS}>
              {projects.length === 0 && <option value={0}>（还没有项目）</option>}
              {projects.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-stone-500">章节号</span>
            <input
              type="number"
              min={1}
              value={chapterNo}
              onChange={(e) => setChapterNo(Number(e.target.value) || 1)}
              className={INPUT_CLASS}
            />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              disabled={loading || projectId === 0}
              onClick={() => void handleExport()}
              className={BUTTON_PRIMARY}
            >
              导出任务单
            </button>
          </div>
        </div>

        {taskPath && (
          <>
            <p className="mt-3 text-xs text-stone-500">
              已写入：<span className="font-mono text-stone-700">{taskPath}</span>
            </p>
            <textarea
              readOnly
              rows={6}
              value={taskContent}
              className={`${INPUT_CLASS} mt-2 resize-none font-mono text-[11px]`}
              onFocus={(e) => e.currentTarget.select()}
            />
          </>
        )}

        <div className="mt-5">
          <Labeled label="把 AI 返回的正文粘到这里">
            <textarea
              rows={6}
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder="粘贴纯正文……"
              className={`${INPUT_CLASS} resize-y leading-6`}
            />
          </Labeled>
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              disabled={loading || !pasted.trim() || projectId === 0}
              onClick={() => void handleImport()}
              className={BUTTON_PRIMARY}
            >
              存为第 {chapterNo} 章正文
            </button>
            <button type="button" onClick={() => setPasted('')} className={BUTTON_GHOST}>
              清空
            </button>
            {importNotice && <span className="text-xs text-emerald-700">{importNotice}</span>}
          </div>
        </div>
      </section>
    </div>
  )
}