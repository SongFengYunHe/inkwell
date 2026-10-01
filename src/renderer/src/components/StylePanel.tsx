import { useEffect, useState } from 'react'
import type { StyleProfile } from '@shared/types'
import { BUTTON_GHOST, BUTTON_PRIMARY, INPUT_CLASS } from './ui'

const FIELDS: Array<{ key: keyof StyleProfile; label: string }> = [
  { key: 'summary', label: '总体' },
  { key: 'tone', label: '语气基调' },
  { key: 'pov', label: '叙事视角' },
  { key: 'sentence', label: '句式节奏' },
  { key: 'diction', label: '用词偏好' },
  { key: 'dialogue', label: '对话特征' },
  { key: 'imagery', label: '意象与比喻' },
  { key: 'pacing', label: '段落节奏' }
]

/**
 * A2 文风仿写画像：从参考文本（或本书已有正文）提炼可执行的文风清单，
 * 生成后会作为「必须遵守」注入每一章的写作提示词。
 */
export default function StylePanel({ projectId }: { projectId: number }) {
  const [profile, setProfile] = useState<StyleProfile | null>(null)
  const [sample, setSample] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.inkwell.style.get(projectId).then(setProfile)
  }, [projectId])

  const run = async (task: () => Promise<StyleProfile | void>): Promise<void> => {
    setBusy(true)
    setMessage('正在分析文风（调用一次模型）…')
    try {
      const next = await task()
      if (next) setProfile(next)
      setMessage('文风画像已更新，将注入后续每一章的写作提示词')
    } catch (err) {
      setMessage('失败：' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-stone-700">文风画像（仿写）</h3>
        {profile && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await window.inkwell.style.clear(projectId)
                setProfile(null)
              })
            }
            className="text-xs text-stone-400 hover:text-red-600"
          >
            清除画像
          </button>
        )}
      </div>

      {profile ? (
        <div className="rounded-lg border border-stone-200 bg-stone-50/60 p-3">
          <dl className="space-y-1 text-xs">
            {FIELDS.map((field) => {
              const value = String(profile[field.key] ?? '')
              if (!value.trim()) return null
              return (
                <div key={field.key} className="flex gap-2">
                  <dt className="w-20 shrink-0 text-stone-400">{field.label}</dt>
                  <dd className="min-w-0 text-stone-700">{value}</dd>
                </div>
              )
            })}
            {profile.keywords.length > 0 && (
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-stone-400">标志性用词</dt>
                <dd className="text-stone-700">{profile.keywords.join('、')}</dd>
              </div>
            )}
            {profile.taboos.length > 0 && (
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-stone-400">必须避免</dt>
                <dd className="text-stone-700">{profile.taboos.join('；')}</dd>
              </div>
            )}
            {profile.samples.length > 0 && (
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-stone-400">代表句</dt>
                <dd className="text-stone-700">{profile.samples.join(' ／ ')}</dd>
              </div>
            )}
          </dl>
          <p className="mt-2 text-[11px] text-stone-400">来源：{profile.source || '—'}</p>
        </div>
      ) : (
        <p className="text-xs text-stone-400">尚未生成文风画像。粘贴一段你想要的文风样本，或直接用本书已有正文生成。</p>
      )}

      <textarea
        value={sample}
        onChange={(e) => setSample(e.target.value)}
        rows={5}
        placeholder="可选：粘贴一段参考文本（别人的作品、你自己满意的旧稿都行），用来提炼文风"
        className={`${INPUT_CLASS} resize-y text-xs`}
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy || !sample.trim()}
          onClick={() => void run(() => window.inkwell.style.generate({ projectId, sample }))}
          className={BUTTON_PRIMARY}
        >
          用这段文本生成画像
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(() => window.inkwell.style.generate({ projectId, useExisting: true }))}
          className={BUTTON_GHOST}
        >
          从本书已有正文生成
        </button>
      </div>
      {message && <p className="text-xs text-stone-500">{message}</p>}
    </section>
  )
}
