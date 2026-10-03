'use strict';

/*
 * KELİME BİLDİRİMLERİ — Kelimelik'te oyuncunun "bu kelime TDK'de var ama
 * oyun kabul etmedi" diye ilettiği kayıtlar. Kelimelik'in kendisinde bu
 * iş e-postayla yürüyor; burada oyun içinden gelir ve Kurucu Paneli'nde
 * görünür. Doğrulanan kelimeler kelimelik-sozluk.txt'ye eklenir
 * (tools/kelimelik-sozluk.py yeniden üretirken EK_LISTE'ye yazılır).
 *
 * play-counts.js ile aynı gerekçeyle db.js'ten bağımsız basit bir JSON
 * dosyası: üyelik modu ne olursa olsun (yerel SQLite / uzak MySQL) çalışır.
 */

const fs = require('fs');
const path = require('path');

const DIR = process.env.GV_DATA_DIR || path.join(__dirname, 'data');
const FILE = path.join(DIR, 'kelimelik-bildirim.json');
const SINIR = 2000;                 // en fazla bu kadar kayıt tutulur

let kayitlar = [];
try {
  fs.mkdirSync(DIR, { recursive: true });
  if (fs.existsSync(FILE)) {
    const ham = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (Array.isArray(ham)) kayitlar = ham;
  }
} catch (_) { kayitlar = []; }

let yazmaBekliyor = null;
function yaz() {
  if (yazmaBekliyor) return;
  yazmaBekliyor = setTimeout(() => {
    yazmaBekliyor = null;
    try {
      fs.mkdirSync(DIR, { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify(kayitlar), 'utf8');
    } catch (e) { console.error('[kelimelik] bildirim yazılamadı:', e && e.message); }
  }, 800);
  if (yazmaBekliyor.unref) yazmaBekliyor.unref();
}

/* Aynı kelime birden çok kez bildirilirse yeni satır açmak yerine sayacı
   artır: panelde "kaç oyuncu bildirdi" bilgisi asıl karar ölçütüdür. */
function ekle(kayit) {
  if (!kayit || !Array.isArray(kayit.kelimeler) || !kayit.kelimeler.length) return null;
  const sonuc = [];
  for (const k of kayit.kelimeler) {
    let v = kayitlar.find(x => x.kelime === k);
    if (v) {
      v.adet++; v.sonTs = kayit.ts || Date.now();
      if (kayit.not && !v.notlar.includes(kayit.not)) v.notlar.push(String(kayit.not).slice(0, 120));
      if (v.notlar.length > 5) v.notlar = v.notlar.slice(-5);
    } else {
      v = { kelime: k, adet: 1, durum: 'bekliyor', notlar: kayit.not ? [kayit.not] : [],
            ilkTs: kayit.ts || Date.now(), sonTs: kayit.ts || Date.now(),
            oda: kayit.oda || null, kim: kayit.kim || null, uid: kayit.uid || null };
      kayitlar.push(v);
    }
    sonuc.push(v);
  }
  if (kayitlar.length > SINIR) kayitlar = kayitlar.slice(-SINIR);
  yaz();
  return sonuc;
}

function liste(opts) {
  const o = opts || {};
  let out = kayitlar.slice();
  if (o.durum) out = out.filter(x => x.durum === o.durum);
  out.sort((a, b) => (b.adet - a.adet) || (b.sonTs - a.sonTs));
  const limit = Math.max(1, Math.min(500, Number(o.limit) || 200));
  return out.slice(0, limit);
}

/* durum: 'bekliyor' | 'eklendi' | 'reddedildi' */
function durumAta(kelime, durum) {
  const v = kayitlar.find(x => x.kelime === kelime);
  if (!v) return false;
  if (!['bekliyor', 'eklendi', 'reddedildi'].includes(durum)) return false;
  v.durum = durum; yaz();
  return true;
}

function sayilar() {
  const s = { toplam: kayitlar.length, bekliyor: 0, eklendi: 0, reddedildi: 0 };
  for (const k of kayitlar) if (s[k.durum] !== undefined) s[k.durum]++;
  return s;
}

module.exports = { ekle, liste, durumAta, sayilar, _dosya: FILE };
