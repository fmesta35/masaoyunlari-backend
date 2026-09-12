'use strict';

/*
 * GameVerse — PUAN ve CEZA SİSTEMİ
 * ================================
 *
 * Tek doğruluk kaynağı: puan kuralları YALNIZ burada tanımlıdır. Sunucu
 * (server.js) maç bitişinde ve masa terkinde buradaki fonksiyonları çağırır;
 * istemci hiçbir puan hesaplamaz (hile önleme).
 *
 * TABLO (kullanıcı onayı ile):
 *
 *   Galibiyet ............................. +25
 *   Beraberlik ............................ +10
 *   Mağlubiyet (masada kalıp bitirdi) ..... +5    ← oynamak her zaman kazandırır
 *   Hamle süresi dolarak mağlubiyet ....... +2    ← oynamamak neredeyse kazandırmaz
 *   Rakibin terkiyle gelen galibiyet ...... +15   ← hak edilmiş ama tam galibiyet değil
 *   Masayı terk ........................... −20
 *   Terk edip geri dönme .................. +10   ← iyi niyet iadesi
 *
 * TERK EDEN OYUNCU NE YAŞAR (kullanıcının tarifi):
 *   1) Masayı terk ettiği anda           −20
 *   2) El bitmeden geri dönerse          +10  (net ceza −10'a iner)
 *   3) Sonrasında NORMAL puanlama devam eder: eli kazanırsa +25, kaybederse
 *      +5 ... yani dönen oyuncu maçın geri kalanında ceza almaz, herkes gibi
 *      sonuca göre puan alır.
 *
 * EL SAYISI ÇARPANI: uzun maç daha değerlidir.
 *   3 el ×1      5 el ×1.25      7 el ×1.5
 * Çarpan YALNIZ maç sonucu puanlarına (galibiyet/beraberlik/mağlubiyet)
 * uygulanır. Terk (−20) ve dönüş (+10) kullanıcının verdiği SABİT
 * değerlerdir, çarpanla oynanmaz.
 *
 * TABAN: bir üyenin toplam puanı 0'ın altına düşmez (moral kırmamak için);
 * tek tek olay kayıtları eksi kalır, yalnız TOPLAM taban uygulanır.
 */

// Olay türleri ve ham puanları
const PUAN = {
  win:        25,   // galibiyet
  draw:       10,   // beraberlik
  loss:        5,   // mağlubiyet (masada kalıp bitirdi)
  timeout:     2,   // hamle süresi dolarak mağlubiyet
  win_left:   15,   // rakibin terkiyle gelen galibiyet
  leave:     -20,   // masayı terk
  rejoin:     10    // terk edip geri dönme
};

// Olayların Türkçe açıklaması (profil ekranı ve kurucu panelinde gösterilir)
const ETIKET = {
  win:      'Galibiyet',
  draw:     'Beraberlik',
  loss:     'Mağlubiyet',
  timeout:  'Süre aşımı mağlubiyeti',
  win_left: 'Rakip terk etti — galibiyet',
  leave:    'Masayı terk',
  rejoin:   'Oyuna geri dönüş'
};

// Maç sonucu puanlarına uygulanan el sayısı çarpanı
function elCarpani(elSayisi) {
  const n = Number(elSayisi) || 0;
  if (n >= 7) return 1.5;
  if (n >= 5) return 1.25;
  return 1;
}

// Terk/dönüş sabittir; sonuç puanları el sayısına göre çarpılır.
const CARPANSIZ = new Set(['leave', 'rejoin']);

function puanHesapla(tur, elSayisi) {
  const ham = PUAN[tur];
  if (ham === undefined) return 0;
  if (CARPANSIZ.has(tur)) return ham;
  return Math.round(ham * elCarpani(elSayisi));
}

/*
 * Bir maçın bitişinden puan olayları üretir.
 *
 *  girdi: {
 *    gameId, roomId, elSayisi,
 *    oyuncular: [{ uid, ad, kazandi, berabere, sureAsimi }],
 *    rakipTerkiyle: bool   // galibiyet rakibin terkiyle mi geldi
 *  }
 *  çıktı: [{ uid, gameId, roomId, tur, puan, ad }]
 *
 * Misafir (uid yok) oyuncular kayıt dışıdır: puan yalnız üye profillerinde
 * tutulur.
 */
function macOlaylari(girdi) {
  const g = girdi || {};
  const el = g.elSayisi;
  const out = [];
  (g.oyuncular || []).forEach(o => {
    if (!o || !(Number(o.uid) > 0)) return;      // misafir: puan yok
    let tur;
    if (o.berabere) tur = 'draw';
    else if (o.kazandi) tur = g.rakipTerkiyle ? 'win_left' : 'win';
    else if (o.sureAsimi) tur = 'timeout';
    else tur = 'loss';
    out.push({
      uid: Number(o.uid), ad: o.ad || null,
      gameId: g.gameId || '', roomId: g.roomId || '',
      tur, puan: puanHesapla(tur, el)
    });
  });
  return out;
}

// Masayı terk eden üye için tek olay.
function terkOlayi({ uid, ad, gameId, roomId }) {
  if (!(Number(uid) > 0)) return null;
  return { uid: Number(uid), ad: ad || null, gameId: gameId || '', roomId: roomId || '',
           tur: 'leave', puan: PUAN.leave };
}

// Terk ettikten sonra el bitmeden geri dönen üye için tek olay.
function donusOlayi({ uid, ad, gameId, roomId }) {
  if (!(Number(uid) > 0)) return null;
  return { uid: Number(uid), ad: ad || null, gameId: gameId || '', roomId: roomId || '',
           tur: 'rejoin', puan: PUAN.rejoin };
}

// Kurucu panelindeki otomatik sıfırlama periyotları (ms).
const PERIYOTLAR = {
  kapali:   0,
  haftalik: 7  * 86400000,
  aylik:    30 * 86400000,
  ceyrek:   90 * 86400000,
  yarim:    180 * 86400000,
  yillik:   365 * 86400000
};
const PERIYOT_ETIKET = {
  kapali:   'Kapalı (yalnız elle sıfırlanır)',
  haftalik: 'Haftalık',
  aylik:    'Aylık',
  ceyrek:   '3 aylık',
  yarim:    '6 aylık',
  yillik:   'Yıllık'
};

module.exports = {
  PUAN, ETIKET, PERIYOTLAR, PERIYOT_ETIKET,
  elCarpani, puanHesapla, macOlaylari, terkOlayi, donusOlayi
};
