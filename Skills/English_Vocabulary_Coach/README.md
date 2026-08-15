# English Vocabulary Coach (SQLite Edition v2.1)

## Version
2.1.1 - 添加 is_reviewed 字段，消除冗余 COUNT 查询

## Description
本地优先、多考试自适应的英语词汇与听说读写硬核教练，使用 better-sqlite3 存储学习数据。

## Requirements
- Node.js >= 16
- `better-sqlite3` 依赖（运行 `npm install` 自动安装）
- 无需 SQLite3 CLI 工具

## File Structure
```
English_Vocabulary_Coach/
├── SKILL.md              # 技能主入口（AI 使用）
├── README.md             # 本文件
├── db.js                 # SQLite 数据库操作层
├── migrate.js            # JSON 数据迁移脚本
├── vocabulary.db         # SQLite 数据库文件（首次运行自动生成）
├── package.json          # 依赖声明
├── schemas/
│   └── Schemas.md        # 数据库 schema 定义
└── modules/
    ├── Vocab.md          # 词汇处理模块
    ├── Exercise.md       # 实战训练模块
    └── Review.md         # 复习引擎模块
```

## Quick Start

### 安装
```bash
# 1. 克隆或复制整个项目
git clone <your-repo>
cd MySkills

# 2. 安装依赖
npm install

# 3. 验证
node -e "const db = require('./Skills/English_Vocabulary_Coach/db.js'); console.log(db.getProfile());"
```

### 使用（Node.js 脚本）
```javascript
const db = require('./Skills/English_Vocabulary_Coach/db.js');

// 设置目标考试
db.setTargetExam('CET6');

// 添加单词
db.addWord({
    word: 'abandon',
    pos: 'v.',
    meaning: '放弃；遗弃',
    frequency: 5,
    collocation: ['abandon hope', 'abandon a plan'],
    example: 'The company abandoned the project due to budget cuts.',
    tips: 'a + band（绑）→ 不再绑住 → 放弃',
    tag: '阅读高频词'
});

// 查词
console.log(db.getWord('abandon'));

// 查看统计
console.log(db.getStats());
```

### 使用（Claude Code / AI 集成）
将 `Skills/English_Vocabulary_Coach/` 目录放入 Claude Code 的工作区，AI 会自动读取 SKILL.md 并路由到对应模块。

## Database Schema
- `user_profile`: 用户配置（目标考试、词汇水平等）
- `words`: 单词表（统一存储）
- `review_queue`: 艾宾浩斯复习队列（1d/2d/4d/8d/16d）
- `history_logs`: 学习历史日志

## API Reference
```javascript
const db = require('./Skills/English_Vocabulary_Coach/db.js');

// 用户配置
db.getProfile()                     // 获取用户配置
db.updateProfile({...})             // 更新配置字段
db.setTargetExam('考研英语')         // 设置目标考试

// 单词操作
db.getWord('abandon')              // 查询单词
db.wordExists('abandon')           // 检查单词是否存在
db.addWord({...})                  // 添加/更新单词
db.getAllWords()                   // 获取所有单词
db.getWordsByTag('阅读高频词')      // 按标签筛选
db.getRecentWords(5)               // 获取最近添加的5个
db.getRandomWords(5)               // 随机获取5个

// 复习队列
db.addToReviewQueue('word', 1)     // 加入复习队列（自动按艾宾浩斯计算时间）
db.getReviewQueue()                // 获取全部复习队列
db.getDueReviews()                 // 获取到期复习
db.updateReviewStage('word', true/false)  // 更新复习状态
db.removeFromReviewQueue('word')   // 从队列移除

// 日志
db.addLog('2026-08-15', 'vocab_search', 5)
db.getLogs()
db.getLogsByDate('2026-08-15')

// 统计
db.getStats()
```

## Environment Variables
| 变量 | 说明 | 默认值 |
|------|------|--------|
| `ENGLISH_DB_PATH` | 数据库文件路径 | `./vocabulary.db` |
| `ENGLISH_MIGRATE_STATE` | migrate.js 的源状态文件路径 | `../../user_state.json` |
| `ENGLISH_MIGRATE_CHUNKS` | migrate.js 的分块目录路径 | `../../` |
