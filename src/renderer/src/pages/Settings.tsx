import type { ProviderTestResult } from '@shared/types'
import { useEffect, useState, type FormEvent } from 'react'
import { BUTTON_GHOST, BUTTON_PRIMARY, INPUT_CLASS, Labeled } from '../components/ui'
import { useAppStore } from '../stores/appStore'

interface ProviderForm {
  id?: number
  name: string
  baseUrl: string
  model: string
  apiKey: string
  enabled: boolean
}

const EMPTY_FORM: ProviderForm = {
  name: 'OpenAI 兼容端点',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  apiKey: '',
  enabled: true
}

/** 常用预设，降低填错地址的概率（计划书 §6.2） */
const PRESETS: Array<{ label: string; baseUrl: string; model: string }> = [
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { label: 'Ollama 本地', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b' }
]

export default function Settings() {
  const providers = useAppStore((s) => s.providers)
  const loading = useAppStore((s) => s.loading)
  const setView = useAppStore((s) => s.setView)
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const loadProviders = useAppStore((s) => s.loadProviders)
  const saveProvider = useAppStore((s) => s.saveProvider)
  const removeProvider = useAppStore((s) => s.removeProvider)
  const testProvider = useAppStore((s) => s.testProvider)

  const [form, setForm] = useState<ProviderForm>(EMPTY_FORM)
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null)

  useEffect(() => {
    void loadProviders()
  }, [loadProviders])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setTestResult(null)
    await saveProvider({
      id: form.id,
      kind: 'openai-compatible',
      name: form.name,
      baseUrl: form.baseUrl,
      model: form.model,
      // 留空表示保持原密钥不变
      apiKey: form.apiKey.trim() ? form.apiKey.trim() : undefined,
      enabled: form.enabled
    })
    setForm({ ...EMPTY_FORM, name: form.name, baseUrl: form.baseUrl, model: form.model, apiKey: '' })
  }

  const handleTest = async () => {
    setTestResult(null)
    const result = await testProvider({
      id: form.id,
      kind: 'openai-compatible',
      name: form.name,
      baseUrl: form.baseUrl,
      model: form.model,
      apiKey: form.apiKey.trim() ? form.apiKey.trim() : undefined
    })
    setTestResult(result)
  }

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
          <p className="text-xs text-stone-400">M1 支持单个 OpenAI 兼容端点；密钥经系统级加密后仅存本地。</p>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-y-auto p-6 lg:grid-cols-[320px_1fr]">
        <section className="flex h-fit flex-col gap-3 rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-stone-700">已配置端点</h2>
            <button type="button" onClick={() => setForm(EMPTY_FORM)} className="text-xs text-amber-700 hover:underline">
              + 新增
            </button>
          </div>

          {providers.length === 0 ? (
            <p className="rounded-lg border border-dashed border-stone-300 px-3 py-6 text-center text-xs text-stone-400">
              还没有配置，右侧填写后保存
            </p>
          ) : (
            providers.map((item) => (
              <div
                key={item.id}
                className={`rounded-lg border p-3 transition ${
                  form.id === item.id ? 'border-amber-400 bg-amber-50/50' : 'border-stone-200'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <button type="button" onClick={() => setForm({
                    id: item.id,
                    name: item.name,
                    baseUrl: item.baseUrl,
                    model: item.model,
                    apiKey: '',
                    enabled: item.enabled
                  })} className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-sm text-stone-800">{item.name}</span>
                    <span className="block truncate text-xs text-stone-400">{item.model}</span>
                    <span className="block truncate text-[11px] text-stone-400">{item.baseUrl}</span>
                  </button>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] ${
                      item.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-500'
                    }`}
                  >
                    {item.enabled ? '启用中' : '已停用'}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-3 text-xs">
                  <span className="text-stone-400">{item.hasApiKey ? '已保存密钥' : '无密钥'}</span>
                  <button
                    type="button"
                    onClick={() => void removeProvider(item.id)}
                    className="ml-auto text-stone-400 hover:text-red-600"
                  >
                    删除
                  </button>
                </div>
              </div>
            ))
          )}
        </section>

        <form onSubmit={handleSubmit} className="flex h-fit flex-col gap-4 rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-stone-500">快速填充：</span>
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => setForm({ ...form, baseUrl: preset.baseUrl, model: preset.model })}
                className="rounded-full border border-stone-200 px-2.5 py-1 text-xs text-stone-600 transition hover:border-amber-400 hover:text-amber-700"
              >
                {preset.label}
              </button>
            ))}
          </div>

          <Labeled label="名称">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={INPUT_CLASS}
            />
          </Labeled>

          <Labeled label="接口地址（Base URL）" hint="填到 /v1 即可，也可直接填到 /chat/completions">
            <input
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              className={INPUT_CLASS}
            />
          </Labeled>

          <Labeled label="模型名">
            <input
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
              className={INPUT_CLASS}
            />
          </Labeled>

          <Labeled label="API Key" hint={form.id ? '留空表示不修改已保存的密钥' : undefined}>
            <input
              type="password"
              value={form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              placeholder="sk-..."
              className={INPUT_CLASS}
            />
          </Labeled>

          <label className="flex items-center gap-2 text-sm text-stone-600">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              className="h-4 w-4 rounded border-stone-300"
            />
            启用该端点（生成正文时使用第一个启用的端点）
          </label>

          <div className="flex items-center gap-3">
            <button type="submit" disabled={loading} className={BUTTON_PRIMARY}>
              保存
            </button>
            <button type="button" onClick={() => void handleTest()} disabled={loading} className={BUTTON_GHOST}>
              测试连接
            </button>
          </div>

          {testResult && (
            <p
              className={`rounded-lg px-3 py-2 text-sm ${
                testResult.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
              }`}
            >
              {testResult.ok ? '✓ ' : '✗ '}
              {testResult.message}
              {testResult.ok ? `（${testResult.latencyMs} ms）` : ''}
            </p>
          )}
        </form>
      </div>
    </div>
  )
}