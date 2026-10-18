/**
 * 轻量 class 合并：过滤假值后以空格拼接。
 * 不引入 clsx / tailwind-merge，避免为一个小工具增加依赖与体积。
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
