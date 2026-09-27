import type { ProviderKind, ProviderTestResult } from '@shared/types'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useAppStore } from '../stores/appStore'
import { BUTTON_GHOST, BUTTON_PRIMARY, INPUT_CLASS, Labeled } from './ui'

interface ProviderForm {
  id?: number
  name: string
  baseUrl: string
  model: string
  apiKey: string
  enabled: boolean
  headersText: string
  rateLimitPerMin: number
  riskAccepted: boolean
}

const PRESETS = [
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { label: 'Kimi / Moonshot', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-plus' },
  { label: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.0-flash' },
  { label: 'Ollama 本地', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b' }
]

function defaultForm(kind: ProviderKind): ProviderForm {
  if (kind === 'custom-reverse-proxy') {
    return {
      name: '自定义反代端点',
      baseUrl: 'http://127.0.0.1:8000/v1',
      model: 'gpt-4o',
      apiKey: '',
      enabled: false,
      headersText: '',
      rateLimitPerMin: 6,
      riskAccepted: false
    }
  }
  return {
    name: 'OpenAI 兼容端点',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    apiKey: '',
    enabled: true,
    headersText: '',
    rateLimitPerMin: 0,
    riskAccepted: false
  }
}

/** 每行一个 `Name: Value` */
function parseHeaders(textValue: string): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const line of textValue.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const index = trimmed.indexOf(':')
    if (index <= 0) continue
    headers[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim()
  }
  return headers
}

function stringifyHeaders(headers: Record<string, string>): string {
  return Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n')
}

export default function ProviderPanel({ kind }: { kind: ProviderKind }) {
  const providers = useAppStore((s) => s.providers)
  const loading = useAppStore((s) => s.loading)
  const saveProvider = useAppStore((s) => s.saveProvider)
  const removeProvider = useAppStore((s) => s.removeProvider)
  const testProvider = useAppStore((s) => s.testProvider)

  const list = useMemo(() => providers.filter((item) => item.kind === kind), [providers, kind])
  const [form, setForm] = useState<ProviderForm>(() => defaultForm(kind))
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null)

  useEffect(() => {
    setForm(defaultForm(kind))
    setTestResult(null)
  }, [kind])

  const isProxy = kind === 'custom-reverse-proxy'
  const proxyRiskUnconfirmed = isProxy && !form.riskAccepted

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setTestResult(null)
    if (proxyRiskUnconfirmed) return
    await saveProvider({
      id: form.id,
      kind,
      name: form.name,
      baseUrl: form.baseUrl,
      model: form.model,
      apiKey: form.apiKey.trim() ? form.apiKey.trim() : undefined,
      enabled: form.enabled,
      headers: parseHeaders(form.headersText),
      rateLimitPerMin: form.rateLimitPerMin,
      riskAccepted: form.riskAccepted
    })
    setForm({ ...defaultForm(kind), name: form.name, baseUrl: form.baseUrl, model: form.model })
  }

  const handleTest = async () => {
    setTestResult(null)
    const result = await testProvider({
      id: form.id,
      kind,
      name: form.name,
      baseUrl: form.baseUrl,
      model: form.model,
      apiKey: form.apiKey.trim() ? form.apiKey.trim() : undefined,
      headers: parseHeaders(form.headersText)
    })
    setTestResult(result)
  }

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[320px_1fr]">
      <section className="flex h-fit flex-col gap-3 rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-stone-700">已配置端点</h2>
          <button type="button" onClick={() => setForm(defaultForm(kind))} className="text-xs text-amber-700 hover:underline">
            + 新增
          </button>
        </div>

        {list.length === 0 ? (
          <p className="rounded-lg border border-dashed border-stone-300 px-3 py-6 text-center text-xs text-stone-400">
            还没有配置，右侧填写后保存
          </p>
        ) : (
          list.map((item) => (
            <div
              key={item.id}
              className={`rounded-lg border p-3 transition ${
                form.id === item.id ? 'border-amber-400 bg-amber-50/50' : 'border-stone-200'
              }`}
            >
              <button
                type="button"
                onClick={() =>
                  setForm({
                    id: item.id,
                    name: item.name,
                    baseUrl: item.baseUrl,
                    model: item.model,
                    apiKey: '',
                    enabled: item.enabled,
                    headersText: stringifyHeaders(item.headers),
                    rateLimitPerMin: item.rateLimitPerMin,
                    riskAccepted: item.riskAccepted
                  })
                }
                className="w-full text-left"
              >
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-stone-800">{item.name}</span>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] ${
                      item.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-500'
                    }`}
                  >
                    {item.enabled ? '启用中' : '已停用'}
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-xs text-stone-400">{item.model}</span>
                <span className="block truncate text-[11px] text-stone-400">{item.baseUrl}</span>
              </button>
              <div className="mt-2 flex items-center gap-3 text-xs">
                <span className="text-stone-400">
                  {item.hasApiKey ? '已保存密钥' : '无密钥'}
                  {item.rateLimitPerMin > 0 ? ` · 限速 ${item.rateLimitPerMin}/分` : ''}
                </span>
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
        {!isProxy && (
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
        )}

        {isProxy && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
            <p className="font-medium">风险提示（请务必阅读）</p>
            <p className="mt-1">
              Inkwell 只提供「自定义 OpenAI 兼容端点」这一通用能力，不内置也不分发任何针对特定厂商的绕过实现。
              社区常见的网页端反代通常违反厂商服务条款，可能导致账号封禁、限流或随时失效，风险由你自行承担。
              Inkwell 不对因此产生的任何后果负责，也不把此路径作为推荐用法。
            </p>
            <label className="mt-2 flex items-center gap-2 text-amber-900">
              <input
                type="checkbox"
                checked={form.riskAccepted}
                onChange={(e) => setForm({ ...form, riskAccepted: e.target.checked })}
                className="h-4 w-4 rounded border-amber-400"
              />
              我已阅读并确认上述风险，自愿使用该端点
            </label>
          </div>
        )}

        <Labeled label="名称">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={INPUT_CLASS} />
        </Labeled>

        <Labeled label="接口地址（Base URL）" hint="填到 /v1 即可，也可直接填到 /chat/completions">
          <input
            value={form.baseUrl}
            onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
            className={INPUT_CLASS}
          />
        </Labeled>

        <Labeled label="模型名">
          <input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} className={INPUT_CLASS} />
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

        {isProxy && (
          <>
            <Labeled label="自定义请求头" hint="每行一个 Name: Value">
              <textarea
                rows={3}
                value={form.headersText}
                onChange={(e) => setForm({ ...form, headersText: e.target.value })}
                placeholder={'Referer: https://example.com\nX-Custom: value'}
                className={`${INPUT_CLASS} resize-none font-mono text-xs`}
              />
            </Labeled>

            <Labeled label="限速（每分钟请求数）" hint="0 表示不限速；反代建议 3-10">
              <input
                type="number"
                min={0}
                max={6000}
                value={form.rateLimitPerMin}
                onChange={(e) => setForm({ ...form, rateLimitPerMin: Number(e.target.value) || 0 })}
                className={INPUT_CLASS}
              />
            </Labeled>
          </>
        )}

        <label className="flex items-center gap-2 text-sm text-stone-600">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            className="h-4 w-4 rounded border-stone-300"
          />
          启用该端点
        </label>

        <div className="flex items-center gap-3">
          <button type="submit" disabled={loading || proxyRiskUnconfirmed} className={BUTTON_PRIMARY}>
            保存
          </button>
          <button type="button" onClick={() => void handleTest()} disabled={loading} className={BUTTON_GHOST}>
            测试连接
          </button>
          {proxyRiskUnconfirmed && <span className="text-xs text-amber-700">需先确认风险提示</span>}
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
  )
}