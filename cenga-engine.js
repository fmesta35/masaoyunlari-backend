'use strict';
/* ============================================================================
 * CENGA — SUNUCU TARAFI OYUN DURUMU (saf mantık, soket/zamanlayıcı yok)
 * ============================================================================
 * Oyunun kendisi (3B kule, cannon-es fiziği, çekme göstergesi, ses ve
 * efektler) assets/oyunlar/cenga3d.html içinde, kullanıcının verdiği
 * referans kodla BİREBİR aynı çalışır. Fizik, SIRASI OLAN oyuncunun
 * tarayıcısında yürür; sunucu üç iş yapar:
 *
 *   1) KARE RÖLESİ — sıradaki oyuncunun kule/gösterge/ses kareleri
 *      rakibe ve izleyicilere aktarılır (sunucu bu karelere bakmaz).
 *   2) SIRA DEVRİ — sıra bitince yerleşmiş kule + puanlar buraya yazılır;
 *      sıra rakibin tarayıcısına geçer. Geç gelen/yeniden bağlanan oyuncu
 *      kuleyi bu kayıttan kurar.
 *   3) BİTİŞ — kule devrilince kaybeden/kazanan buradan belirlenir.
 *
 * Hile payı: referans oyun istemcide çalıştığı için çekiş becerisi
 * tarayıcıdan doğrulanamaz (kullanıcı bunu bilerek seçti). Yine de sunucu
 * şunları zorlar: yalnız SIRASI OLAN koltuk kare/devir/bitiş yollayabilir,
 * devir paketi biçim ve sınır kontrolünden geçer, kaybeden kendi koltuğu
 * olmak zorundadır (tek istisna: çekilecek taş kalmaması).
 * ========================================================================= */
const crypto = require('crypto');

const TOPLAM_KAT = 18;
const TAS_SAYISI = TOPLAM_KAT * 3;
const EN_YUKSEK_KAT = 60;
const ARD_ARDA_ZAMAN_ASIMI = 3;

function macBaslat(opts) {
  const seats = ((opts && opts.seats) || [0, 1]).slice().sort((a, b) => a - b);
  const skor = {};
  const cekis = {};
  seats.forEach(s => { skor[s] = 0; cekis[s] = 0; });
  return {
    status: 'playing',
    seats,
    turn: seats[0],
    tur: 0,
    seed: (crypto.randomBytes(4).readUInt32BE(0) >>> 0) || 1,
    settled: null,        // [[kat, slot] × 54] — son yerleşmiş kule
    players: null,        // [{name,score,streak,pulls}] — oyuncu sırasına göre
    stability: 1,
    skor, cekis,
    zamanAsimi: 0,
    winner: null,
    loser: null,
    result: null
  };
}

function sayi(v, a, b, d) {
  v = Number(v);
  if (!Number.isFinite(v)) return d;
  return Math.max(a, Math.min(b, v));
}

function digeri(c, seat) { return c.seats.find(s => s !== seat); }

/* Yerleşmiş kule geçerli mi? 54 taşın her biri benzersiz (kat, slot) çiftinde. */
function kuleGecerli(settled) {
  if (!Array.isArray(settled) || settled.length !== TAS_SAYISI) return false;
  const gorulen = new Set();
  for (const r of settled) {
    if (!Array.isArray(r) || r.length !== 2) return false;
    const l = r[0], s = r[1];
    if (!Number.isInteger(l) || !Number.isInteger(s)) return false;
    if (l < 0 || l > EN_YUKSEK_KAT || s < 0 || s > 2) return false;
    const k = l * 3 + s;
    if (gorulen.has(k)) return false;
    gorulen.add(k);
  }
  return true;
}

function oyuncular(c, ham) {
  if (!Array.isArray(ham) || ham.length !== c.seats.length) return null;
  return ham.map(p => ({
    name: String((p && p.name) || '').slice(0, 24),
    score: Math.round(sayi(p && p.score, 0, 1e6, 0)),
    streak: Math.round(sayi(p && p.streak, 0, 1e3, 0)),
    pulls: Math.round(sayi(p && p.pulls, 0, 1e4, 0))
  }));
}

function skorYaz(c) {
  if (!c.players) return;
  c.seats.forEach((s, i) => {
    c.skor[s] = c.players[i].score;
    c.cekis[s] = c.players[i].pulls;
  });
}

/* Sıra bitti: yerleşmiş kule + puanlar yazılır, sıra rakibe geçer. */
function turDevret(c, seat, p) {
  if (!c || c.status !== 'playing') return { ok: false, reason: 'game_over' };
  if (seat !== c.turn) return { ok: false, reason: 'not_your_turn' };
  if (!p || !Number.isInteger(p.current) || p.current < 0 || p.current >= c.seats.length) {
    return { ok: false, reason: 'gecersiz_tur' };
  }
  const sonraki = c.seats[p.current];
  if (sonraki === seat) return { ok: false, reason: 'gecersiz_tur' };
  if (!kuleGecerli(p.settled)) return { ok: false, reason: 'gecersiz_tas' };
  const pl = oyuncular(c, p.players);
  if (!pl) return { ok: false, reason: 'gecersiz_tur' };
  c.players = pl;
  c.settled = p.settled.map(r => [r[0], r[1]]);
  c.stability = sayi(p.stability, 0, 1, 1);
  c.tur = Math.round(sayi(p.turn, 0, 1e5, c.tur + 1));
  c.turn = sonraki;
  c.zamanAsimi = 0;
  skorYaz(c);
  return { ok: true, sonraki };
}

/* Kule devrildi / çekilecek taş kalmadı. */
function bitir(c, seat, info) {
  if (!c || c.status !== 'playing') return { ok: false, reason: 'game_over' };
  if (seat !== c.turn) return { ok: false, reason: 'not_your_turn' };
  if (!info || !Number.isInteger(info.loser) || info.loser < 0 || info.loser >= c.seats.length) {
    return { ok: false, reason: 'gecersiz_tur' };
  }
  const neden = ['balance', 'structure', 'nomoves'].includes(info.reason) ? info.reason : 'balance';
  const kaybeden = c.seats[info.loser];
  /* Devrilmeyi kişi kendi elinde yaşar; rakibi kaybettirme yalnız "çekilecek
     taş kalmadı" durumunda (sıra zaten rakibe geçmiştir) mümkündür. */
  if (kaybeden !== seat && neden !== 'nomoves') return { ok: false, reason: 'gecersiz_tur' };
  const pl = oyuncular(c, info.players);
  if (pl) { c.players = pl; skorYaz(c); }
  c.status = 'finished';
  c.loser = kaybeden;
  c.winner = digeri(c, kaybeden);
  c.result = { neden: neden === 'nomoves' ? 'tas_bitti' : neden === 'structure' ? 'yapi' : 'denge', kaybeden };
  return { ok: true, kaybeden, kazanan: c.winner };
}

/* Süre doldu: istemciye "taşı seç / el kaysın" denir. Tarayıcı yanıt
   vermiyorsa (kapalı sekme) ardışık üçüncü aşımda hükmen mağlubiyet. */
function sureDoldu(c) {
  if (!c || c.status !== 'playing') return null;
  c.zamanAsimi = (c.zamanAsimi || 0) + 1;
  const tur = c.tur;
  if (c.zamanAsimi >= ARD_ARDA_ZAMAN_ASIMI) {
    const kaybeden = c.turn;
    c.status = 'finished';
    c.loser = kaybeden;
    c.winner = digeri(c, kaybeden);
    c.result = { neden: 'sure', kaybeden };
    return { tur, hukmen: true, kaybeden };
  }
  return { tur, hukmen: false };
}

function pesEt(c, loserSeat) {
  if (!c || c.status !== 'playing') return;
  c.status = 'finished';
  c.loser = loserSeat;
  c.winner = digeri(c, loserSeat);
  c.result = { neden: 'pes', reason: 'resign', kaybeden: loserSeat };
}

function gorunum(c, seat, extra) {
  if (!c) return null;
  const v = {
    kind: 'cenga',
    status: c.status,
    seat: (seat === 0 || seat === 1) ? seat : null,
    seats: c.seats.slice(),
    turn: c.status === 'playing' ? c.turn : null,
    tur: c.tur,
    seed: c.seed,
    settled: c.settled,
    players: c.players,
    stability: c.stability,
    skor: Object.assign({}, c.skor),
    cekis: Object.assign({}, c.cekis),
    winner: c.winner,
    result: c.result ? Object.assign({}, c.result) : null
  };
  return Object.assign(v, extra || {});
}

module.exports = {
  TOPLAM_KAT, TAS_SAYISI, ARD_ARDA_ZAMAN_ASIMI,
  macBaslat, turDevret, bitir, sureDoldu, pesEt, gorunum, kuleGecerli
};
