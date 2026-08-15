/**
 * Data Migration Script: JSON to SQLite (v2.0 - No Chunk)
 *
 * Usage:
 *   node migrate.js                              # 使用默认路径
 *   node migrate.js --state ./path/user_state.json
 *   node migrate.js --state ./path/user_state.json --chunks ./path/chunks/
 *
 * Environment variables:
 *   ENGLISH_MIGRATE_STATE  - path to user_state.json (default: ../../user_state.json)
 *   ENGLISH_MIGRATE_CHUNKS - path to chunk directory (default: ../../)
 */

const fs = require('fs');
const path = require('path');
const db = require('./db.js');

// Parse arguments
function parseArgs() {
    const args = process.argv.slice(2);
    const config = {
        statePath: process.env.ENGLISH_MIGRATE_STATE || path.join(__dirname, '../../user_state.json'),
        chunkDir: process.env.ENGLISH_MIGRATE_CHUNKS || path.join(__dirname, '../../')
    };

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--state' && args[i + 1]) {
            config.statePath = args[++i];
        } else if (args[i] === '--chunks' && args[i + 1]) {
            config.chunkDir = args[++i];
        } else if (args[i] === '--help' || args[i] === '-h') {
            console.log(`
Usage: node migrate.js [options]

Options:
  --state <path>   Path to user_state.json (default: ../../user_state.json)
  --chunks <path>  Path to chunk directory (default: ../../)
  --help, -h       Show this help

Environment:
  ENGLISH_MIGRATE_STATE   - Override state path
  ENGLISH_MIGRATE_CHUNKS  - Override chunk directory
            `);
            process.exit(0);
        }
    }

    return config;
}

function migrate() {
    const config = parseArgs();
    console.log('Starting migration from JSON to SQLite (v2.0)...');
    console.log(`State file: ${config.statePath}`);
    console.log(`Chunk dir: ${config.chunkDir}`);

    // 1. Migrate user_state.json
    if (fs.existsSync(config.statePath)) {
        const userState = JSON.parse(fs.readFileSync(config.statePath, 'utf8'));

        db.updateProfile({
            target_exam: userState.profile?.target_exam,
            vocabulary_level: userState.profile?.vocabulary_level,
            grammar_basis: userState.profile?.grammar_basis,
            total_words_count: userState.sys_meta?.total_words_count
        });
        console.log('✓ User profile migrated');

        // Migrate review queue
        if (userState.review_queue && userState.review_queue.length > 0) {
            userState.review_queue.forEach(item => {
                db.addToReviewQueue(item.word, item.stage, item.next_review_time);
            });
            console.log(`✓ Review queue migrated (${userState.review_queue.length} items)`);
        }

        // Migrate history logs
        if (userState.history_logs && userState.history_logs.length > 0) {
            userState.history_logs.forEach(log => {
                db.addLog(log.date, log.type, log.count);
            });
            console.log(`✓ History logs migrated (${userState.history_logs.length} items)`);
        }
    } else {
        console.log('⚠ user_state.json not found, skipping user profile migration');
    }

    // 2. Migrate chunk files
    const vocabIndexPath = path.join(config.chunkDir, 'vocab_index.json');
    if (fs.existsSync(vocabIndexPath)) {
        const vocabIndex = JSON.parse(fs.readFileSync(vocabIndexPath, 'utf8'));

        let migrated = 0;
        for (const [word, chunkId] of Object.entries(vocabIndex)) {
            const chunkPath = path.join(config.chunkDir, `chunk_${chunkId}.json`);
            if (fs.existsSync(chunkPath)) {
                const chunkData = JSON.parse(fs.readFileSync(chunkPath, 'utf8'));
                if (chunkData[word]) {
                    const wordData = chunkData[word];
                    db.addWord({
                        word: word,
                        pos: wordData.pos,
                        meaning: wordData.meaning,
                        frequency: wordData.frequency,
                        collocation: wordData.collocation,
                        example: wordData.example,
                        tips: wordData.tips,
                        tag: wordData.tag
                    });
                    migrated++;
                }
            }
        }
        console.log(`✓ Words migrated from chunk files (${migrated} words)`);
    } else {
        console.log('⚠ vocab_index.json not found, skipping word migration');
    }

    // Print stats
    const stats = db.getStats();
    console.log('\nMigration complete!');
    console.log('Stats:', JSON.stringify(stats, null, 2));
}

migrate();
