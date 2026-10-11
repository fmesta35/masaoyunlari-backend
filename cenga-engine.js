'use strict';
/* ============================================================================
 * CENGA — SAF OYUN MOTORU (sunucu yetkili)
 * ============================================================================
 * Üçerli dizilmiş 18 kattan oluşan bir kuleden sırayla taş çekip en üste
 * koyma oyunu. Kuleyi deviren kaybeder.
 *
 * KURALLAR (yerel prototipin tower.ts dosyasından birebir alındı)
 *   · Kule 18 kat × 3 taştır; katlar dönüşümlü olarak x ve z eksenine dizilir.
 *   · EN ÜSTTEKİ TAMAMLANMIŞ KATTAN ve onun üstündeki katlardan taş
 *     ÇEKİLEMEZ (klasik Jenga kuralı).
 *   · Çekilen taş en üste konur: önce üstteki eksik kat tamamlanır
 *     (orta → sol → sağ), dolduysa yeni kat açılır.
 *   · Her çekişten sonra kule analiz edilir: her katın üstündeki yığının
 *     ağırlık merkezi o katın taşıma alanının dışına çıkarsa kule DEVRİLİR.
 *   · Çekilecek taş kalmazsa oyun biter ve kule devrilmiş sayılır.
 *
 * ÇEKME BECERİSİ — AĞA UYGUN HÂLİ
 *   Prototipte oyuncu 60 Hz'lik bir göstergede iğneyi hedefte tutuyordu;
 *   bu, ağ üzerinden sunucu yetkili yapılamaz (istemci kendi "başardım"
 *   demiş olurdu). Burada aynı beceri GİZLİ HEDEF yöntemiyle korunur:
 *     · Taş seçilince sunucu 0..1 arası GİZLİ bir hedef ve bir tolerans
 *       bandı üretir; bandın genişliği taşın sıkılığına ve kulenin riskine
 *       göre daralır. İstemciye yalnız BANT GENİŞLİĞİ bildirilir.
 *     · İstemci iğneyi 0..1 arasında gezdirir; oyuncu dokunduğu anki konum
 *       sunucuya gelir.
 *     · Sunucu sapmayı ölçer: bandın içindeyse taş çıkar (ne kadar ortaysa
 *       o kadar puan), dışındaysa kule devrilir.
 *   İstemci hedefi bilmediği için hile yapamaz; beceri de yerinde kalır.
 *
 * Bu dosya SAF mantıktır: soket, zamanlayıcı, oda yoktur.
 * ========================================================================= */

/* ------------------------------------------------------------ KULE ÖLÇÜLERİ
   Sayılar prototipten birebir alındı; denge hesabı bunlara dayanıyor. */
const BLOCK_L = 2.98;          // taş uzunluğu
const BLOCK_W = 0.98;          // taş genişliği
const PITCH = 1.0;             // yan yana taşların merkez aralığı
const TOPLAM_KAT = 18;
const SLOT_SIRASI = [1, 0, 2]; // üst kata yerleştirme sırası: orta, sol, sağ

const katEkseni = (kat) => (kat % 2 === 0 ? 'x' : 'z');
const slotKaymasi = (slot) => (slot - 1) * PITCH;

function izgaraKur() {
  let id = 0;
  const g = [];
  for (let k = 0; k < TOPLAM_KAT; k++) g.push([id++, id++, id++]);
  return g;
}
const katSayisi = (satir) => satir.reduce((a, v) => a + (v >= 0 ? 1 : 0), 0);

function ustKat(izgara) {
  let t = izgara.length - 1;
  while (t >= 0 && katSayisi(izgara[t]) === 0) t--;
  return t;
}
/* Cenga kuralı: en üstteki TAMAMLANMIŞ kat ve üstü dokunulmaz. */
function enUstTamKat(izgara) {
  const t = ustKat(izgara);
  if (t < 0) return -1;
  return katSayisi(izgara[t]) === 3 ? t : t - 1;
}
function katIzinli(izgara, kat) { return kat < enUstTamKat(izgara); }
function hamleVarMi(izgara) {
  const hc = enUstTamKat(izgara);
  for (let k = 0; k < hc; k++) if (katSayisi(izgara[k]) > 0) return true;
  return false;
}
/* Çekilen taşın gideceği yer: önce üstteki eksik katı tamamla, sonra yeni kat. */
function sonrakiUstSlot(izgara) {
  const t = ustKat(izgara);
  if (t < 0) return { kat: 0, slot: 1 };
  if (katSayisi(izgara[t]) === 3) return { kat: t + 1, slot: 1 };
  for (const s of SLOT_SIRASI) if (izgara[t][s] === -1) return { kat: t, slot: s };
  return { kat: t + 1, slot: 1 };
}

/* --------------------------------------------------------------- DENGE
   Her kat için, üstündeki yığının ağırlık merkezi o katın taşıma alanının
   içinde mi? Dışına çıkarsa kule devrilir. */
function coz(izgara, haric = -1) {
  const sonuc = { dengeli: true, pay: 99, yumusak: 99, zayifKat: -1 };
  let kutle = 0, mx = 0, mz = 0;
  for (let k = izgara.length - 1; k >= 0; k--) {
    const eksen = katEkseni(k);
    const slotlar = [];
    for (let s = 0; s < 3; s++) {
      const v = izgara[k][s];
      if (v >= 0 && v !== haric) slotlar.push(s);
    }
    if (kutle > 0) {
      if (slotlar.length === 0) {
        sonuc.pay = -1; sonuc.yumusak = -1; sonuc.zayifKat = k;
      } else {
        const lo = (Math.min(...slotlar) - 1) * PITCH - BLOCK_W / 2 - 0.01;
        const hi = (Math.max(...slotlar) - 1) * PITCH + BLOCK_W / 2 + 0.01;
        const c = eksen === 'x' ? mz / kutle : mx / kutle;    // kat eksenine dik
        const cl = eksen === 'x' ? mx / kutle : mz / kutle;   // taş boyunca
        const m1 = c - lo, m2 = hi - c;
        const m = Math.min(m1, m2), M = Math.max(m1, m2);
        const ml = BLOCK_L / 2 - Math.abs(cl);
        const pay = Math.min(m, ml);
        const yumusak = Math.min(0.7 * m + 0.3 * M, ml);
        if (pay < sonuc.pay) { sonuc.pay = pay; sonuc.zayifKat = k; }
        if (yumusak < sonuc.yumusak) sonuc.yumusak = yumusak;
      }
    }
    for (const s of slotlar) {
      const off = slotKaymasi(s);
      if (eksen === 'x') mz += off; else mx += off;
      kutle += 1;
    }
  }
  sonuc.dengeli = sonuc.pay > 0.03;
  return sonuc;
}
function dengeYuzdesi(a) {
  if (!a.dengeli) return 0;
  return Math.max(0, Math.min(1, (a.yumusak - 0.03) / 0.9));
}
function riskKatsayisi(a) {
  if (!a.dengeli) return 1;
  return Math.max(0, Math.min(1, (1.5 - a.yumusak) / 1.3));
}
function riskSeviyesi(a) {
  if (!a.dengeli || a.yumusak < 0.45) return 3;
  if (a.yumusak < 0.75) return 2;
  if (a.yumusak < 1.0) return 1;
  return 0;
}
const RISK_ETIKETLERI = ['Güvenli', 'Dengeli', 'Riskli', 'Çok riskli'];
function sikilikEtiketi(s) {
  if (s < 0.38) return 'Gevşek';
  if (s < 0.65) return 'Normal';
  return 'Sıkı';
}

/* ----------------------------------------------------------------- MAÇ */
function kirp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function macBaslat(opts) {
  const o = opts || {};
  const seats = (o.seats || [0, 1]).slice(0, 2);
  const rng = o.rng || Math.random;
  const izgara = izgaraKur();
  /* Her taşa sabit bir "sıkılık tohumu": aynı taş her seferinde aynı
     zorlukta olsun, oyuncu kuleyi tanıyabilsin. */
  const tohum = {};
  for (let k = 0; k < TOPLAM_KAT; k++) {
    for (let s = 0; s < 3; s++) tohum[izgara[k][s]] = { a: rng(), b: rng() };
  }
  const st = {
    kind: 'cenga',
    seats,
    izgara,
    tohum,
    rngDurum: Math.floor(rng() * 1e9) >>> 0,
    skor: { [seats[0]]: 0, [seats[1]]: 0 },
    seri: { [seats[0]]: 0, [seats[1]]: 0 },
    cekis: { [seats[0]]: 0, [seats[1]]: 0 },
    turn: seats[0],
    tur: 1,
    faz: 'secim',          // secim | cekis | bitti
    secim: null,           // { kat, slot, id, sikilik, risk, riskSeviyesi, bant, hedef }
    denge: 1,
    son: null,             // son hamlenin özeti
    status: 'playing',
    winner: null,
    result: null
  };
  st.denge = dengeYuzdesi(coz(izgara));
  return st;
}

/* Tohumlanabilir sayı üreteci — gizli hedef tahmin edilemesin diye motorun
   kendi durumundan ilerler (istemci bu durumu hiç görmez). */
function sonraki(st) {
  st.rngDurum = (st.rngDurum * 1103515245 + 12345) & 0x7fffffff;
  return st.rngDurum / 0x7fffffff;
}

/* Taşın sıkılığı: üstündeki yük ne kadar çoksa o kadar sıkı; orta taş biraz
   daha sıkıdır (prototiple aynı formül). */
function sikilik(st, kat, slot, id) {
  const t = Math.max(1, ustKat(st.izgara));
  const yuk = kirp((t - kat) / t, 0, 1);
  const s = st.tohum[id] || { a: 0.5, b: 0.5 };
  return kirp(0.1 + 0.55 * s.a + 0.35 * yuk * (0.5 + 0.5 * s.b) + (slot === 1 ? 0.08 : 0), 0.05, 1);
}

/* --------------------------------------------------------------- 1) SEÇİM */
function tasSec(st, seat, kat, slot) {
  if (st.status !== 'playing') return { ok: false, reason: 'game_over' };
  if (seat !== st.turn) return { ok: false, reason: 'not_your_turn' };
  if (st.faz !== 'secim') return { ok: false, reason: 'wrong_phase' };
  const k = Math.floor(Number(kat)), sl = Math.floor(Number(slot));
  if (!(k >= 0 && k < st.izgara.length && sl >= 0 && sl <= 2)) {
    return { ok: false, reason: 'gecersiz_tas' };
  }
  const id = st.izgara[k][sl];
  if (id < 0) return { ok: false, reason: 'tas_yok' };
  if (!katIzinli(st.izgara, k)) return { ok: false, reason: 'kat_kilitli' };

  const sk = sikilik(st, k, sl, id);
  const sonra = coz(st.izgara, id);
  const risk = riskKatsayisi(sonra);
  const sev = riskSeviyesi(sonra);
  /* Zorluk: sıkı taş + riskli kule + geç turlar bandı daraltır. */
  const zorluk = kirp(0.05 + 0.35 * sk + 0.3 * risk + Math.min(0.28, 0.012 * st.tur), 0, 1);
  const bant = 0.30 - zorluk * 0.19;             // 0.30 → 0.11 (prototipteki zone)
  /* GİZLİ HEDEF: kenarlara yapışmasın diye bandın bir tam genişliği içeride. */
  const hedef = bant + sonraki(st) * (1 - 2 * bant);

  st.faz = 'cekis';
  st.secim = { kat: k, slot: sl, id, sikilik: sk, risk, riskSeviyesi: sev, bant, hedef };
  return {
    ok: true,
    /* HEDEF DÖNMEZ — istemci yalnız bandı ve etiketleri görür. */
    kat: k, slot: sl, bant,
    sikilikEtiketi: sikilikEtiketi(sk),
    riskSeviyesi: sev, riskEtiketi: RISK_ETIKETLERI[sev]
  };
}

/* Seçimi geri al (oyuncu başka taş seçmek isterse). */
function secimiBirak(st, seat) {
  if (st.status !== 'playing') return { ok: false, reason: 'game_over' };
  if (seat !== st.turn) return { ok: false, reason: 'not_your_turn' };
  if (st.faz !== 'cekis') return { ok: false, reason: 'wrong_phase' };
  st.faz = 'secim';
  st.secim = null;
  return { ok: true };
}

/* --------------------------------------------------------------- 2) ÇEKİŞ */
function tasCek(st, seat, el) {
  if (st.status !== 'playing') return { ok: false, reason: 'game_over' };
  if (seat !== st.turn) return { ok: false, reason: 'not_your_turn' };
  if (st.faz !== 'cekis' || !st.secim) return { ok: false, reason: 'wrong_phase' };
  const konum = Number(el);
  if (!Number.isFinite(konum) || konum < 0 || konum > 1) {
    return { ok: false, reason: 'gecersiz_cekis' };
  }
  const sec = st.secim;
  const sapma = Math.abs(konum - sec.hedef);

  if (sapma > sec.bant) {
    /* Band dışı: oyuncu taşı zorladı, kule devrildi. */
    return { ok: true, basarili: false, sapma, hedef: sec.hedef,
             devrildi: true, sonuc: devril(st, 'denge') };
  }

  /* İsabet: ne kadar ortaysa o kadar iyi (0..1). */
  const isabet = 1 - sapma / sec.bant;
  st.izgara[sec.kat][sec.slot] = -1;
  const hedefYer = sonrakiUstSlot(st.izgara);
  while (st.izgara.length <= hedefYer.kat) st.izgara.push([-1, -1, -1]);
  st.izgara[hedefYer.kat][hedefYer.slot] = sec.id;

  const a = coz(st.izgara);
  if (!a.dengeli) {
    /* Taş çıktı ama kule yeni yüküyle ayakta duramadı. */
    return { ok: true, basarili: true, isabet, sapma, hedef: sec.hedef,
             devrildi: true, yerlestirildi: hedefYer, sonuc: devril(st, 'yapi') };
  }
  st.denge = dengeYuzdesi(a);

  /* PUAN — prototipin formülü: taban + kat + sıkılık + isabet + risk,
     üst üste iyi çekişlerde çarpan. */
  const kademe = isabet >= 0.6 ? 2 : isabet >= 0.4 ? 1 : 0;
  st.seri[seat] = kademe >= 1 ? (st.seri[seat] || 0) + 1 : 0;
  const carpan = 1 + 0.25 * Math.min(4, Math.max(0, st.seri[seat] - 1));
  const taban = 100 + 6 * sec.kat + Math.round(sec.sikilik * 60) +
                Math.round(isabet * 120) + Math.round(sec.risk * 80);
  const puan = Math.round(taban * carpan);
  st.skor[seat] = (st.skor[seat] || 0) + puan;
  st.cekis[seat] = (st.cekis[seat] || 0) + 1;
  st.son = { seat, puan, kademe, carpan, isabet, kat: sec.kat, slot: sec.slot,
             yerlestirildi: hedefYer, tur: st.tur };
  st.faz = 'secim';
  st.secim = null;

  /* Sıra rakibe. Çekilecek taş kalmadıysa oyun biter. */
  st.tur += 1;
  st.turn = st.seats.find(s => s !== seat);
  if (!hamleVarMi(st.izgara)) {
    return { ok: true, basarili: true, isabet, sapma, hedef: sec.hedef,
             devrildi: true, yerlestirildi: hedefYer, sonuc: devril(st, 'tas_bitti') };
  }
  return { ok: true, basarili: true, isabet, puan, kademe, carpan,
           sapma, hedef: sec.hedef, devrildi: false, yerlestirildi: hedefYer };
}

/* Süresi dolan oyuncu: taş seçmediyse kendiliğinden en güvenli taşı seçer,
   seçtiyse rastgele (çoğunlukla ıskalayan) bir çekiş yapar. Hiç kimse
   masadan atılmaz — site kuralı. */
function sureDoldu(st) {
  if (st.status !== 'playing') return null;
  const seat = st.turn;
  if (st.faz === 'secim') {
    const aday = enGuvenliTas(st);
    if (!aday) return { tur: 'secim', sonuc: devril(st, 'tas_bitti') };
    const r = tasSec(st, seat, aday.kat, aday.slot);
    return { tur: 'secim', secim: r };
  }
  /* Çekiş fazında süre dolduysa el kayar: isabet rastgele, çoğu zaman band
     dışı kalır — acele etmeyenin cezası budur. */
  const el = sonraki(st);
  return { tur: 'cekis', el, sonuc: tasCek(st, seat, el) };
}

/* Çekilebilir taşlar içinde kuleyi en az sarsan: süre aşımında kullanılır. */
function enGuvenliTas(st) {
  const hc = enUstTamKat(st.izgara);
  let iyi = null, iyiPay = -Infinity;
  for (let k = 0; k < hc; k++) {
    for (let s = 0; s < 3; s++) {
      const id = st.izgara[k][s];
      if (id < 0) continue;
      const a = coz(st.izgara, id);
      if (a.yumusak > iyiPay) { iyiPay = a.yumusak; iyi = { kat: k, slot: s }; }
    }
  }
  return iyi;
}

/* --------------------------------------------------------------- BİTİŞ */
function devril(st, neden) {
  if (st.status !== 'playing') return st.result;
  /* Kuleyi deviren KAYBEDER; sıradaki oyuncu o an kimse odur. */
  const kaybeden = st.turn;
  const kazanan = st.seats.find(s => s !== kaybeden);
  st.status = 'finished';
  st.faz = 'bitti';
  st.secim = null;
  st.winner = kazanan === undefined ? null : kazanan;
  st.result = {
    reason: 'cokus', neden, winner: st.winner, kaybeden,
    skor: Object.assign({}, st.skor),
    cekis: Object.assign({}, st.cekis),
    kat: ustKat(st.izgara) + 1, tur: st.tur
  };
  return st.result;
}
function pesEt(st, seat) {
  if (st.status !== 'playing') return st.result;
  const rakip = st.seats.find(s => s !== seat);
  st.status = 'finished';
  st.faz = 'bitti';
  st.secim = null;
  st.winner = rakip === undefined ? null : rakip;
  st.result = { reason: 'resign', winner: st.winner, kaybeden: seat,
    skor: Object.assign({}, st.skor), cekis: Object.assign({}, st.cekis),
    kat: ustKat(st.izgara) + 1, tur: st.tur };
  return st.result;
}

/* --------------------------------------------------------------- GÖRÜNÜM
   GİZLİ HEDEF ASLA GİTMEZ. İstemci yalnız bandı, etiketleri ve ızgarayı
   görür; maç bitince hedef de açılır (sonuç ekranında gösterilsin diye). */
function gorunum(st, seat, ekstra) {
  const acik = st.status !== 'playing';
  const sec = st.secim;
  return Object.assign({
    kind: 'cenga',
    status: st.status,
    faz: st.faz,
    seats: st.seats.slice(),
    seat: (seat === 0 || seat === 1) ? seat : null,
    turn: st.turn,
    tur: st.tur,
    izgara: st.izgara.map(r => r.slice()),
    izinliKat: enUstTamKat(st.izgara),
    ustKat: ustKat(st.izgara) + 1,
    denge: st.denge,
    skor: Object.assign({}, st.skor),
    seri: Object.assign({}, st.seri),
    cekis: Object.assign({}, st.cekis),
    secim: sec ? {
      kat: sec.kat, slot: sec.slot, bant: sec.bant,
      sikilikEtiketi: sikilikEtiketi(sec.sikilik),
      riskSeviyesi: sec.riskSeviyesi, riskEtiketi: RISK_ETIKETLERI[sec.riskSeviyesi],
      hedef: acik ? sec.hedef : null
    } : null,
    son: st.son,
    winner: st.winner,
    result: st.result
  }, ekstra || {});
}

module.exports = {
  BLOCK_L, BLOCK_W, PITCH, TOPLAM_KAT, SLOT_SIRASI, RISK_ETIKETLERI,
  izgaraKur, katSayisi, ustKat, enUstTamKat, katIzinli, hamleVarMi,
  sonrakiUstSlot, coz, dengeYuzdesi, riskKatsayisi, riskSeviyesi,
  katEkseni, sikilikEtiketi, enGuvenliTas,
  macBaslat, tasSec, secimiBirak, tasCek, sureDoldu, devril, pesEt, gorunum
};
