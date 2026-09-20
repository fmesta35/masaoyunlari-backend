/* ==========================================================================
   TURNUVA MOTORU — tekli eleme (knockout)
   --------------------------------------------------------------------------
   Saf mantık: burada ne soket, ne veritabanı, ne zaman vardır. Böylece
   braket kuralları tek başına test edilebilir ve sunucu yalnız bu motoru
   çağırır.

   KURAL (kullanıcının tarifi):
     16 kişi katılır → ikişerli eşleşir → 8 galip → 4 → 2 → şampiyon.
     Her tur kendi içinde KURAYLA eşleşir; kaybeden elenir.

   Katılımcı sayısı ikinin kuvveti değilse (ör. 12 kişi), eksik yerler BAY
   (bye) ile tamamlanır: bay çeken oyuncu o turu oynamadan geçer. Böylece
   kurucunun belirlediği kapasiteye tam ulaşılmasa da turnuva yürür.
   ========================================================================== */
'use strict';

const KAPASITELER = [4, 8, 16, 32, 64];

/* Tur adları sondan başa: final, yarı final, çeyrek final, sonra "N. Tur". */
function turAdi(toplamTur, turIndex) {
  const kalan = toplamTur - turIndex;            // 1 = final
  if (kalan === 1) return 'Final';
  if (kalan === 2) return 'Yarı Final';
  if (kalan === 3) return 'Çeyrek Final';
  return (turIndex + 1) + '. Tur';
}

/* Tohumlu karıştırma: aynı tohum → aynı kura. Kuranın sunucuda üretilip
   herkese aynı gösterilmesi için gerekir (itiraz olursa tekrar üretilebilir). */
function rastgele(tohum) {
  let a = (tohum || 1) >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function karistir(liste, tohum) {
  const r = rastgele(tohum), a = liste.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

/* Katılımcı sayısından, ikinin kuvveti olan braket boyunu bulur. */
function braketBoyu(n) {
  let b = 2;
  while (b < n) b *= 2;
  return Math.max(2, b);
}

/**
 * Braketi kurar.
 * @param {Array} katilimcilar [{uid, name}]
 * @param {number} tohum
 * @returns {{tohum, boy, turlar:[[mac]]}}  mac: {id,tur,sira,a,b,kazanan,roomId,durum}
 *   durum: 'bekliyor' | 'oynaniyor' | 'bitti' | 'bay'
 */
function braketKur(katilimcilar, tohum) {
  const oyuncular = (katilimcilar || []).filter(k => k && k.uid != null);
  if (oyuncular.length < 2) throw new Error('Turnuva için en az 2 katılımcı gerekir.');

  const boy = braketBoyu(oyuncular.length);
  const sira = karistir(oyuncular, tohum);
  const macSayisi = boy / 2;
  /* BAY DAĞITIMI: eksik yerler listenin sonuna yığılırsa iki boş eşleşir ve
     kimse bay geçmez. Onun yerine baylar İLK maçlara dağıtılır: her boş yer
     bir oyuncuyla eşleşir, o oyuncu oynamadan bir üst tura çıkar. */
  const bayAdedi = boy - sira.length;

  const toplamTur = Math.log2(boy);
  const turlar = [];

  const ilk = [];
  let k = 0;
  for (let i = 0; i < macSayisi; i++) {
    const bayMi = i < bayAdedi;
    const a = sira[k++] || null;
    const b = bayMi ? null : (sira[k++] || null);
    const mac = {
      id: 't1m' + (i + 1), tur: 0, sira: i,
      a: a, b: b, kazanan: null, roomId: null, durum: 'bekliyor'
    };
    if (a && !b) { mac.kazanan = a.uid; mac.durum = 'bay'; }
    else if (!a && b) { mac.kazanan = b.uid; mac.durum = 'bay'; }
    else if (!a && !b) { mac.durum = 'bay'; }
    ilk.push(mac);
  }
  turlar.push(ilk);

  // Üst turlar boş kurulur; galipler geldikçe dolar.
  for (let t = 1; t < toplamTur; t++) {
    const n = boy / Math.pow(2, t + 1);
    const tur = [];
    for (let i = 0; i < n; i++) {
      tur.push({ id: 't' + (t + 1) + 'm' + (i + 1), tur: t, sira: i,
                 a: null, b: null, kazanan: null, roomId: null, durum: 'bekliyor' });
    }
    turlar.push(tur);
  }

  const braket = { tohum: tohum >>> 0, boy: boy, turlar: turlar };
  bayIlerlet(braket);            // baylar hemen bir üst tura taşınır
  return braket;
}

/* Kazananı bir üst turun doğru koltuğuna yerleştirir. */
function ustTuraTasi(braket, tur, sira, oyuncu) {
  const ust = braket.turlar[tur + 1];
  if (!ust) return;
  const hedef = ust[Math.floor(sira / 2)];
  if (!hedef) return;
  if (sira % 2 === 0) hedef.a = oyuncu; else hedef.b = oyuncu;
}

function oyuncuBul(braket, uid) {
  for (const tur of braket.turlar) {
    for (const m of tur) {
      if (m.a && m.a.uid === uid) return m.a;
      if (m.b && m.b.uid === uid) return m.b;
    }
  }
  return null;
}

/* BAY maçlarının galibini üst tura taşır (zincirleme). */
function bayIlerlet(braket) {
  for (let t = 0; t < braket.turlar.length; t++) {
    for (const m of braket.turlar[t]) {
      if (m.durum !== 'bay' || !m.kazanan) continue;
      const o = m.a && m.a.uid === m.kazanan ? m.a : m.b;
      ustTuraTasi(braket, t, m.sira, o);
    }
    // Üst turda da tek taraflı eşleşme oluşmuş olabilir: onu da bay yap.
    const ust = braket.turlar[t + 1];
    if (!ust) continue;
    const altTamam = braket.turlar[t].every(m => m.durum === 'bay' || m.durum === 'bitti');
    if (!altTamam) continue;
    for (const m of ust) {
      if (m.durum !== 'bekliyor') continue;
      if (m.a && !m.b) { m.kazanan = m.a.uid; m.durum = 'bay'; }
      else if (!m.a && m.b) { m.kazanan = m.b.uid; m.durum = 'bay'; }
    }
  }
}

/**
 * Bir maçın sonucunu işler ve galibi üst tura taşır.
 * @returns {{ok:boolean, error?:string, mac?:object, sampiyon?:object}}
 */
function sonucIsle(braket, macId, kazananUid) {
  for (let t = 0; t < braket.turlar.length; t++) {
    const m = braket.turlar[t].find(x => x.id === macId);
    if (!m) continue;
    if (m.durum === 'bitti') return { ok: false, error: 'Bu maç zaten sonuçlandı.' };
    const aday = (m.a && m.a.uid === kazananUid) ? m.a
               : (m.b && m.b.uid === kazananUid) ? m.b : null;
    if (!aday) return { ok: false, error: 'Kazanan bu maçın oyuncusu değil.' };
    m.kazanan = kazananUid;
    m.durum = 'bitti';
    ustTuraTasi(braket, t, m.sira, aday);
    bayIlerlet(braket);
    return { ok: true, mac: m, sampiyon: sampiyon(braket) };
  }
  return { ok: false, error: 'Maç bulunamadı.' };
}

/* Şampiyon: son turdaki tek maçın galibi. */
function sampiyon(braket) {
  const son = braket.turlar[braket.turlar.length - 1];
  if (!son || son.length !== 1) return null;
  const m = son[0];
  if (!m.kazanan) return null;
  return (m.a && m.a.uid === m.kazanan) ? m.a : m.b;
}

/* Şu an OYNANABİLİR maçlar: iki oyuncusu belli, henüz bitmemiş.
   Sunucu her turda bunlar için turnuva odası açar. */
function oynanacakMaclar(braket) {
  const out = [];
  for (const tur of braket.turlar) {
    for (const m of tur) {
      if (m.durum === 'bekliyor' && m.a && m.b) out.push(m);
    }
  }
  return out;
}

/* Turnuvanın tamamlanıp tamamlanmadığı. */
function bittiMi(braket) { return !!sampiyon(braket); }

/* Bir üyenin braketteki güncel maçı (sırada olan). */
function uyeMaci(braket, uid) {
  for (const tur of braket.turlar) {
    for (const m of tur) {
      if (m.durum === 'bitti' || m.durum === 'bay') continue;
      if ((m.a && m.a.uid === uid) || (m.b && m.b.uid === uid)) return m;
    }
  }
  return null;
}

module.exports = {
  KAPASITELER, turAdi, braketKur, sonucIsle, sampiyon,
  oynanacakMaclar, bittiMi, uyeMaci, oyuncuBul, karistir, braketBoyu
};
