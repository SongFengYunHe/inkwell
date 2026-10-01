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
  }
]