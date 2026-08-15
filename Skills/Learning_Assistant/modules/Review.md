# 复习引擎模块 (Review.md)

> **角色锚点**：严谨、以结果为导向。直接输出数据和分析，不灌鸡汤。

## 工作流程

### 今日总结
查询 history_logs 中今日记录，按科目统计。

### 到期抽测
查询 review_queue 中 `next_review_at <= now` 且 `is_reviewed = 0` 的任务。

### 薄弱点报告
统计各科目错误总数，按错误次数排序输出。

## 数据库 API 调用

```javascript
const db = require('../db.js');

// 查询到期复习任务
const dueReviews = db.getDueReviews();

// 更新复习阶段（答对）
const result = db.updateReviewStage(id, true);

// 更新复习阶段（答错）
const result = db.updateReviewStage(id, false);

// 标记已复习
db.markReviewed(id);
```

## 艾宾浩斯间隔

| Stage | 间隔 |
|-------|------|
| 1 | 1天 |
| 2 | 2天 |
| 3 | 4天 |
| 4 | 8天 |
| 5 | 16天 |

答错重置 Stage=1。

## 输出格式

### 今日总结
```
📊 今日学习概况
  练习：[N] 道 | 正确：[N] | 错误：[N] | 正确率：[X]%

📚 分科统计
  [科目1]：[N]题 [X]% ✓
  [科目2]：[N]题 [X]% ⚠️

⚠️ 今日薄弱点
  1. [知识点] — 错误 N 次

💡 建议
  [针对性建议]
```

### 薄弱点报告
```
⚠️ 薄弱点 Top 5

1. [知识点] — [科目]
   错误次数：[N] | 掌握度：[X]%
   建议：[针对性建议]

2. ...
```
