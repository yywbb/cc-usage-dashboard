ALTER TABLE messages ADD COLUMN source TEXT DEFAULT 'claude';
ALTER TABLE messages ADD COLUMN reasoning_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN originator TEXT;

ALTER TABLE sessions ADD COLUMN source TEXT DEFAULT 'claude';
ALTER TABLE sessions ADD COLUMN total_reasoning INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN cwd_real_path TEXT;

ALTER TABLE projects ADD COLUMN sources TEXT;

UPDATE messages SET source = 'claude' WHERE source IS NULL;
UPDATE sessions SET source = 'claude' WHERE source IS NULL;

CREATE INDEX IF NOT EXISTS idx_messages_source ON messages(source, timestamp);
CREATE INDEX IF NOT EXISTS idx_sessions_real_path ON sessions(cwd_real_path);
CREATE INDEX IF NOT EXISTS idx_sessions_source ON sessions(source);
