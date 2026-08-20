/**
 * SQLite Database Layer for Learning Assistant (通用学习助手)
 * Uses better-sqlite3 for safe parameterized queries
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.LEARNER_DB_PATH || path.join(__dirname, 'learner.db');

// Auto-create directory if it doesn't exist
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent access
db.pragma('journal_mode = WAL');

// Ebbinghaus review intervals in seconds: 1d, 2d, 4d, 8d, 16d (matches English VC)
const REVIEW_INTERVALS = [86400, 172800, 345600, 691200, 1382400];

function initDatabase() {
    db.exec(`
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

        CREATE TABLE IF NOT EXISTS history_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT,
            type TEXT,
            count INTEGER DEFAULT 0,
            UNIQUE(date, type)
        );

        CREATE INDEX IF NOT EXISTS idx_mistakes_topic ON mistakes(topic_id);
        CREATE INDEX IF NOT EXISTS idx_mistakes_count ON mistakes(mistake_count DESC);
        CREATE INDEX IF NOT EXISTS idx_progress_mastery ON progress(mastery_level ASC);
        CREATE INDEX IF NOT EXISTS idx_review_queue_due ON review_queue(next_review_at ASC, is_reviewed ASC);
        CREATE INDEX IF NOT EXISTS idx_history_date ON history_logs(date);

        INSERT OR IGNORE INTO user_profile (id) VALUES (1);
    `);
}

// Initialize on module load
initDatabase();

// ============ USER PROFILE OPERATIONS ============

const ALLOWED_PROFILE_KEYS = new Set(['exam', 'stage', 'exam_date']);

function getProfile() {
    return db.prepare('SELECT * FROM user_profile WHERE id = 1').get();
}

function updateProfile(updates) {
    const keys = Object.keys(updates).filter(k => ALLOWED_PROFILE_KEYS.has(k));
    if (keys.length === 0) return getProfile();

    const sql = `UPDATE user_profile SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = 1`;
    db.prepare(sql).run(...keys.map(k => updates[k]));
    return getProfile();
}

function setExam(exam) {
    return updateProfile({ exam });
}

// ============ SUBJECT OPERATIONS ============

function getSubject(name) {
    return db.prepare('SELECT * FROM subjects WHERE name = ?').get(name);
}

function addSubject(name, fullName = null, weight = 1.0) {
    db.prepare(`INSERT OR IGNORE INTO subjects (name, full_name, weight) VALUES (?, ?, ?)`).run(name, fullName, weight);
}

function getAllSubjects() {
    return db.prepare('SELECT * FROM subjects ORDER BY weight DESC').all();
}

// ============ TOPIC OPERATIONS ============

function getTopic(subjectId, name = null) {
    if (name) {
        const sql = subjectId
            ? 'SELECT * FROM topics WHERE subject_id = ? AND name LIKE ? ORDER BY exam_weight DESC'
            : 'SELECT * FROM topics WHERE name LIKE ? ORDER BY exam_weight DESC';
        return db.prepare(sql).all(subjectId ? [subjectId, `%${name}%`] : [`%${name}%`]);
    }
    return db.prepare('SELECT * FROM topics WHERE subject_id = ? ORDER BY exam_weight DESC').all(subjectId);
}

function addTopic(subjectId, name, parentId = null, examWeight = 3.0) {
    db.prepare(`INSERT INTO topics (subject_id, name, parent_id, exam_weight) VALUES (?, ?, ?, ?)`).run(subjectId, name, parentId, examWeight);
}

// ============ MISTAKE OPERATIONS ============

function addMistake(topicId, question, wrongAnswer, correctAnswer, explanation) {
    // Upsert: insert new record or increment existing mistake count
    const info = db.prepare(
        `INSERT INTO mistakes (topic_id, question, wrong_answer, correct_answer, explanation, mistake_count, last_mistake_at)
         VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
         ON CONFLICT DO NOTHING`
    ).run(topicId, question, wrongAnswer, correctAnswer, explanation);

    if (info.changes === 0) {
        // Record existed, increment count
        db.prepare(
            `UPDATE mistakes SET mistake_count = mistake_count + 1, last_mistake_at = CURRENT_TIMESTAMP
             WHERE topic_id = ? AND question = ? AND wrong_answer = ? AND correct_answer = ?`
        ).run(topicId, question, wrongAnswer, correctAnswer);
    }

    return true;
}

function getMistakesByTopic(topicId, limit = 10) {
    return db.prepare('SELECT * FROM mistakes WHERE topic_id = ? ORDER BY last_mistake_at DESC LIMIT ?').all(topicId, limit);
}

// ============ PROGRESS OPERATIONS ============

function updateProgress(topicId, isCorrect) {
    const existing = db.prepare('SELECT * FROM progress WHERE topic_id = ?').get(topicId);

    if (existing) {
        const newCorrect = existing.correct_count + (isCorrect ? 1 : 0);
        const newWrong = existing.wrong_count + (isCorrect ? 0 : 1);
        const total = newCorrect + newWrong;
        const mastery = total > 0 ? Math.round((newCorrect / total) * 100) / 100 : 0;

        db.prepare(
            `UPDATE progress SET correct_count = ?, wrong_count = ?, mastery_level = ?, last_practice_at = ? WHERE topic_id = ?`
        ).run(newCorrect, newWrong, mastery, Math.floor(Date.now() / 1000), topicId);
    } else {
        db.prepare(
            `INSERT INTO progress (topic_id, correct_count, wrong_count, mastery_level, last_practice_at) VALUES (?, ?, ?, ?, ?)`
        ).run(topicId, isCorrect ? 1 : 0, isCorrect ? 0 : 1, isCorrect ? 1.0 : 0.0, Math.floor(Date.now() / 1000));
    }

    return getMasteryLevel(topicId);
}

function getMasteryLevel(topicId) {
    const row = db.prepare('SELECT mastery_level FROM progress WHERE topic_id = ?').get(topicId);
    return row ? row.mastery_level : 0.0;
}

function getWeakPoints(limit = 5) {
    return db.prepare(`
        SELECT t.id as topic_id, t.name as topic_name, s.name as subject,
               COALESCE(SUM(m.mistake_count), 0) as error_count,
               COALESCE(p.mastery_level, 0.0) as mastery
        FROM topics t
        JOIN subjects s ON s.id = t.subject_id
        LEFT JOIN mistakes m ON m.topic_id = t.id
        LEFT JOIN progress p ON p.topic_id = t.id
        GROUP BY t.id
        HAVING error_count > 0
        ORDER BY error_count DESC
        LIMIT ?
    `).all(limit);
}

// ============ REVIEW QUEUE OPERATIONS ============

function addToReviewQueue(topicId, stage = 1, nextReviewAt = null) {
    if (!nextReviewAt) {
        nextReviewAt = Math.floor(Date.now() / 1000) + REVIEW_INTERVALS[Math.min(stage - 1, REVIEW_INTERVALS.length - 1)];
    }

    const existing = db.prepare('SELECT * FROM review_queue WHERE topic_id = ? AND is_reviewed = 0').get(topicId);

    if (existing) {
        db.prepare('UPDATE review_queue SET stage = ?, next_review_at = ? WHERE id = ?').run(stage, nextReviewAt, existing.id);
    } else {
        db.prepare('INSERT INTO review_queue (topic_id, stage, next_review_at, is_reviewed) VALUES (?, ?, ?, 0)').run(topicId, stage, nextReviewAt);
    }

    return getReviewQueue();
}

function getReviewQueue() {
    return db.prepare('SELECT * FROM review_queue ORDER BY next_review_at ASC').all();
}

function getDueReviews() {
    const now = Math.floor(Date.now() / 1000);
    return db.prepare('SELECT * FROM review_queue WHERE next_review_at <= ? AND is_reviewed = 0 ORDER BY next_review_at ASC').all(now);
}

function updateReviewStage(id, isCorrect) {
    const existing = db.prepare('SELECT * FROM review_queue WHERE id = ?').get(id);
    if (!existing) return null;

    const now = Math.floor(Date.now() / 1000);
    let newStage;
    let nextReviewAt;

    if (isCorrect) {
        newStage = Math.min(existing.stage + 1, 5);
        const intervalIndex = Math.min(newStage - 1, REVIEW_INTERVALS.length - 1);
        nextReviewAt = now + REVIEW_INTERVALS[intervalIndex];
    } else {
        newStage = 1;
        nextReviewAt = now + REVIEW_INTERVALS[0];
    }

    db.prepare('UPDATE review_queue SET stage = ?, next_review_at = ?, is_reviewed = 1 WHERE id = ?').run(newStage, nextReviewAt, id);
    return { id, topic_id: existing.topic_id, stage: newStage, next_review_at: nextReviewAt };
}

function markReviewed(id) {
    db.prepare('UPDATE review_queue SET is_reviewed = 1 WHERE id = ?').run(id);
    return true;
}

function removeFromReviewQueue(id) {
    db.prepare('DELETE FROM review_queue WHERE id = ?').run(id);
    return true;
}

// ============ HISTORY LOG OPERATIONS ============

function addLog(date, type, count = 1) {
    db.prepare(
        `INSERT INTO history_logs (date, type, count) VALUES (?, ?, ?)
         ON CONFLICT(date, type) DO UPDATE SET count = count + excluded.count`
    ).run(date, type, count);
    return getLogs();
}

function getLogs() {
    return db.prepare('SELECT * FROM history_logs ORDER BY date DESC').all();
}

function getLogsByDate(date) {
    return db.prepare('SELECT * FROM history_logs WHERE date = ?').all(date);
}

// ============ UTILITY OPERATIONS ============

function getStats() {
    const profile = getProfile();
    const totalTopics = db.prepare('SELECT COUNT(*) as count FROM topics').get();
    const totalMistakes = db.prepare('SELECT COALESCE(SUM(mistake_count), 0) as count FROM mistakes').get();
    const queueSize = db.prepare('SELECT COUNT(*) as count FROM review_queue WHERE is_reviewed = 0').get();
    const dueReviews = db.prepare(
        'SELECT COUNT(*) as count FROM review_queue WHERE next_review_at <= ? AND is_reviewed = 0'
    ).get(Math.floor(Date.now() / 1000)).count;

    return {
        exam: profile ? profile.exam : '',
        stage: profile ? profile.stage : '基础',
        exam_date: profile ? profile.exam_date : '',
        total_topics: totalTopics.count,
        total_mistakes: totalMistakes.count,
        queue_size: queueSize.count,
        due_reviews: dueReviews
    };
}

module.exports = {
    // Init
    initDatabase,

    // User Profile
    getProfile,
    updateProfile,
    setExam,

    // Subjects
    getSubject,
    addSubject,
    getAllSubjects,

    // Topics
    getTopic,
    addTopic,

    // Mistakes
    addMistake,
    getMistakesByTopic,

    // Progress
    updateProgress,
    getMasteryLevel,
    getWeakPoints,

    // Review Queue
    addToReviewQueue,
    getReviewQueue,
    getDueReviews,
    updateReviewStage,
    markReviewed,
    removeFromReviewQueue,

    // History Logs
    addLog,
    getLogs,
    getLogsByDate,

    // Stats
    getStats
};
