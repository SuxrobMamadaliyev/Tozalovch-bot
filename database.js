const Database = require('better-sqlite3');
const db = new Database('bot.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    lang TEXT DEFAULT 'en',
    joined_at TEXT DEFAULT (datetime('now')),
    blocked INTEGER DEFAULT 0
  );
`);

module.exports = {
  getUser: (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id),

  saveUser: (id, username, first_name, lang = 'en') => {
    db.prepare(`
      INSERT INTO users (id, username, first_name, lang)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET username=excluded.username, first_name=excluded.first_name
    `).run(id, username || '', first_name || '', lang);
  },

  setLang: (id, lang) => db.prepare('UPDATE users SET lang = ? WHERE id = ?').run(lang, id),

  getLang: (id) => {
    const row = db.prepare('SELECT lang FROM users WHERE id = ?').get(id);
    return row ? row.lang : 'en';
  },

  getAllUsers: () => db.prepare('SELECT * FROM users WHERE blocked = 0').all(),

  getUserCount: () => db.prepare('SELECT COUNT(*) as c FROM users').get().c,

  blockUser: (id) => db.prepare('UPDATE users SET blocked = 1 WHERE id = ?').run(id),
};
