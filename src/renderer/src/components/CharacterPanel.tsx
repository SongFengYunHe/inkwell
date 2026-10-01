import { useEffect, useState } from 'react'
import type { CharacterCard, CharacterSaveInput } from '@shared/types'
import { BUTTON_GHOST, BUTTON_PRIMARY, INPUT_CLASS } from './ui'

const EMPTY: CharacterSaveInput = { projectId: 0, name: '' }

/**
 * R12：角色卡编辑。
 * 角色矩阵此前只能从正文重建（提取模型说了算），用户无法手工修正设定；
 * 这里允许直接改「基础设定 + 当前状态」，改完立刻进入写作上下文。
 */
export default function CharacterPanel({ projectId }: { projectId: number }) {
  const [characters, setCharacters] = useState<CharacterCard[]>([])
  const [editing, setEditing] = useState<CharacterSaveInput | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.inkwell.character.list(projectId).then(setCharacters)
  }, [projectId])

  const run = async (task: () => Promise<CharacterCard[]>): Promise<void> => {
    setBusy(true)
    setMessage('')
    try {
      setCharacters(await task())
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const startNew = (): void => {
    setEditing({ ...EMPTY, projectId })
    setMessage('')
  }

  const startEdit = (card: CharacterCard): void => {
    setEditing({
      id: card.id,
      projectId,
      name: card.name,
      role: card.role,
      appearance: card.appearance,
      personality: card.personality,
      background: card.background,
      abilities: card.abilities,
      motivation: card.motivation,
      relationships: card.relationships,
      csLocation: card.csLocation,
      csPower: card.csPower,
      csState: card.csState,
      csItems: card.csItems,
      csRecent: card.csRecent
    })
    setMessage('')
  }

  const field = (label: string, key: keyof CharacterSaveInput): React.ReactElement => {
    const value = String(editing?.[key] ?? '')
    return (
      <label key={String(key)} className='flex flex-col gap-1'>
        <span className='text-[11px] text-stone-500'>{label}</span>
        <input
          value={value}
          onChange={(e) => setEditing((prev) => (prev ? { ...prev, [key]: e.target.value } : prev))}
          className={INPUT_CLASS + ' text-xs'}
        />
      </label>
    )
  }

  return (
    <section className='rounded-xl border border-stone-200 bg-white p-4 shadow-sm'>
      <header className='mb-2 flex items-center gap-2'>
        <h3 className='text-sm font-medium text-stone-800'>角色卡（可手工修正）</h3>
        <span className='text-xs text-stone-400'>共 {characters.length} 个</span>
        <button type='button' onClick={startNew} disabled={busy} className={BUTTON_GHOST + ' ml-auto px-2 py-1 text-xs'}>
          ＋ 新建角色
        </button>
      </header>

      {characters.length === 0 ? (
        <p className='text-xs text-stone-400'>还没有角色卡：写完一章并回写记忆后会自动生成，也可以点「新建角色」手工加。</p>
      ) : (
        <ul className='divide-y divide-stone-100'>
          {characters.map((card) => (
            <li key={card.id} className='flex flex-wrap items-center gap-2 py-2 text-xs'>
              <span className='font-medium text-stone-700'>{card.name}</span>
              {card.role && <span className='rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-500'>{card.role}</span>}
              <span className='min-w-0 flex-1 truncate text-stone-500'>
                {[card.csState, card.csLocation, card.csPower, card.csRecent].filter(Boolean).join(' · ') || '（暂无状态）'}
              </span>
              <button type='button' onClick={() => startEdit(card)} disabled={busy} className='text-stone-400 hover:text-stone-700'>
                编辑
              </button>
              <button
                type='button'
                onClick={() => void run(() => window.inkwell.character.remove(card.id))}
                disabled={busy}
                className='text-stone-400 hover:text-red-600'
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <div className='mt-3 flex flex-col gap-3 rounded-lg border border-stone-200 bg-stone-50 p-3'>
          <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
            {field('角色名（必填）', 'name')}
            {field('身份 / 定位', 'role')}
            {field('外貌', 'appearance')}
            {field('性格', 'personality')}
            {field('能力 / 战力', 'abilities')}
            {field('动机', 'motivation')}
            {field('当前所在地', 'csLocation')}
            {field('当前战力', 'csPower')}
            {field('当前状态', 'csState')}
            {field('最近行为', 'csRecent')}
          </div>
          <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
            <label className='flex flex-col gap-1'>
              <span className='text-[11px] text-stone-500'>背景</span>
              <textarea
                rows={2}
                value={editing.background ?? ''}
                onChange={(e) => setEditing({ ...editing, background: e.target.value })}
                className={INPUT_CLASS + ' resize-y text-xs'}
              />
            </label>
            <label className='flex flex-col gap-1'>
              <span className='text-[11px] text-stone-500'>关系</span>
              <textarea
                rows={2}
                value={editing.relationships ?? ''}
                onChange={(e) => setEditing({ ...editing, relationships: e.target.value })}
                className={INPUT_CLASS + ' resize-y text-xs'}
              />
            </label>
          </div>
          <div className='flex items-center gap-3'>
            <button
              type='button'
              disabled={busy || !editing.name.trim()}
              onClick={() =>
                void run(async () => {
                  const next = await window.inkwell.character.save(editing)
                  setEditing(null)
                  return next
                })
              }
              className={BUTTON_PRIMARY + ' px-3 py-1.5 text-xs'}
            >
              保存角色
            </button>
            <button type='button' onClick={() => setEditing(null)} className={BUTTON_GHOST + ' px-3 py-1.5 text-xs'}>
              取消
            </button>
          </div>
        </div>
      )}

      {message && <p className='mt-2 text-xs text-red-600'>{message}</p>}
    </section>
  )
}
