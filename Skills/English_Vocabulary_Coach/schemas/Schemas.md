# Data Contract Specification (SQLite Version)
本文件定义了系统标准数据库拓扑。大模型在执行初始化创建或追加写入时，必须严格对照本文件独立章节的层级进行结构化输出。

## 1. Database Schema (SQLite)

### 1.1 User Profile Table
```sql
CREATE TABLE IF NOT EXISTS user_profile (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_exam TEXT DEFAULT '',           -- 目标考试 (CET4/CET6/考研英语/雅思/托福等)
    vocabulary_level TEXT DEFAULT 'Medium', -- 词汇水平 (Low/Medium/High)
    grammar_basis TEXT DEFAULT 'Weak',      -- 语法基础 (Weak/Medium/Strong)
    total_words_count INTEGER DEFAULT 0     -- 总单词数
);
```

**初始数据**：
```sql
INSERT OR IGNORE INTO user_profile (id) VALUES (1);
```

### 1.2 Words Table
```sql
CREATE TABLE IF NOT EXISTS words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word TEXT UNIQUE NOT NULL,             -- 单词（唯一）
    pos TEXT,                              -- 词性
    meaning TEXT,                          -- 中文释义
    frequency INTEGER DEFAULT 0,           -- 考试频率 (1-5)
    collocation TEXT,                      -- 搭配 (JSON数组字符串)
    example TEXT,                          -- 例句
    tips TEXT,                             -- 记忆技巧
    tag TEXT,                              -- 标签 (如：阅读高频词/态度/经济)
    created_at INTEGER DEFAULT (strftime('%s', 'now'))  -- 创建时间戳
);
```

### 1.3 Review Queue Table
```sql
CREATE TABLE IF NOT EXISTS review_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word TEXT NOT NULL,                    -- 单词
    stage INTEGER DEFAULT 1,               -- 艾宾浩斯阶段 (1-5)
    next_review_time INTEGER,              -- 下次复习时间戳
    is_reviewed INTEGER DEFAULT 0,         -- 是否已完成本轮复习
    FOREIGN KEY (word) REFERENCES words(word)
);
```

**阶段间隔规则**：
| Stage | 间隔天数 | 下次复习时间 |
|-------|---------|-------------|
| 1 | 1天 | now + 86400 |
| 2 | 2天 | now + 172800 |
| 3 | 4天 | now + 345600 |
| 4 | 8天 | now + 691200 |
| 5 | 16天 | now + 1382400 |

### 1.4 History Logs Table
```sql
CREATE TABLE IF NOT EXISTS history_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT,                             -- 日期 (YYYY-MM-DD)
    type TEXT,                             -- 类型 (vocab_search/exercise/review)
    count INTEGER DEFAULT 0,
    UNIQUE(date, type)
);
```

## 2. Indexes
```sql
CREATE INDEX IF NOT EXISTS idx_words_word ON words(word);
CREATE INDEX IF NOT EXISTS idx_words_tag ON words(tag);
CREATE INDEX IF NOT EXISTS idx_review_queue_time ON review_queue(next_review_time);
CREATE INDEX IF NOT EXISTS idx_review_queue_word ON review_queue(word);
CREATE INDEX IF NOT EXISTS idx_review_queue_due ON review_queue(next_review_time ASC);
CREATE INDEX IF NOT EXISTS idx_history_date ON history_logs(date);
```

## 3. Data Format Standards

### 3.1 Word Object Structure
```json
{
  "word": "abandon",
  "pos": "v.",
  "meaning": "放弃；遗弃",
  "frequency": 5,
  "collocation": ["abandon hope", "abandon a plan"],
  "example": "The company abandoned the project due to budget cuts.",
  "tips": "a + band（绑）→ 不再绑住 → 放弃",
  "tag": "阅读高频词"
}
```

### 3.2 Review Queue Item Structure
```json
{
  "word": "abandon",
  "stage": 1,
  "next_review_time": 1782489600
}
```

### 3.3 Log Item Structure
```json
{
  "date": "2026-08-08",
  "type": "vocab_search",
  "count": 5
}
```
