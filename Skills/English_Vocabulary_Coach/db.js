/**
 * SQLite Database Layer for English Vocabulary Coach
 * Uses better-sqlite3 for safe parameterized queries
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.ENGLISH_DB_PATH || path.join(__dirname, 'vocabulary.db');

// Auto-create directory if it doesn't exist
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent access
db.pragma('journal_mode = WAL');

function initDatabase() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_profile (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            target_exam TEXT DEFAULT '',
            vocabulary_level TEXT DEFAULT 'Medium',
            grammar_basis TEXT DEFAULT 'Weak',
            total_words_count INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS words (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            word TEXT UNIQUE NOT NULL,
            pos TEXT,
            meaning TEXT,
            frequency INTEGER DEFAULT 0,
            collocation TEXT,
            example TEXT,
            tips TEXT,
            tag TEXT,
            created_at INTEGER DEFAULT (strftime('%s', 'now'))
        );

        CREATE TABLE IF NOT EXISTS review_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            word TEXT NOT NULL,
            stage INTEGER DEFAULT 1,
            next_review_time INTEGER,
            is_reviewed INTEGER DEFAULT 0,
            FOREIGN KEY (word) REFERENCES words(word)
        );

        CREATE TABLE IF NOT EXISTS history_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT,
            type TEXT,
            count INTEGER DEFAULT 0,
            UNIQUE(date, type)
        );

        CREATE INDEX IF NOT EXISTS idx_words_word ON words(word);
        CREATE INDEX IF NOT EXISTS idx_words_tag ON words(tag);
        CREATE INDEX IF NOT EXISTS idx_review_queue_time ON review_queue(next_review_time);
        CREATE INDEX IF NOT EXISTS idx_review_queue_word ON review_queue(word);
        CREATE INDEX IF NOT EXISTS idx_review_queue_due ON review_queue(next_review_time ASC, is_reviewed ASC);
        CREATE INDEX IF NOT EXISTS idx_history_date ON history_logs(date);

        INSERT OR IGNORE INTO user_profile (id) VALUES (1);
    `);
}

// Initialize on module load
initDatabase();

// ============ HELPER ============

const ALLOWED_PROFILE_KEYS = new Set(['target_exam', 'vocabulary_level', 'grammar_basis', 'total_words_count']);

function parseWordRow(row) {
    if (row.collocation) {
        try { row.collocation = JSON.parse(row.collocation); }
        catch (e) { row.collocation = []; }
    }
    return row;
}

// ============ USER PROFILE OPERATIONS ============

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

function setTargetExam(exam) {
    return updateProfile({ target_exam: exam });
}

// ============ WORDS OPERATIONS ============

function getWord(word) {
    return parseWordRow(db.prepare('SELECT * FROM words WHERE word = ?').get(word));
}

function wordExists(word) {
    const row = db.prepare('SELECT COUNT(*) as count FROM words WHERE word = ?').get(word);
    return row.count > 0;
}

function addWord(wordData) {
    const { word, pos, meaning, frequency, collocation, example, tips, tag } = wordData;
    const collocationJson = Array.isArray(collocation) ? JSON.stringify(collocation) : collocation;

    // Check if word already exists before inserting
    const exists = db.prepare('SELECT COUNT(*) as count FROM words WHERE word = ?').get(word).count;
    db.prepare(
        `INSERT OR REPLACE INTO words (word, pos, meaning, frequency, collocation, example, tips, tag) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(word, pos, meaning, frequency || 0, collocationJson, example, tips, tag);

    // Update total count: increment only on new word
    if (!exists) {
        db.prepare('UPDATE user_profile SET total_words_count = total_words_count + 1 WHERE id = 1').run();
    } else {
        const count = db.prepare('SELECT COUNT(*) as total FROM words').get().total;
        db.prepare('UPDATE user_profile SET total_words_count = ? WHERE id = 1').run(count);
    }

    return true;
}

function getAllWords() {
    return db.prepare('SELECT * FROM words ORDER BY created_at DESC').all().map(parseWordRow);
}

function getWordsByTag(tag) {
    return db.prepare('SELECT * FROM words WHERE tag = ? ORDER BY created_at DESC').all(tag).map(parseWordRow);
}

function getRecentWords(limit = 5) {
    return db.prepare('SELECT * FROM words ORDER BY created_at DESC LIMIT ?').all(limit).map(parseWordRow);
}

function getRandomWords(count = 5) {
    return db.prepare('SELECT * FROM words ORDER BY RANDOM() LIMIT ?').all(count).map(parseWordRow);
}

// ============ REVIEW QUEUE OPERATIONS ============

// Ebbinghaus review intervals in seconds: 1d, 2d, 4d, 8d, 16d (matches Schemas.md)
const REVIEW_INTERVALS = [86400, 172800, 345600, 691200, 1382400];

function addToReviewQueue(word, stage = 1, nextReviewTime = null) {
    if (!nextReviewTime) {
        nextReviewTime = Math.floor(Date.now() / 1000) + REVIEW_INTERVALS[Math.min(stage - 1, REVIEW_INTERVALS.length - 1)];
    }

    const existing = db.prepare('SELECT * FROM review_queue WHERE word = ? AND is_reviewed = 0').get(word);

    if (existing) {
        db.prepare('UPDATE review_queue SET stage = ?, next_review_time = ?, is_reviewed = 0 WHERE word = ?').run(stage, nextReviewTime, word);
    } else {
        db.prepare('INSERT INTO review_queue (word, stage, next_review_time, is_reviewed) VALUES (?, ?, ?, 0)').run(word, stage, nextReviewTime);
    }

    return getReviewQueue();
}

function getReviewQueue() {
    return db.prepare('SELECT * FROM review_queue WHERE is_reviewed = 0 ORDER BY next_review_time ASC').all();
}

function getDueReviews(currentTime = null) {
    if (!currentTime) currentTime = Math.floor(Date.now() / 1000);
    return db.prepare('SELECT * FROM review_queue WHERE next_review_time <= ? AND is_reviewed = 0 ORDER BY next_review_time ASC').all(currentTime);
}

function updateReviewStage(word, correct, currentTime = null) {
    if (!currentTime) currentTime = Math.floor(Date.now() / 1000);

    const existing = db.prepare('SELECT * FROM review_queue WHERE word = ? AND is_reviewed = 0').get(word);
    if (!existing) return null;

    let newStage;
    let nextReviewTime;
    let isReviewed = 0; // Default: keep in queue for future review

    if (correct) {
        newStage = Math.min(existing.stage + 1, 5);
        const intervalIndex = Math.min(newStage - 1, REVIEW_INTERVALS.length - 1);
        nextReviewTime = currentTime + REVIEW_INTERVALS[intervalIndex];
        // Mark as reviewed only when reaching max stage (all stages completed)
        if (newStage === 5) isReviewed = 1;
    } else {
        newStage = 1;
        nextReviewTime = currentTime + REVIEW_INTERVALS[0];
        // Wrong answer: reset and keep in queue
        isReviewed = 0;
    }

    db.prepare('UPDATE review_queue SET stage = ?, next_review_time = ?, is_reviewed = ? WHERE word = ?').run(newStage, nextReviewTime, isReviewed, word);
    return { word, stage: newStage, next_review_time: nextReviewTime };
}

function removeFromReviewQueue(word) {
    db.prepare('DELETE FROM review_queue WHERE word = ?').run(word);
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
    const totalWords = db.prepare('SELECT COUNT(*) as count FROM words').get();
    const queueSize = db.prepare('SELECT COUNT(*) as count FROM review_queue WHERE is_reviewed = 0').get();
    const dueReviews = db.prepare(
        'SELECT COUNT(*) as count FROM review_queue WHERE next_review_time <= ?'
    ).get(Math.floor(Date.now() / 1000)).count;

    return {
        target_exam: profile ? profile.target_exam : '',
        vocabulary_level: profile ? profile.vocabulary_level : 'Medium',
        grammar_basis: profile ? profile.grammar_basis : 'Weak',
        total_words: totalWords.count,
        queue_size: queueSize.count,
        due_reviews: dueReviews
    };
}

module.exports = {
    initDatabase,
    getProfile,
    updateProfile,
    setTargetExam,
    getWord,
    wordExists,
    addWord,
    getAllWords,
    getWordsByTag,
    getRecentWords,
    getRandomWords,
    addToReviewQueue,
    getReviewQueue,
    getDueReviews,
    updateReviewStage,
    removeFromReviewQueue,
    addLog,
    getLogs,
    getLogsByDate,
    getStats
};
