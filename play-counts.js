'use strict';

/*
 * GERÇEK OYNANMA SAYAÇLARI — "hangi oyun en çok oynandı?" sorusunun tek
 * doğruluk kaynağı. Eskiden ana sayfadaki "Popüler Oyunlar" ve oyun
 * kartlarındaki sayı, GAMES[id].p adında sabit/uydurma bir rakamdı
 * (kullanıcı raporu: "teorik olarak gösterilen oyuncu sayıları").
 *
 * Bu modül, db.js'ten BİLEREK bağımsız tutulur: db.js yalnız YEREL modda
 * (GV_AUTH_API tanımsızken) SQLite açar, ÜYELİK/PUAN verisi üretimde
 * (uzak mod, Yöncü MySQL) hiç dokunulmaz. Ama "kaç kez oynandı" sayacı
 * üyelik moduna bakmaksızın — ziyaretçi maçları dahil — HER modda gerçek
 * kalmalı. Bu yüzden basit bir JSON dosyasına (aynı GV_DATA_DIR altına)
 * yazılır; ne SQLite ne MySQL şart koşar, iki modda da çalışır.
 *
 * Not: Render'da GV_DATA_DIR kalıcı bir diske işaret etmiyorsa (bkz.
 * db.js'teki aynı uyarı), sayaçlar yeniden dağıtımda sıfırlanabilir —
 * bu, üyelik verisiyle aynı bilinen kısıtlamadır.
 */

const fs = require('fs');
const path = require('path');

const DIR = process.env.GV_DATA_DIR || path.join(__dirname, 'data');
const FILE = path.join(DIR, 'play-counts.json');

let counts = Object.create(null);
try {
  fs.mkdirSync(DIR, { recursive: true });
  if (fs.existsSync(FILE)) {
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (parsed && typeof parsed === 'object') counts = parsed;
  }
} catch (e) {
  console.warn('⚠️  oynanma sayaçları okunamadı (sıfırdan başlanıyor):', e.message);
}

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  // Kısa bir gecikmeyle biriktirip yaz: art arda biten maçlarda diske her
  // seferinde ayrı ayrı yazmayı (I/O baskısı) önler.
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(FILE, JSON.stringify(counts)); } catch (e) {
      console.warn('⚠️  oynanma sayaçları diske yazılamadı:', e.message);
    }
  }, 500);
}

// Bir maç GERÇEKTEN tamamlandığında (yalnız bir kez) çağrılır — üye ya da
// ziyaretçi ayrımı YOK, "kaç kez oynandı" tamamen gerçek maç sayısıdır.
function bump(gameId) {
  if (!gameId) return;
  const k = String(gameId);
  counts[k] = (Number(counts[k]) || 0) + 1;
  persist();
}

function all() {
  return Object.assign(Object.create(null), counts);
}

module.exports = { bump, all };
