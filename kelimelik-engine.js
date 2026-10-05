'use strict';
/* GameVerse — KELİMELİK MOTORU (sunucu yetkili)
 *
 * Kelimelik iki kişiliktir ve 15×15 tahtada oynanır. Bu dosya oyunun BÜTÜN
 * kurallarını işletir; istemci yalnız çizer ve hamle önerir. Sözlük de
 * burada durur: istemciye hiç inmez, bu yüzden kelime uydurulamaz ve
 * "sözlük dışına izin ver" gibi bir anahtar teknik olarak mümkün değildir.
 *
 * SÖZLÜK KURALI (Kelimelik'in kendi kuralı): TDK Güncel Türkçe Sözlük'te
 * MADDE BAŞI ne ise o geçerlidir. Ek almış biçimler (kediler, evde, geldim)
 * geçerli DEĞİLDİR; fiiller mastar hâliyle bulunur (gel ✗ / gelmek ✓).
 * Liste kelimelik-sozluk.txt'tedir, tools/kelimelik-sozluk.py üretir.
 *
 * SİTE KURALLARI:
 *  - Hamle süresi masa tipindedir; süresi dolan PAS geçmiş sayılır.
 *  - Hamle yapılamıyorsa oyuncu masadan ATILMAZ, sırası otomatik pas geçilir.
 *  - Aynı oyuncu ÜST ÜSTE 3 kez pas geçerse (elle, otomatik ya da süre
 *    aşımıyla) DİSKALİFİYE olur: puanı silinir, rakip hükmen kazanır.
 *  - İki oyuncu da üst üste ikişer kez pas geçerse maç biter.
 *  - Torba boşalıp bir oyuncu taşlarını bitirince maç biter; rakibin elinde
 *    kalan taşların puanı ondan düşülüp bitirene eklenir.
 */

const fs = require('fs');
const path = require('path');

const N = 15;                       // tahta kenarı
const ISTAKA = 7;                   // ıstakadaki taş sayısı
const BINGO = 35;                   // yedi harfin tamamı kullanılırsa ek puan
const PAS_SINIRI = 3;               // üst üste bu kadar pas → diskalifiye

/* Türkçe harf dağılımı — 100 taş (2 joker dahil). */
const HARFLER = {
  'A': { p: 1, n: 12 }, 'B': { p: 3, n: 2 }, 'C': { p: 4, n: 2 }, 'Ç': { p: 4, n: 2 },
  'D': { p: 3, n: 2 }, 'E': { p: 1, n: 8 }, 'F': { p: 7, n: 1 }, 'G': { p: 5, n: 1 },
  'Ğ': { p: 8, n: 1 }, 'H': { p: 5, n: 1 }, 'I': { p: 2, n: 4 }, 'İ': { p: 1, n: 7 },
  'J': { p: 10, n: 1 }, 'K': { p: 1, n: 7 }, 'L': { p: 1, n: 7 }, 'M': { p: 2, n: 4 },
  'N': { p: 1, n: 5 }, 'O': { p: 2, n: 3 }, 'Ö': { p: 7, n: 1 }, 'P': { p: 5, n: 1 },
  'R': { p: 1, n: 6 }, 'S': { p: 2, n: 3 }, 'Ş': { p: 4, n: 2 }, 'T': { p: 1, n: 5 },
  'U': { p: 2, n: 3 }, 'Ü': { p: 3, n: 2 }, 'V': { p: 7, n: 1 }, 'Y': { p: 3, n: 2 },
  'Z': { p: 4, n: 2 }, '*': { p: 0, n: 2 }
};
const ALFABE = Object.keys(HARFLER).filter(h => h !== '*');

/* Klasik 15×15 bonus deseni. T=K³ D=K² 3=H³ 2=H² *=başlangıç .=boş */
const DUZEN = [
  'T..2...T...2..T', '.D...3...3...D.', '..D...2.2...D..', '2..D...2...D..2',
  '....D.....D....', '.3...3...3...3.', '..2...2.2...2..', 'T..2...*...2..T',
  '..2...2.2...2..', '.3...3...3...3.', '....D.....D....', '2..D...2...D..2',
  '..D...2.2...D..', '.D...3...3...D.', 'T..2...T...2..T'
];
const TIP = { 'T': 'k3', 'D': 'k2', '3': 'h3', '2': 'h2', '*': 'merkez' };
const MERKEZ = [7, 7];
const BONUS = DUZEN.map(satir => satir.split('').map(ch => TIP[ch] || ''));

/* --------------------------------------------------------------- SÖZLÜK */
/* Düz toUpperCase 'i'yi 'I' yapar; Türkçede 'İ' olmalı. Sözlük ve tahta aynı
   kuralla büyütülmezse "kedi" → "KEDI" olur ve geçerli kelimeler reddedilir. */
function trBuyuk(s) {
  try { return String(s).toLocaleUpperCase('tr-TR'); }
  catch (_) { return String(s).replace(/i/g, 'İ').replace(/ı/g, 'I').toUpperCase(); }
}
function trKucuk(s) {
  try { return String(s).toLocaleLowerCase('tr-TR'); }
  catch (_) { return String(s).replace(/I/g, 'ı').replace(/İ/g, 'i').toLowerCase(); }
}

let SOZLUK = null;              // Set<string> — BÜYÜK harfli
let SOZLUK_LISTE = null;        // ıstakadan kelime çıkarmak için dizi
function sozlukYukle(yol) {
  if (SOZLUK) return SOZLUK;
  const dosya = yol || path.join(__dirname, 'kelimelik-sozluk.txt');
  let ham = '';
  try { ham = fs.readFileSync(dosya, 'utf8'); }
  catch (e) {
    /* Sözlük okunamazsa oyun hiç açılmamalı: aksi halde her kelime
       reddedilir ve oyuncular sebebini anlamaz. */
    console.error('[kelimelik] SÖZLÜK OKUNAMADI:', dosya, e && e.message);
    ham = '';
  }
  SOZLUK = new Set();
  SOZLUK_LISTE = [];
  for (const satir of ham.split('\n')) {
    const k = satir.trim();
    if (k.length < 2) continue;
    const b = trBuyuk(k);
    SOZLUK.add(b);
    if (b.length <= ISTAKA) SOZLUK_LISTE.push(b);
  }
  return SOZLUK;
}
function sozluktekiMi(kelime) {
  sozlukYukle();
  return SOZLUK.has(trBuyuk(kelime));
}
function sozlukBoyu() { sozlukYukle(); return SOZLUK.size; }

/* ---------------------------------------------------------------- "BUNU MU?"
 * Reddedilen kelimeye BİR harf uzaklıktaki sözlük kelimelerini bulur.
 * Kullanıcı raporu: "MARMALAT kelimesi nasıl Türkçe olmaz" — doğrusu
 * MARMELAT'tı ve sözlükte VAR. Oyuncu bunu göremediği için sözlüğü suçluyordu.
 * Artık ret mesajı "bunu mu demek istedin" diye yazıyor.
 * Tek harf değişimi / eksikliği / fazlalığı taranır: 7 harflik bir kelime için
 * birkaç yüz küme sorgusu, yani ölçülemeyecek kadar hızlı.
 */
const TR_HARFLER = 'ABCÇDEFGĞHIİJKLMNOÖPRSŞTUÜVYZ'.split('');
function benzerKelimeler(kelime, enCok) {
  sozlukYukle();
  const k = trBuyuk(String(kelime || ''));
  const n = enCok || 3;
  if (k.length < 2 || SOZLUK.has(k)) return [];
  const bulunan = [];
  const ekle = (w) => {
    if (w !== k && SOZLUK.has(w) && bulunan.indexOf(w) === -1) bulunan.push(w);
  };
  // 1) bir harfi değiştir
  for (let i = 0; i < k.length && bulunan.length < n * 4; i++) {
    for (const h of TR_HARFLER) {
      if (h === k[i]) continue;
      ekle(k.slice(0, i) + h + k.slice(i + 1));
    }
  }
  // 2) bir harfi çıkar
  for (let i = 0; i < k.length; i++) ekle(k.slice(0, i) + k.slice(i + 1));
  // 3) bir harf ekle
  for (let i = 0; i <= k.length; i++) {
    for (const h of TR_HARFLER) ekle(k.slice(0, i) + h + k.slice(i));
  }
  // 4) komşu iki harfi yer değiştir
  for (let i = 0; i + 1 < k.length; i++) {
    ekle(k.slice(0, i) + k[i + 1] + k[i] + k.slice(i + 2));
  }
  /* Aynı uzunlukta olanlar önce: yazım hatası genelde harf değişimidir. */
  bulunan.sort((a, b) => Math.abs(a.length - k.length) - Math.abs(b.length - k.length));
  return bulunan.slice(0, n);
}

/* ------------------------------------------------------------- YARDIMCI */
function harfPuani(h) { return (HARFLER[h] && HARFLER[h].p) || 0; }
function karistir(dizi) {
  for (let i = dizi.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [dizi[i], dizi[j]] = [dizi[j], dizi[i]];
  }
  return dizi;
}
function torbaKur() {
  const t = [];
  for (const h of Object.keys(HARFLER)) for (let i = 0; i < HARFLER[h].n; i++) t.push(h);
  return karistir(t);
}

/* ----------------------------------------------------------------- INIT */
function init(opts) {
  sozlukYukle();
  const st = {
    N, kind: 'kelimelik',
    board: Array.from({ length: N }, () => Array(N).fill(null)),
    bag: torbaKur(),
    racks: [[], []],
    scores: [0, 0],
    turn: 0,
    status: 'playing',
    winner: null,
    passStreak: [0, 0],          // kişi bazlı ÜST ÜSTE pas
    totalPasses: 0,              // iki taraf toplam üst üste pas (maç bitişi)
    lastSquares: [],
    moves: 0,
    history: [],                 // {seat, tur:'move'|'pass'|'swap'|'auto'|'dq', metin, puan}
    result: null,
    turnLimitMs: Math.max(10000, Number(opts && opts.turnLimitMs) || 60000)
  };
  doldur(st, 0); doldur(st, 1);
  return st;
}
function doldur(st, seat) {
  while (st.racks[seat].length < ISTAKA && st.bag.length) st.racks[seat].push(st.bag.pop());
}

/* ------------------------------------------------------- KURAL DENETİMİ */
function tasVar(st, r, c) { return r >= 0 && c >= 0 && r < N && c < N && !!st.board[r][c]; }
function bosKare(st, r, c) { return r >= 0 && c >= 0 && r < N && c < N && !st.board[r][c]; }
function tahtaBos(st) {
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (st.board[r][c]) return false;
  return true;
}

/* konumlar: [{r,c,harf,joker}] — HENÜZ tahtaya konmamış yeni taşlar. */
function kelimeleriTopla(st, konumlar) {
  const g = konumlar;
  if (!g.length) return { hata: 'bos_hamle' };
  const ayniSatir = g.every(t => t.r === g[0].r);
  const ayniSutun = g.every(t => t.c === g[0].c);
  if (!ayniSatir && !ayniSutun) return { hata: 'tek_hat_degil' };
  const yatay = (g.length === 1) ? null : ayniSatir;

  /* Geçici olarak tahtaya koy — bütün denetimler tam tahtada yapılır. */
  const yeni = new Set();
  for (const t of g) {
    if (!bosKare(st, t.r, t.c)) { geriAl(); return { hata: 'kare_dolu' }; }
    st.board[t.r][t.c] = { harf: t.harf, joker: !!t.joker };
    yeni.add(t.r + ',' + t.c);
  }
  function geriAl() { for (const t of g) if (yeni.has(t.r + ',' + t.c)) st.board[t.r][t.c] = null; }

  if (g.length > 1) {
    const sabit = yatay ? g[0].r : g[0].c;
    const dizi = g.map(t => (yatay ? t.c : t.r)).sort((a, b) => a - b);
    for (let v = dizi[0]; v <= dizi[dizi.length - 1]; v++) {
      const rr = yatay ? sabit : v, cc = yatay ? v : sabit;
      if (!tasVar(st, rr, cc)) { geriAl(); return { hata: 'arada_bosluk' }; }
    }
  }

  const ilkHamle = g.length === yeniSayisi(st);
  if (ilkHamle) {
    if (!g.some(t => t.r === MERKEZ[0] && t.c === MERKEZ[1])) { geriAl(); return { hata: 'merkezden_gecmeli' }; }
    if (g.length < 2) { geriAl(); return { hata: 'en_az_iki_harf' }; }
  } else {
    const temas = g.some(t => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(d => {
      const rr = t.r + d[0], cc = t.c + d[1];
      return tasVar(st, rr, cc) && !yeni.has(rr + ',' + cc);
    }));
    if (!temas) { geriAl(); return { hata: 'temas_yok' }; }
  }

  function kelimeAl(r, c, yat) {
    const dr = yat ? 0 : 1, dc = yat ? 1 : 0;
    let sr = r, sc = c;
    while (tasVar(st, sr - dr, sc - dc)) { sr -= dr; sc -= dc; }
    const kareler = []; let metin = '', rr = sr, cc = sc;
    while (tasVar(st, rr, cc)) { kareler.push([rr, cc]); metin += st.board[rr][cc].harf; rr += dr; cc += dc; }
    return { metin, kareler };
  }
  const kelimeler = [], gorulen = new Set();
  const ekle = k => {
    if (k.kareler.length < 2) return;
    const a = k.kareler[0].join(',') + '>' + k.kareler[k.kareler.length - 1].join(',');
    if (gorulen.has(a)) return;
    gorulen.add(a); kelimeler.push(k);
  };
  if (yatay === null) { ekle(kelimeAl(g[0].r, g[0].c, true)); ekle(kelimeAl(g[0].r, g[0].c, false)); }
  else {
    ekle(kelimeAl(g[0].r, g[0].c, yatay));
    for (const t of g) ekle(kelimeAl(t.r, t.c, !yatay));
  }
  geriAl();
  if (!kelimeler.length) return { hata: 'kelime_olusmadi' };
  return { kelimeler, yeni };
}
function yeniSayisi(st) {
  let n = 0;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (st.board[r][c]) n++;
  return n;
}

/* ----------------------------------------------------------- PUANLAMA
   H²/H³ harfin, K²/K³ kelimenin puanını çarpar; bonus yalnız üzerine İLK
   konulduğu hamlede sayılır. Önce harf çarpanı, sonra kelime çarpanı. */
function hamlePuani(st, kelimeler, yeni, konumSayisi) {
  let toplam = 0;
  for (const k of kelimeler) {
    let p = 0, carpan = 1;
    for (const [r, c] of k.kareler) {
      const t = st.board[r][c];
      let hp = t.joker ? 0 : harfPuani(t.harf);
      if (yeni.has(r + ',' + c)) {
        const b = BONUS[r][c];
        if (b === 'h2') hp *= 2;
        else if (b === 'h3') hp *= 3;
        else if (b === 'k2' || b === 'merkez') carpan *= 2;
        else if (b === 'k3') carpan *= 3;
      }
      p += hp;
    }
    toplam += p * carpan;
  }
  if (konumSayisi === ISTAKA) toplam += BINGO;
  return toplam;
}

/* ------------------------------------------------- HAMLE BULUNABİLİR Mİ
   Otomatik pas kararı. İki arama birlikte çalışır:
   (1) tutamak karelerine 1-2 harflik denemeler — tahtadaki harfleri de
       kullanan hamleleri yakalar,
   (2) ıstakadan kurulabilen BÜTÜN sözlük kelimelerinin yerleştirilmesi —
       3+ harflik hamleleri yakalar.
   İkisi de boş dönerse "hamle yok" denir. Bütçe dolarsa "hamle var"
   sayılır: belirsizlikte kimse cezalandırılmaz. */
function denemePuani(st, konumlar) {
  const s = kelimeleriTopla(st, konumlar);
  if (s.hata) return -1;
  if (!s.kelimeler.every(k => sozluktekiMi(k.metin))) return -1;
  /* puan için taşları yeniden koy */
  for (const t of konumlar) st.board[t.r][t.c] = { harf: t.harf, joker: !!t.joker };
  const p = hamlePuani(st, s.kelimeler, s.yeni, konumlar.length);
  for (const t of konumlar) st.board[t.r][t.c] = null;
  return p;
}
function istakadanKurulabilir(elde) {
  sozlukYukle();
  const say = {}; let joker = 0;
  for (const h of elde) { if (h === '*') joker++; else say[h] = (say[h] || 0) + 1; }
  const out = [];
  for (const w of SOZLUK_LISTE) {
    let kalan = joker, olur = true; const kul = {};
    for (const ch of w) {
      kul[ch] = (kul[ch] || 0) + 1;
      if (kul[ch] > (say[ch] || 0)) { if (--kalan < 0) { olur = false; break; } }
    }
    if (olur) out.push(w);
  }
  return out;
}
function hamleAra(st, seat, enIyiyiBul) {
  const elde = st.racks[seat].slice();
  if (!elde.length) return null;
  const jokerVar = elde.includes('*');
  const tekil = [...new Set(elde.filter(h => h !== '*'))];
  const deneme = jokerVar ? ALFABE : tekil;
  if (!deneme.length) return null;
  let butce = 120000, enIyi = null;
  const bak = (kon) => {
    if (--butce < 0) return 'butce';
    const p = denemePuani(st, kon);
    if (p < 0) return null;
    if (!enIyi || p > enIyi.puan) enIyi = { puan: p, konumlar: kon.slice() };
    return 'bulundu';
  };
  if (tahtaBos(st)) {
    for (let kay = 0; kay < 2; kay++) for (let yon = 0; yon < 2; yon++) {
      const dr = yon ? 1 : 0, dc = yon ? 0 : 1;
      const r0 = MERKEZ[0] - dr * kay, c0 = MERKEZ[1] - dc * kay;
      if (!bosKare(st, r0, c0) || !bosKare(st, r0 + dr, c0 + dc)) continue;
      for (const a of deneme) for (const b of deneme) {
        const s = bak([{ r: r0, c: c0, harf: a }, { r: r0 + dr, c: c0 + dc, harf: b }]);
        if (s === 'butce') return enIyi || { butce: true };
        if (s === 'bulundu' && !enIyiyiBul) return enIyi;
      }
    }
    return enIyi;
  }
  const tutamak = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++)
    if (!st.board[r][c] && (tasVar(st, r - 1, c) || tasVar(st, r + 1, c) || tasVar(st, r, c - 1) || tasVar(st, r, c + 1)))
      tutamak.push([r, c]);
  for (const [r, c] of tutamak) for (const a of deneme) {
    const s = bak([{ r, c, harf: a }]);
    if (s === 'butce') return enIyi || { butce: true };
    if (s === 'bulundu' && !enIyiyiBul) return enIyi;
  }
  for (const [r1, c1] of tutamak) for (const [d0, d1] of [[0, 1], [1, 0]]) for (const im of [1, -1]) {
    const r2 = r1 + d0 * im, c2 = c1 + d1 * im;
    if (!bosKare(st, r2, c2)) continue;
    for (const a of deneme) for (const b of deneme) {
      const s = bak([{ r: r1, c: c1, harf: a }, { r: r2, c: c2, harf: b }]);
      if (s === 'butce') return enIyi || { butce: true };
      if (s === 'bulundu' && !enIyiyiBul) return enIyi;
    }
  }
  return enIyi;
}
function sozlukHamlesiAra(st, seat, enIyiyiBul) {
  const elde = st.racks[seat].slice();
  if (!elde.length) return null;
  const adaylar = istakadanKurulabilir(elde).sort((a, b) => b.length - a.length);
  if (!adaylar.length) return null;
  const bosMu = tahtaBos(st);
  let butce = 500000, enIyi = null;
  for (const w of adaylar) {
    for (let yon = 0; yon < 2; yon++) {
      const dr = yon ? 1 : 0, dc = yon ? 0 : 1;
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        const sonR = r + dr * (w.length - 1), sonC = c + dc * (w.length - 1);
        if (sonR >= N || sonC >= N) continue;
        if (--butce < 0) return enIyi || { butce: true };
        const kon = []; let uygun = true, degiyor = false;
        for (let k = 0; k < w.length; k++) {
          const rr = r + dr * k, cc = c + dc * k;
          if (st.board[rr][cc]) { uygun = false; break; }
          kon.push({ r: rr, c: cc, harf: w[k] });
          if (bosMu) { if (rr === MERKEZ[0] && cc === MERKEZ[1]) degiyor = true; }
          else if (tasVar(st, rr - 1, cc) || tasVar(st, rr + 1, cc) ||
                   tasVar(st, rr, cc - 1) || tasVar(st, rr, cc + 1)) degiyor = true;
        }
        if (!uygun || !degiyor) continue;
        /* kelimenin iki ucu da boş olmalı, yoksa komşu kelimeye yapışır */
        if (tasVar(st, r - dr, c - dc) || tasVar(st, sonR + dr, sonC + dc)) continue;
        const p = denemePuani(st, kon);
        if (p < 0) continue;
        if (!enIyi || p > enIyi.puan) enIyi = { puan: p, konumlar: kon };
        if (!enIyiyiBul) return enIyi;
      }
    }
  }
  return enIyi;
}
function hamleVarMi(st, seat) {
  if (hamleAra(st, seat, false)) return true;
  return !!sozlukHamlesiAra(st, seat, false);
}

/* ------------------------------------------------------------- HAMLELER */
function play(st, seat, konumlar) {
  if (st.status !== 'playing') return { ok: false, reason: 'finished' };
  if (st.turn !== seat) return { ok: false, reason: 'not_your_turn' };
  if (!Array.isArray(konumlar) || !konumlar.length || konumlar.length > ISTAKA)
    return { ok: false, reason: 'gecersiz_hamle' };

  /* Oyuncunun ıstakasında gerçekten o taşlar var mı? (istemciye güvenilmez) */
  const rack = st.racks[seat].slice();
  const temiz = [];
  for (const k of konumlar) {
    const r = Number(k.r), c = Number(k.c);
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r >= N || c >= N)
      return { ok: false, reason: 'gecersiz_kare' };
    if (st.board[r][c]) return { ok: false, reason: 'kare_dolu' };
    const joker = !!k.joker;
    const harf = trBuyuk(String(k.harf || ''));
    if (!HARFLER[harf] || harf === '*') return { ok: false, reason: 'gecersiz_harf' };
    const ara = joker ? '*' : harf;
    const i = rack.indexOf(ara);
    if (i < 0) return { ok: false, reason: 'istakanda_yok' };
    rack.splice(i, 1);
    temiz.push({ r, c, harf, joker });
  }
  /* aynı kareye iki taş konmasın */
  const kareler = new Set(temiz.map(t => t.r + ',' + t.c));
  if (kareler.size !== temiz.length) return { ok: false, reason: 'ayni_kare' };

  const s = kelimeleriTopla(st, temiz);
  if (s.hata) return { ok: false, reason: s.hata };
  const kotu = s.kelimeler.filter(k => !sozluktekiMi(k.metin)).map(k => k.metin);
  if (kotu.length) {
    /* Yakın yazımlar: "MARMALAT" reddedildiğinde oyuncuya MARMELAT önerilir. */
    const oneri = {};
    for (const w of kotu.slice(0, 3)) {
      const y = benzerKelimeler(w, 3);
      if (y.length) oneri[w] = y;
    }
    return { ok: false, reason: 'sozlukte_yok', kelimeler: kotu,
             oneriler: Object.keys(oneri).length ? oneri : null };
  }

  for (const t of temiz) st.board[t.r][t.c] = { harf: t.harf, joker: t.joker };
  const puan = hamlePuani(st, s.kelimeler, s.yeni, temiz.length);
  const bingo = temiz.length === ISTAKA;
  /* Bu hamlede H²/H³/K²/K³ ya da merkez karesi KULLANILDI mı? İstemci bunu
     kendi hesaplayabilirdi ama o zaman bonus desenini de taşımak gerekirdi;
     tek satırlık bilgiyi sunucu söylüyor. Ses efekti (klBonus) ve ileride
     hamle kaydındaki gösterim buna bakar. */
  const bonus = temiz.some(t => !!BONUS[t.r][t.c]);
  st.scores[seat] += puan;
  st.racks[seat] = rack;
  doldur(st, seat);
  st.lastSquares = temiz.map(t => [t.r, t.c]);
  st.passStreak[seat] = 0; st.totalPasses = 0;
  st.moves++;
  st.history.push({ seat, tur: 'move', puan, bingo, bonus,
                    kelimeler: s.kelimeler.map(k => k.metin) });

  /* Bitiş: torba boş ve oyuncunun eli bitti. */
  if (!st.bag.length && !st.racks[seat].length) {
    const r = 1 - seat;
    const kalan = st.racks[r].reduce((t, h) => t + harfPuani(h), 0);
    st.scores[r] -= kalan; st.scores[seat] += kalan;
    bitir(st, kazananSeat(st), 'tiles_out');
    return { ok: true, puan, bingo, bonus, bitti: true };
  }
  st.turn = 1 - seat;
  return { ok: true, puan, bingo, bonus, kelimeler: s.kelimeler.map(k => k.metin) };
}

/* PAS — elle, otomatik ya da süre aşımıyla tek yerden geçer. */
function pas(st, seat, otomatikMi) {
  if (st.status !== 'playing') return { ok: false, reason: 'finished' };
  if (st.turn !== seat) return { ok: false, reason: 'not_your_turn' };
  st.passStreak[seat]++;
  st.totalPasses++;
  st.history.push({ seat, tur: otomatikMi ? 'auto' : 'pass', pas: st.passStreak[seat] });
  if (st.passStreak[seat] >= PAS_SINIRI) {
    st.scores[seat] = 0;
    st.history.push({ seat, tur: 'dq' });
    bitir(st, 1 - seat, 'pass_disqualify');
    return { ok: true, diskalifiye: true, bitti: true };
  }
  if (st.totalPasses >= 4) { bitir(st, kazananSeat(st), 'all_passed'); return { ok: true, bitti: true }; }
  st.turn = 1 - seat;
  return { ok: true };
}

/* HARF DEĞİŞTİR — pas sayılmaz ama sıra geçer; torbada taş olmalı. */
function takas(st, seat, indeksler) {
  if (st.status !== 'playing') return { ok: false, reason: 'finished' };
  if (st.turn !== seat) return { ok: false, reason: 'not_your_turn' };
  if (!st.bag.length) return { ok: false, reason: 'torba_bos' };
  if (!Array.isArray(indeksler) || !indeksler.length) return { ok: false, reason: 'secim_yok' };
  const idx = [...new Set(indeksler.map(Number))].filter(i => Number.isInteger(i) && i >= 0 && i < st.racks[seat].length);
  if (!idx.length) return { ok: false, reason: 'secim_yok' };
  if (idx.length > st.bag.length) return { ok: false, reason: 'torbada_yetersiz' };
  const geri = idx.map(i => st.racks[seat][i]);
  st.racks[seat] = st.racks[seat].filter((_, i) => !idx.includes(i));
  doldur(st, seat);
  st.bag.push(...geri); karistir(st.bag);
  st.passStreak[seat] = 0;
  st.totalPasses++;
  st.history.push({ seat, tur: 'swap', adet: idx.length });
  if (st.totalPasses >= 4) { bitir(st, kazananSeat(st), 'all_passed'); return { ok: true, bitti: true }; }
  st.turn = 1 - seat;
  return { ok: true, adet: idx.length };
}

/* PES ET / TERK — hükmen mağlubiyet, puan silinir. */
function pesEt(st, seat) {
  if (st.status !== 'playing') return { ok: false, reason: 'finished' };
  st.scores[seat] = 0;
  st.history.push({ seat, tur: 'resign' });
  bitir(st, 1 - seat, 'resign');
  return { ok: true, bitti: true };
}

function kazananSeat(st) {
  if (st.scores[0] === st.scores[1]) return null;
  return st.scores[0] > st.scores[1] ? 0 : 1;
}
function bitir(st, winner, reason) {
  st.status = 'finished';
  st.winner = winner;
  st.result = { winner, reason, scores: st.scores.slice() };
}

/* OTOMATİK PAS — sunucu her sıra başında çağırır. Yalnız torba boşken
   devreye girer: torbada taş varken oyuncu harf değiştirebilir, dolayısıyla
   "hamle yapamıyor" durumu yoktur. */
function otomatikPasGerekli(st) {
  if (st.status !== 'playing') return false;
  if (st.bag.length) return false;
  return !hamleVarMi(st, st.turn);
}

module.exports = {
  N, ISTAKA, BINGO, PAS_SINIRI, HARFLER, BONUS, MERKEZ,
  init, play, pas, takas, pesEt, hamleVarMi, otomatikPasGerekli,
  sozluktekiMi, sozlukYukle, sozlukBoyu, benzerKelimeler, harfPuani, trBuyuk, trKucuk,
  _hamleAra: hamleAra, _sozlukHamlesiAra: sozlukHamlesiAra, _kelimeleriTopla: kelimeleriTopla
};
