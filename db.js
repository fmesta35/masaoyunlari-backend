'use strict';

/*
 * GameVerse — Kalıcı katman (SQLite, better-sqlite3)
 *
 *  Tablolar: users (üyelik + e-posta onayı + şifre sıfırlama jetonları),
 *  sessions (giriş anahtarları), friends (arkadaşlık), matches (maç geçmişi).
 *
 *  DB dosyası: GV_DATA_DIR || <repo>/data/gameverse.db
 *  Render'da kalıcı disk takılıysa GV_DATA_DIR=/var/data gibi verilmelidir;
 *  disk yoksa üyelikler yeniden dağıtımda sıfırlanır (uyarı loglanır).
 */

const fs = require('fs');
const path = require('path');

let db = null;
try {
  // UZAK modda kalıcı veri Yöncü MySQL'dir; Render'da SQLite hiç açılmaz.
  if (process.env.GV_AUTH_API) {
    console.log('💾 UZAK mod: kalıcı veri Yöncü\'de — yerel SQLite devre dışı.');
  } else {
  const Database = require('better-sqlite3');
  const dir = process.env.GV_DATA_DIR || path.join(__dirname, 'data');
  fs.mkdirSync(dir, { recursive: true });
  if (!process.env.GV_DATA_DIR && process.env.RENDER) {
    console.warn('⚠️  GV_DATA_DIR tanımlı değil: Render disk geçicidir, üyelikler yeniden dağıtımda SIFIRLANABİLİR. Kalıcı disk ekleyip GV_DATA_DIR=/var/data verin.');
  }
  db = new Database(path.join(dir, 'gameverse.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      pass_hash TEXT NOT NULL,
      verified INTEGER NOT NULL DEFAULT 0,
      verify_token TEXT,
      verify_sent_at INTEGER,
      reset_token TEXT,
      reset_expires INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions(
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS friends(
      user_id INTEGER NOT NULL,
      friend_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(user_id, friend_id)
    );
    CREATE TABLE IF NOT EXISTS friend_requests(
      from_id INTEGER NOT NULL,
      to_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(from_id, to_id)
    );
    CREATE TABLE IF NOT EXISTS matches(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id TEXT NOT NULL,
      room_id TEXT,
      players TEXT NOT NULL,
      winner TEXT,
      reason TEXT,
      ts INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_matches_ts ON matches(ts);
  `);
  console.log('💾 SQLite veritabanı hazır (' + path.join(dir, 'gameverse.db') + ')');
  }
} catch (e) {
  console.warn('⚠️  SQLite yüklenemedi, üyelik katmanı devre dışı:', e.message);
  db = null;
}

module.exports = { db };
