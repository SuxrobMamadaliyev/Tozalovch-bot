const Database = require('better-sqlite3');
const path = require('path');

// Render.com da fayl tizimi read-only, faqat /tmp yozish mumkin
// Local ishlatganda joriy papkada saqlanadi
const DB_PATH =
  process.env.NODE_ENV === 'production'
    ? path.join('/tmp', 'bot.db')
    : path.join(__dirname, 'bot.db');

const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    lang TEXT DEFAULT 'uz',
    joined_at TEXT DEFAULT (datetime('now')),
    blocked INTEGER DEFAULT 0
  );
`);

module.exports = {
  getUser: (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id),

  saveUser: (id, username, first_name, lang = 'uz') => {
    db.prepare(`
      INSERT INTO users (id, username, first_name, lang)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        username = excluded.username,
        first_name = excluded.first_name
    `).run(id, username || '', first_name || '', lang);
  },

  setLang: (id, lang) =>
    db.prepare('UPDATE users SET lang = ? WHERE id = ?').run(lang, id),

  getLang: (id) => {
    const row = db.prepare('SELECT lang FROM users WHERE id = ?').get(id);
    return row ? row.lang : 'uz';
  },

  getAllUsers: () =>
    db.prepare('SELECT * FROM users WHERE blocked = 0').all(),

  getUserCount: () =>
    db.prepare('SELECT COUNT(*) as c FROM users').get().c,

  blockUser: (id) =>
    db.prepare('UPDATE users SET blocked = 1 WHERE id = ?').run(id),
};
