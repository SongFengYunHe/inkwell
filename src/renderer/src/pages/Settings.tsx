import { useEffect, useState } from 'react'
import AgentPanel from '../components/AgentPanel'
import BackupPanel from '../components/BackupPanel'
import ProviderPanel from '../components/ProviderPanel'
import RoutePanel from '../components/RoutePanel'
import TrashPanel from '../components/TrashPanel'
import UsagePanel from '../components/UsagePanel'
import ThemeToggle from '../components/ThemeToggle'
import { BUTTON_PRIMARY, INPUT_CLASS, Labeled } from '../components/ui'
import { useAppStore } from '../stores/appStore'

type SettingsTab = 'official' | 'agent' | 'proxy' | 'route' | 'usage' | 'data' | 'trash' | 'about'

const TABS: Array<{ key: SettingsTab; label: string }> = [
  { key: 'official', label: '官方 API（BYOK）' },
  { key: 'agent', label: 'Agent 模式（MCP）' },
  { key: 'proxy', label: '自定义端点' },
  { key: 'route', label: '角色-模型路由' },
  { key: 'usage', label: '用量' },
  { key: 'data', label: '数据与备份' },
  { key: 'trash', label: '回收站' },
  { key: 'about', label: '关于' }
]

/** 隐私与后台行为四条（M8 §5.4） */
const PRIVACY_POINTS: Array<{ title: string; detail: string }> = [
  { title: '不联网', detail: '除你显式配置的模型端点外，应用不向任何服务器发送数据；没有遥测、没有上报。' },
  { title: '不自启', detail: '不写入开机自启项（不调用系统登录项设置），关闭即彻底退出。' },
  { title: '不驻留', detail: '不创建托盘图标、不常驻后台；退出后任务管理器无 Inkwell 残留进程。' },
  { title: '无遥测', detail: '不采集设备信息、使用统计或崩溃日志上传；用量仪表盘仅记录本地调用记账。' }
]

/** 「关于」Tab：隐私声明 + 写作目标设置 */
function AboutPanel() {
  const stat = useAppStore((s) => s.stat)
  const loadStat = useAppStore((s) => s.loadStat)
  const saveGoal = useAppStore((s) => s.saveGoal)

  const [dailyWords, setDailyWords] = useState(3000)
  const [dailyChapters, setDailyChapters] = useState(1)

  useEffect(() => {
    void loadStat()
  }, [loadStat])

  useEffect(() => {
    if (stat) {
      setDailyWords(stat.goal.dailyWords)
      setDailyChapters(stat.goal.dailyChapters)
    }
  }, [stat])

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-medium text-stone-700">隐私与后台行为</h2>
        <ul className="mt-3 space-y-3">
          {PRIVACY_POINTS.map((point) => (
            <li key={point.title} className="flex gap-3">
              <span className="mt-0.5 shrink-0 rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                {point.title}
              </span>
              <span className="text-xs leading-5 text-stone-600">{point.detail}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-medium text-stone-700">写作目标</h2>
        <p className="mt-1 text-xs text-stone-400">
          今日进度 {stat?.today.wordsAdded.toLocaleString() ?? 0} 字 · 连续达标 {stat?.streak ?? 0} 天
        </p>
        <div className="mt-3 grid grid-cols-2 gap-4">
          <Labeled label="每日字数目标">
            <input
              type="number"
              min={0}
              max={1_000_000}
              value={dailyWords}
              onChange={(event) => setDailyWords(Number(event.target.value) || 0)}
              className={INPUT_CLASS}
            />
          </Labeled>
          <Labeled label="每日章节目标">
            <input
              type="number"
              min={0}
              max={1000}
              value={dailyChapters}
              onChange={(event) => setDailyChapters(Number(event.target.value) || 0)}
              className={INPUT_CLASS}
            />
          </Labeled>
        </div>
        <button
          type="button"
          onClick={() => void saveGoal({ dailyWords, dailyChapters })}
          className={`mt-4 ${BUTTON_PRIMARY}`}
        >
          保存目标
        </button>
      </section>
    </div>
  )
}

export default function Settings() {
  const setView = useAppStore((s) => s.setView)
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const loadProviders = useAppStore((s) => s.loadProviders)

  const [tab, setTab] = useState<SettingsTab>('official')

  useEffect(() => {
    void loadProviders()
  }, [loadProviders])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-4 border-b border-stone-200 bg-white px-5 py-3">
        <button
          type="button"
          onClick={() => setView(activeProjectId === null ? 'bookshelf' : 'workspace')}
          className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm text-stone-600 transition hover:bg-stone-50"
        >
          ← 返回
        </button>
        <div>
          <h1 className="text-base font-medium">设置 · 模型接入</h1>
          <p className="text-xs text-stone-400">三种接入方式可混用；密钥经系统级加密后仅存本地。</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setView('library')}
            className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm text-stone-600 transition hover:bg-stone-50"
          >
            书库管理
          </button>
          <ThemeToggle />
        </div>
      </header>

      <nav className="flex gap-1 overflow-x-auto border-b border-stone-200 bg-white px-4">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm transition ${
              tab === item.key
                ? 'border-amber-500 font-medium text-stone-900'
                : 'border-transparent text-stone-500 hover:text-stone-700'
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {tab === 'official' && <ProviderPanel kind="openai-compatible" />}
        {tab === 'agent' && <AgentPanel />}
        {tab === 'proxy' && <ProviderPanel kind="custom-reverse-proxy" />}
        {tab === 'route' && <RoutePanel />}
        {tab === 'usage' && <UsagePanel />}
        {tab === 'data' && <BackupPanel />}
        {tab === 'trash' && <TrashPanel />}
        {tab === 'about' && <AboutPanel />}
      </div>
    </div>
  )
}