'use strict';
/* ============================================================================
 * TOMBALA — SAF OYUN MOTORU (sunucu yetkili)
 * ============================================================================
 * Klasik 90'lık tombala. Kurallar:
 *   · Her oyuncuya 3×9'luk bir KART verilir. Her SATIRDA tam 5 sayı vardır
 *     (kartta toplam 15 sayı), her SÜTUN en az bir sayı taşır.
 *   · Sütunlar onluk dilimlerdir: 1-9, 10-19, 20-29 … 70-79, 80-90.
 *     (İlk sütun 9, son sütun 11 sayı taşır — resmî tombala düzeni budur.)
 *   · Torbada 1-90 arası 90 sayı vardır; sunucu sırayla birer sayı çeker.
 *   · Çekilen sayı, kartında varsa KENDİLİĞİNDEN kapanır — oyuncunun bir şey
 *     yapması gerekmez. Oyun tamamen şansa dayanır, bu yüzden hamle sırası,
 *     hamle süresi ya da terk cezası yoktur.
 *   · ÖDÜLLER sırayla verilir: 1. Çinko (bir satırı ilk kapatan), 2. Çinko
 *     (iki satırı ilk kapatan), TOMBALA (on beş sayının tamamı). Aynı çekilişte
 *     birden fazla oyuncu hak ederse ödül PAYLAŞILIR.
 *   · Tombala verildiğinde ya da torba boşaldığında el biter.
 *
 * Bu dosya SAF mantıktır: soket, zamanlayıcı, oda yoktur. Sunucu (server.js)
 * çekiliş zamanlayıcısını işletir, istemci yalnız çizer. Böylece oyun
 * istemciden oynanamaz ve testler motoru tek başına ölçebilir.
 * ========================================================================= */

const SUTUN = 9;
const SATIR = 3;
const SATIR_BASINA = 5;          // her satırda 5 sayı
const KART_SAYISI = SATIR * SATIR_BASINA;   // 15
const TOPLAM_TOP = 90;

/* Ödül sırası ve puanları. Maç skoru bu puanlardan oluşur; paylaşılan ödülde
   puan bölünmez, hak eden herkes tam puan alır (klasik tombalada da ikramiye
   bölünür ama sıralama için tam puan daha anlaşılır). */
const ODULLER = [
  { key: 'cinko1', ad: '1. Çinko', satir: 1, puan: 1 },
  { key: 'cinko2', ad: '2. Çinko', satir: 2, puan: 2 },
  { key: 'tombala', ad: 'Tombala', satir: 3, puan: 4 }
];

/* --------------------------------------------------------------- RASTGELE
   Testler için tohumlanabilir: aynı tohum aynı kartları ve aynı torbayı
   verir. rng verilmezse Math.random kullanılır. */
function karistir(dizi, rng) {
  const r = rng || Math.random;
  for (let i = dizi.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [dizi[i], dizi[j]] = [dizi[j], dizi[i]];
  }
  return dizi;
}
function aralik(bas, son) {
  const out = [];
  for (let i = bas; i <= son; i++) out.push(i);
  return out;
}
/* Sütunun sayı aralığı: ilk sütun 1-9, son sütun 80-90, diğerleri onluk. */
function sutunAraligi(c) {
  if (c === 0) return [1, 9];
  if (c === SUTUN - 1) return [80, 90];
  return [c * 10, c * 10 + 9];
}

/* ------------------------------------------------------------------- KART
   3×9 ızgara; dolu gözlerde sayı, boşlarda null. Her satırda 5 sayı, her
   sütunda en az 1 sayı. Sütun içindeki sayılar yukarıdan aşağı artar. */
function kartUret(rng) {
  for (let deneme = 0; deneme < 200; deneme++) {
    const sutunKullanim = new Array(SUTUN).fill(0);
    const satirSutunlari = [];
    for (let r = 0; r < SATIR; r++) {
      const cols = karistir(aralik(0, SUTUN - 1), rng).slice(0, SATIR_BASINA).sort((a, b) => a - b);
      satirSutunlari.push(cols);
      cols.forEach(c => sutunKullanim[c]++);
    }
    if (sutunKullanim.some(x => x === 0)) continue;   // boş sütun olmaz
    const kart = Array.from({ length: SATIR }, () => new Array(SUTUN).fill(null));
    for (let c = 0; c < SUTUN; c++) {
      const [lo, hi] = sutunAraligi(c);
      const satirlar = [0, 1, 2].filter(r => satirSutunlari[r].includes(c));
      const sayilar = karistir(aralik(lo, hi), rng).slice(0, satirlar.length).sort((a, b) => a - b);
      satirlar.forEach((r, i) => { kart[r][c] = sayilar[i]; });
    }
    return kart;
  }
  /* Buraya düşmek pratikte imkânsız; yine de oyun çökmesin diye basit bir
     yedek düzen üretilir. */
  const kart = Array.from({ length: SATIR }, () => new Array(SUTUN).fill(null));
  for (let r = 0; r < SATIR; r++) {
    for (let i = 0; i < SATIR_BASINA; i++) {
      const c = (r * SATIR_BASINA + i) % SUTUN;
      const [lo] = sutunAraligi(c);
      kart[r][c] = lo + r;
    }
  }
  return kart;
}

/* Kartın sayı → {r,c} haritası: çekilen top hızlıca bulunsun. */
function kartHaritasi(kart) {
  const m = {};
  for (let r = 0; r < SATIR; r++) {
    for (let c = 0; c < SUTUN; c++) {
      const n = kart[r][c];
      if (n != null) m[n] = { r, c };
    }
  }
  return m;
}

/* ------------------------------------------------------------------- EL */
function elBaslat(opts) {
  const o = opts || {};
  const seats = (o.seats || []).slice();
  const rng = o.rng || Math.random;
  const kartlar = {}, haritalar = {}, isaretli = {}, satirTam = {}, oduller = {};
  seats.forEach(s => {
    kartlar[s] = kartUret(rng);
    haritalar[s] = kartHaritasi(kartlar[s]);
    isaretli[s] = [];
    satirTam[s] = [false, false, false];
    oduller[s] = [];
  });
  return {
    round: Number(o.roundNo) || 1,
    seats,
    torba: karistir(aralik(1, TOPLAM_TOP), rng),   // sondan çekilir
    cekilen: [],                                   // çekiliş sırası (yeni → eski değil, eski → yeni)
    sonTop: null,
    kartlar, haritalar, isaretli, satirTam,
    oduller,                                       // koltuk → ['cinko1', …]
    verilen: {},                                   // ödül → [koltuk, …]
    status: 'playing',
    result: null
  };
}

/* Bir koltuğun kapattığı satır sayısı. */
function tamSatir(st, seat) {
  return (st.satirTam[seat] || []).filter(Boolean).length;
}

/* --------------------------------------------------------------- ÇEKİLİŞ
   Tek bir top çeker, kartları kapatır, hak edilen ödülleri verir.
   Döner: { ok, top, kapatan:[{seat,r,c}], yeniOduller:[{key,ad,seats,puan}],
            bitti } */
function cek(st) {
  if (st.status !== 'playing') return { ok: false, reason: 'el_bitti' };
  if (!st.torba.length) {
    st.status = 'finished';
    st.result = { reason: 'torba_bitti', siralama: siralama(st) };
    return { ok: true, top: null, kapatan: [], yeniOduller: [], bitti: true, torbaBitti: true };
  }
  const top = st.torba.pop();
  st.cekilen.push(top);
  st.sonTop = top;

  const kapatan = [];
  for (const seat of st.seats) {
    const pos = st.haritalar[seat] && st.haritalar[seat][top];
    if (!pos) continue;
    st.isaretli[seat].push(top);
    kapatan.push({ seat, r: pos.r, c: pos.c });
    /* Satır tamam mı? O satırdaki sayıların hepsi işaretli mi diye bakılır. */
    const satirSayilari = st.kartlar[seat][pos.r].filter(x => x != null);
    if (satirSayilari.every(n => st.isaretli[seat].includes(n))) {
      st.satirTam[seat][pos.r] = true;
    }
  }

  /* ÖDÜLLER SIRAYLA: 1. çinko verilmeden 2. çinko verilmez. Aynı çekilişte
     birden fazla oyuncu hak ederse ödül paylaşılır. */
  const yeniOduller = [];
  for (const o of ODULLER) {
    if (st.verilen[o.key]) continue;
    const hakEdenler = st.seats.filter(s => tamSatir(st, s) >= o.satir);
    if (!hakEdenler.length) continue;
    st.verilen[o.key] = hakEdenler.slice();
    hakEdenler.forEach(s => st.oduller[s].push(o.key));
    yeniOduller.push({ key: o.key, ad: o.ad, seats: hakEdenler.slice(), puan: o.puan });
  }

  let bitti = false;
  if (st.verilen.tombala) {
    st.status = 'finished';
    st.result = { reason: 'tombala', kazananlar: st.verilen.tombala.slice(), siralama: siralama(st) };
    bitti = true;
  } else if (!st.torba.length) {
    st.status = 'finished';
    st.result = { reason: 'torba_bitti', siralama: siralama(st) };
    bitti = true;
  }
  return { ok: true, top, kapatan, yeniOduller, bitti };
}

/* Koltuğun bu eldeki puanı: kazandığı ödüllerin toplamı. */
function puan(st, seat) {
  return (st.oduller[seat] || [])
    .reduce((a, k) => a + ((ODULLER.find(o => o.key === k) || {}).puan || 0), 0);
}

/* Sıralama: önce puan, eşitlikte kapatılan sayı adedi. */
function siralama(st) {
  return st.seats.slice().sort((a, b) => {
    const fark = puan(st, b) - puan(st, a);
    if (fark) return fark;
    return (st.isaretli[b] || []).length - (st.isaretli[a] || []).length;
  }).map(seat => ({
    seat, puan: puan(st, seat),
    kapanan: (st.isaretli[seat] || []).length,
    oduller: (st.oduller[seat] || []).slice()
  }));
}

/* Bir koltuğun istemciye gidecek görünümü. Rakiplerin KARTI da açıktır —
   tombalada gizli bilgi yoktur, herkes herkesin kartını görür. */
function gorunum(st, seat) {
  return {
    kind: 'tombala',
    status: st.status,
    round: st.round,
    seats: st.seats.slice(),
    mySeat: (seat === null || seat === undefined) ? null : seat,
    sonTop: st.sonTop,
    cekilen: st.cekilen.slice(),
    kalanTop: st.torba.length,
    kartlar: st.seats.reduce((a, s) => { a[s] = st.kartlar[s]; return a; }, {}),
    isaretli: st.seats.reduce((a, s) => { a[s] = (st.isaretli[s] || []).slice(); return a; }, {}),
    satirTam: st.seats.reduce((a, s) => { a[s] = (st.satirTam[s] || []).slice(); return a; }, {}),
    oduller: st.seats.reduce((a, s) => { a[s] = (st.oduller[s] || []).slice(); return a; }, {}),
    verilen: Object.keys(st.verilen).reduce((a, k) => { a[k] = st.verilen[k].slice(); return a; }, {}),
    odulTanim: ODULLER.map(o => ({ key: o.key, ad: o.ad, puan: o.puan })),
    result: st.result
  };
}

module.exports = {
  SUTUN, SATIR, SATIR_BASINA, KART_SAYISI, TOPLAM_TOP, ODULLER,
  karistir, kartUret, kartHaritasi, sutunAraligi,
  elBaslat, cek, puan, siralama, tamSatir, gorunum
};
