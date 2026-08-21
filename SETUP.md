# 安装使用指南

## 前置要求

- Node.js >= 16（验证：`node --version`）
- npm（验证：`npm --version`）

## 安装步骤

### 1. 安装依赖
```bash
npm install
```
这会自动安装 `better-sqlite3`（编译原生模块，需要 build tools）。

> 如果编译失败（Windows 常见），确保已安装：
> - Python 3.x
> - Visual Studio Build Tools（勾选 "C++ build tools"）
> - 或运行：`npm install --global windows-build-tools`

### 2. 验证安装
```bash
node -e "const db = require('./Skills/English_Vocabulary_Coach/db.js'); console.log(db.getProfile());"
node -e "const db = require('./Skills/Learning_Assistant/db.js'); console.log(db.getProfile());"
```
期望输出：`{ id: 1, target_exam: '', ... }` 和 `{ id: 1, exam: '', ... }`

### 3. 使用

#### 方式一：Node.js 脚本
```javascript
const evc = require('./Skills/English_Vocabulary_Coach/db.js');

// 设置目标考试
evc.setTargetExam('CET6');

// 添加单词
evc.addWord({
    word: 'abandon',
    pos: 'v.',
    meaning: '放弃',
    frequency: 5,
    collocation: ['abandon hope'],
    example: 'He abandoned the plan.',
    tips: 'a+band',
    tag: '高频词'
});

// 查看统计
console.log(evc.getStats());
```

#### 方式二：Claude Code AI 集成
将 `Skills/` 目录放到 Claude Code 工作区，AI 会自动读取 `SKILL.md` 并按照模块路由处理你的指令。

常用指令：
- **英语教练**：查单词、背单词、做题、复习
- **学习助手**：添加科目知识点、记录错题、查薄弱点

## 数据文件

数据库文件自动生成在对应 skill 目录下：
- `Skills/English_Vocabulary_Coach/vocabulary.db`
- `Skills/Learning_Assistant/learner.db`

可通过环境变量覆盖路径：
```bash
ENGLISH_DB_PATH=/my/path/vocab.db node script.js
LEARNER_DB_PATH=/my/path/learner.db node script.js
```

## 迁移旧数据

如果你之前有 JSON 格式的词汇数据，运行：
```bash
node Skills/English_Vocabulary_Coach/migrate.js
```
或指定路径：
```bash
node Skills/English_Vocabulary_Coach/migrate.js --state ./my_state.json --chunks ./my_chunks/
```
