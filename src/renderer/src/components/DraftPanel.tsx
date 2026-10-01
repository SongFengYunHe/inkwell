import type { DraftRevision, GenerationMode } from '@shared/types'
import StyleAuditPanel from './StyleAuditPanel'
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
  const reloadDrafts = useAppStore((s) => s.reloadDrafts)
  const auditCurrent = useAppStore((s) => s.auditCurrent)
  const fixCurrent = useAppStore((s) => s.fixCurrent)
  const fixResult = useAppStore((s) => s.fixResult)
  const clearFixResult = useAppStore((s) => s.clearFixResult)

  const toggleFocusMode = useAppStore((s) => s.toggleFocusMode)
  /** 专注模式由 store 驱动：Workspace 不再切换到另一棵树，避免正文面板被卸载重建 */
  const focusMode = useAppStore((s) => s.focusMode)

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
  /** R10：列表里只有摘要，「当前版本」也是摘要 */
  const current = versions.find((item) => item.version === selectedVersion) ?? latest

  /**
   * R4 + R10：
   *   - 正文按章按需从主进程拉取（currentDraft）；
   *   - 未保存的编辑按「章:版本」记在 store 的 draftBuffers 里，
   *     因此切章 / 切版本 / 切专注模式都不会再把改动丢掉。
   */
  const draftBuffers = useAppStore((s) => s.draftBuffers)
  const currentDraft = useAppStore((s) => s.currentDraft)
  const loadDraftContent = useAppStore((s) => s.loadDraftContent)
  const setDraftBuffer = useAppStore((s) => s.setDraftBuffer)
  const bufferKey = `${currentChapterNo}:${current?.version ?? 0}`
  const serverContent =
    currentDraft && currentDraft.chapterNo === currentChapterNo && currentDraft.version === (current?.version ?? -1)
      ? currentDraft.content
      : ''
  const content = draftBuffers[bufferKey] ?? serverContent
  const setContent = (value: string): void => setDraftBuffer(bufferKey, value)
  /** A5：本章修订历史（每次一键修复 / 润色 / 重写都会记一条） */
  const [revisions, setRevisions] = useState<DraftRevision[]>([])

  useEffect(() => {
    if (activeProjectId === null) {
      setRevisions([])
      return
    }
    void window.inkwell.revision.list(activeProjectId, currentChapterNo).then(setRevisions)
  }, [activeProjectId, currentChapterNo, current?.id, fixResult])

  /** M10：回退到某条修订之前（落新版本，不覆盖历史） */
  const revertRevision = async (input: {
    projectId: number
    chapterNo: number
    revisionId: number
  }): Promise<void> => {
    if (!window.confirm('回退会用该修订「修改前」的正文落一个新版本（历史版本都还在）。继续？')) return
    try {
      await window.inkwell.revision.revert(input)
      await reloadDrafts()
      if (activeProjectId !== null) {
        setRevisions(await window.inkwell.revision.list(activeProjectId, input.chapterNo))
      }
    } catch (err) {
      window.alert('回退失败：' + (err instanceof Error ? err.message : String(err)))
    }
  }

  useEffect(() => {
    setSelectedVersion(null)
  }, [currentChapterNo, activeProjectId])
  useEffect(() => {
    if (activeProjectId === null || current === null) return
    if (
      currentDraft &&
      currentDraft.chapterNo === currentChapterNo &&
      currentDraft.version === current.version
    ) {
      return
    }
    void loadDraftContent(activeProjectId, currentChapterNo, current.version)
  }, [activeProjectId, currentChapterNo, current?.version, currentDraft, current, loadDraftContent])

  const streamRef = useRef<HTMLDivElement>(null)
  const isStreamingHere = generating !== null && generating.chapterNo === currentChapterNo

  useEffect(() => {
    if (isStreamingHere) streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight })
  }, [streamText, isStreamingHere])

  const hasProvider = providers.some((item) => item.enabled)
  const dirty = current !== null && content !== serverContent

  const runMode = (mode: GenerationMode): void => {
    void generate(mode)
  }

  /** 保存当前编辑内容（专注模式与常规模式共用） */
  const saveContent = (): void => {
    if (!current) return
    void saveDraft({
      id: current.id,
      projectId: current.projectId,
      chapterNo: current.chapterNo,
      version: current.version,
      content
    })
  }

  /** R10：版本列表只有摘要，禁用态改用 wordCount 判断「有没有正文」 */
  const latestHasContent = (latest?.wordCount ?? 0) > 0

  // 专注模式：隐藏全部工具栏与提示，只留正文与保存入口（计划书 §8.3）
  if (focusMode) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="truncate text-xs text-stone-400">
            第 {currentChapterNo} 章 · {brief?.title || '（未命名）'}
            {dirty && <span className="ml-2 text-amber-600">有未保存修改</span>}
          </span>
          <div className="flex items-center gap-2">
            {current && !isStreamingHere && (
              <button
                type="button"
                disabled={!dirty || loading}
                onClick={saveContent}
                className={`${BUTTON_PRIMARY} px-3 py-1.5 text-xs`}
              >
                保存修改
              </button>
            )}
            <button
              type="button"
              onClick={() => toggleFocusMode()}
              className={`${BUTTON_GHOST} px-3 py-1.5 text-xs`}
            >
              退出专注
            </button>
          </div>
        </div>
        {isStreamingHere ? (
          <div
            ref={streamRef}
            className="reader-body flex-1 overflow-y-auto rounded-xl border border-stone-200 bg-white p-8 text-[16px] leading-9 whitespace-pre-wrap text-stone-800 shadow-sm"
          >
            {streamText || '等待模型返回…'}
          </div>
        ) : current ? (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
            className="reader-body flex-1 resize-none rounded-xl border border-stone-200 bg-white p-8 text-[16px] leading-9 text-stone-800 shadow-sm outline-none"
          />
        ) : (
          <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-stone-300 text-sm text-stone-400">
            本章还没有正文
          </div>
        )}
        <p className="pt-2 text-center text-[11px] text-stone-400">
          {countWords(isStreamingHere ? streamText : content)} 字 · 专注模式
        </p>
      </div>
    )
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
          disabled={!latestHasContent || generating !== null || !hasProvider}
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
          disabled={!latestHasContent || generating !== null || !hasProvider}
          onClick={() => runMode('polish')}
          className={BUTTON_GHOST}
        >
          {MODE_LABEL.polish}
        </button>
        <button
          type="button"
          disabled={!latestHasContent || generating !== null}
          onClick={() => void auditCurrent()}
          className={BUTTON_GHOST}
        >
          审稿
        </button>
        <button
          type="button"
          disabled={!latestHasContent || generating !== null}
          onClick={() => void fixCurrent(true)}
          className={BUTTON_GHOST}
        >
          一键修复
        </button>
        <button type="button" onClick={() => toggleFocusMode()} className={BUTTON_GHOST}>
          专注
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
                onChange={(e) => {
                  if (dirty && !window.confirm('当前有未保存的修改，切换版本会丢弃它们。继续？')) return
                  setSelectedVersion(Number(e.target.value))
                }}
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
            onClick={saveContent}
            className={BUTTON_PRIMARY}
          >
            保存修改
          </button>
          <button
            type="button"
            onClick={() => void removeDraft(current.id)}
            className={`${BUTTON_GHOST} hover:bg-red-50 hover:text-red-600`}
          >
            移入回收站
          </button>
          <span className="text-xs text-stone-400">
            v{current.version} · 来源 {current.source} · {dirty ? '有未保存修改' : '已保存'}
          </span>
        </div>
      )}

      {current && !isStreamingHere && (
        <StyleAuditPanel
          projectId={current.projectId}
          chapterNo={currentChapterNo}
          hasContent={latestHasContent}
        />
      )}

      {revisions.length > 0 && (
        <details className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-500">
          <summary className="cursor-pointer select-none">修订历史（{revisions.length} 条）</summary>
          <ul className="mt-2 space-y-2">
            {revisions.slice(0, 8).map((item) => (
              <li key={item.id} className="rounded border border-stone-200 bg-white px-2 py-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="shrink-0 text-stone-400">#{item.idx}</span>
                  <span className="shrink-0 text-stone-500">{item.type}</span>
                  <span className="min-w-0 flex-1 truncate text-stone-600">{item.userPrompt || '—'}</span>
                  <span className="shrink-0 text-stone-400">{item.wordCount} 字</span>
                  <span className="shrink-0 text-stone-400">{new Date(item.createdAt).toLocaleString('zh-CN')}</span>
                  {item.reverted ? (
                    <span className="shrink-0 rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-500">已回退</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void revertRevision({ projectId: item.projectId, chapterNo: item.chapterNo, revisionId: item.id })}
                      className="shrink-0 text-stone-400 hover:text-amber-700"
                    >
                      回退到修改前
                    </button>
                  )}
                </div>
                {(item.beforeExcerpt || item.afterExcerpt) && (
                  <details className="mt-1">
                    <summary className="cursor-pointer select-none text-stone-400">改前 / 改后</summary>
                    <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div className="rounded bg-red-50/60 p-2 text-[11px] whitespace-pre-wrap text-stone-600">
                        <p className="mb-1 text-[10px] text-red-600">改前</p>
                        {item.beforeExcerpt || '（无）'}
                      </div>
                      <div className="rounded bg-emerald-50/60 p-2 text-[11px] whitespace-pre-wrap text-stone-600">
                        <p className="mb-1 text-[10px] text-emerald-700">改后</p>
                        {item.afterExcerpt || '（无）'}
                      </div>
                    </div>
                    {item.diff.length > 0 && (
                      <div className="mt-1 max-h-40 overflow-y-auto rounded bg-stone-50 p-2 text-[11px]">
                        {item.diff.slice(0, 200).map((line, index) => (
                          <p
                            key={index}
                            className={
                              line.type === 'add'
                                ? 'text-emerald-700'
                                : line.type === 'del'
                                  ? 'text-red-600 line-through'
                                  : 'text-stone-500'
                            }
                          >
                            {line.type === 'add' ? '＋ ' : line.type === 'del' ? '－ ' : '　 '}
                            {line.text.slice(0, 120)}
                          </p>
                        ))}
                      </div>
                    )}
                  </details>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}