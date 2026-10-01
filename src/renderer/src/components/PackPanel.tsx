import { useState } from 'react'
import { GENRE_TEMPLATES, loadImportedGenres, saveImportedGenres } from '../data/genres'
import { BUTTON_GHOST, BUTTON_PRIMARY, INPUT_CLASS, Labeled } from './ui'

/**
 * M11：题材包导入导出。
 * 一个包 = 题材模板 + 提示词覆写 + 校验必填字段，可分享给别的作者。
 */
export default function PackPanel() {
  const [name, setName] = useState('我的题材包')
  const [description, setDescription] = useState('')
  const [includePrompts, setIncludePrompts] = useState(true)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const importedCount = loadImportedGenres().length

  const doExport = async (): Promise<void> => {
    setBusy(true)
    setMessage('')
    try {
      const result = await window.inkwell.pack.export({
        name: name.trim(),
        description: description.trim(),
        includePrompts,
        genres: GENRE_TEMPLATES
      })
      setMessage(result ? '已导出到 ' + result.path : '已取消')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const doImport = async (): Promise<void> => {
    setBusy(true)
    setMessage('')
    try {
      const result = await window.inkwell.pack.import()
      if (!result) {
        setMessage('已取消')
        return
      }
      const added = saveImportedGenres(result.genres)
      setMessage(
        '已导入「' + result.name + '」：题材 +' + added +
          '（包内 ' + result.genresAdded + '）、提示词覆写 ' + result.promptsApplied +
          ' 条、校验必填字段 ' + result.requiredFields
      )
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className='mx-auto max-w-2xl space-y-5'>
      <section className='rounded-xl border border-stone-200 bg-white p-5 shadow-sm'>
        <h2 className='text-sm font-medium text-stone-700'>导出题材包</h2>
        <p className='mt-1 text-xs text-stone-400'>
          把「题材模板 + 提示词覆写 + 校验必填字段」打包成一个 json，别人导入即可复用你调好的写法。
        </p>
        <div className='mt-4 space-y-3'>
          <Labeled label='包名'>
            <input value={name} onChange={(e) => setName(e.target.value)} className={INPUT_CLASS} />
          </Labeled>
          <Labeled label='说明' hint='可选'>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={INPUT_CLASS}
              placeholder='例如：克制冷峻的仙侠开局写法'
            />
          </Labeled>
          <label className='flex items-center gap-2 text-xs text-stone-600'>
            <input
              type='checkbox'
              checked={includePrompts}
              onChange={(e) => setIncludePrompts(e.target.checked)}
              className='accent-amber-500'
            />
            {includePrompts ? '一并打包当前提示词覆写' : '只打包题材与校验模板'}
          </label>
        </div>
        <button
          type='button'
          onClick={() => void doExport()}
          disabled={busy || !name.trim()}
          className={BUTTON_PRIMARY + ' mt-4'}
        >
          导出…
        </button>
      </section>

      <section className='rounded-xl border border-stone-200 bg-white p-5 shadow-sm'>
        <h2 className='text-sm font-medium text-stone-700'>导入题材包</h2>
        <p className='mt-1 text-xs text-stone-400'>
          导入的题材进入「新建项目」的题材下拉；提示词覆写直接生效；同名题材以内置模板为准。当前已导入 {importedCount} 个题材。
        </p>
        <button type='button' onClick={() => void doImport()} disabled={busy} className={BUTTON_GHOST + ' mt-4'}>
          选择文件并导入…
        </button>
      </section>

      {message && <p className='text-xs text-stone-500'>{message}</p>}
    </div>
  )
}
