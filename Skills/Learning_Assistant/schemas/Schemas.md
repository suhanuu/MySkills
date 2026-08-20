# 数据库模式 (Schemas)

## 表结构

```sql
CREATE TABLE IF NOT EXISTS subjects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    full_name TEXT,
    weight REAL DEFAULT 1.0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS topics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    parent_id INTEGER,
    exam_weight REAL DEFAULT 3.0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (subject_id) REFERENCES subjects(id),
    FOREIGN KEY (parent_id) REFERENCES topics(id)
);

CREATE TABLE IF NOT EXISTS mistakes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic_id INTEGER,
    question TEXT NOT NULL,
    wrong_answer TEXT,
    correct_answer TEXT,
    explanation TEXT,
    mistake_count INTEGER DEFAULT 1,
    last_mistake_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (topic_id) REFERENCES topics(id),
    UNIQUE(topic_id, question, wrong_answer, correct_answer)
);

CREATE TABLE IF NOT EXISTS progress (
    topic_id INTEGER PRIMARY KEY,
    correct_count INTEGER DEFAULT 0,
    wrong_count INTEGER DEFAULT 0,
    last_practice_at TIMESTAMP,
    mastery_level REAL DEFAULT 0.0,
    FOREIGN KEY (topic_id) REFERENCES topics(id)
);

CREATE TABLE IF NOT EXISTS review_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic_id INTEGER NOT NULL,
    stage INTEGER DEFAULT 1,
    next_review_at INTEGER NOT NULL,
    is_reviewed INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (topic_id) REFERENCES topics(id)
);

CREATE TABLE IF NOT EXISTS user_profile (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    exam TEXT DEFAULT '',
    stage TEXT DEFAULT '基础',
    exam_date TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## 索引

```sql
CREATE INDEX IF NOT EXISTS idx_mistakes_topic ON mistakes(topic_id);
CREATE INDEX IF NOT EXISTS idx_mistakes_count ON mistakes(mistake_count DESC);
CREATE INDEX IF NOT EXISTS idx_progress_mastery ON progress(mastery_level ASC);
CREATE INDEX IF NOT EXISTS idx_review_queue ON review_queue(next_review_at ASC, is_reviewed ASC);
```
