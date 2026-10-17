'use strict';
/* ============================================================================
 * TEK KİŞİLİK OYUNLAR — SUNUCU TARAFI OTURUM DURUMU (saf mantık)
 * ============================================================================
 * Apex Garage (3B araba), Gölge Labirenti (birinci şahıs labirent) ve AYLA
 * (mührün bekçisi) tek kişilik oyunlardır; oyunun kendisi (grafik, fizik,
 * ses, kontrol) kullanıcının verdiği referans kodla BİREBİR aynı şekilde
 * oyuncunun tarayıcısında çalışır (assets/oyunlar/*.html, iframe).
 *
 * Sunucu bu oyunlarda üç iş yapar:
 *   1) OTURUM — masa "hazır" verilince oyun başlar, oyuncu masadan ayrılana
 *      dek sürer (oyun içindeki "tekrar dene" döngüsü sitenin maç sonunu
 *      tetiklemez).
 *   2) ÖZET — oyuncunun tarayıcısı skor/seviye/durum özetini periyodik yollar;
 *      sunucu bunu sınırlayıp izleyicilere iletir (canlı izleme).
 *   3) GÖRÜNTÜ — izleyici varsa oyuncunun ekranından küçük bir kare akışı
 *      (JPEG) izleyicilere aktarılır. Sunucu görüntüyü saklamaz, yalnız
 *      boyut/hız sınırı uygular.
 *
 * Hile payı: oyun istemcide çalıştığı için skor tarayıcıdan doğrulanamaz
 * (kullanıcı referans oyunun birebir çalışmasını bilerek seçti). Tek kişilik
 * olduğu için kimsenin puanını etkilemez; sunucu yalnız biçim/sınır denetler.
 * ========================================================================= */

const OYUNLAR = {
  apexgarage:     { ad: 'Apex Garage',      dosya: 'tek-apexgarage.html' },
  golgelabirenti: { ad: 'Gölge Labirenti',  dosya: 'tek-golgelabirenti.html' },
  ayla:           { ad: 'AYLA: Mührün Bekçisi', dosya: 'tek-ayla.html' }
};
const OYUN_IDLERI = Object.keys(OYUNLAR);

const OZET_ARALIK_MS = 400;        // özet paketleri arası en az süre
const KARE_ARALIK_MS = 250;        // görüntü kareleri arası en az süre (≤4 kare/sn)
const KARE_EN_COK_BAYT = 90 * 1024;

function tekKisilikMi(gameId) { return OYUN_IDLERI.indexOf(String(gameId)) !== -1; }

function macBaslat(opts) {
  const o = opts || {};
  const seat = (typeof o.seat === 'number') ? o.seat : 0;
  return {
    status: 'playing',
    oyun: String(o.oyun || ''),
    seat,
    seats: [seat],
    baslangic: o.simdi || Date.now(),
    ozet: null,
    enYuksekSkor: 0,
    sonOzetAt: 0,
    sonKareAt: 0,
    result: null
  };
}

function sayi(v, a, b, d) {
  v = Number(v);
  if (!Number.isFinite(v)) return d;
  return Math.max(a, Math.min(b, v));
}
function metin(v, n) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, '').slice(0, n);
}

/* Oyuncunun yolladığı özeti temizler: yalnız bilinen alanlar, sınırlı uzunluk. */
function ozetTemizle(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const durumlar = ['menu', 'oynuyor', 'duraklat', 'bitti', 'garaj'];
  const d = String(raw.durum || '');
  const ozet = {
    durum: durumlar.indexOf(d) !== -1 ? d : 'oynuyor',
    skor: Math.round(sayi(raw.skor, 0, 1e12, 0)),
    seviye: metin(raw.seviye, 40),
    metin: metin(raw.metin, 90),
    ayrinti: metin(raw.ayrinti, 120)
  };
  return ozet;
}

/* Özet paketini kaydeder. Sık gelirse yoksayılır (false döner). */
function ozetKaydet(s, raw, simdi) {
  if (!s || s.status !== 'playing') return false;
  const t = simdi || Date.now();
  if (t - s.sonOzetAt < OZET_ARALIK_MS) return false;
  const oz = ozetTemizle(raw);
  if (!oz) return false;
  s.sonOzetAt = t;
  s.ozet = oz;
  if (oz.skor > s.enYuksekSkor) s.enYuksekSkor = oz.skor;
  return true;
}

/* Görüntü karesi geçerli mi ve hız sınırına uyuyor mu? */
function kareKabul(s, img, simdi) {
  if (!s || s.status !== 'playing') return false;
  if (typeof img !== 'string') return false;
  if (img.length > KARE_EN_COK_BAYT) return false;
  if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(img)) return false;
  const t = simdi || Date.now();
  if (t - s.sonKareAt < KARE_ARALIK_MS) return false;
  s.sonKareAt = t;
  return true;
}

/* Oyuncu masadan ayrıldı / oturum kapandı. */
function bitir(s, neden) {
  if (!s || s.status !== 'playing') return;
  s.status = 'finished';
  s.result = { reason: String(neden || 'ayrildi'), skor: s.enYuksekSkor };
}
function pesEt(s) { bitir(s, 'ayrildi'); }

function gorunum(s, seat, extra) {
  if (!s) return null;
  const v = {
    kind: s.oyun,
    solo: true,
    status: s.status,
    seat: (seat === 0) ? 0 : null,
    seats: [s.seat],
    oyun: s.oyun,
    ozet: s.ozet ? Object.assign({}, s.ozet) : null,
    enYuksekSkor: s.enYuksekSkor,
    baslangic: s.baslangic,
    result: s.result ? Object.assign({}, s.result) : null
  };
  return Object.assign(v, extra || {});
}

module.exports = {
  OYUNLAR, OYUN_IDLERI, OZET_ARALIK_MS, KARE_ARALIK_MS, KARE_EN_COK_BAYT,
  tekKisilikMi, macBaslat, ozetTemizle, ozetKaydet, kareKabul, bitir, pesEt, gorunum
};
