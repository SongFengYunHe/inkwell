import type { GenerationMode } from '@shared/types'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../stores/appStore'
import { BUTTON_GHOST, BUTTON_PRIMARY } from './ui'

const MODE_LABEL: Record<GenerationMode, string> = {
  draft: '生成正文',
  continue: '续写',
  rewrite: '重写',
  polish: '润色'
}

function countWords(text: string): number {
  return text.replace(/\s/g, '').length
}

export default function DraftPanel() {
  const activeProjectId = useAppStore((s) => s.activeProjectId)
  const briefs = useAppStore((s) => s.briefs)
  const drafts = useAppStore((s) => s.drafts)
  const providers = useAppStore((s) => s.providers)
  const currentChapterNo = useAppStore((s) => s.currentChapterNo)
  const generating = useAppStore((s) => s.generating)
  const streamText = useAppStore((s) => s.streamText)
  const notice = useAppStore((s) => s.notice)
  const loading = useAppStore((s) => s.loading)
  const clearNotice = useAppStore((s) => s.clearNotice)
  const setView = useAppStore((s) => s.setView)
  const generate = useAppStore((s) => s.generate)
  const abortGeneration = useAppStore((s) => s.abortGeneration)
  const saveDraft = useAppStore((s) => s.saveDraft)
  const removeDraft = useAppStore((s) => s.removeDraft)
  const auditCurrent = useAppStore((s) => s.auditCurrent)
  const fixCurrent = useAppStore((s) => s.fixCurrent)
  const fixResult = useAppStore((s) => s.fixResult)
  const clearFixResult = useAppStore((s) => s.clearFixResult)

  const brief = briefs.find((item) => item.chapterNo === currentChapterNo) ?? null
  const versions = useMemo(
    () =>
      drafts
        .filter((item) => item.chapterNo === currentChapterNo)
        .sort((a, b) => b.version - a.version),
    [drafts, currentChapterNo]
  )
  const latest = versions[0] ?? null

  const [selectedVersion, setSelectedVersion] = useState<number | null>(null)
  const current = versions.find((item) => item.version === selectedVersion) ?? latest

  const [content, setContent] = useState('')
  useEffect(() => {
    setSelectedVersion(null)
  }, [currentChapterNo, activeProjectId])
  useEffect(() => {
    setContent(current?.content ?? '')
  }, [current?.id, current?.content])

  const streamRef = useRef<HTMLDivElement>(null)
  const isStreamingHere = generating !== null && generating.chapterNo === currentChapterNo

  useEffect(() => {
    if (isStreamingHere) streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight })
  }, [streamText, isStreamingHere])

  const hasProvider = providers.some((item) => item.enabled)
  const dirty = current !== null && content !== current.content

  const runMode = (mode: GenerationMode): void => {
    void generate(mode)
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-sm text-stone-500">
          第 {currentChapterNo} 章 · {brief?.title || '（未命名）'}
        </span>

        <button
          type="button"
          disabled={!brief || generating !== null || !hasProvider}
          onClick={() => runMode('draft')}
          className={BUTTON_PRIMARY}
        >
          {MODE_LABEL.draft}
        </button>
        <button
          type="button"
          disabled={!latest?.content || generating !== null || !hasProvider}
          onClick={() => runMode('continue')}
          className={BUTTON_GHOST}
        >
          {MODE_LABEL.continue}
        </button>
        <button
          type="button"
          disabled={(latest === null && brief === null) || generating !== null || !hasProvider}
          onClick={() => runMode('rewrite')}
          className={BUTTON_GHOST}
        >
          {MODE_LABEL.rewrite}
        </button>
        <button
          type="button"
          disabled={!latest?.content || generating !== null || !hasProvider}
          onClick={() => runMode('polish')}
          className={BUTTON_GHOST}
        >
          {MODE_LABEL.polish}
        </button>
        <button
          type="button"
          disabled={!latest?.content || generating !== null}
          onClick={() => void auditCurrent()}
          className={BUTTON_GHOST}
        >
          审稿
        </button>
        <button
          type="button"
          disabled={!latest?.content || generating !== null}
          onClick={() => void fixCurrent(true)}
          className={BUTTON_GHOST}
        >
          一键修复
        </button>

        {generating !== null && (
          <button
            type="button"
            onClick={() => void abortGeneration()}
            className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600 transition hover:bg-red-50"
          >
            停止
          </button>
        )}

        <div className="ml-auto flex items-center gap-3 text-xs text-stone-400">
          {versions.length > 1 && (
            <label className="flex items-center gap-1">
              版本
              <select
                value={current?.version ?? ''}
                onChange={(e) => setSelectedVersion(Number(e.target.value))}
                className="rounded border border-stone-200 bg-white px-1.5 py-1 text-xs"
              >
                {versions.map((item) => (
                  <option key={item.id} value={item.version}>
                    v{item.version} · {item.source}
                  </option>
                ))}
              </select>
            </label>
          )}
          <span>{countWords(isStreamingHere ? streamText : content)} 字</span>
        </div>
      </div>

      {!hasProvider && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          尚未启用任何模型接入，无法生成正文。
          <button type="button" onClick={() => setView('settings')} className="ml-2 underline">
            去设置
          </button>
        </div>
      )}

      {(notice || generating !== null) && (
        <div className="flex items-center gap-3 rounded-lg border border-stone-200 bg-stone-50 px-4 py-2 text-sm text-stone-600">
          <span>{generating !== null ? `正在${MODE_LABEL[generating.mode]}…` : notice}</span>
          {generating === null && notice && (
            <button type="button" onClick={clearNotice} className="ml-auto text-xs text-stone-400 hover:text-stone-600">
              关闭
            </button>
          )}
        </div>
      )}

      {fixResult && !fixResult.noop && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-800">
          <span className="font-medium">一键修复结果</span>
          <span>规则变更 {fixResult.styleChanges.length} 条</span>
          {fixResult.modelUsed && <span>· 含模型定点修复</span>}
          {fixResult.auditBefore && fixResult.auditAfter && (
            <span>
              · 评分 {fixResult.auditBefore.score} → {fixResult.auditAfter.score}
            </span>
          )}
          {fixResult.styleChanges.length > 0 && (
            <span className="text-emerald-700">
              · {[...new Set(fixResult.styleChanges.map((change) => change.rule))].join('、')}
            </span>
          )}
          <button type="button" onClick={clearFixResult} className="ml-auto text-emerald-600 hover:underline">
            关闭
          </button>
        </div>
      )}

      {isStreamingHere ? (
        <div
          ref={streamRef}
          className="reader-body flex-1 overflow-y-auto rounded-xl border border-stone-200 bg-white p-6 text-[15px] whitespace-pre-wrap text-stone-800 shadow-sm"
        >
          {streamText || '等待模型返回…'}
          <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-amber-500 align-middle" />
        </div>
      ) : current ? (
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
          placeholder="左侧点「生成正文」开始写作，也可以在这里手动输入。"
          className="reader-body flex-1 resize-none rounded-xl border border-stone-200 bg-white p-6 text-[15px] text-stone-800 shadow-sm outline-none focus:border-amber-400"
        />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-stone-300 text-stone-400">
          <p className="text-sm">本章还没有正文</p>
          <p className="text-xs">确认细纲已填写，然后点左上「生成正文」</p>
        </div>
      )}

      {current && !isStreamingHere && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={!dirty || loading}
            onClick={() =>
              void saveDraft({
                id: current.id,
                projectId: current.projectId,
                chapterNo: current.chapterNo,
                version: current.version,
                content
              })
            }
            className={BUTTON_PRIMARY}
          >
            保存修改
          </button>
          <button
            type="button"
            onClick={() => void removeDraft(current.id)}
            className={`${BUTTON_GHOST} hover:bg-red-50 hover:text-red-600`}
          >
            删除本版本
          </button>
          <span className="text-xs text-stone-400">
            v{current.version} · 来源 {current.source} · {dirty ? '有未保存修改' : '已保存'}
          </span>
        </div>
      )}
    </div>
  )
}