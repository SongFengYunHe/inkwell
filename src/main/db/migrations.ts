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
  }
]