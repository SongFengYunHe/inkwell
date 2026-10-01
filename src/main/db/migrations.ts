/**
 * 迁移脚本：由 `schema_version` 表驱动，按 version 升序执行。
 * 新增结构变更时追加一个 Migration，切勿修改历史条目。
 */

export interface Migration {
  version: number
  name: string
  statements: string[]
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'init_core_tables',
    statements: [
      `CREATE TABLE project (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        genre TEXT NOT NULL DEFAULT '',
        target_audience TEXT NOT NULL DEFAULT '',
        total_chapters INTEGER NOT NULL DEFAULT 50,
        words_per_chapter INTEGER NOT NULL DEFAULT 3000,
        language TEXT NOT NULL DEFAULT 'zh-CN',
        style TEXT NOT NULL DEFAULT '',
        premise TEXT NOT NULL DEFAULT '',
        worldbuilding TEXT NOT NULL DEFAULT '',
        protagonist TEXT NOT NULL DEFAULT '',
        golden_finger TEXT NOT NULL DEFAULT '',
        global_guidance TEXT NOT NULL DEFAULT '',
        core_outline TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,

      `CREATE TABLE chapter_brief (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
        chapter_no INTEGER NOT NULL,
        volume_idx INTEGER NOT NULL DEFAULT 1,
        title TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT '',
        purpose TEXT NOT NULL DEFAULT '',
        key_events TEXT NOT NULL DEFAULT '',
        characters TEXT NOT NULL DEFAULT '[]',
        scene_beats TEXT NOT NULL DEFAULT '[]',
        suspense_hook TEXT NOT NULL DEFAULT '',
        user_guidance TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,

      `CREATE UNIQUE INDEX chapter_brief_project_chapter_uq ON chapter_brief (project_id, chapter_no)`,

      `CREATE INDEX chapter_brief_project_idx ON chapter_brief (project_id)`,

      `CREATE TABLE chapter_draft (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
        chapter_no INTEGER NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'draft',
        source TEXT NOT NULL DEFAULT 'write',
        content TEXT NOT NULL DEFAULT '',
        word_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,

      `CREATE UNIQUE INDEX chapter_draft_project_chapter_version_uq ON chapter_draft (project_id, chapter_no, version)`,

      `CREATE INDEX chapter_draft_project_idx ON chapter_draft (project_id)`
    ]
  },
  {
    version: 2,
    name: 'add_provider',
    statements: [
      `CREATE TABLE provider (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL DEFAULT 'openai-compatible',
        name TEXT NOT NULL,
        base_url TEXT NOT NULL,
        api_key_enc TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`
    ]
  },
  {
    version: 3,
    name: 'provider_routing_and_usage',
    statements: [
      `ALTER TABLE provider ADD COLUMN headers TEXT NOT NULL DEFAULT '{}'`,
      `ALTER TABLE provider ADD COLUMN rate_limit_per_min INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE provider ADD COLUMN risk_accepted INTEGER NOT NULL DEFAULT 0`,

      `CREATE TABLE role_route (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        provider_id INTEGER NOT NULL REFERENCES provider(id) ON DELETE CASCADE,
        model TEXT NOT NULL DEFAULT '',
        fallback_chain TEXT NOT NULL DEFAULT '[]',
        max_concurrency INTEGER NOT NULL DEFAULT 2,
        updated_at INTEGER NOT NULL
      )`,

      `CREATE UNIQUE INDEX role_route_role_uq ON role_route (role)`,

      `CREATE TABLE llm_call (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider_id INTEGER,
        provider_name TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT '',
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        success INTEGER NOT NULL DEFAULT 1,
        error TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      )`,

      `CREATE INDEX llm_call_created_idx ON llm_call (created_at)`,
      `CREATE INDEX llm_call_role_idx ON llm_call (role)`
    ]
  },
  {
    version: 4,
    name: 'memory_truth_files_and_pipeline',
    statements: [
      // 章节记忆快照（真相文件 chapter_summaries 的载体，附带世界状态增量）
      `CREATE TABLE memory_chapter (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
        chapter_no INTEGER NOT NULL,
        draft_id INTEGER,
        summary TEXT NOT NULL DEFAULT '',
        character_states TEXT NOT NULL DEFAULT '[]',
        continuity_facts TEXT NOT NULL DEFAULT '{}',
        thread_updates TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE UNIQUE INDEX memory_chapter_project_chapter_uq ON memory_chapter (project_id, chapter_no)`,

      // 角色卡 + 当前状态（真相文件 character_matrix 的载体）
      `CREATE TABLE character (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT '',
        appearance TEXT NOT NULL DEFAULT '',
        personality TEXT NOT NULL DEFAULT '',
        background TEXT NOT NULL DEFAULT '',
        abilities TEXT NOT NULL DEFAULT '',
        motivation TEXT NOT NULL DEFAULT '',
        relationships TEXT NOT NULL DEFAULT '',
        cs_location TEXT NOT NULL DEFAULT '',
        cs_power TEXT NOT NULL DEFAULT '',
        cs_state TEXT NOT NULL DEFAULT '',
        cs_items TEXT NOT NULL DEFAULT '[]',
        cs_recent TEXT NOT NULL DEFAULT '',
        cs_updated_ch INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE UNIQUE INDEX character_project_name_uq ON character (project_id, name)`,

      // 主线/支线/伏笔台账（真相文件 pending_hooks / subplot_board 的载体）
      `CREATE TABLE outline_thread (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'plot',
        start_ch INTEGER NOT NULL DEFAULT 0,
        end_ch INTEGER NOT NULL DEFAULT 0,
        intent TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'planned',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE UNIQUE INDEX outline_thread_project_title_uq ON outline_thread (project_id, title)`,

      // 伏笔状态变更记录
      `CREATE TABLE thread_event (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
        thread_id INTEGER NOT NULL REFERENCES outline_thread(id) ON DELETE CASCADE,
        chapter_no INTEGER NOT NULL DEFAULT 0,
        draft_id INTEGER,
        event TEXT NOT NULL DEFAULT 'progressing',
        evidence TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      )`,
      `CREATE INDEX thread_event_thread_idx ON thread_event (thread_id)`,

      // 审稿报告（多维审计结果，JSON）
      `CREATE TABLE review (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
        draft_id INTEGER,
        chapter_no INTEGER NOT NULL,
        idx INTEGER NOT NULL DEFAULT 1,
        content TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL
      )`,
      `CREATE INDEX review_project_chapter_idx ON review (project_id, chapter_no)`,

      // 连写任务
      `CREATE TABLE pipeline_run (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
        from_ch INTEGER NOT NULL,
        to_ch INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        cursor INTEGER NOT NULL DEFAULT 1,
        require_accept INTEGER NOT NULL DEFAULT 0,
        steer_guidance TEXT NOT NULL DEFAULT '',
        error TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE INDEX pipeline_run_project_idx ON pipeline_run (project_id)`,

      // 步骤级进度（断点恢复）
      `CREATE TABLE pipeline_step (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id INTEGER NOT NULL REFERENCES pipeline_run(id) ON DELETE CASCADE,
        chapter_no INTEGER NOT NULL,
        step TEXT NOT NULL,
        ok INTEGER NOT NULL DEFAULT 0,
        attempt INTEGER NOT NULL DEFAULT 1,
        error TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL
      )`,
      `CREATE UNIQUE INDEX pipeline_step_run_chapter_step_uq ON pipeline_step (run_id, chapter_no, step)`
    ]
  },
  {
    version: 5,
    name: 'soft_delete',
    statements: [
      // 软删除：所有查询默认 WHERE deleted_at IS NULL（repository 层统一封装），删除即打时间戳
      `ALTER TABLE project ADD COLUMN deleted_at INTEGER`,
      `ALTER TABLE chapter_brief ADD COLUMN deleted_at INTEGER`,
      `ALTER TABLE chapter_draft ADD COLUMN deleted_at INTEGER`,

      `CREATE INDEX idx_project_deleted ON project (deleted_at)`,
      `CREATE INDEX idx_brief_deleted ON chapter_brief (deleted_at)`,
      `CREATE INDEX idx_draft_deleted ON chapter_draft (deleted_at)`,

      // 唯一约束改为「部分索引」：只约束未删除的行，
      // 否则删掉第 N 章后无法再建第 N 章，回收站里的行会永久占号。
      `DROP INDEX chapter_brief_project_chapter_uq`,
      `CREATE UNIQUE INDEX chapter_brief_project_chapter_uq ON chapter_brief (project_id, chapter_no) WHERE deleted_at IS NULL`,

      `DROP INDEX chapter_draft_project_chapter_version_uq`,
      `CREATE UNIQUE INDEX chapter_draft_project_chapter_version_uq ON chapter_draft (project_id, chapter_no, version) WHERE deleted_at IS NULL`
    ]
  },
  {
    version: 6,
    name: 'import_session_and_items',
    statements: [
      // 导入会话（暂存，不落 chapter_brief）；parsed_tree/validation 为 JSON 文本
      `CREATE TABLE import_session (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        source_path TEXT NOT NULL DEFAULT '',
        source_kind TEXT NOT NULL DEFAULT '',
        parsed_tree TEXT NOT NULL DEFAULT '{}',
        validation TEXT NOT NULL DEFAULT '{}',
        warnings TEXT NOT NULL DEFAULT '[]',
        encoding TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'staging'
      )`,
      `CREATE INDEX import_session_status_idx ON import_session (status)`,

      // 暂存条目（逐章）；payload/diff 为 JSON 文本，enabled 默认 1，用户可逐条开关
      `CREATE TABLE import_item (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES import_session(id) ON DELETE CASCADE,
        chapter_no INTEGER NOT NULL DEFAULT 0,
        volume_idx INTEGER NOT NULL DEFAULT 0,
        title TEXT NOT NULL DEFAULT '',
        action TEXT NOT NULL DEFAULT 'create',
        enabled INTEGER NOT NULL DEFAULT 1,
        payload TEXT NOT NULL DEFAULT '{}',
        diff TEXT NOT NULL DEFAULT '[]',
        heuristic_fields TEXT NOT NULL DEFAULT '[]',
        has_draft INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE INDEX import_item_session_idx ON import_item (session_id)`
    ]
  },
  {
    version: 7,
    name: 'full_text_search_and_writing_stats',
    // M8：FTS5 全文检索（细纲 / 正文 / 记忆）+ 写作统计与目标。
    // 说明：CJK 用 FTS5 的 trigram 分词器（SQLite 3.34+，Electron 44 内置已支持）。
    //       trigram 对 <3 字符的查询无法切词（1~2 字中文命中为 0），应用层会用 LIKE 回退兜底，
    //       因此这里仍然按规格建三种 FTS 表；短查询的降级逻辑在 src/main/search/query.ts。
    statements: [
      // ---------- FTS：正文 ----------
      `CREATE VIRTUAL TABLE fts_draft USING fts5(
        content, chapter_no UNINDEXED, project_id UNINDEXED,
        tokenize='trigram'
      )`,
      // ---------- FTS：细纲 ----------
      `CREATE VIRTUAL TABLE fts_brief USING fts5(
        title, purpose, key_events, characters, suspense_hook, scene_beats,
        chapter_no UNINDEXED, project_id UNINDEXED,
        tokenize='trigram'
      )`,
      // ---------- FTS：章节记忆 ----------
      `CREATE VIRTUAL TABLE fts_memory USING fts5(
        summary, chapter_no UNINDEXED, project_id UNINDEXED,
        tokenize='trigram'
      )`,

      // ---------- 触发器：正文（软删除时必须从 FTS 移除） ----------
      `CREATE TRIGGER fts_draft_ai AFTER INSERT ON chapter_draft BEGIN
        INSERT INTO fts_draft(rowid, content, chapter_no, project_id)
        VALUES (new.id, new.content, new.chapter_no, new.project_id);
      END`,
      `CREATE TRIGGER fts_draft_ad AFTER DELETE ON chapter_draft BEGIN
        DELETE FROM fts_draft WHERE rowid = old.id;
      END`,
      `CREATE TRIGGER fts_draft_au AFTER UPDATE ON chapter_draft BEGIN
        DELETE FROM fts_draft WHERE rowid = old.id;
        INSERT INTO fts_draft(rowid, content, chapter_no, project_id)
        SELECT new.id, new.content, new.chapter_no, new.project_id WHERE new.deleted_at IS NULL;
      END`,

      // ---------- 触发器：细纲 ----------
      `CREATE TRIGGER fts_brief_ai AFTER INSERT ON chapter_brief BEGIN
        INSERT INTO fts_brief(rowid, title, purpose, key_events, characters, suspense_hook, scene_beats, chapter_no, project_id)
        VALUES (new.id, new.title, new.purpose, new.key_events, new.characters, new.suspense_hook, new.scene_beats, new.chapter_no, new.project_id);
      END`,
      `CREATE TRIGGER fts_brief_ad AFTER DELETE ON chapter_brief BEGIN
        DELETE FROM fts_brief WHERE rowid = old.id;
      END`,
      `CREATE TRIGGER fts_brief_au AFTER UPDATE ON chapter_brief BEGIN
        DELETE FROM fts_brief WHERE rowid = old.id;
        INSERT INTO fts_brief(rowid, title, purpose, key_events, characters, suspense_hook, scene_beats, chapter_no, project_id)
        SELECT new.id, new.title, new.purpose, new.key_events, new.characters, new.suspense_hook, new.scene_beats, new.chapter_no, new.project_id
        WHERE new.deleted_at IS NULL;
      END`,

      // ---------- 触发器：记忆（memory_chapter 无 deleted_at，按自然行为同步） ----------
      `CREATE TRIGGER fts_memory_ai AFTER INSERT ON memory_chapter BEGIN
        INSERT INTO fts_memory(rowid, summary, chapter_no, project_id)
        VALUES (new.id, new.summary, new.chapter_no, new.project_id);
      END`,
      `CREATE TRIGGER fts_memory_ad AFTER DELETE ON memory_chapter BEGIN
        DELETE FROM fts_memory WHERE rowid = old.id;
      END`,
      `CREATE TRIGGER fts_memory_au AFTER UPDATE ON memory_chapter BEGIN
        DELETE FROM fts_memory WHERE rowid = old.id;
        INSERT INTO fts_memory(rowid, summary, chapter_no, project_id)
        VALUES (new.id, new.summary, new.chapter_no, new.project_id);
      END`,

      // ---------- 回填历史数据（否则老用户的存量正文 / 细纲 / 记忆搜不到） ----------
      `INSERT INTO fts_draft(rowid, content, chapter_no, project_id)
        SELECT id, content, chapter_no, project_id FROM chapter_draft WHERE deleted_at IS NULL`,
      `INSERT INTO fts_brief(rowid, title, purpose, key_events, characters, suspense_hook, scene_beats, chapter_no, project_id)
        SELECT id, title, purpose, key_events, characters, suspense_hook, scene_beats, chapter_no, project_id
        FROM chapter_brief WHERE deleted_at IS NULL`,
      `INSERT INTO fts_memory(rowid, summary, chapter_no, project_id)
        SELECT id, summary, chapter_no, project_id FROM memory_chapter`,

      // ---------- 写作统计（按天，本地时区 YYYY-MM-DD） ----------
      `CREATE TABLE writing_stat (
        day TEXT PRIMARY KEY,
        words_added INTEGER NOT NULL DEFAULT 0,
        chapters_done INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER
      )`,

      // ---------- 写作目标（单行，id 恒为 1） ----------
      `CREATE TABLE writing_goal (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        daily_words INTEGER NOT NULL DEFAULT 3000,
        daily_chapters INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER
      )`,
      `INSERT INTO writing_goal (id, daily_words, daily_chapters, created_at)
        VALUES (1, 3000, 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000)`
    ]
  },
  {
    version: 8,
    name: 'prompt_templates_style_vector_volume_revisions',
    // M9（A1–A5）：
    //   A1 可覆写提示词模板表 prompt_template（只存"被覆写过"的行，缺行即用内置默认）
    //   A2 文风画像 project.style_profile（JSON）
    //   A3 RAG 向量索引 embedding（Float32Array BLOB）
    //   A5 补齐计划书 §5.1 的 volume / draft_revision 两张表
    statements: [
      // ---------- A1：提示词模板（覆写层） ----------
      `CREATE TABLE prompt_template (
        key TEXT NOT NULL,
        locale TEXT NOT NULL DEFAULT 'zh-CN',
        system_body TEXT NOT NULL DEFAULT '',
        instruction_body TEXT NOT NULL DEFAULT '',
        version INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (key, locale)
      )`,

      // ---------- A2：文风画像（项目级 JSON） ----------
      `ALTER TABLE project ADD COLUMN style_profile TEXT NOT NULL DEFAULT ''`,

      // ---------- A5：分卷（计划书 §5.1 volume） ----------
      `CREATE TABLE volume (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
        idx INTEGER NOT NULL DEFAULT 1,
        title TEXT NOT NULL DEFAULT '',
        synopsis TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE UNIQUE INDEX volume_project_idx_uq ON volume (project_id, idx)`,

      // ---------- A5：修订记录（计划书 §5.1 draft_revision） ----------
      // 与 chapter_draft 的分工：draft 是"正文版本"，revision 是"这次改动的来由与产出"
      `CREATE TABLE draft_revision (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
        chapter_no INTEGER NOT NULL,
        base_draft_id INTEGER,
        draft_id INTEGER,
        idx INTEGER NOT NULL DEFAULT 1,
        type TEXT NOT NULL DEFAULT 'refine',
        status TEXT NOT NULL DEFAULT 'applied',
        user_prompt TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        word_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      )`,
      `CREATE INDEX draft_revision_project_chapter_idx ON draft_revision (project_id, chapter_no)`,

      // ---------- A3：向量索引 ----------
      // vector 为 Float32Array 的 BLOB；维度写在 dim 里，读回时按 dim 还原
      `CREATE TABLE embedding (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
        source_type TEXT NOT NULL DEFAULT 'draft',
        source_id INTEGER NOT NULL DEFAULT 0,
        chapter_no INTEGER NOT NULL DEFAULT 0,
        chunk_idx INTEGER NOT NULL DEFAULT 0,
        text TEXT NOT NULL DEFAULT '',
        dim INTEGER NOT NULL DEFAULT 0,
        vector BLOB,
        model TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      )`,
      `CREATE UNIQUE INDEX embedding_source_uq ON embedding (project_id, source_type, source_id, chunk_idx)`,
      `CREATE INDEX embedding_project_chapter_idx ON embedding (project_id, chapter_no)`,

      // ---------- 回填：把已有细纲里出现过的卷号补成 volume 行 ----------
      `INSERT INTO volume (project_id, idx, title, synopsis, created_at, updated_at)
        SELECT DISTINCT project_id, volume_idx, '', '',
          CAST(strftime('%s', 'now') AS INTEGER) * 1000,
          CAST(strftime('%s', 'now') AS INTEGER) * 1000
        FROM chapter_brief WHERE deleted_at IS NULL`
    ]
  }
]