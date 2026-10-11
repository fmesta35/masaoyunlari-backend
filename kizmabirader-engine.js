'use strict';
/* ============================================================================
 * KIZMA BİRADER (Ludo) — SAF OYUN MOTORU (sunucu yetkili)
 * ============================================================================
 * Yerel prototipin kuralları birebir taşındı; değişen tek şey ZARIN NEREDE
 * ATILDIĞI: artık sunucuda. İstemci yalnız "zar at" ve "şu piyonu oynat"
 * der; hangi sayının geldiğine ve hangi hamlelerin geçerli olduğuna sunucu
 * karar verir.
 *
 * TAHTA
 *   · 52 kareli ortak tur (TUR_YOLU) + her renge 5 kareli ev yolu + merkez.
 *   · Piyon ilerlemesi tek sayıyla tutulur: -1 üste, 0-51 turda, 52-56 ev
 *     yolunda, 57 merkez (BITIS).
 *   · Oyuncunun başlangıç karesi BASLANGIC[renk]; turdaki küresel kare
 *     (BASLANGIC[renk] + ilerleme) % 52 ile bulunur.
 *
 * KURALLAR
 *   · Üsten çıkmak için 6 gerekir. 6 atan bir kez daha atar.
 *   · Üst üste ÜÇ 6 sırayı yakar (yoksa sonsuz tur atılabilirdi).
 *   · Aynı renkten 2+ piyonun durduğu kare BLOKTUR: rakip ne üstünden
 *     geçebilir ne de üstüne konabilir.
 *   · GÜVENLİ karelerde (başlangıçlar ve yıldızlar) piyon yenmez. Başka bir
 *     karede tek duran rakip piyonu yenir ve üsse döner; yiyen tekrar atar.
 *   · Merkeze TAM SAYIYLA girilir (fazla atan oynayamaz); merkeze sokan
 *     tekrar atar.
 *   · Dört piyonunu merkeze sokan sırayı tamamlar ve artık oynamaz; son
 *     kalan otomatik sonuncu olur.
 *
 * Bu dosya SAF mantıktır: soket, zamanlayıcı, oda yoktur.
 * ========================================================================= */

/* Tahtanın 15×15 ızgaradaki kareleri — istemci bunu çizerken kullanır. */
const TUR_YOLU = [
  [6,1],[6,2],[6,3],[6,4],[6,5],
  [5,6],[4,6],[3,6],[2,6],[1,6],[0,6],
  [0,7],
  [0,8],[1,8],[2,8],[3,8],[4,8],[5,8],
  [6,9],[6,10],[6,11],[6,12],[6,13],[6,14],
  [7,14],
  [8,14],[8,13],[8,12],[8,11],[8,10],[8,9],
  [9,8],[10,8],[11,8],[12,8],[13,8],[14,8],
  [14,7],
  [14,6],[13,6],[12,6],[11,6],[10,6],[9,6],
  [8,5],[8,4],[8,3],[8,2],[8,1],[8,0],
  [7,0],
  [6,0]
];
const BASLANGIC = [0, 13, 26, 39];
const EV_YOLU = [
  [[7,1],[7,2],[7,3],[7,4],[7,5]],
  [[1,7],[2,7],[3,7],[4,7],[5,7]],
  [[7,13],[7,12],[7,11],[7,10],[7,9]],
  [[13,7],[12,7],[11,7],[10,7],[9,7]]
];
const US_KOSELERI = [[0,0],[0,9],[9,9],[9,0]];
const GUVENLI = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
const YILDIZ = new Set([8, 21, 34, 47]);
const BITIS = 57;                  // 0-51 tur, 52-56 ev yolu, 57 merkez
const RENK_ADLARI = ['Kırmızı', 'Sarı', 'Yeşil', 'Mavi'];
const RENKLER = ['#ef4444', '#eab308', '#22c55e', '#3b82f6'];
/* Kaç kişilik masada hangi renkler oynar (karşılıklı otursunlar). */
const RENK_DAGILIMI = { 2: [0, 2], 3: [0, 1, 3], 4: [0, 1, 2, 3] };

/* ------------------------------------------------------------------- MAÇ */
function macBaslat(opts) {
  const o = opts || {};
  const seats = (o.seats || [0, 1]).slice();
  const renkler = RENK_DAGILIMI[seats.length] || RENK_DAGILIMI[4];
  const st = {
    kind: 'kizmabirader',
    seats,
    /* koltuk → renk ve renk → koltuk: tahta renklerle, oda koltuklarla
       konuşuyor; çeviri tek yerde dursun. */
    renkOf: {},
    koltukOf: {},
    piyon: {},                     // renk → [4 ilerleme]
    sira: 0,                       // seats dizisindeki indeks
    faz: 'zar',                    // zar | secim | bitti
    zar: null,
    altiSayisi: 0,
    hamleler: [],
    sonHamle: null,
    sira_lama: [],                 // bitirme sırası (renkler)
    rng: o.rng || Math.random,
    status: 'playing',
    winner: null,
    result: null
  };
  seats.forEach((s, i) => { st.renkOf[s] = renkler[i]; st.koltukOf[renkler[i]] = s; });
  renkler.forEach(r => { st.piyon[r] = [-1, -1, -1, -1]; });
  return st;
}

const siradakiKoltuk = (st) => (st.status === 'playing' ? st.seats[st.sira] : null);
const siradakiRenk = (st) => st.renkOf[siradakiKoltuk(st)];
const aktifRenkler = (st) => st.seats.map(s => st.renkOf[s]);

/* Turdaki her karede kimin piyonu var? */
function doluluk(st) {
  const harita = new Map();
  aktifRenkler(st).forEach(r => {
    st.piyon[r].forEach((p, i) => {
      if (p >= 0 && p <= 51) {
        const k = (BASLANGIC[r] + p) % 52;
        if (!harita.has(k)) harita.set(k, []);
        harita.get(k).push({ renk: r, idx: i });
      }
    });
  });
  return harita;
}
/* O karede RAKİP bloğu (aynı renkten 2+) var mı? */
function rakipBlogu(harita, kare, renk) {
  const liste = harita.get(kare) || [];
  const say = {};
  liste.forEach(o => { if (o.renk !== renk) say[o.renk] = (say[o.renk] || 0) + 1; });
  return Object.values(say).some(n => n >= 2);
}
function rakipTek(harita, kare, renk) {
  return (harita.get(kare) || []).filter(o => o.renk !== renk);
}

/* -------------------------------------------------------- GEÇERLİ HAMLELER */
function gecerliHamleler(st, renk, z) {
  const harita = doluluk(st);
  const out = [];
  st.piyon[renk].forEach((p, i) => {
    if (p === BITIS) return;
    if (p === -1) {
      /* Üsten çıkış yalnız 6 ile ve başlangıç karesi rakip bloğuyla
         kapalı değilse. */
      if (z !== 6) return;
      if (rakipBlogu(harita, BASLANGIC[renk], renk)) return;
      out.push({ idx: i, nereden: -1, nereye: 0, cikis: true, yenen: [] });
      return;
    }
    const hedef = p + z;
    if (hedef > BITIS) return;                 // merkeze TAM sayı gerekir
    /* Yol üstünde rakip bloğu varsa geçilemez (ara kareler dahil). */
    let kapali = false;
    for (let s = p + 1; s <= Math.min(hedef, 51); s++) {
      if (rakipBlogu(harita, (BASLANGIC[renk] + s) % 52, renk)) { kapali = true; break; }
    }
    if (kapali) return;
    let yenen = [];
    if (hedef <= 51) {
      const kare = (BASLANGIC[renk] + hedef) % 52;
      const rakipler = rakipTek(harita, kare, renk);
      if (rakipler.length && !GUVENLI.has(kare)) yenen = rakipler;
    }
    out.push({ idx: i, nereden: p, nereye: hedef, cikis: false, yenen });
  });
  return out;
}

/* ------------------------------------------------------------------ ZAR */
function zarAt(st, seat) {
  if (st.status !== 'playing') return { ok: false, reason: 'game_over' };
  if (seat !== siradakiKoltuk(st)) return { ok: false, reason: 'not_your_turn' };
  if (st.faz !== 'zar') return { ok: false, reason: 'wrong_phase' };
  const renk = st.renkOf[seat];
  const z = Math.floor(st.rng() * 6) + 1;
  st.zar = z;
  st.altiSayisi = (z === 6) ? st.altiSayisi + 1 : 0;

  /* ÜÇ ALTI: sıra yanar. Yoksa 6 atan sonsuza kadar oynayabilirdi. */
  if (st.altiSayisi === 3) {
    st.altiSayisi = 0;
    st.hamleler = [];
    st.sonHamle = { tur: 'ucAlti', renk, zar: z };
    siraGec(st);
    return { ok: true, zar: z, ucAlti: true, hamleler: [] };
  }
  st.hamleler = gecerliHamleler(st, renk, z);
  if (!st.hamleler.length) {
    st.sonHamle = { tur: 'hamleYok', renk, zar: z };
    /* 6 atıp da hamle bulamamak mümkün (tüm çıkışlar kapalı): sıra geçer. */
    siraGec(st);
    return { ok: true, zar: z, hamleYok: true, hamleler: [] };
  }
  st.faz = 'secim';
  return { ok: true, zar: z, hamleler: st.hamleler.slice() };
}

/* ---------------------------------------------------------------- HAMLE */
function piyonOyna(st, seat, idx) {
  if (st.status !== 'playing') return { ok: false, reason: 'game_over' };
  if (seat !== siradakiKoltuk(st)) return { ok: false, reason: 'not_your_turn' };
  if (st.faz !== 'secim') return { ok: false, reason: 'wrong_phase' };
  const renk = st.renkOf[seat];
  const mv = st.hamleler.find(m => m.idx === Number(idx));
  if (!mv) return { ok: false, reason: 'gecersiz_hamle' };

  st.piyon[renk][mv.idx] = mv.nereye;
  let tekrar = (st.zar === 6);
  const yenenler = [];
  if (mv.yenen && mv.yenen.length) {
    mv.yenen.forEach(v => { st.piyon[v.renk][v.idx] = -1; yenenler.push(v); });
    tekrar = true;                              // yiyen tekrar atar
  }
  let bitirdi = false;
  if (mv.nereye === BITIS) {
    tekrar = true;                              // merkeze sokan tekrar atar
    if (st.piyon[renk].every(p => p === BITIS)) {
      bitirdi = true;
      st.sira_lama.push(renk);
    }
  }
  st.sonHamle = { tur: 'hamle', renk, zar: st.zar, idx: mv.idx,
                  nereden: mv.nereden, nereye: mv.nereye,
                  yenen: yenenler.slice(), bitirdi };
  st.hamleler = [];

  if (bitirdi) {
    const kalan = aktifRenkler(st).filter(r => st.sira_lama.indexOf(r) === -1);
    if (kalan.length <= 1) {
      if (kalan.length === 1) st.sira_lama.push(kalan[0]);
      macBitir(st, 'finished');
      return { ok: true, hamle: st.sonHamle, bitti: true };
    }
    /* Bitiren artık oynamaz: tekrar hakkı olsa bile sıra geçer. */
    siraGec(st);
    return { ok: true, hamle: st.sonHamle, siraGecti: true };
  }
  if (tekrar) {
    st.faz = 'zar';
    return { ok: true, hamle: st.sonHamle, tekrar: true };
  }
  siraGec(st);
  return { ok: true, hamle: st.sonHamle, siraGecti: true };
}

/* Süresi dolan oyuncu masadan ATILMAZ: zar atmadıysa sunucu atar, hamle
   seçmediyse ilk geçerli hamleyi oynar. */
function sureDoldu(st, seat) {
  if (st.status !== 'playing') return null;
  const sirada = siradakiKoltuk(st);
  if (seat !== undefined && seat !== sirada) return null;
  if (st.faz === 'zar') return { tur: 'zar', sonuc: zarAt(st, sirada) };
  if (st.faz === 'secim' && st.hamleler.length) {
    return { tur: 'hamle', sonuc: piyonOyna(st, sirada, st.hamleler[0].idx) };
  }
  return null;
}

function siraGec(st) {
  if (st.status !== 'playing') return;
  st.altiSayisi = 0;
  st.hamleler = [];
  st.zar = null;
  st.faz = 'zar';
  let koruma = 0;
  do {
    st.sira = (st.sira + 1) % st.seats.length;
    koruma++;
  } while (st.sira_lama.indexOf(siradakiRenk(st)) !== -1 && koruma <= st.seats.length * 2);
}

/* --------------------------------------------------------------- BİTİŞ */
function macBitir(st, reason) {
  st.status = 'finished';
  st.faz = 'bitti';
  const kazananRenk = st.sira_lama[0];
  st.winner = kazananRenk === undefined ? null : st.koltukOf[kazananRenk];
  st.result = {
    reason: reason || 'finished', winner: st.winner,
    siralama: st.sira_lama.map(r => ({ renk: r, seat: st.koltukOf[r], ad: RENK_ADLARI[r] }))
  };
  return st.result;
}
function pesEt(st, seat) {
  if (st.status !== 'playing') return st.result;
  const renk = st.renkOf[seat];
  /* Pes eden SONA yazılır; kalan tek kişiyse maç biter. */
  if (renk !== undefined && st.sira_lama.indexOf(renk) === -1) {
    const kalan = aktifRenkler(st).filter(r => r !== renk && st.sira_lama.indexOf(r) === -1);
    kalan.forEach(r => { if (st.sira_lama.indexOf(r) === -1) st.sira_lama.push(r); });
    st.sira_lama.push(renk);
  }
  st.status = 'finished';
  st.faz = 'bitti';
  const kazananRenk = st.sira_lama.find(r => r !== renk);
  st.winner = kazananRenk === undefined ? null : st.koltukOf[kazananRenk];
  st.result = { reason: 'resign', winner: st.winner,
    siralama: st.sira_lama.map(r => ({ renk: r, seat: st.koltukOf[r], ad: RENK_ADLARI[r] })) };
  return st.result;
}

/* --------------------------------------------------------------- GÖRÜNÜM
   Kızma Birader'de gizli bilgi yoktur: herkes bütün piyonları görür.
   Zar da atıldıktan sonra herkese açıktır. */
function gorunum(st, seat, ekstra) {
  const bakan = (st.seats.indexOf(seat) !== -1) ? seat : null;
  return Object.assign({
    kind: 'kizmabirader',
    status: st.status,
    faz: st.faz,
    seats: st.seats.slice(),
    seat: bakan,
    renk: bakan === null ? null : st.renkOf[bakan],
    renkOf: Object.assign({}, st.renkOf),
    turn: siradakiKoltuk(st),
    turnRenk: siradakiRenk(st) === undefined ? null : siradakiRenk(st),
    piyon: aktifRenkler(st).reduce((a, r) => { a[r] = st.piyon[r].slice(); return a; }, {}),
    zar: st.zar,
    altiSayisi: st.altiSayisi,
    /* Hamleler YALNIZ sırası olana gönderilir: rakip neyi oynayabileceğini
       görmesin, tahtadan kendisi okusun. */
    hamleler: (bakan !== null && bakan === siradakiKoltuk(st)) ? st.hamleler.slice() : [],
    hamleSayisi: st.hamleler.length,
    sonHamle: st.sonHamle,
    siralama: st.sira_lama.slice(),
    /* Tahta çizimi için sabitler (istemci kendi kopyasını tutmasın). */
    turYolu: TUR_YOLU, evYolu: EV_YOLU, baslangic: BASLANGIC,
    usKoseleri: US_KOSELERI, guvenli: [...GUVENLI], yildiz: [...YILDIZ],
    bitisIlerleme: BITIS, renkAdlari: RENK_ADLARI, renkKodlari: RENKLER,
    winner: st.winner,
    result: st.result
  }, ekstra || {});
}

module.exports = {
  TUR_YOLU, BASLANGIC, EV_YOLU, US_KOSELERI, GUVENLI, YILDIZ, BITIS,
  RENK_ADLARI, RENKLER, RENK_DAGILIMI,
  macBaslat, zarAt, piyonOyna, sureDoldu, gecerliHamleler, doluluk,
  siraGec, macBitir, pesEt, gorunum, siradakiKoltuk, siradakiRenk
};
