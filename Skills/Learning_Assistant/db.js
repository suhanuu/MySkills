/**
 * SQLite Database Layer for Learning Assistant
 * Uses better-sqlite3 for safe parameterized queries
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.LEARNING_DB_PATH || path.join(__dirname, 'learner.db');

// Auto-create directory if it doesn't exist
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent access
db.pragma('journal_mode = WAL');

// Ebbinghaus review intervals in seconds: 1d, 2d, 4d, 8d, 16d
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

        -- Indexes
        CREATE INDEX IF NOT EXISTS idx_mistakes_topic ON mistakes(topic_id);
        CREATE INDEX IF NOT EXISTS idx_mistakes_count ON mistakes(mistake_count DESC);
        CREATE INDEX IF NOT EXISTS idx_progress_mastery ON progress(mastery_level ASC);
        CREATE INDEX IF NOT EXISTS idx_review_queue ON review_queue(next_review_at ASC, is_reviewed ASC);

        -- Insert default profile
        INSERT OR IGNORE INTO user_profile (id) VALUES (1);
    `);
}

// Initialize on module load
initDatabase();
// ============ USER PROFILE OPERATIONS ============

function getProfile() {
    return db.prepare('SELECT * FROM user_profile WHERE id = 1').get();
}

function updateProfile(updates) {
    const keys = Object.keys(updates);
    if (keys.length === 0) return getProfile();
    const sql = `UPDATE user_profile SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = 1`;
    db.prepare(sql).run(...keys.map(k => updates[k]));
    return getProfile();
}

function setExam(exam) {
    return updateProfile({ exam });
}

function setExamDate(date) {
    return updateProfile({ exam_date: date });
}

function setStage(stage) {
    return updateProfile({ stage });
}
// ============ SUBJECT OPERATIONS ============

function addSubject(name, fullName = null, weight = 1.0) {
    const exists = db.prepare('SELECT id FROM subjects WHERE name = ?').get(name);
    if (exists) return { id: exists.id, created: false };
    const result = db.prepare('INSERT INTO subjects (name, full_name, weight) VALUES (?, ?, ?)').run(name, fullName, weight);
    return { id: result.lastInsertRowid, created: true };
}

function getAllSubjects() {
    return db.prepare('SELECT * FROM subjects ORDER BY name').all();
}

function getSubject(id) {
    return db.prepare('SELECT * FROM subjects WHERE id = ?').get(id);
}

// ============ TOPIC OPERATIONS ============

function addTopic(subjectId, name, parentId = null, examWeight = 3.0) {
    const result = db.prepare(
        'INSERT INTO topics (subject_id, name, parent_id, exam_weight) VALUES (?, ?, ?, ?)'
    ).run(subjectId, name, parentId, examWeight);
    return { id: result.lastInsertRowid, created: true };
}

function getTopics(subjectId = null, keyword = null) {
    let sql = 'SELECT t.*, s.name as subject_name FROM topics t LEFT JOIN subjects s ON t.subject_id = s.id';
    const params = [];
    const conditions = [];
    if (subjectId) {
        conditions.push('t.subject_id = ?');
        params.push(subjectId);
    }
    if (keyword) {
        conditions.push('t.name LIKE ?');
        params.push('%' + keyword + '%');
    }
    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY t.exam_weight DESC, t.name';
    return db.prepare(sql).all(...params);
}

function getTopic(id) {
    return db.prepare(
        'SELECT t.*, s.name as subject_name FROM topics t LEFT JOIN subjects s ON t.subject_id = s.id WHERE t.id = ?'
    ).get(id);
}
// ============ MISTAKE OPERATIONS ============

function addMistake(topicId, question, wrongAnswer, correctAnswer, explanation) {
    try {
        db.prepare(
            `INSERT INTO mistakes (topic_id, question, wrong_answer, correct_answer, explanation)
             VALUES (?, ?, ?, ?, ?)`
        ).run(topicId, question, wrongAnswer, correctAnswer, explanation);
        // Update progress
        db.prepare('UPDATE progress SET wrong_count = wrong_count + 1, last_practice_at = CURRENT_TIMESTAMP WHERE topic_id = ?').run(topicId);
    } catch (e) {
        // Duplicate - increment mistake_count
        db.prepare('UPDATE mistakes SET mistake_count = mistake_count + 1, last_mistake_at = CURRENT_TIMESTAMP WHERE topic_id = ? AND question = ?').run(topicId, question);
        db.prepare('UPDATE progress SET wrong_count = wrong_count + 1, last_practice_at = CURRENT_TIMESTAMP WHERE topic_id = ?').run(topicId);
    }
}

function getMistakesByTopic(topicId) {
    return db.prepare('SELECT * FROM mistakes WHERE topic_id = ? ORDER BY mistake_count DESC').all(topicId);
}

function getWeakPoints(limit = 5) {
    return db.prepare(`
        SELECT t.id, t.name, t.subject_id, s.name as subject_name,
               p.wrong_count, p.correct_count, p.mastery_level
        FROM topics t
        JOIN subjects s ON t.subject_id = s.id
        LEFT JOIN progress p ON p.topic_id = t.id
        ORDER BY p.wrong_count DESC NULLS LAST
        LIMIT ?
    `).all(limit);
}

function updateProgress(topicId, isCorrect) {
    const existing = db.prepare('SELECT * FROM progress WHERE topic_id = ?').get(topicId);
    if (existing) {
        db.prepare('UPDATE progress SET correct_count = correct_count + ?, last_practice_at = CURRENT_TIMESTAMP, mastery_level = ? WHERE topic_id = ?').run(
            isCorrect ? 1 : 0,
            isCorrect ? Math.min(1, (existing.correct_count + 1) / (existing.correct_count + existing.wrong_count + 1)) : Math.max(0, (existing.correct_count) / (existing.correct_count + existing.wrong_count + 1)),
            topicId
        );
    } else {
        db.prepare('INSERT INTO progress (topic_id, correct_count, wrong_count, mastery_level) VALUES (?, ?, ?, ?)').run(
            topicId,
            isCorrect ? 1 : 0,
            isCorrect ? 0 : 1,
            isCorrect ? 1.0 : 0.0
        );
    }
}
// ============ REVIEW QUEUE OPERATIONS ============

function addToReviewQueue(topicId, stage = 1) {
    const nextReviewAt = Math.floor(Date.now() / 1000) + REVIEW_INTERVALS[Math.min(stage - 1, REVIEW_INTERVALS.length - 1)];
    const existing = db.prepare('SELECT * FROM review_queue WHERE topic_id = ? AND is_reviewed = 0').get(topicId);
    if (existing) {
        db.prepare('UPDATE review_queue SET stage = ?, next_review_at = ?, is_reviewed = 0 WHERE topic_id = ?').run(stage, nextReviewAt, topicId);
    } else {
        db.prepare('INSERT INTO review_queue (topic_id, stage, next_review_at, is_reviewed) VALUES (?, ?, ?, 0)').run(topicId, stage, nextReviewAt);
    }
}

function getReviewQueue() {
    return db.prepare('SELECT * FROM review_queue WHERE is_reviewed = 0 ORDER BY next_review_at ASC').all();
}

function getDueReviews(currentTime = null) {
    if (!currentTime) currentTime = Math.floor(Date.now() / 1000);
    return db.prepare('SELECT * FROM review_queue WHERE next_review_at <= ? AND is_reviewed = 0 ORDER BY next_review_at ASC').all(currentTime);
}

function updateReviewStage(topicId, correct) {
    const existing = db.prepare('SELECT * FROM review_queue WHERE topic_id = ? AND is_reviewed = 0').get(topicId);
    if (!existing) return null;
    
    let newStage, nextReviewAt, isReviewed = 0;
    if (correct) {
        newStage = Math.min(existing.stage + 1, 5);
        nextReviewAt = Math.floor(Date.now() / 1000) + REVIEW_INTERVALS[Math.min(newStage - 1, REVIEW_INTERVALS.length - 1)];
        if (newStage === 5) isReviewed = 1;
    } else {
        newStage = 1;
        nextReviewAt = Math.floor(Date.now() / 1000) + REVIEW_INTERVALS[0];
    }
    
    db.prepare('UPDATE review_queue SET stage = ?, next_review_at = ?, is_reviewed = ? WHERE topic_id = ?').run(newStage, nextReviewAt, isReviewed, topicId);
    return { topic_id: topicId, stage: newStage, next_review_at: nextReviewAt };
}

function removeFromReviewQueue(topicId) {
    db.prepare('DELETE FROM review_queue WHERE topic_id = ?').run(topicId);
}

// ============ UTILITY ============

function getStats() {
    const profile = getProfile();
    const totalTopics = db.prepare('SELECT COUNT(*) as count FROM topics').get();
    const totalMistakes = db.prepare('SELECT SUM(mistake_count) as count FROM mistakes').get();
    const queueSize = db.prepare('SELECT COUNT(*) as count FROM review_queue WHERE is_reviewed = 0').get();
    
    return {
        exam: profile?.exam || '',
        stage: profile?.stage || '',
        exam_date: profile?.exam_date || '',
        total_topics: totalTopics.count,
        total_mistakes: totalMistakes.count || 0,
        review_queue_size: queueSize.count
    };
}

module.exports = {
    initDatabase,
    getProfile, updateProfile, setExam, setExamDate, setStage,
    addSubject, getAllSubjects, getSubject,
    addTopic, getTopics, getTopic,
    addMistake, getMistakesByTopic, getWeakPoints, updateProgress,
    addToReviewQueue, getReviewQueue, getDueReviews, updateReviewStage, removeFromReviewQueue,
    getStats
};
