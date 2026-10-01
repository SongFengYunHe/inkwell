/**
 * 题材模板（M5 扩充，计划书 §10「题材模板扩充」）。
 * 每个题材给出默认章数与文风建议，新建项目时自动带出，降低配置门槛。
 */

export interface GenreTemplate {
  name: string
  /** 建议预计章数 */
  chapters: number
  /** 文风 / 写法建议（会作为文风提示写入项目） */
  style: string
}

/** M11：题材包导入的题材存在本地（与内置模板合并，不污染内置列表） */
const IMPORTED_KEY = 'inkwell.genres.imported'

export function loadImportedGenres(): GenreTemplate[] {
  try {
    const raw = localStorage.getItem(IMPORTED_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is GenreTemplate =>
        Boolean(item) &&
        typeof (item as GenreTemplate).name === 'string' &&
        typeof (item as GenreTemplate).chapters === 'number'
      )
      .map((item) => ({ name: item.name, chapters: item.chapters, style: String(item.style ?? '') }))
  } catch {
    return []
  }
}

/** 合并内置 + 导入的题材（同名以内置为准，避免被包覆盖） */
export function loadGenreTemplates(): GenreTemplate[] {
  const builtinNames = new Set(GENRE_TEMPLATES.map((item) => item.name))
  const extra = loadImportedGenres().filter((item) => !builtinNames.has(item.name))
  return [...GENRE_TEMPLATES, ...extra]
}

/** 导入题材包时调用：合并去重后落本地存储 */
export function saveImportedGenres(incoming: GenreTemplate[]): number {
  const existing = loadImportedGenres()
  const builtinNames = new Set(GENRE_TEMPLATES.map((item) => item.name))
  const merged = [...existing]
  let added = 0
  for (const item of incoming) {
    if (!item?.name || builtinNames.has(item.name)) continue
    if (merged.some((entry) => entry.name === item.name)) continue
    merged.push({ name: item.name, chapters: item.chapters || 100, style: item.style ?? '' })
    added += 1
  }
  try {
    localStorage.setItem(IMPORTED_KEY, JSON.stringify(merged))
  } catch {
    // 存储失败不影响主流程
  }
  return added
}

export const GENRE_TEMPLATES: GenreTemplate[] = [
  { name: '玄幻', chapters: 300, style: '热血爽利，节奏快，重视打脸与升级' },
  { name: '仙侠', chapters: 200, style: '克制冷峻，重意境与道法玄机' },
  { name: '都市', chapters: 200, style: '写实流畅，贴近当代生活语境' },
  { name: '都市异能', chapters: 200, style: '日常与异能交织，张弛有度' },
  { name: '科幻', chapters: 150, style: '逻辑严谨，重视设定自洽与想象力' },
  { name: '历史', chapters: 200, style: '沉稳厚重，官制礼法考据细致' },
  { name: '历史穿越', chapters: 250, style: '以现代思维碰撞古代规则' },
  { name: '悬疑', chapters: 120, style: '冷峻克制，善用伏笔与误导' },
  { name: '推理', chapters: 100, style: '线索公平，逻辑可回溯' },
  { name: '言情', chapters: 120, style: '细腻温柔，重情绪张力' },
  { name: '古言', chapters: 150, style: '古雅含蓄，宅斗与情义并重' },
  { name: '奇幻', chapters: 200, style: '想象力丰沛，世界观完整' },
  { name: '游戏', chapters: 250, style: '数据与操作细节可信，爽感密集' },
  { name: '网游', chapters: 250, style: '副本与公会线并行，节奏明快' },
  { name: '武侠', chapters: 150, style: '恩怨分明，武打干脆利落' },
  { name: '末世', chapters: 200, style: '压抑求存，资源与人性的重量' },
  { name: '无限流', chapters: 250, style: '副本推进，规则严谨，队伍群像' },
  { name: '灵异', chapters: 120, style: '阴冷克制，恐怖留白' },
  { name: '军事', chapters: 150, style: '专业硬朗，战术细节扎实' },
  { name: '体育', chapters: 150, style: '赛场节奏与成长线并重' },
  { name: '娱乐', chapters: 200, style: '圈内生态真实，爽点密集' },
  { name: '校园', chapters: 100, style: '青春鲜活，日常细节动人' },
  { name: '轻小说', chapters: 120, style: '轻快诙谐，对话驱动' },
  { name: '赛博朋克', chapters: 150, style: '霓虹冷调，义体与资本的隐喻' },
  { name: '克苏鲁', chapters: 120, style: '不可名状的压迫感，理智线紧绷' },
  { name: '星战', chapters: 180, style: '宏大战役与个体命运交织' },
  { name: '蒸汽朋克', chapters: 150, style: '齿轮与迷雾，工业时代的浪漫' },
  { name: '修真文明', chapters: 300, style: '以文明尺度书写修行与秩序' },
  { name: '同人', chapters: 100, style: '贴近原作气质，尊重既有设定' },
  { name: '短篇集', chapters: 12, style: '每章独立成篇，主题呼应' }
]

export const GENRE_NAMES = GENRE_TEMPLATES.map((item) => item.name)

export function findGenreTemplate(name: string): GenreTemplate | undefined {
  return GENRE_TEMPLATES.find((item) => item.name === name)
}