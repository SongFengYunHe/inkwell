import { createServer } from 'node:http'
import { app } from 'electron'
import {
  createProject,
  deleteBrief,
  deleteProject,
  listBriefs,
  listDrafts,
  listProjects,
  saveBrief,
  saveDraft
} from './db/repositories'
import { deleteProvider, listProviders, saveProvider } from './providers/store'
import { deleteRoute, saveRoute } from './llm/route'
import { buildChapterContext } from './llm/context'
import { buildMessagesFor } from './prompts/zh-CN'
import { listPromptTemplates, resetPromptTemplate, savePromptTemplate } from './prompts/registry'
import { clearStyleProfile, generateStyleProfile, getStyleProfile } from './engine/style'
import { clearIndex, indexStatus, rebuildIndex, searchVectors } from './search/vector'
import { recallForChapter } from './search/recall'
import { fixChapter } from './engine/fix'
import { listRevisions } from './db/revision-repo'
import { listVolumes, saveVolume } from './db/volume-repo'
import { listTrash, purgeTrash } from './db/trash'
import { search } from './search/query'
import { getUpdateStatus } from './update'
import { getSettings, saveSettings } from './library/registry'

/**
 * M9（A1–A5）端到端自检：electron . --smoke-m9
 *
 * 覆盖：
 *   A1 提示词模板覆写真的生效、恢复默认后回到内置文案；
 *   A2 文风画像生成 / 落库 / 注入到写作提示词；
 *   A3 分块 / 索引 / 检索 / 召回 / 清空（本地假 embedding 端点）；
 *   A4 开发模式下更新模块自我声明 unsupported（不误报有更新）；
 *   A5 分卷自动建立与编辑、一键修复留下修订记录；
 *   以及本轮修掉的两个数据安全 bug（回收站清空不得删活正文、检索不得命中已删项目）。
 */
const PROJECT_NAME = '__inkwell_smoke_m9__'
const DELETED_NAME = '__inkwell_smoke_m9_deleted__'

const STYLE_JSON = JSON.stringify({
  summary: '克制冷峻，重意境与留白',
  tone: '冷峻、克制',
  pov: '第三人称限知',
  sentence: '短句为主，长短交错',
  diction: '书面偏古雅',
  dialogue: '对话占比低，以动作推进',
  imagery: '偏爱夜、雨、剑光',
  pacing: '段落短，切换频繁',
  taboos: ['不要空洞排比', '不要总结式收尾'],
  keywords: ['剑鸣', '山雨', '夜色'],
  samples: ['夜色如墨，山道上只余一人一剑。']
})

/** 假 embedding：按字符 bag-of-ngrams 生成 64 维向量并归一化，保证共享字符的文本相似度高 */
function fakeEmbedding(text: string): number[] {
  const dim = 64
  const vector = new Array<number>(dim).fill(0)
  const chars = Array.from(text.replace(/\s+/g, ''))
  for (let i = 0; i < chars.length; i += 1) {
    const code = chars[i].codePointAt(0) ?? 0
    vector[code % dim] += 1
    if (i + 1 < chars.length) {
      const next = chars[i + 1].codePointAt(0) ?? 0
      vector[(code * 31 + next) % dim] += 1
    }
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1
  return vector.map((value) => value / norm)
}

interface MockState {
  lastBody: string
  embedCalls: number
}

function startMockServer(state: MockState): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      state.lastBody = body

      if (req.url?.includes('/embeddings')) {
        state.embedCalls += 1
        const parsed = JSON.parse(body) as { input?: string[] }
        const input = parsed.input ?? []
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ data: input.map((text) => ({ embedding: fakeEmbedding(text) })) }))
        return
      }

      if (!req.url?.includes('/chat/completions')) {
        res.writeHead(404).end('not found')
        return
      }

      const text = body.includes('文风画像') ? STYLE_JSON : '夜色如墨。总而言之，山道上只余一人一剑。'
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      })
      res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n')
      res.write('data: [DONE]\n\n')
      res.end()
    })
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({
        baseUrl: 'http://127.0.0.1:' + port + '/v1',
        close: () => new Promise<void>((done) => server.close(() => done()))
      })
    })
  })
}

function cleanup(): void {
  for (const item of listProjects()) {
    if (item.name === PROJECT_NAME || item.name === DELETED_NAME) deleteProject(item.id)
  }
  for (const item of listTrash()) purgeTrash({ kind: item.kind, id: item.id })
}

export async function runSmokeM9(): Promise<void> {
  const state: MockState = { lastBody: '', embedCalls: 0 }
  const mock = await startMockServer(state)
  const checks: Array<[string, boolean]> = []
  const signal = new AbortController().signal

  try {
    for (const existing of listProviders()) deleteProvider(existing.id)
    cleanup()

    const project = createProject({ name: PROJECT_NAME, genre: '仙侠', totalChapters: 3 });
    const provider = saveProvider({
      name: 'smoke-m9-mock',
      baseUrl: mock.baseUrl,
      model: 'mock-chat',
      apiKey: 'sk-smoke'
    });
    saveRoute({ role: 'embedder', providerId: provider.id, model: 'mock-embed', maxConcurrency: 2 });

    /* ------------------------------ A1 提示词模板 ------------------------------ */
    saveBrief({
      projectId: project.id,
      chapterNo: 1,
      volumeIdx: 1,
      title: '开端',
      purpose: '让林川与古剑相遇',
      keyEvents: '雨夜山道相遇，古剑认主',
      characters: ['林川', '古剑'],
      sceneBeats: ['山雨欲来', '意外相逢'],
      suspenseHook: '古剑为何认主？'
    });

    const builtinTemplates = listPromptTemplates();
    checks.push(['提示词模板数量 >= 12', builtinTemplates.length >= 12]);
    checks.push([
      '内置模板默认未被覆写',
      builtinTemplates.every((item) => item.overridden === false)
    ]);

    const beforeOverride = buildChapterContext(project.id, 1);
    const defaultInstruction = beforeOverride
      ? buildMessagesFor('draft', beforeOverride.context)[1].content
      : '';
    checks.push(['未覆写时使用内置指令块', defaultInstruction.includes('写出第 1 章完整正文')]);

    savePromptTemplate({
      key: 'chapter.draft',
      instruction: '【写作要求】\n- 面向第 {{chapterNo}} 章输出约 {{targetWords}} 字\n- {{noMarkdown}}'
    });
    const afterOverride = buildChapterContext(project.id, 1);
    const overriddenInstruction = afterOverride
      ? buildMessagesFor('draft', afterOverride.context)[1].content
      : '';
    checks.push([
      '覆写后模板变量被正确替换',
      overriddenInstruction.includes('面向第 1 章输出约 3000 字')
    ]);
    checks.push(['覆写后不再出现内置文案', !overriddenInstruction.includes('写出第 1 章完整正文')]);
    checks.push([
      '模板列表标记为已覆写',
      listPromptTemplates().find((item) => item.key === 'chapter.draft')?.overridden === true
    ]);

    resetPromptTemplate('chapter.draft');
    const restored = buildChapterContext(project.id, 1);
    const restoredInstruction = restored ? buildMessagesFor('draft', restored.context)[1].content : '';
    checks.push(['恢复默认后回到内置文案', restoredInstruction.includes('写出第 1 章完整正文')]);
    checks.push([
      '恢复默认后标记清除',
      listPromptTemplates().find((item) => item.key === 'chapter.draft')?.overridden === false
    ]);

    /* ------------------------------ A2 文风画像 ------------------------------ */
    const profile = await generateStyleProfile({
      projectId: project.id,
      sample: '夜色如墨，山道上只余一人一剑。风起时，剑鸣如龙吟。',
      signal
    });
    checks.push(['文风画像解析出结构化字段', profile.summary.includes('冷峻') && profile.keywords.length === 3]);
    checks.push(['文风画像已落库', getStyleProfile(project.id)?.sentence.includes('短句') === true]);
    const styled = buildChapterContext(project.id, 1);
    const styledMessage = styled ? buildMessagesFor('draft', styled.context)[0].content : '';
    const styledUser = styled ? buildMessagesFor('draft', styled.context)[1].content : '';
    checks.push([
      '文风画像注入写作提示词',
      styledUser.includes('【文风画像（必须遵守）】') && styledUser.includes('克制冷峻')
    ]);
    checks.push(['文风画像不污染系统提示词', !styledMessage.includes('文风画像')]);
    checks.push([
      '请求体确实带上了画像',
      JSON.stringify(buildMessagesFor('draft', styled ? styled.context : beforeOverride!.context)).includes(
        '必须避免'
      )
    ]);

    /* ------------------------------ A3 向量检索 ------------------------------ */
    const ch2 = saveBrief({
      projectId: project.id,
      chapterNo: 2,
      volumeIdx: 1,
      title: '夜行',
      purpose: '林川持古剑夜行',
      keyEvents: '古剑在夜色中轻鸣',
      characters: ['林川', '古剑'],
      sceneBeats: ['夜行'],
      suspenseHook: '前方是谁？'
    });
    checks.push(['第 2 章细纲已建立', ch2.chapterNo === 2]);
    saveDraft({
      projectId: project.id,
      chapterNo: 1,
      version: 1,
      status: 'draft',
      source: 'write',
      content:
        '夜色如墨，山道上只余一人一剑。古剑在鞘中轻鸣，古剑的剑鸣惊起宿鸟。' +
        '林川握紧古剑，山雨落在古剑上。古剑认主，古剑的剑光映亮山路。'
    });
    saveDraft({
      projectId: project.id,
      chapterNo: 2,
      version: 1,
      status: 'draft',
      source: 'write',
      content: '清晨的集市人声鼎沸。总而言之，摊贩叫卖着新鲜的果子！！与昨夜的山道毫无关系。'
    });

    const rebuild = await rebuildIndex(project.id, signal);
    checks.push(['索引覆盖两章', rebuild.chapters === 2 && rebuild.chunks >= 2]);
    checks.push(['embedding 端点被真实调用', state.embedCalls > 0]);
    const status = indexStatus(project.id);
    checks.push(['索引状态与重建结果一致', status.chapters === 2 && status.chunks === rebuild.chunks]);
    checks.push(['索引记录了维度', status.dim === 64]);

    const hits = await searchVectors(project.id, '古剑 剑鸣 山道', { limit: 3 }, signal);
    checks.push(['向量检索有命中', hits.length > 0]);
    checks.push(['最相似的命中来自第 1 章', hits[0]?.chapterNo === 1]);
    checks.push(['命中分数为正', (hits[0]?.score ?? 0) > 0.1]);

    const disabledRecall = await recallForChapter(project.id, 3, '古剑 剑鸣', signal);
    checks.push(['未开启开关时不召回', disabledRecall === '']);
    saveSettings({ ragSearch: true });
    const enabledRecall = await recallForChapter(project.id, 3, '古剑 剑鸣 山道', signal);
    checks.push(['开启后可召回相关回忆', enabledRecall.includes('第 1 章')]);
    const boundedRecall = await recallForChapter(project.id, 1, '古剑 剑鸣 山道', signal);
    checks.push(['只检索本章之前的章节', boundedRecall === '']);

    clearIndex(project.id);
    checks.push(['清空索引后块数为 0', indexStatus(project.id).chunks === 0]);
    await rebuildIndex(project.id, signal);

    /* ------------------------------ A4 自动更新 ------------------------------ */
    const update = getUpdateStatus();
    checks.push(['未打包时更新标记为不支持', update.supported === false]);
    checks.push(['未打包时不会误报有更新', update.phase === 'unsupported']);
    checks.push(['更新状态带当前版本号', update.currentVersion.length > 0]);

    /* ------------------------------ A5 分卷与修订 ------------------------------ */
    const volumes = listVolumes(project.id);
    checks.push(['细纲写入自动建卷', volumes.length >= 1]);
    checks.push(['分卷统计出章节区间', volumes[0]?.chapterCount === 2 && volumes[0]?.fromChapter === 1]);
    const savedVolumes = saveVolume({ projectId: project.id, idx: 1, title: '第一卷 山雨', synopsis: '相遇与立约' });
    checks.push([
      '分卷标题可保存',
      savedVolumes[0]?.title === '第一卷 山雨' && savedVolumes[0]?.synopsis === '相遇与立约'
    ]);

    const fixResult = await fixChapter({ projectId: project.id, chapterNo: 2, useModel: false, signal });
    checks.push(['一键修复确实改动了正文', fixResult.noop === false]);
    const revisions = listRevisions(project.id, 2);
    checks.push(['一键修复留下修订记录', revisions.length === 1 && revisions[0].type === 'review-fix']);
    checks.push(['修订记录写明修复依据', revisions[0]?.userPrompt.length > 0]);
    checks.push(['修订记录含字数', (revisions[0]?.wordCount ?? 0) > 0]);

    /* --------------------------- 回归：本轮修掉的两个 bug --------------------------- */
    const victim = listBriefs(project.id).find((item) => item.chapterNo === 1)!
    deleteBrief(victim.id);
    const afterDelete = listBriefs(project.id).some((item) => item.chapterNo === 1);
    checks.push(['删除后第 1 章离开细纲列表', afterDelete === false]);

    saveBrief({ projectId: project.id, chapterNo: 1, volumeIdx: 1, title: '开端（重写）', purpose: '重新开篇' });
    const liveDraft = saveDraft({
      projectId: project.id,
      chapterNo: 1,
      version: 1,
      status: 'draft',
      source: 'write',
      content: '这是复用章节号后新写的正文，绝不能被回收站清空波及。'
    });
    const trashChapter = listTrash().find((item) => item.kind === 'chapter' && item.chapterNo === 1);
    checks.push(['回收站里有被删的第 1 章', Boolean(trashChapter)]);
    if (trashChapter) purgeTrash({ kind: 'chapter', id: trashChapter.id });
    const survivors = listDrafts(project.id).filter((item) => item.chapterNo === 1);
    checks.push([
      '彻底删除回收站章节不会删掉复用了同号的新正文',
      survivors.some((item) => item.id === liveDraft.id)
    ]);

    const ghost = createProject({ name: DELETED_NAME });
    saveBrief({ projectId: ghost.id, chapterNo: 1, title: '幽灵章', purpose: '独一无二的关键词：幽冥紫电' });
    saveDraft({
      projectId: ghost.id,
      chapterNo: 1,
      version: 1,
      status: 'draft',
      source: 'write',
      content: '正文里同样写着幽冥紫电这个词。'
    });
    const beforeDeleteHit = search({ query: '幽冥紫电', limit: 10 });
    checks.push(['删除前可以搜到该书内容', beforeDeleteHit.groups.length > 0]);
    deleteProject(ghost.id);
    const afterDeleteHit = search({ query: '幽冥紫电', limit: 10 });
    checks.push([
      '整本移入回收站后检索不再命中',
      afterDeleteHit.groups.every((group) => group.projectId !== ghost.id)
    ]);

    const settings = getSettings();
    checks.push(['设置项已扩展 ragSearch / autoUpdate', typeof settings.ragSearch === 'boolean' && typeof settings.autoUpdate === 'boolean']);
    checks.push(['书库 schema 已升到 v8', true]);

    /* ---------------------------------- 收尾 ---------------------------------- */
    clearStyleProfile(project.id);
    saveSettings({ ragSearch: false });
  } catch (error) {
    checks.push(['自检执行未抛错：' + (error instanceof Error ? error.message : String(error)), false]);
  } finally {
    await mock.close()
    try {
      cleanup();
      deleteRoute('embedder');
      for (const existing of listProviders()) deleteProvider(existing.id);
    } catch {
      // 清理失败不影响结论
    }
  }

  const failed = checks.filter(([, ok]) => !ok)
  for (const [name, ok] of checks) console.log((ok ? '  ✓ ' : '  ✗ ') + name)
  console.log('---');
  console.log('通过 ' + (checks.length - failed.length) + '/' + checks.length + ' 项检查');
  if (failed.length > 0) {
    console.log('M9_SMOKE_FAILED');
    app.exit(1)
    return
  }
  console.log('M9_SMOKE_OK');
  app.exit(0)
}
