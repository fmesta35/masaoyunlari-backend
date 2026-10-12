'use strict';
/* ============================================================================
 * METROPOL (emlak oyunu) — SAF OYUN MOTORU (sunucu yetkili)
 * ============================================================================
 * Yerel prototipin kuralları ve kare/kart listeleri birebir taşındı. Değişen
 * şey: ZAR, KART ÇEKİLİŞİ ve BÜTÜN PARA HAREKETLERİ artık sunucuda. İstemci
 * yalnız niyet bildirir ("zar at", "satın al", "ev kur", "turu bitir").
 *
 * TAHTA — 40 kare (SPACES): mülkler (sekiz renk grubu), 4 gar, 2 idare,
 * şans/topluluk, vergiler, ücretsiz park, cezaevi ve "cezaevine git".
 *
 * TEMEL KURALLAR
 *   · Kalkış'tan her geçişte 200 maaş.
 *   · Çift atan tekrar atar; ÜST ÜSTE ÜÇ ÇİFT doğruca cezaevine.
 *   · Cezaevinden çıkış: çift atmak, 50 kefalet ya da çıkış kartı. Üçüncü
 *     denemede çift gelmezse kefalet zorunlu.
 *   · Sahipsiz mülke düşen satın alabilir. ALMAZSA mülk sırayla diğer
 *     oyunculara liste fiyatından teklif edilir (bkz. İHALE notu).
 *   · Kira: grubun tamamı tek sahipteyse ve hiç bina yoksa taban kira İKİ
 *     KATI; bina varsa bina kademesinin kirası. Gar kirası sahip olunan gar
 *     sayısına göre 25/50/100/200; idare kirası zarın 4 ya da 10 katı.
 *   · Bina ancak grubun tamamına sahipken ve DENGELİ kurulur (kareler
 *     arasında en çok bir fark). 5. kademe oteldir. Satış yarı fiyatına.
 *   · İpotek: mülk değerinin yarısı alınır; geri alırken %110 ödenir.
 *     İpotekli mülkte kira yoktur; grubunda bina varken ipotek edilemez.
 *   · Parası yetmeyen oyuncunun binaları ve mülkleri OTOMATİK nakde çevrilir;
 *     yine yetmezse iflas eder ve varlıkları alacaklıya (ya da bankaya) geçer.
 *   · Tek oyuncu kalınca maç biter. Süre dolarsa en yüksek VARLIK kazanır.
 *
 * İHALE NOTU: prototipte alınmayan mülk açık artırmaya çıkıyordu. Çevrimiçi
 * masada açık artırma her teklif için ayrı bir tur ve zamanlayıcı demek;
 * dört kişilik bir masada tek kare dakikalarca sürebilirdi. Bunun yerine
 * mülk, sıradaki oyunculara TEK TUR boyunca liste fiyatından teklif edilir;
 * ilk kabul eden alır, kimse almazsa mülk sahipsiz kalır. Kural metninde de
 * böyle yazıyor — gizli bir sapma değil.
 *
 * Bu dosya SAF mantıktır: soket, zamanlayıcı, oda yoktur.
 * ========================================================================= */

const BASLANGIC_PARA = 1500;
const MAAS = 200;
const KEFALET = 50;
const KARE_SAYISI = 40;
const CEZAEVI = 10;
const GAR_KARELERI = [5, 15, 25, 35];
const IDARE_KARELERI = [12, 28];
const GRUP_ADLARI = {
  brown: 'Kahverengi', lblue: 'Açık Mavi', pink: 'Mor', orange: 'Turuncu',
  red: 'Kırmızı', yellow: 'Sarı', green: 'Yeşil', dblue: 'Lacivert'
};
const GRUP_RENKLERI = {
  brown: '#9a5b2d', lblue: '#6fc5e8', pink: '#d4449a', orange: '#ef8418',
  red: '#e02f2b', yellow: '#f5d020', green: '#20a75a', dblue: '#2a63d8'
};

/* Kare tanımları (prototiple birebir). p: fiyat, r: kira kademeleri,
   b: bina bedeli, a: vergi tutarı. */
const KARELER = [
  { t: 'go', ad: 'KALKIŞ' },
  { t: 'mulk', g: 'brown', ad: 'KASIMPAŞA', p: 60, r: [2, 10, 30, 90, 160, 250], b: 50 },
  { t: 'fon' },
  { t: 'mulk', g: 'brown', ad: 'DOLAPDERE', p: 60, r: [4, 20, 60, 180, 320, 450], b: 50 },
  { t: 'vergi', ad: 'GELİR VERGİSİ', a: 200 },
  { t: 'gar', ad: 'HAYDARPAŞA GARI' },
  { t: 'mulk', g: 'lblue', ad: 'SULTANAHMET', p: 100, r: [6, 30, 90, 270, 400, 550], b: 50 },
  { t: 'sans' },
  { t: 'mulk', g: 'lblue', ad: 'SİRKECİ', p: 100, r: [6, 30, 90, 270, 400, 550], b: 50 },
  { t: 'mulk', g: 'lblue', ad: 'KARAKÖY', p: 120, r: [8, 40, 100, 300, 450, 600], b: 50 },
  { t: 'cezaevi', ad: 'ZİYARET / CEZAEVİ' },
  { t: 'mulk', g: 'pink', ad: 'BEYOĞLU', p: 140, r: [10, 50, 150, 450, 625, 750], b: 100 },
  { t: 'idare', ad: 'ELEKTRİK İDARESİ' },
  { t: 'mulk', g: 'pink', ad: 'BEŞİKTAŞ', p: 140, r: [10, 50, 150, 450, 625, 750], b: 100 },
  { t: 'mulk', g: 'pink', ad: 'BOSTANCI', p: 160, r: [12, 60, 180, 500, 700, 900], b: 100 },
  { t: 'gar', ad: 'SİRKECİ GARI' },
  { t: 'mulk', g: 'orange', ad: 'ŞİŞLİ', p: 180, r: [14, 70, 200, 550, 750, 950], b: 100 },
  { t: 'fon' },
  { t: 'mulk', g: 'orange', ad: 'PANGALTI', p: 180, r: [14, 70, 200, 550, 750, 950], b: 100 },
  { t: 'mulk', g: 'orange', ad: 'HARBİYE', p: 200, r: [16, 80, 220, 600, 800, 1000], b: 100 },
  { t: 'park', ad: 'ÜCRETSİZ PARK' },
  { t: 'mulk', g: 'red', ad: 'CADDEBOSTAN', p: 220, r: [18, 90, 250, 700, 875, 1050], b: 150 },
  { t: 'sans' },
  { t: 'mulk', g: 'red', ad: 'ATAKÖY', p: 220, r: [18, 90, 250, 700, 875, 1050], b: 150 },
  { t: 'mulk', g: 'red', ad: 'BAĞDAT CAD.', p: 240, r: [20, 100, 300, 750, 925, 1100], b: 150 },
  { t: 'gar', ad: 'ANKARA GARI' },
  { t: 'mulk', g: 'yellow', ad: 'BAKIRKÖY', p: 260, r: [22, 110, 330, 800, 975, 1150], b: 150 },
  { t: 'mulk', g: 'yellow', ad: 'BAHÇELİEVLER', p: 260, r: [22, 110, 330, 800, 975, 1150], b: 150 },
  { t: 'idare', ad: 'SU İDARESİ' },
  { t: 'mulk', g: 'yellow', ad: 'SARIYER', p: 280, r: [24, 120, 360, 850, 1025, 1200], b: 150 },
  { t: 'cezaevineGit', ad: 'CEZAEVİNE GİT' },
  { t: 'mulk', g: 'green', ad: 'ETİLER', p: 300, r: [26, 130, 390, 900, 1100, 1275], b: 200 },
  { t: 'mulk', g: 'green', ad: 'LEVENT', p: 300, r: [26, 130, 390, 900, 1100, 1275], b: 200 },
  { t: 'fon' },
  { t: 'mulk', g: 'green', ad: 'BEBEK', p: 320, r: [28, 150, 450, 1000, 1200, 1400], b: 200 },
  { t: 'gar', ad: 'İZMİR GARI' },
  { t: 'sans' },
  { t: 'mulk', g: 'dblue', ad: 'AKSARAY', p: 350, r: [35, 175, 500, 1100, 1300, 1500], b: 200 },
  { t: 'vergi', ad: 'LÜKS VERGİSİ', a: 100 },
  { t: 'mulk', g: 'dblue', ad: 'TAKSİM', p: 400, r: [50, 200, 600, 1400, 1700, 2000], b: 200 }
];
KARELER.forEach((k, i) => {
  k.i = i;
  if (k.t === 'gar') k.p = 200;
  if (k.t === 'idare') k.p = 150;
  if (k.t === 'sans') k.ad = 'ŞANS';
  if (k.t === 'fon') k.ad = 'TOPLULUK FONU';
});

const SANS = [
  { t: 'Kalkış’a ilerle, 200 al.', k: 'git', to: 0 },
  { t: 'Taksim’e ilerle.', k: 'git', to: 39 },
  { t: 'Bağdat Caddesi’ne ilerle. Kalkış’tan geçersen 200 al.', k: 'git', to: 24 },
  { t: 'Beyoğlu’na ilerle. Kalkış’tan geçersen 200 al.', k: 'git', to: 11 },
  { t: 'Sonraki Gara ilerle. Sahibi varsa kirasının 2 katını öde.', k: 'gar2' },
  { t: 'Sonraki Gara ilerle. Sahibi varsa kirasının 2 katını öde.', k: 'gar2' },
  { t: 'Sonraki İdareye ilerle. Sahibi varsa attığın zarın 10 katını öde.', k: 'idare10' },
  { t: 'Banka sana 50 temettü ödüyor.', k: 'al', a: 50 },
  { t: 'Cezaevinden Ücretsiz Çıkış. Bu kartı sakla.', k: 'cikisKarti', deste: 'sans' },
  { t: '3 kare geri git.', k: 'gitKadar', d: -3 },
  { t: 'Doğruca Cezaevine git. Kalkış’tan geçme, 200 alma.', k: 'cezaevi' },
  { t: 'Genel onarım: her evin için 25, her otelin için 100 öde.', k: 'onarim', ev: 25, otel: 100 },
  { t: 'Hız cezası: 15 öde.', k: 'ode', a: 15 },
  { t: 'Haydarpaşa Garı’na ilerle. Kalkış’tan geçersen 200 al.', k: 'git', to: 5 },
  { t: 'Yönetim kurulu başkanı seçildin: her oyuncuya 50 öde.', k: 'herkeseOde', a: 50 },
  { t: 'Yapı kredinin vadesi doldu: 150 al.', k: 'al', a: 150 }
];
const FON = [
  { t: 'Kalkış’a ilerle, 200 al.', k: 'git', to: 0 },
  { t: 'Banka hatası lehine: 200 al.', k: 'al', a: 200 },
  { t: 'Doktor ücreti: 50 öde.', k: 'ode', a: 50 },
  { t: 'Hisse senedi satışı: 50 al.', k: 'al', a: 50 },
  { t: 'Cezaevinden Ücretsiz Çıkış. Bu kartı sakla.', k: 'cikisKarti', deste: 'fon' },
  { t: 'Doğruca Cezaevine git. Kalkış’tan geçme, 200 alma.', k: 'cezaevi' },
  { t: 'Bayram fonu: 100 al.', k: 'al', a: 100 },
  { t: 'Vergi iadesi: 20 al.', k: 'al', a: 20 },
  { t: 'Doğum günün: her oyuncudan 10 al.', k: 'herkestenAl', a: 10 },
  { t: 'Hayat sigortası ödemesi: 100 al.', k: 'al', a: 100 },
  { t: 'Hastane masrafı: 100 öde.', k: 'ode', a: 100 },
  { t: 'Okul harcı: 50 öde.', k: 'ode', a: 50 },
  { t: 'Danışmanlık ücreti: 25 al.', k: 'al', a: 25 },
  { t: 'Sokak onarımı: her evin için 40, her otelin için 115 öde.', k: 'onarim', ev: 40, otel: 115 },
  { t: 'Güzellik yarışmasında ikinci oldun: 10 al.', k: 'al', a: 10 },
  { t: 'Miras kaldı: 100 al.', k: 'al', a: 100 }
];

/* ------------------------------------------------------------------- MAÇ */
function karistir(dizi, rng) {
  for (let i = dizi.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [dizi[i], dizi[j]] = [dizi[j], dizi[i]];
  }
  return dizi;
}
function macBaslat(opts) {
  const o = opts || {};
  const seats = (o.seats || [0, 1]).slice();
  const rng = o.rng || Math.random;
  const st = {
    kind: 'metropol',
    seats,
    rng,
    havuzAcik: o.havuzAcik !== false,       // ücretsiz park havuzu
    havuz: 0,
    kare: KARELER.map(k => ({ i: k.i, sahip: null, ev: 0, ipotek: false })),
    oyuncu: {},
    sira: 0,
    faz: 'zar',       // zar | karar | teklif | bitir | bitti
    zar: [0, 0],
    zarToplam: 0,
    cift: 0,
    sonKart: null,
    teklif: null,     // { kareIdx, sira: [koltuk...], idx }
    pazar: null,      // açık satış/artırma oturumu (bkz. PAZAR)
    garX2: false,
    idareX10: false,
    gunluk: [],       // son olaylar (en çok 40)
    tur: 1,
    /* TUR LİMİTİ: çevrimiçi masa sonsuza kadar sürmesin. Limit dolduğunda
       en yüksek varlığa sahip oyuncu kazanır (macBitir 'sure_doldu'). 0 =
       limit yok. Masa satırındaki "rounds" alanından gelir. */
    turLimiti: Math.max(0, Number(o.turLimiti) || 0),
    status: 'playing',
    winner: null,
    result: null
  };
  seats.forEach(s => {
    st.oyuncu[s] = { seat: s, para: BASLANGIC_PARA, konum: 0, cezaevi: false,
                     cezaTur: 0, cikisKarti: 0, iflas: false };
  });
  st.sansDeste = karistir(SANS.map((c, i) => i), rng);
  st.fonDeste = karistir(FON.map((c, i) => i), rng);
  return st;
}

const siradakiKoltuk = (st) => (st.status === 'playing' ? st.seats[st.sira] : null);
const ayakta = (st) => st.seats.filter(s => !st.oyuncu[s].iflas);
const mulkleri = (st, seat) => st.kare.filter(k => k.sahip === seat);
const grupKareleri = (g) => KARELER.filter(k => k.t === 'mulk' && k.g === g).map(k => k.i);

function gunluge(st, metin) {
  st.gunluk.push(metin);
  if (st.gunluk.length > 40) st.gunluk.shift();
}

/* -------------------------------------------------------------- KİRA */
function kira(st, kareIdx, zarToplam, garCift, idareOn) {
  const tanim = KARELER[kareIdx];
  const d = st.kare[kareIdx];
  if (d.ipotek || d.sahip === null) return 0;
  if (tanim.t === 'gar') {
    const n = GAR_KARELERI.filter(i => st.kare[i].sahip === d.sahip).length;
    const r = 25 * Math.pow(2, n - 1);
    return garCift ? r * 2 : r;
  }
  if (tanim.t === 'idare') {
    if (idareOn) return 10 * zarToplam;
    const n = IDARE_KARELERI.filter(i => st.kare[i].sahip === d.sahip).length;
    return zarToplam * (n >= 2 ? 10 : 4);
  }
  if (tanim.t === 'mulk') {
    if (d.ev > 0) return tanim.r[d.ev];
    const grup = grupKareleri(tanim.g);
    const tekSahip = grup.every(i => st.kare[i].sahip === d.sahip);
    const binasiz = grup.every(i => st.kare[i].ev === 0 && !st.kare[i].ipotek);
    return (tekSahip && binasiz) ? tanim.r[0] * 2 : tanim.r[0];
  }
  return 0;
}
/* Oyuncunun toplam varlığı: nakit + mülk değeri + bina değeri. Süre dolunca
   kazananı bu belirler. */
function varlik(st, seat) {
  const p = st.oyuncu[seat];
  let t = p.para;
  mulkleri(st, seat).forEach(d => {
    const tanim = KARELER[d.i];
    t += d.ipotek ? Math.floor(tanim.p / 2) : tanim.p;
    t += d.ev * (tanim.b || 0);
  });
  return t;
}

/* --------------------------------------------------- ÖDEME / ZORUNLU SATIŞ
   Parası yetmeyenin önce binaları, sonra mülkleri otomatik nakde çevrilir;
   yine yetmezse iflas eder. */
function nakdeCevir(st, seat, gerek) {
  const p = st.oyuncu[seat];
  let koruma = 200;
  while (p.para < gerek && koruma-- > 0) {
    let satildi = false;
    const gruplar = [...new Set(mulkleri(st, seat)
      .filter(d => KARELER[d.i].t === 'mulk').map(d => KARELER[d.i].g))];
    for (const g of gruplar) {
      const kareler = grupKareleri(g).map(i => st.kare[i]).filter(d => d.sahip === seat);
      const enCok = Math.max.apply(null, kareler.map(d => d.ev).concat([0]));
      if (enCok <= 0) continue;
      const hedef = kareler.find(d => d.ev === enCok);
      if (hedef) {
        hedef.ev--;
        p.para += Math.floor((KARELER[hedef.i].b || 0) / 2);
        satildi = true;
        break;
      }
    }
    if (satildi) continue;
    const aday = mulkleri(st, seat)
      .filter(d => !d.ipotek &&
        (KARELER[d.i].t !== 'mulk' || grupKareleri(KARELER[d.i].g).every(i => st.kare[i].ev === 0)))
      .sort((a, b) => KARELER[b.i].p - KARELER[a.i].p)[0];
    if (!aday) break;
    aday.ipotek = true;
    p.para += Math.floor(KARELER[aday.i].p / 2);
  }
}
function ode(st, seat, tutar, alacakliSeat, cezaHavuza) {
  const p = st.oyuncu[seat];
  nakdeCevir(st, seat, tutar);
  if (p.para < tutar) { iflasEt(st, seat, alacakliSeat); return false; }
  p.para -= tutar;
  if (alacakliSeat !== null && alacakliSeat !== undefined) st.oyuncu[alacakliSeat].para += tutar;
  else if (cezaHavuza && st.havuzAcik) st.havuz += tutar;
  return true;
}
function iflasEt(st, seat, alacakliSeat) {
  const p = st.oyuncu[seat];
  if (p.iflas) return;
  p.iflas = true;
  const varMi = (alacakliSeat !== null && alacakliSeat !== undefined);
  mulkleri(st, seat).forEach(d => {
    if (varMi) { d.sahip = alacakliSeat; d.ev = 0; }
    else { d.sahip = null; d.ev = 0; d.ipotek = false; }
  });
  if (varMi) st.oyuncu[alacakliSeat].para += Math.max(0, p.para);
  p.para = 0;
  p.cikisKarti = 0;
  gunluge(st, 'iflas:' + seat);
  const kalan = ayakta(st);
  if (kalan.length <= 1) macBitir(st, 'finished');
}

/* -------------------------------------------------------------- HAREKET */
function ilerle(st, seat, adim, maasVar) {
  const p = st.oyuncu[seat];
  const yeni = ((p.konum + adim) % KARE_SAYISI + KARE_SAYISI) % KARE_SAYISI;
  if (maasVar !== false && adim > 0 && yeni < p.konum) {
    p.para += MAAS;
    gunluge(st, 'maas:' + seat + ':' + MAAS);
  }
  p.konum = yeni;
  return yeni;
}
function cezaeviNeGonder(st, seat) {
  const p = st.oyuncu[seat];
  p.konum = CEZAEVI; p.cezaevi = true; p.cezaTur = 0;
  st.cift = 0;
  gunluge(st, 'cezaevi:' + seat);
}

/* ----------------------------------------------------------------- ZAR */
/* Cezaevine düşen (ya da cezaevinde çift atamayan) oyuncuya "turu bitir" ya da
   "kefalet / çift dene" SORULMAZ: el kendiliğinden bir sonraki oyuncuya geçer.
   Zar değeri ekranda kalsın diye sıfırlanmaz. */
function zarAt(st, seat) {
  const r = zarAtIc(st, seat);
  if (r && r.ok && st.status === 'playing' && st.faz === 'bitir' && !st.pazar) {
    const p = st.oyuncu[seat];
    if (p && p.cezaevi && !r.iflas) {
      const z = st.zar.slice(), zt = st.zarToplam;
      turuBitir(st, seat);
      if (st.status === 'playing') { st.zar = z; st.zarToplam = zt; }
      r.otoBitir = true;
    }
  }
  return r;
}
function zarAtIc(st, seat) {
  if (st.status !== 'playing') return { ok: false, reason: 'game_over' };
  if (st.pazar) return { ok: false, reason: 'pazar_acik' };
  if (seat !== siradakiKoltuk(st)) return { ok: false, reason: 'not_your_turn' };
  if (st.faz !== 'zar') return { ok: false, reason: 'wrong_phase' };
  const p = st.oyuncu[seat];
  const d1 = Math.floor(st.rng() * 6) + 1;
  const d2 = Math.floor(st.rng() * 6) + 1;
  st.zar = [d1, d2];
  st.zarToplam = d1 + d2;
  const cift = d1 === d2;

  if (p.cezaevi) {
    if (cift) {
      p.cezaevi = false; p.cezaTur = 0;
      ilerle(st, seat, d1 + d2);
      return Object.assign({ ok: true, zar: [d1, d2], cezadanCikti: true }, kareyeDus(st, seat, false));
    }
    p.cezaTur++;
    if (p.cezaTur >= 3) {
      if (!ode(st, seat, KEFALET, null, true)) { turuBitir(st); return { ok: true, zar: [d1, d2], iflas: true }; }
      p.cezaevi = false; p.cezaTur = 0;
      ilerle(st, seat, d1 + d2);
      return Object.assign({ ok: true, zar: [d1, d2], kefalet: true }, kareyeDus(st, seat, false));
    }
    st.faz = 'bitir';
    return { ok: true, zar: [d1, d2], cezaevinde: true, kalanHak: 3 - p.cezaTur };
  }

  if (cift) {
    st.cift++;
    if (st.cift === 3) {
      /* ÜÇ ÇİFT: hız yapan cezaevine. Yoksa tur bitmeyebilirdi. */
      cezaeviNeGonder(st, seat);
      st.faz = 'bitir';
      return { ok: true, zar: [d1, d2], ucCift: true };
    }
  } else {
    st.cift = 0;
  }
  ilerle(st, seat, d1 + d2);
  return Object.assign({ ok: true, zar: [d1, d2], cift }, kareyeDus(st, seat, cift));
}

/* ----------------------------------------------------- KAREYE DÜŞME */
function kareyeDus(st, seat, cift) {
  const p = st.oyuncu[seat];
  const tanim = KARELER[p.konum];
  const d = st.kare[p.konum];
  const garX2 = st.garX2, idareOn = st.idareX10;
  st.garX2 = false; st.idareX10 = false;

  if (tanim.t === 'go' || tanim.t === 'cezaevi') { return turSonu(st, cift); }
  if (tanim.t === 'park') {
    if (st.havuzAcik && st.havuz > 0) {
      p.para += st.havuz;
      gunluge(st, 'havuz:' + seat + ':' + st.havuz);
      st.havuz = 0;
    }
    return turSonu(st, cift);
  }
  if (tanim.t === 'cezaevineGit') {
    cezaeviNeGonder(st, seat);
    st.faz = 'bitir';
    return { kare: p.konum };
  }
  if (tanim.t === 'vergi') {
    ode(st, seat, tanim.a, null, true);
    gunluge(st, 'vergi:' + seat + ':' + tanim.a);
    return turSonu(st, cift);
  }
  if (tanim.t === 'sans' || tanim.t === 'fon') return kartCek(st, seat, tanim.t, cift);

  /* Satın alınabilir kare */
  if (d.sahip === null) {
    st.faz = 'karar';
    st.teklif = null;
    return { kare: p.konum, satilik: true, fiyat: tanim.p };
  }
  if (d.sahip === seat || d.ipotek) return turSonu(st, cift);

  const tutar = kira(st, p.konum, st.zarToplam, garX2, idareOn);
  if (tutar > 0) {
    ode(st, seat, tutar, d.sahip, false);
    gunluge(st, 'kira:' + seat + ':' + d.sahip + ':' + tutar + ':' + p.konum);
  }
  return turSonu(st, cift);
}

/* ---------------------------------------------------------------- KART */
function kartCek(st, seat, tur, cift) {
  const deste = tur === 'sans' ? st.sansDeste : st.fonDeste;
  const liste = tur === 'sans' ? SANS : FON;
  if (!deste.length) {
    const hepsi = liste.map((c, i) => i).filter(i => liste[i].k !== 'cikisKarti');
    karistir(hepsi, st.rng).forEach(i => deste.push(i));
  }
  const idx = deste.shift();
  const kart = liste[idx];
  st.kartSayac = (st.kartSayac || 0) + 1;
  st.sonKart = { tur, metin: kart.t, n: st.kartSayac, seat };
  /* Günlüğe de yazılır: kart metni panelde birkaç saniye sonra kaybolur,
     oyuncu "ne olmuştu?" diye günlüğe bakabilsin. */
  gunluge(st, 'kart:' + seat + ':' + tur + ':' + kart.t);
  const geriKoy = () => { if (kart.k !== 'cikisKarti') deste.push(idx); };
  const p = st.oyuncu[seat];

  switch (kart.k) {
    case 'al': p.para += kart.a; geriKoy(); return turSonu(st, cift);
    case 'ode': ode(st, seat, kart.a, null, true); geriKoy(); return turSonu(st, cift);
    case 'herkestenAl': {
      ayakta(st).forEach(o => { if (o !== seat) ode(st, o, kart.a, seat, false); });
      geriKoy(); return turSonu(st, cift);
    }
    case 'herkeseOde': {
      for (const o of ayakta(st)) {
        if (o === seat) continue;
        if (!ode(st, seat, kart.a, o, false)) break;
      }
      geriKoy(); return turSonu(st, cift);
    }
    case 'onarim': {
      let ev = 0, otel = 0;
      mulkleri(st, seat).forEach(d => { if (d.ev === 5) otel++; else ev += d.ev; });
      const bedel = ev * kart.ev + otel * kart.otel;
      if (bedel > 0) { ode(st, seat, bedel, null, true); gunluge(st, 'onarim:' + seat + ':' + bedel); }
      geriKoy(); return turSonu(st, cift);
    }
    case 'cikisKarti': p.cikisKarti++; return turSonu(st, cift);
    case 'cezaevi': cezaeviNeGonder(st, seat); geriKoy(); st.faz = 'bitir'; return { kart: st.sonKart };
    case 'git': {
      geriKoy();
      ilerle(st, seat, ((kart.to - p.konum) % KARE_SAYISI + KARE_SAYISI) % KARE_SAYISI);
      return kareyeDus(st, seat, cift);
    }
    case 'gitKadar': {
      geriKoy();
      ilerle(st, seat, kart.d, false);
      return kareyeDus(st, seat, cift);
    }
    case 'gar2': {
      geriKoy();
      let to = GAR_KARELERI.find(x => x > p.konum);
      if (to === undefined) to = GAR_KARELERI[0];
      st.garX2 = st.kare[to].sahip !== null && st.kare[to].sahip !== seat;
      ilerle(st, seat, ((to - p.konum) % KARE_SAYISI + KARE_SAYISI) % KARE_SAYISI);
      return kareyeDus(st, seat, cift);
    }
    case 'idare10': {
      geriKoy();
      let to = IDARE_KARELERI.find(x => x > p.konum);
      if (to === undefined) to = IDARE_KARELERI[0];
      st.idareX10 = st.kare[to].sahip !== null && st.kare[to].sahip !== seat;
      ilerle(st, seat, ((to - p.konum) % KARE_SAYISI + KARE_SAYISI) % KARE_SAYISI);
      return kareyeDus(st, seat, cift);
    }
  }
  geriKoy();
  return turSonu(st, cift);
}

/* --------------------------------------------------------- SATIN ALMA */
function satinAl(st, seat) {
  if (st.status !== 'playing') return { ok: false, reason: 'game_over' };
  if (st.pazar) return { ok: false, reason: 'pazar_acik' };
  const sirada = siradakiKoltuk(st);
  /* Hem sıradaki oyuncunun kararı hem de teklif turundaki alım burada. */
  if (st.faz === 'karar') {
    if (seat !== sirada) return { ok: false, reason: 'not_your_turn' };
    const p = st.oyuncu[seat];
    const kareIdx = p.konum;
    const tanim = KARELER[kareIdx];
    if (st.kare[kareIdx].sahip !== null) return { ok: false, reason: 'satilmaz' };
    if (p.para < tanim.p) return { ok: false, reason: 'para_yetmiyor' };
    p.para -= tanim.p;
    st.kare[kareIdx].sahip = seat;
    gunluge(st, 'aldi:' + seat + ':' + kareIdx);
    Object.assign(st, {});
    const son = turSonu(st, st.zar[0] === st.zar[1] && !st.oyuncu[seat].cezaevi);
    return { ok: true, kare: kareIdx, sonuc: son };
  }
  if (st.faz === 'teklif') {
    const t = st.teklif;
    if (!t || t.sira[t.idx] !== seat) return { ok: false, reason: 'not_your_turn' };
    const tanim = KARELER[t.kareIdx];
    const p = st.oyuncu[seat];
    if (p.para < tanim.p) return { ok: false, reason: 'para_yetmiyor' };
    p.para -= tanim.p;
    st.kare[t.kareIdx].sahip = seat;
    gunluge(st, 'teklifAldi:' + seat + ':' + t.kareIdx);
    st.teklif = null;
    const son = turSonu(st, false);
    return { ok: true, kare: t.kareIdx, sonuc: son };
  }
  return { ok: false, reason: 'wrong_phase' };
}
/* Almayı reddet: sıradaki oyuncu reddederse teklif turu başlar; teklif
   turunda reddeden sıradakine geçer. */
function reddet(st, seat) {
  if (st.status !== 'playing') return { ok: false, reason: 'game_over' };
  if (st.pazar) return { ok: false, reason: 'pazar_acik' };
  if (st.faz === 'karar') {
    if (seat !== siradakiKoltuk(st)) return { ok: false, reason: 'not_your_turn' };
    const kareIdx = st.oyuncu[seat].konum;
    const digerleri = ayakta(st).filter(s => s !== seat);
    if (!digerleri.length) return { ok: true, sonuc: turSonu(st, false) };
    st.teklif = { kareIdx, sira: digerleri, idx: 0 };
    st.faz = 'teklif';
    return { ok: true, teklif: { kareIdx, seat: digerleri[0] } };
  }
  if (st.faz === 'teklif') {
    const t = st.teklif;
    if (!t || t.sira[t.idx] !== seat) return { ok: false, reason: 'not_your_turn' };
    t.idx++;
    if (t.idx >= t.sira.length) {
      st.teklif = null;
      return { ok: true, sonuc: turSonu(st, false) };
    }
    return { ok: true, teklif: { kareIdx: t.kareIdx, seat: t.sira[t.idx] } };
  }
  return { ok: false, reason: 'wrong_phase' };
}

/* --------------------------------------------------------- BİNA / İPOTEK
   Her ikisi de YALNIZ sırası olan oyuncunun kendi turunda yapılabilir. */
function binaKurulabilirMi(st, seat, kareIdx) {
  const tanim = KARELER[kareIdx];
  const d = st.kare[kareIdx];
  if (!tanim || tanim.t !== 'mulk') return 'gecersiz_kare';
  if (d.sahip !== seat) return 'sizin_degil';
  if (d.ipotek) return 'ipotekli';
  if (d.ev >= 5) return 'bina_dolu';
  const grup = grupKareleri(tanim.g);
  if (!grup.every(i => st.kare[i].sahip === seat)) return 'grup_eksik';
  if (grup.some(i => st.kare[i].ipotek)) return 'ipotekli';
  /* DENGELİ İNŞAAT: kareler arasında en çok bir fark olabilir. */
  const enAz = Math.min.apply(null, grup.map(i => st.kare[i].ev));
  if (d.ev > enAz) return 'dengesiz';
  if (st.oyuncu[seat].para < (tanim.b || 0)) return 'para_yetmiyor';
  return null;
}
function binaKur(st, seat, kareIdx) {
  if (st.status !== 'playing') return { ok: false, reason: 'game_over' };
  if (st.pazar) return { ok: false, reason: 'pazar_acik' };
  if (seat !== siradakiKoltuk(st)) return { ok: false, reason: 'not_your_turn' };
  if (st.faz !== 'zar' && st.faz !== 'bitir') return { ok: false, reason: 'wrong_phase' };
  const sebep = binaKurulabilirMi(st, seat, Number(kareIdx));
  if (sebep) return { ok: false, reason: sebep };
  const tanim = KARELER[kareIdx];
  st.oyuncu[seat].para -= tanim.b;
  st.kare[kareIdx].ev++;
  gunluge(st, 'bina:' + seat + ':' + kareIdx + ':' + st.kare[kareIdx].ev);
  return { ok: true, ev: st.kare[kareIdx].ev };
}
function binaSat(st, seat, kareIdx) {
  if (st.status !== 'playing') return { ok: false, reason: 'game_over' };
  if (st.pazar) return { ok: false, reason: 'pazar_acik' };
  if (seat !== siradakiKoltuk(st)) return { ok: false, reason: 'not_your_turn' };
  const i = Number(kareIdx);
  const tanim = KARELER[i];
  const d = st.kare[i];
  if (!tanim || tanim.t !== 'mulk' || !d || d.sahip !== seat) return { ok: false, reason: 'sizin_degil' };
  if (d.ev <= 0) return { ok: false, reason: 'bina_yok' };
  /* Dengeli satış: en çok binası olanlardan satılır. */
  const grup = grupKareleri(tanim.g);
  const enCok = Math.max.apply(null, grup.map(x => st.kare[x].ev));
  if (d.ev < enCok) return { ok: false, reason: 'dengesiz' };
  d.ev--;
  st.oyuncu[seat].para += Math.floor((tanim.b || 0) / 2);
  return { ok: true, ev: d.ev };
}
function ipotek(st, seat, kareIdx) {
  if (st.status !== 'playing') return { ok: false, reason: 'game_over' };
  if (st.pazar) return { ok: false, reason: 'pazar_acik' };
  if (seat !== siradakiKoltuk(st)) return { ok: false, reason: 'not_your_turn' };
  const i = Number(kareIdx);
  const tanim = KARELER[i];
  const d = st.kare[i];
  if (!tanim || !d || d.sahip !== seat) return { ok: false, reason: 'sizin_degil' };
  if (!d.ipotek) {
    if (tanim.t === 'mulk' && grupKareleri(tanim.g).some(x => st.kare[x].ev > 0)) {
      return { ok: false, reason: 'once_binalari_sat' };
    }
    d.ipotek = true;
    st.oyuncu[seat].para += Math.floor(tanim.p / 2);
    return { ok: true, ipotek: true };
  }
  const bedel = Math.ceil(tanim.p * 0.55);
  if (st.oyuncu[seat].para < bedel) return { ok: false, reason: 'para_yetmiyor' };
  st.oyuncu[seat].para -= bedel;
  d.ipotek = false;
  return { ok: true, ipotek: false, bedel };
}

/* --------------------------------------------------------- PAZAR
   Oyuncu KENDİ turunda (zar öncesi ya da tur bitirmeden önce) bir tapusunu
   iki yoldan satışa çıkarabilir:
     · SABİT FİYAT: satıcı fiyatı belirler; diğer oyuncuların HEPSİNE aynı
       anda sunulur, parası yetip ilk "satın al"a basan alır.
     · AÇIK ARTIRMA: tapunun liste fiyatının biraz üstünde sabit bir
       başlangıçla açılır. Teklif sırası dönüşümlüdür; herkes oturumda en çok
       3 kez teklif verir, istediği an "çekil" diyebilir. Sonunda en yüksek
       teklif tapu sahibine sunulur: kabul ederse tapu o oyuncuya satılır,
       reddederse artırma kapanır. Bir oyuncu bir tur içinde en çok 3 tapuyu
       açık artırmaya sunabilir.
   Her adımın süresi 30 saniyedir (süre dolunca: alıcı çekilir / satıcı
   reddetmiş sayılır / sabit fiyat teklifi kapanır). Pazar açıkken HAMLE
   SAATİ sunucuda DURDURULUR (bkz. server.js → metropolSonrasi). Motor
   saf kalsın diye zamanı çağıran verir (`simdi`, ms).
   Pazar açıkken başka hiçbir oyun eylemi kabul edilmez (`pazar_acik`). */
const PAZAR_SURE_MS = 30000;
const ARTIRMA_HAK = 3;          // oturumda kişi başı en çok teklif sayısı
const TUR_ARTIRMA_LIMITI = 3;   // bir turda en çok açık artırmaya çıkan tapu
const MIN_ARTIS = 10;
const SATILABILIR_TURLER = { mulk: 1, gar: 1, idare: 1 };

function artirmaBaslangic(fiyat) { return Math.ceil(fiyat * 1.1 / 5) * 5; }
function turArtirmaKullanilan(st, seat) {
  const a = st.oyuncu[seat].artirma;
  return (a && a.tur === st.tur) ? a.n : 0;
}
function pazarSatilabilirMi(st, seat, kareIdx) {
  const i = Number(kareIdx);
  const tanim = KARELER[i];
  const d = st.kare[i];
  if (!tanim || !d || !SATILABILIR_TURLER[tanim.t]) return 'gecersiz_kare';
  if (d.sahip !== seat) return 'sizin_degil';
  if (d.ipotek) return 'ipotekli';
  if (tanim.t === 'mulk' && grupKareleri(tanim.g).some(x => st.kare[x].ev > 0)) return 'once_binalari_sat';
  return null;
}
function tapuDevret(st, satici, alici, kareIdx, tutar) {
  st.oyuncu[alici].para -= tutar;
  st.oyuncu[satici].para += tutar;
  st.kare[kareIdx].sahip = alici;
}
function pazarAc(st, seat, kareIdx, mod, fiyat, simdi) {
  if (st.status !== 'playing') return { ok: false, reason: 'game_over' };
  if (st.pazar) return { ok: false, reason: 'pazar_acik' };
  if (seat !== siradakiKoltuk(st)) return { ok: false, reason: 'not_your_turn' };
  if (st.faz !== 'zar' && st.faz !== 'bitir') return { ok: false, reason: 'wrong_phase' };
  const i = Number(kareIdx);
  const sebep = pazarSatilabilirMi(st, seat, i);
  if (sebep) return { ok: false, reason: sebep };
  const rakipler = ayakta(st).filter(x => x !== seat);
  if (!rakipler.length) return { ok: false, reason: 'rakip_yok' };
  const tanim = KARELER[i];
  const t0 = Number(simdi) || 0;
  if (mod === 'sabit') {
    const f = Math.floor(Number(fiyat));
    if (!(f >= 10 && f <= tanim.p * 4)) return { ok: false, reason: 'fiyat_gecersiz' };
    st.pazar = { mod: 'sabit', kare: i, satici: seat, fiyat: f, alicilar: rakipler,
                 bitis: t0 + PAZAR_SURE_MS };
    gunluge(st, 'sabitSat:' + seat + ':' + i + ':' + f);
    return { ok: true, mod: 'sabit', kare: i, fiyat: f };
  }
  if (mod === 'artirma') {
    if (turArtirmaKullanilan(st, seat) >= TUR_ARTIRMA_LIMITI) return { ok: false, reason: 'artirma_limiti' };
    /* Teklif sırası: satıcıdan sonraki koltuktan başlayarak dönüşümlü. */
    const bas = st.seats.indexOf(seat);
    const sira = [];
    for (let k = 1; k < st.seats.length; k++) {
      const x = st.seats[(bas + k) % st.seats.length];
      if (rakipler.indexOf(x) !== -1) sira.push(x);
    }
    const hak = {}, cekildi = {};
    sira.forEach(x => { hak[x] = ARTIRMA_HAK; cekildi[x] = false; });
    const a = st.oyuncu[seat].artirma;
    st.oyuncu[seat].artirma = { tur: st.tur, n: (a && a.tur === st.tur ? a.n : 0) + 1 };
    st.pazar = { mod: 'artirma', kare: i, satici: seat, baslangic: artirmaBaslangic(tanim.p),
                 enYuksek: null, sira, idx: -1, hak, cekildi, asama: 'teklif', gecmis: [],
                 bitis: t0 + PAZAR_SURE_MS };
    gunluge(st, 'artirmaAc:' + seat + ':' + i + ':' + st.pazar.baslangic);
    artirmaIlerle(st, t0);
    return { ok: true, mod: 'artirma', kare: i, baslangic: st.pazar.baslangic };
  }
  return { ok: false, reason: 'mod_gecersiz' };
}
function artirmaMinTeklif(pz) {
  return pz.enYuksek ? pz.enYuksek.tutar + MIN_ARTIS : pz.baslangic;
}
function artirmaAktifMi(st, pz, x) {
  const o = st.oyuncu[x];
  return !pz.cekildi[x] && pz.hak[x] > 0 && !o.iflas && o.para >= artirmaMinTeklif(pz) &&
         !(pz.enYuksek && pz.enYuksek.seat === x);
}
/* Sıradaki teklif verebilecek oyuncuya geç; kimse kalmadıysa artırmayı bitir
   (en yüksek teklif varsa satıcının kararına sun). */
function artirmaIlerle(st, simdi) {
  const pz = st.pazar;
  const n = pz.sira.length;
  for (let k = 1; k <= n; k++) {
    const j = ((pz.idx < 0 ? -1 : pz.idx) + k + n) % n;
    if (artirmaAktifMi(st, pz, pz.sira[j])) {
      pz.idx = j; pz.bitis = (Number(simdi) || 0) + PAZAR_SURE_MS;
      return;
    }
  }
  if (!pz.enYuksek) {
    gunluge(st, 'artirmaBos:' + pz.satici + ':' + pz.kare);
    st.pazar = null;
    return;
  }
  pz.asama = 'karar';
  pz.idx = -1;
  pz.bitis = (Number(simdi) || 0) + PAZAR_SURE_MS;
}
function pazarSatinAl(st, seat, simdi) {
  const pz = st.pazar;
  if (st.status !== 'playing' || !pz || pz.mod !== 'sabit') return { ok: false, reason: 'pazar_yok' };
  if (pz.alicilar.indexOf(seat) === -1 || st.oyuncu[seat].iflas) return { ok: false, reason: 'alici_degil' };
  if (st.oyuncu[seat].para < pz.fiyat) return { ok: false, reason: 'para_yetmiyor' };
  tapuDevret(st, pz.satici, seat, pz.kare, pz.fiyat);
  gunluge(st, 'satti:' + pz.satici + ':' + seat + ':' + pz.kare + ':' + pz.fiyat);
  const r = { ok: true, kare: pz.kare, alici: seat, satici: pz.satici, tutar: pz.fiyat };
  st.pazar = null;
  return r;
}
function pazarVazgec(st, seat) {
  const pz = st.pazar;
  if (st.status !== 'playing' || !pz || pz.mod !== 'sabit') return { ok: false, reason: 'pazar_yok' };
  if (pz.satici !== seat) return { ok: false, reason: 'satici_degil' };
  gunluge(st, 'sabitIptal:' + seat + ':' + pz.kare);
  st.pazar = null;
  return { ok: true };
}
/* Sabit fiyatlı satışta bir alıcı "istemiyorum" der: o kişi alıcı listesinden
   çıkar, süre dolmasını beklemez. Son alıcı da reddedince satış kapanır. */
function pazarReddet(st, seat) {
  const pz = st.pazar;
  if (st.status !== 'playing' || !pz || pz.mod !== 'sabit') return { ok: false, reason: 'pazar_yok' };
  if (pz.alicilar.indexOf(seat) === -1) return { ok: false, reason: 'alici_degil' };
  pz.alicilar = pz.alicilar.filter(x => x !== seat);
  gunluge(st, 'sabitRed:' + seat + ':' + pz.kare);
  let hepsi = false;
  if (!pz.alicilar.length) {
    gunluge(st, 'sabitHepsiRed:' + pz.satici + ':' + pz.kare);
    st.pazar = null; hepsi = true;
  }
  return { ok: true, kapandi: hepsi };
}
function pazarTeklif(st, seat, tutar, simdi) {
  const pz = st.pazar;
  if (st.status !== 'playing' || !pz || pz.mod !== 'artirma' || pz.asama !== 'teklif') return { ok: false, reason: 'pazar_yok' };
  if (pz.sira[pz.idx] !== seat) return { ok: false, reason: 'not_your_turn' };
  const t = Math.floor(Number(tutar));
  if (!(t >= artirmaMinTeklif(pz))) return { ok: false, reason: 'teklif_dusuk', min: artirmaMinTeklif(pz) };
  if (t > st.oyuncu[seat].para) return { ok: false, reason: 'para_yetmiyor' };
  pz.enYuksek = { seat, tutar: t };
  pz.hak[seat]--;
  pz.gecmis.push({ seat, tutar: t });
  if (pz.gecmis.length > 12) pz.gecmis.shift();
  gunluge(st, 'artirmaTeklif:' + seat + ':' + pz.kare + ':' + t);
  artirmaIlerle(st, simdi);
  return { ok: true, tutar: t };
}
function pazarCekil(st, seat, simdi) {
  const pz = st.pazar;
  if (st.status !== 'playing' || !pz || pz.mod !== 'artirma' || pz.asama !== 'teklif') return { ok: false, reason: 'pazar_yok' };
  if (pz.sira[pz.idx] !== seat) return { ok: false, reason: 'not_your_turn' };
  pz.cekildi[seat] = true;
  gunluge(st, 'artirmaCekil:' + seat + ':' + pz.kare);
  artirmaIlerle(st, simdi);
  return { ok: true };
}
function pazarKarar(st, seat, kabul, simdi) {
  const pz = st.pazar;
  if (st.status !== 'playing' || !pz || pz.mod !== 'artirma' || pz.asama !== 'karar') return { ok: false, reason: 'pazar_yok' };
  if (pz.satici !== seat) return { ok: false, reason: 'satici_degil' };
  const eh = pz.enYuksek;
  if (kabul && eh) {
    if (st.oyuncu[eh.seat].iflas || st.oyuncu[eh.seat].para < eh.tutar) {
      gunluge(st, 'artirmaRed:' + seat + ':' + pz.kare);
      st.pazar = null;
      return { ok: true, satildi: false };
    }
    tapuDevret(st, seat, eh.seat, pz.kare, eh.tutar);
    gunluge(st, 'satti:' + seat + ':' + eh.seat + ':' + pz.kare + ':' + eh.tutar);
    const r = { ok: true, satildi: true, kare: pz.kare, alici: eh.seat, tutar: eh.tutar };
    st.pazar = null;
    return r;
  }
  gunluge(st, 'artirmaRed:' + seat + ':' + pz.kare);
  st.pazar = null;
  return { ok: true, satildi: false };
}
/* 30 sn doldu: sabit teklif kapanır; sıradaki alıcı çekilmiş sayılır; satıcı
   reddetmiş sayılır. Süre dolmadıysa null döner. */
function pazarSureDoldu(st, simdi) {
  const pz = st.pazar;
  if (st.status !== 'playing' || !pz || (Number(simdi) || 0) < pz.bitis) return null;
  if (pz.mod === 'sabit') {
    gunluge(st, 'sabitSure:' + pz.satici + ':' + pz.kare);
    st.pazar = null;
    return { tur: 'sabit' };
  }
  if (pz.asama === 'teklif') {
    const kim = pz.sira[pz.idx];
    pazarCekil(st, kim, simdi);
    return { tur: 'teklif', seat: kim };
  }
  const satici = pz.satici;
  pazarKarar(st, satici, false, simdi);
  return { tur: 'karar', seat: satici };
}
/* Pes eden / iflas eden oyuncu pazardan çıkarılır. */
function pazarOyuncuCikar(st, seat, simdi) {
  const pz = st.pazar;
  if (!pz) return;
  if (pz.satici === seat) { st.pazar = null; return; }
  if (pz.mod === 'sabit') {
    pz.alicilar = pz.alicilar.filter(x => x !== seat);
    if (!pz.alicilar.length) st.pazar = null;
    return;
  }
  if (pz.enYuksek && pz.enYuksek.seat === seat) { st.pazar = null; return; }
  pz.cekildi[seat] = true;
  if (pz.asama === 'teklif' && pz.sira[pz.idx] === seat) artirmaIlerle(st, simdi);
}

/* --------------------------------------------------------- CEZAEVİ */
function kefaletOde(st, seat) {
  if (st.status !== 'playing') return { ok: false, reason: 'game_over' };
  if (st.pazar) return { ok: false, reason: 'pazar_acik' };
  if (seat !== siradakiKoltuk(st)) return { ok: false, reason: 'not_your_turn' };
  const p = st.oyuncu[seat];
  if (!p.cezaevi) return { ok: false, reason: 'wrong_phase' };
  if (!ode(st, seat, KEFALET, null, true)) return { ok: false, reason: 'para_yetmiyor' };
  p.cezaevi = false; p.cezaTur = 0;
  st.faz = 'zar';
  return { ok: true };
}
function cikisKartiKullan(st, seat) {
  if (st.status !== 'playing') return { ok: false, reason: 'game_over' };
  if (st.pazar) return { ok: false, reason: 'pazar_acik' };
  if (seat !== siradakiKoltuk(st)) return { ok: false, reason: 'not_your_turn' };
  const p = st.oyuncu[seat];
  if (!p.cezaevi) return { ok: false, reason: 'wrong_phase' };
  if (p.cikisKarti <= 0) return { ok: false, reason: 'kart_yok' };
  p.cikisKarti--; p.cezaevi = false; p.cezaTur = 0;
  st.faz = 'zar';
  return { ok: true };
}

/* ------------------------------------------------------------ TUR SONU */
function turSonu(st, cift) {
  if (st.status !== 'playing') return { bitti: true };
  const seat = siradakiKoltuk(st);
  const p = seat === null ? null : st.oyuncu[seat];
  if (!p || p.iflas) { st.faz = 'bitir'; return { iflas: true }; }
  if (cift && !p.cezaevi) { st.faz = 'zar'; return { tekrar: true }; }
  st.faz = 'bitir';
  return { bitir: true };
}
function turuBitir(st, seat) {
  if (st.status !== 'playing') return { ok: false, reason: 'game_over' };
  if (st.pazar) return { ok: false, reason: 'pazar_acik' };
  if (seat !== undefined && seat !== siradakiKoltuk(st)) return { ok: false, reason: 'not_your_turn' };
  if (st.faz === 'karar' || st.faz === 'teklif') return { ok: false, reason: 'wrong_phase' };
  st.cift = 0;
  st.teklif = null;
  let koruma = 0;
  const oncekiSira = st.sira;
  do {
    st.sira = (st.sira + 1) % st.seats.length;
    koruma++;
  } while (st.oyuncu[siradakiKoltuk(st)].iflas && koruma <= st.seats.length * 2);
  if (st.sira <= oncekiSira) st.tur++;
  if (st.turLimiti && st.tur > st.turLimiti) {
    return { ok: true, sira: null, sonuc: macBitir(st, 'tur_limiti') };
  }
  st.faz = 'zar';
  st.zar = [0, 0];
  return { ok: true, sira: siradakiKoltuk(st) };
}

/* Süresi dolan oyuncu masadan ATILMAZ: eksik adımı sunucu tamamlar. */
function sureDoldu(st, seat) {
  if (st.status !== 'playing') return null;
  const sirada = siradakiKoltuk(st);
  if (st.faz === 'teklif' && st.teklif) {
    return { tur: 'teklif', sonuc: reddet(st, st.teklif.sira[st.teklif.idx]) };
  }
  if (seat !== undefined && seat !== sirada) return null;
  if (st.faz === 'zar') return { tur: 'zar', sonuc: zarAt(st, sirada) };
  if (st.faz === 'karar') {
    /* Parası yetiyorsa alır (pasif oyuncu cezalandırılmasın), yoksa
       teklif turuna bırakır. */
    const tanim = KARELER[st.oyuncu[sirada].konum];
    if (st.oyuncu[sirada].para >= tanim.p * 2) return { tur: 'alir', sonuc: satinAl(st, sirada) };
    return { tur: 'reddeder', sonuc: reddet(st, sirada) };
  }
  if (st.faz === 'bitir') return { tur: 'bitir', sonuc: turuBitir(st, sirada) };
  return null;
}

/* --------------------------------------------------------------- BİTİŞ */
function macBitir(st, reason) {
  st.status = 'finished';
  st.faz = 'bitti';
  const kalan = ayakta(st);
  let winner = null;
  if (kalan.length === 1) winner = kalan[0];
  else if (kalan.length > 1) {
    /* Süre doldu: en yüksek VARLIK kazanır, eşitlikte kazanan yok. */
    const sirali = kalan.slice().sort((a, b) => varlik(st, b) - varlik(st, a));
    winner = (sirali.length > 1 && varlik(st, sirali[0]) === varlik(st, sirali[1]))
      ? null : sirali[0];
  }
  st.winner = winner;
  st.result = {
    reason: reason || 'finished', winner,
    varlik: st.seats.reduce((a, s) => { a[s] = varlik(st, s); return a; }, {}),
    iflas: st.seats.filter(s => st.oyuncu[s].iflas)
  };
  return st.result;
}
function pesEt(st, seat) {
  if (st.status !== 'playing') return st.result;
  pazarOyuncuCikar(st, seat, 0);
  iflasEt(st, seat, null);
  if (st.status === 'playing') {
    /* Sırası pes edendeyse sırayı ilerlet. */
    if (siradakiKoltuk(st) === seat) turuBitir(st);
    if (ayakta(st).length <= 1) macBitir(st, 'resign');
  }
  if (st.result) st.result.reason = 'resign';
  return st.result;
}

/* --------------------------------------------------------------- GÖRÜNÜM
   Metropol'de gizli bilgi yoktur: para, mülk ve kartlar masada açıktır.
   Gizli olan tek şey DESTENİN SIRASI — o istemciye gitmez, yoksa bir
   sonraki kart önceden bilinirdi. */
function gorunum(st, seat, ekstra) {
  const bakan = (st.seats.indexOf(seat) !== -1) ? seat : null;
  const sirada = siradakiKoltuk(st);
  return Object.assign({
    kind: 'metropol',
    status: st.status,
    faz: st.faz,
    seats: st.seats.slice(),
    seat: bakan,
    turn: sirada,
    tur: st.tur,
    turLimiti: st.turLimiti,
    zar: st.zar.slice(),
    cift: st.cift,
    havuz: st.havuzAcik ? st.havuz : null,
    kareler: KARELER.map(k => ({
      i: k.i, t: k.t, ad: k.ad, g: k.g || null, p: k.p || 0,
      r: k.r || null, b: k.b || 0, a: k.a || 0
    })),
    durum: st.kare.map(d => ({ i: d.i, sahip: d.sahip, ev: d.ev, ipotek: d.ipotek })),
    oyuncular: st.seats.map(s => ({
      seat: s, para: st.oyuncu[s].para, konum: st.oyuncu[s].konum,
      cezaevi: st.oyuncu[s].cezaevi, cezaTur: st.oyuncu[s].cezaTur,
      cikisKarti: st.oyuncu[s].cikisKarti, iflas: st.oyuncu[s].iflas,
      varlik: varlik(st, s)
    })),
    /* O an satılık olan kare ve teklif sırası. */
    satilik: (st.faz === 'karar' && sirada !== null) ? st.oyuncu[sirada].konum : null,
    teklif: st.teklif ? { kare: st.teklif.kareIdx, seat: st.teklif.sira[st.teklif.idx] } : null,
    /* Bina/ipotek düğmeleri için: bu oyuncu şu anda ne yapabilir? */
    kurulabilir: (!st.pazar && bakan !== null && bakan === sirada && (st.faz === 'zar' || st.faz === 'bitir'))
      ? st.kare.filter(d => d.sahip === bakan && !binaKurulabilirMi(st, bakan, d.i)).map(d => d.i)
      : [],
    /* PAZAR: satışa çıkarılabilecek tapular, kalan açık artırma hakkı ve açık oturum. */
    satilabilir: (!st.pazar && bakan !== null && bakan === sirada && (st.faz === 'zar' || st.faz === 'bitir'))
      ? st.kare.filter(d => d.sahip === bakan && !pazarSatilabilirMi(st, bakan, d.i)).map(d => d.i)
      : [],
    artirmaKalan: bakan !== null ? Math.max(0, TUR_ARTIRMA_LIMITI - turArtirmaKullanilan(st, bakan)) : 0,
    pazar: st.pazar ? {
      mod: st.pazar.mod, kare: st.pazar.kare, satici: st.pazar.satici,
      fiyat: st.pazar.fiyat || null, alicilar: st.pazar.alicilar ? st.pazar.alicilar.slice() : null,
      baslangic: st.pazar.baslangic || null,
      enYuksek: st.pazar.enYuksek ? { seat: st.pazar.enYuksek.seat, tutar: st.pazar.enYuksek.tutar } : null,
      sira: st.pazar.sira ? st.pazar.sira.slice() : null,
      bekleyen: st.pazar.mod === 'artirma'
        ? (st.pazar.asama === 'teklif' ? st.pazar.sira[st.pazar.idx] : st.pazar.satici) : null,
      asama: st.pazar.asama || 'sabit',
      hak: st.pazar.hak ? Object.assign({}, st.pazar.hak) : null,
      cekildi: st.pazar.cekildi ? Object.assign({}, st.pazar.cekildi) : null,
      gecmis: (st.pazar.gecmis || []).slice(-6),
      minTeklif: st.pazar.mod === 'artirma' ? artirmaMinTeklif(st.pazar) : null,
      bitis: st.pazar.bitis, sureMs: PAZAR_SURE_MS
    } : null,
    sonKart: st.sonKart,
    gunluk: st.gunluk.slice(-12),
    grupAdlari: GRUP_ADLARI, grupRenkleri: GRUP_RENKLERI,
    kefalet: KEFALET, maas: MAAS,
    winner: st.winner,
    result: st.result
  }, ekstra || {});
}

module.exports = {
  KARELER, SANS, FON, GRUP_ADLARI, GRUP_RENKLERI,
  BASLANGIC_PARA, MAAS, KEFALET, KARE_SAYISI, CEZAEVI,
  GAR_KARELERI, IDARE_KARELERI,
  macBaslat, zarAt, kareyeDus, satinAl, reddet, binaKur, binaSat, ipotek,
  kefaletOde, cikisKartiKullan, turuBitir, sureDoldu, macBitir, pesEt,
  gorunum, kira, varlik, siradakiKoltuk, ayakta, grupKareleri,
  binaKurulabilirMi, iflasEt, ode,
  PAZAR_SURE_MS, ARTIRMA_HAK, TUR_ARTIRMA_LIMITI, MIN_ARTIS, artirmaBaslangic,
  pazarAc, pazarSatinAl, pazarVazgec, pazarReddet, pazarTeklif, pazarCekil, pazarKarar,
  pazarSureDoldu, pazarOyuncuCikar, pazarSatilabilirMi
};
