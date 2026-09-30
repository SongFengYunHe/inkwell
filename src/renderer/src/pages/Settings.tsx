import { useEffect, useState } from 'react'
import AgentPanel from '../components/AgentPanel'
import ProviderPanel from '../components/ProviderPanel'
import RoutePanel from '../components/RoutePanel'
import UsagePanel from '../components/UsagePanel'
import { useAppStore } from '../stores/appStore'

type SettingsTab = 'official' | 'agent' | 'proxy' | 'route' | 'usage'

const TABS: Array<{ key: SettingsTab; label: string }> = [
  { key: 'official', label: '官方 API（BYOK）' },
  { key: 'agent', label: 'Agent 模式（MCP）' },
  { key: 'proxy', label: '自定义端点' },
  { key: 'route', label: '角色-模型路由' },
  { key: 'usage', label: '用量' }
]

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
      </div>
    </div>
  )
}