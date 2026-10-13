'use strict';
/* ============================================================================
 * HAVA HOKEYİ — SAF FİZİK MOTORU (sunucu yetkili)
 * ============================================================================
 * Yerel prototipin (customizable-air-hockey-game/src/App.tsx) fiziği birebir
 * taşındı: masa ölçüleri, tokmak sınırları, çarpışma katsayıları, direk
 * çarpışması ve gol kuralı aynıdır. Değişen tek şey KİMİN İŞLETTİĞİ: fizik
 * artık sunucuda sabit 120 Hz adımlarla işler; istemciler yalnız tokmak
 * hedefini yollar, karşılığında ~20 Hz durum paketi alır.
 *
 * NEDEN 120 Hz: disk çok hızlanabiliyor (saniyede 1450 birim). 50 Hz'de bir
 * adımda 29 birim yol alır ve 20 birimlik yarıçapıyla tokmağın İÇİNDEN
 * geçebilir. Prototip de bu yüzden 1/120 sabit adım kullanıyordu.
 *
 * MASA: 1000 × 600 birim. Koltuk 0 solda, koltuk 1 sağda.
 * ========================================================================= */

const MASA_EN = 1000;
const MASA_BOY = 600;
const MERKEZ_X = MASA_EN / 2;
const MERKEZ_Y = MASA_BOY / 2;
const ALAN = { sol: 48, sag: MASA_EN - 48, ust: 48, alt: MASA_BOY - 48 };
const KALE_UST = 205;
const KALE_ALT = 395;
const DIREK_R = 13;
const DISK_R = 20;
const TOKMAK_R = 43;
const ADIM_SN = 1 / 120;          // sabit fizik adımı
const TOKMAK_HIZI = 1120;         // birim/sn (imleci takip hızı)
const DISK_TAVANI = 1450;
const GERI_SAYIM_SN = 3;

function kirp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function tarafOf(seat) { return seat === 0 ? 0 : 1; }

/* Tokmak kendi yarı sahasında kalır (prototiple aynı paylar). */
function tokmakKirp(t, oyuncu) {
  const pay = 7;
  const minX = oyuncu === 0 ? ALAN.sol + TOKMAK_R + pay : MERKEZ_X + TOKMAK_R + 8;
  const maxX = oyuncu === 0 ? MERKEZ_X - TOKMAK_R - 8 : ALAN.sag - TOKMAK_R - pay;
  t.x = kirp(t.x, minX, maxX);
  t.y = kirp(t.y, ALAN.ust + TOKMAK_R + pay, ALAN.alt - TOKMAK_R - pay);
}

/* ------------------------------------------------------------------- MAÇ */
function macBaslat(opts) {
  const o = opts || {};
  const golHedefi = [3, 5, 7].includes(Number(o.golHedefi)) ? Number(o.golHedefi) : 5;
  const st = {
    kind: 'havahokeyi',
    seats: (o.seats || [0, 1]).slice(0, 2),
    disk: { x: MERKEZ_X, y: MERKEZ_Y, vx: 0, vy: 0 },
    tokmak: [
      { x: ALAN.sol + 150, y: MERKEZ_Y, vx: 0, vy: 0 },
      { x: ALAN.sag - 150, y: MERKEZ_Y, vx: 0, vy: 0 }
    ],
    hedef: [
      { x: ALAN.sol + 150, y: MERKEZ_Y },
      { x: ALAN.sag - 150, y: MERKEZ_Y }
    ],
    skor: [0, 0],                  // bu setteki goller
    setler: [0, 0],                // kazanılan setler
    maxSet: [1, 3, 5].includes(Number(o.maxSet)) ? Number(o.maxSet) : 3,
    renk: ['#22d3ee', '#fb4d6d'],  // tokmak renkleri (oyuncu kendi rengini seçer)
    golHedefi,
    faz: 'gerisayim',              // gerisayim | oyun | gol | bitti
    fazSn: GERI_SAYIM_SN,
    servisYonu: 1,                 // ilk servis sağa
    gecenSn: 0,
    yavasSn: 0,
    sonGolAtan: null,
    sonOlay: 'yok',                // yok | duvar | vurus | gol
    olayNo: 0,
    status: 'playing',
    winner: null,
    result: null
  };
  tokmakKirp(st.tokmak[0], 0);
  tokmakKirp(st.tokmak[1], 1);
  return st;
}
function olay(st, ad) { st.sonOlay = ad; st.olayNo += 1; }

function basaDon(st) {
  st.disk.x = MERKEZ_X; st.disk.y = MERKEZ_Y; st.disk.vx = 0; st.disk.vy = 0;
  st.tokmak[0] = { x: ALAN.sol + 150, y: MERKEZ_Y, vx: 0, vy: 0 };
  st.tokmak[1] = { x: ALAN.sag - 150, y: MERKEZ_Y, vx: 0, vy: 0 };
  st.hedef[0] = { x: ALAN.sol + 150, y: MERKEZ_Y };
  st.hedef[1] = { x: ALAN.sag - 150, y: MERKEZ_Y };
  st.faz = 'gerisayim';
  st.fazSn = GERI_SAYIM_SN;
  st.yavasSn = 0;
}
function golAt(st, atan) {
  st.skor[atan] += 1;
  st.sonGolAtan = atan;
  st.disk.x = MERKEZ_X; st.disk.y = MERKEZ_Y; st.disk.vx = 0; st.disk.vy = 0;
  /* Gol yiyen servis atar — klasik hava hokeyi kuralı. */
  st.servisYonu = atan === 0 ? -1 : 1;
  olay(st, 'gol');
  st.setSonu = false;
  if (st.skor[atan] >= st.golHedefi) {
    /* Referans oyundaki gibi: tur golüne ulaşan seti alır, goller sıfırlanır;
       gereken set sayısına (en çok setin yarısı + 1) ulaşan maçı alır. */
    st.setler[atan] += 1;
    st.setSonu = true;
    if (st.setler[atan] >= Math.ceil(st.maxSet / 2)) {
      st.faz = 'bitti'; st.fazSn = 0;
      macBitir(st, 'finished');
    } else {
      st.skor = [0, 0];
      st.faz = 'gol'; st.fazSn = 2.8;
    }
  } else {
    st.faz = 'gol'; st.fazSn = 1.4;
  }
}

/* Tokmağı hedefe doğru taşı ve hızını ölç (çarpışma bu hıza bakıyor). */
function tokmagiTasi(st, i, dt) {
  const t = st.tokmak[i];
  const h = st.hedef[i];
  const oncekiX = t.x, oncekiY = t.y;
  const dx = h.x - t.x, dy = h.y - t.y;
  const uz = Math.hypot(dx, dy);
  const yol = Math.min(uz, TOKMAK_HIZI * dt);
  if (uz > 0.001) { t.x += (dx / uz) * yol; t.y += (dy / uz) * yol; }
  tokmakKirp(t, i);
  t.vx = dt > 0 ? (t.x - oncekiX) / dt : 0;
  t.vy = dt > 0 ? (t.y - oncekiY) / dt : 0;
}

/* Disk–tokmak çarpışması (prototipin formülü birebir). */
function tokmaklaCarpis(st, i) {
  const d = st.disk, t = st.tokmak[i];
  const dx = d.x - t.x, dy = d.y - t.y;
  const enAz = DISK_R + TOKMAK_R;
  const k2 = dx * dx + dy * dy;
  if (k2 >= enAz * enAz) return 0;
  const uz = Math.sqrt(k2) || 0.001;
  const nx = dx / uz, ny = dy / uz;
  d.x = t.x + nx * (enAz + 0.6);
  d.y = t.y + ny * (enAz + 0.6);
  const bx = d.vx - t.vx, by = d.vy - t.vy;
  const bn = bx * nx + by * ny;
  const siddet = Math.max(90, Math.abs(bn));
  if (bn < 0) {
    const itme = -(1.08 + 1) * bn;
    d.vx += itme * nx; d.vy += itme * ny;
  } else {
    const tn = t.vx * nx + t.vy * ny;
    if (tn > 0) { d.vx += tn * nx * 0.62; d.vy += tn * ny * 0.62; }
  }
  /* Teğet sürtünme: yandan sıyıran tokmak diske dönüş veriyor. */
  const tgx = -ny, tgy = nx;
  const tgv = t.vx * tgx + t.vy * tgy;
  d.vx += tgx * tgv * 0.075;
  d.vy += tgy * tgv * 0.075;
  const hiz = Math.hypot(d.vx, d.vy);
  if (hiz > DISK_TAVANI) { d.vx = (d.vx / hiz) * DISK_TAVANI; d.vy = (d.vy / hiz) * DISK_TAVANI; }
  return Math.min(1, siddet / 850);
}

/* Kale direği: köşeye gelen disk içeri girmeden sekiyor. */
function direkleCarpis(st, x, y) {
  const d = st.disk;
  const dx = d.x - x, dy = d.y - y;
  const enAz = DISK_R + DIREK_R;
  const k2 = dx * dx + dy * dy;
  if (k2 >= enAz * enAz) return false;
  const uz = Math.sqrt(k2) || 0.001;
  const nx = dx / uz, ny = dy / uz;
  d.x = x + nx * (enAz + 0.4);
  d.y = y + ny * (enAz + 0.4);
  const vn = d.vx * nx + d.vy * ny;
  if (vn < 0) { d.vx -= 1.92 * vn * nx; d.vy -= 1.92 * vn * ny; }
  return true;
}

/* --------------------------------------------------------------- FİZİK ADIMI */
function adim(st, dtSn) {
  const dt = kirp(Number(dtSn) || 0, 0, 0.05);
  if (dt <= 0 || st.faz === 'bitti') return;
  st.gecenSn += dt;
  tokmagiTasi(st, 0, dt);
  tokmagiTasi(st, 1, dt);

  if (st.faz === 'gerisayim') {
    st.fazSn = Math.max(0, st.fazSn - dt);
    st.disk.x = MERKEZ_X; st.disk.y = MERKEZ_Y;
    if (st.fazSn === 0) {
      st.faz = 'oyun';
      st.disk.vx = st.servisYonu * 430;
      st.disk.vy = (st.olayNo % 3 === 0 ? 1 : -1) * 150;
      olay(st, 'vurus');
    }
    return;
  }
  if (st.faz === 'gol') {
    st.fazSn = Math.max(0, st.fazSn - dt);
    if (st.fazSn === 0) basaDon(st);
    return;
  }
  if (st.faz !== 'oyun') return;

  const d = st.disk;
  const direnc = Math.pow(0.9992, dt * 60);
  d.vx *= direnc; d.vy *= direnc;
  d.x += d.vx * dt;
  d.y += d.vy * dt;

  if (d.y - DISK_R < ALAN.ust) { d.y = ALAN.ust + DISK_R; d.vy = Math.abs(d.vy) * 0.97; olay(st, 'duvar'); }
  else if (d.y + DISK_R > ALAN.alt) { d.y = ALAN.alt - DISK_R; d.vy = -Math.abs(d.vy) * 0.97; olay(st, 'duvar'); }

  const kaleAgzi = d.y > KALE_UST && d.y < KALE_ALT;
  if (!kaleAgzi && d.x - DISK_R < ALAN.sol) { d.x = ALAN.sol + DISK_R; d.vx = Math.abs(d.vx) * 0.97; olay(st, 'duvar'); }
  else if (!kaleAgzi && d.x + DISK_R > ALAN.sag) { d.x = ALAN.sag - DISK_R; d.vx = -Math.abs(d.vx) * 0.97; olay(st, 'duvar'); }

  if (direkleCarpis(st, ALAN.sol, KALE_UST) | direkleCarpis(st, ALAN.sol, KALE_ALT) |
      direkleCarpis(st, ALAN.sag, KALE_UST) | direkleCarpis(st, ALAN.sag, KALE_ALT)) {
    olay(st, 'duvar');
  }
  const v0 = tokmaklaCarpis(st, 0);
  const v1 = tokmaklaCarpis(st, 1);
  if (v0 || v1) olay(st, 'vurus');

  /* Disk ortada takılıp kalırsa oyun durmasın: kısa bir süre sonra itilir. */
  const hiz = Math.hypot(d.vx, d.vy);
  if (hiz < 120) st.yavasSn += dt; else st.yavasSn = 0;
  if (st.yavasSn > 1.25) {
    d.vx = (st.olayNo % 2 ? 1 : -1) * 230;
    d.vy = ((st.olayNo % 3) - 1) * 90;
    st.yavasSn = 0;
    olay(st, 'vurus');
  }

  if (d.x < 4 - DISK_R) golAt(st, 1);
  else if (d.x > MASA_EN - 4 + DISK_R) golAt(st, 0);
}

/* Tokmak hedefi (istemciden gelir): yalnız kendi yarı sahasına yazılır. */
function hedefYaz(st, seat, x, y) {
  const i = tarafOf(seat);
  const hx = Number(x), hy = Number(y);
  if (!Number.isFinite(hx) || !Number.isFinite(hy)) return { ok: false, reason: 'gecersiz_hamle' };
  const gecici = { x: hx, y: hy };
  tokmakKirp(gecici, i);
  st.hedef[i] = gecici;
  return { ok: true };
}

/* --------------------------------------------------------------- BİTİŞ */
function macBitir(st, reason) {
  st.status = 'finished';
  st.faz = 'bitti';
  /* Önce set, eşitse bu setteki gol sayısı belirler. */
  const [sa, sb] = st.setler;
  const [a, b] = st.skor;
  const winner = sa !== sb ? (sa > sb ? 0 : 1) : (a === b ? null : (a > b ? 0 : 1));
  st.winner = winner;
  st.result = { reason: reason || 'finished', winner, skor: st.skor.slice(), setler: st.setler.slice(),
                sure: Math.round(st.gecenSn) };
  return st.result;
}
function pesEt(st, seat) {
  if (st.status !== 'playing') return st.result;
  const rakip = st.seats.find(s => s !== seat);
  st.status = 'finished';
  st.faz = 'bitti';
  st.winner = rakip === undefined ? null : rakip;
  st.result = { reason: 'resign', winner: st.winner, skor: st.skor.slice(),
                sure: Math.round(st.gecenSn) };
  return st.result;
}

/* Tokmak rengi: yalnız izinli paletten (istemci keyfi metin yollayamaz). */
const RENKLER = ['#38bdf8', '#22d3ee', '#34d399', '#a3e635', '#facc15', '#fb923c', '#fb4d6d',
  '#f472b6', '#d946ef', '#8b5cf6', '#6366f1', '#f8fafc', '#94a3b8', '#111827'];
function renkYaz(st, seat, renk) {
  const i = tarafOf(seat);
  if (!RENKLER.includes(renk)) return { ok: false, reason: 'gecersiz_hamle' };
  st.renk[i] = renk;
  return { ok: true };
}

/* --------------------------------------------------------------- GÖRÜNÜM */
function yuvarla(v) { return Math.round(Number(v) * 10) / 10; }
function gorunum(st, seat, ekstra) {
  return Object.assign({
    kind: 'havahokeyi',
    status: st.status,
    faz: st.faz,
    fazSn: yuvarla(st.fazSn),
    seat: (seat === 0 || seat === 1) ? seat : null,
    seats: st.seats.slice(),
    masaEn: MASA_EN, masaBoy: MASA_BOY,
    alan: ALAN, kaleUst: KALE_UST, kaleAlt: KALE_ALT,
    diskR: DISK_R, tokmakR: TOKMAK_R, direkR: DIREK_R,
    disk: { x: yuvarla(st.disk.x), y: yuvarla(st.disk.y),
            vx: Math.round(st.disk.vx), vy: Math.round(st.disk.vy) },
    tokmak: st.tokmak.map(t => ({ x: yuvarla(t.x), y: yuvarla(t.y) })),
    skor: st.skor.slice(),
    setler: st.setler.slice(),
    maxSet: st.maxSet,
    renk: st.renk.slice(),
    setSonu: !!st.setSonu,
    golHedefi: st.golHedefi,
    gecenSn: Math.round(st.gecenSn),
    sonGolAtan: st.sonGolAtan,
    sonOlay: st.sonOlay, olayNo: st.olayNo,
    winner: st.winner,
    result: st.result
  }, ekstra || {});
}

module.exports = {
  MASA_EN, MASA_BOY, ALAN, KALE_UST, KALE_ALT, DISK_R, TOKMAK_R, DIREK_R,
  ADIM_SN, TOKMAK_HIZI, DISK_TAVANI, GERI_SAYIM_SN,
  tarafOf, tokmakKirp, macBaslat, adim, hedefYaz, renkYaz, RENKLER, macBitir, pesEt, gorunum
};
