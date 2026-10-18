import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * M14-A：通用固定行高虚拟滚动。
 *
 * 原先只有章节导航（ChapterNav）自带一套窗口化实现，长列表（书架 / 审计报告 /
 * 检索结果）在几百项时仍会一次性铺满 DOM。这里抽成可复用 hook：组件把行容器
 * 交给 `scrollRef`，按 `range` 只渲染可见窗口内的行，其余用占位高度撑起滚动条。
 *
 * 仅支持**固定行高**：可变行高需要测量缓存与滚动锚定，收益与风险都不划算
 * （见 README §M14，可变高度列表在各自容器内按需再议）。
 */
export interface VirtualWindow {
  start: number
  end: number
}

export interface UseVirtualListOptions {
  /** 总项数 */
  count: number
  /** 单行高度（px），必须与实际渲染行一致，否则窗口会错位 */
  rowHeight: number
  /** 视口外额外渲染的行数，滚动更平滑 */
  overscan?: number
  /** 低于该数量不做虚拟化（小列表全量渲染更简单） */
  threshold?: number
}

export interface UseVirtualListResult {
  /** 挂到滚动容器（overflow-y-auto 的那个元素） */
  scrollRef: (el: HTMLElement | null) => void
  onScroll: (event: { currentTarget: HTMLElement }) => void
  /** 是否启用了虚拟化（未启用时组件应走全量渲染） */
  virtual: boolean
  /** 可见窗口 [start, end) */
  range: VirtualWindow
  /** 占位总高度，用于撑起滚动条 */
  totalHeight: number
}

export function useVirtualList({ count, rowHeight, overscan = 4, threshold = 200 }: UseVirtualListOptions): UseVirtualListResult {
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(0)
  const elementRef = useRef<HTMLElement | null>(null)

  // 回调式 ref：同时支持普通 div 与动态出现的容器
  const scrollRef = useCallback((el: HTMLElement | null) => {
    elementRef.current = el
    if (el) setViewport(el.clientHeight)
  }, [])

  const onScroll = useCallback((event: { currentTarget: HTMLElement }) => {
    setScrollTop(event.currentTarget.scrollTop)
  }, [])

  // 容器尺寸变化（窗口缩放 / 面板折叠）时重算可见行数
  useEffect(() => {
    const el = elementRef.current
    if (!el) return
    const update = (): void => setViewport(el.clientHeight)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [count])

  const virtual = count > threshold

  const range = useMemo<VirtualWindow>(() => {
    if (!virtual || viewport === 0) return { start: 0, end: count }
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
    const end = Math.min(count, Math.ceil((scrollTop + viewport) / rowHeight) + overscan)
    return { start, end }
  }, [virtual, viewport, scrollTop, rowHeight, overscan, count])

  return { scrollRef, onScroll, virtual, range, totalHeight: count * rowHeight }
}
