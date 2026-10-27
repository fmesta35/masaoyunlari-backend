'use strict';
/* ============================================================================
 * HAVA HOKEYİ — SAF FİZİK MOTORU (sunucu yetkili)
 * ============================================================================
 * Kullanıcı raporu: "hâlâ çok hızlı reaksiyonlar, olur olmadık fiziksel
 * kuvvetler, temas etmeden uçmalar devam ediyor — gerçekçi fiziksel kurallar
 * eşliğinde oynanabilir bir oyuna dönüştür."
 *
 * ÖNCEKİ MODELİN KUSURLARI (ölçüldü):
 *  1) Tokmak hedefe IŞINLANIR gibi gidiyordu: tek adımda 0 → 1500 birim/sn.
 *     Bu hız çarpışmaya girince disk "olur olmadık" fırlıyordu.
 *  2) Diski banda doğru bastırmak (sıkıştırmak) onu 1300 birim/sn ile
 *     fırlatıyordu: konum düzeltmesi bant içine itiyor, bant geri itiyor,
 *     her adımda yeni itme ekleniyordu.
 *  3) Yavaşlayan disk 1,25 sn sonra kimse dokunmadan kendiliğinden itiliyordu.
 *  4) Gecikme telafisi istemcinin "ekranda değdi" BEYANINI kabul ediyordu:
 *     sunucudaki tokmak diske değmeden (380 birim uzaktan bile) vuruş
 *     uygulanabiliyordu; rakip de diski "temas olmadan" uçarken görüyordu.
 *
 * YENİ MODEL (gerçek masa davranışı):
 *  · TOKMAK = elle tutulan ağır gövde. Hedefe hız ve İVME sınırıyla gider
 *    (el ağırlığı): anlık hız sıçraması yoktur, vuruş gücü salınımla kazanılır.
 *  · DİSK = hava yastığında kayan hafif gövde: çok az sürtünme, bantlarda
 *    enerji kaybı (esneklik 0.88), direklerde 0.85.
 *  · ÇARPIŞMA = yalnız GERÇEK temasta ve YALNIZ yaklaşırken itme. Tokmak elle
 *    tutulduğu için diskten çok ağırdır (itmenin %85'i diske geçer); esneklik
 *    0.75: durgun tokmağa çarpan disk yaklaşık yarı hızla seker, koşan tokmak
 *    diske hızının ~1.5 katını verir.
 *    Hız tavanı yumuşaktır (750 üstü sıkıştırılır, en çok 1000).
 *  · SIKIŞMA = bantla tokmak arasında kalan disk FIRLAMAZ: banda paralel
 *    kayar, enerji eklenmez.
 *  · Fizik 240 Hz alt adımla çözülür (120 Hz dış adımın iki katı): tünelleme
 *    ve derin iç içe geçme olmaz.
 *  · Kendiliğinden itme YOK. Servis gerçek kuraldaki gibi: gol yiyenin yarı
 *    sahasına disk DURGUN konur, oyuncu kendisi vurur.
 *  · Vuruşu YALNIZ sunucu, kendi tokmak konumuyla belirler. İstemci beyanı
 *    (gecikme telafisi) kaldırıldı: ekranda görülen her temas sunucuda da
 *    olmuş bir temastır — temassız uçuş olamaz.
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
const ADIM_SN = 1 / 120;          // dış adım (sunucu döngüsü)
const ALT_ADIM_SN = 1 / 240;      // fizik alt adımı

/* --- tokmak (el) --- */
const TOKMAK_HIZI = 950;          // en yüksek tokmak hızı (birim/sn)
const TOKMAK_IVME = 8000;         // en yüksek ivme (birim/sn²) — el ağırlığı (~1.6 g)
const TOKMAK_TAKIP = 20;          // hedefe yaklaşma kazancı (1/sn); yakında yavaşlar

/* --- disk --- */
const DISK_TAVANI = 1000;         // mutlak hız tavanı (masayı ~1 sn’de geçer)
const DISK_YUMUSAK = 750;         // bunun üstü sıkıştırılır (sert vuruşlar birbirine yaklaşır)
const HAVA_SURTUNME = 0.2;        // 1/sn: hava yastığı (5 sn'de ~%37'ye iner)
const BANT_ESNEKLIK = 0.88;
const BANT_SURTUNME = 0.97;       // banda değerken teğet hız kaybı
const DIREK_ESNEKLIK = 0.85;
const TOKMAK_ESNEKLIK = 0.75;
const KUTLE_PAYI = 0.85;          // tokmak (el + tokmak) ~6 kat ağır: itmenin 0.85'i diske geçer
const TOKMAK_TEGET = 0.1;         // temasta teğet hız aktarımı (hafif "kesme")
const VURUS_ARALIGI = 0.03;       // aynı tokmağın art arda itme aralığı (sn)
const GERI_SAYIM_SN = 3;
const SERVIS_UZAKLIGI = 170;      // servis diski orta çizgiden bu kadar içeride durur

function kirp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function tarafOf(seat) { return seat === 0 ? 0 : 1; }

/* Tokmak kendi yarı sahasında kalır (prototiple aynı paylar). */
function tokmakSiniri(oyuncu) {
  const pay = 7;
  return {
    minX: oyuncu === 0 ? ALAN.sol + TOKMAK_R + pay : MERKEZ_X + TOKMAK_R + 8,
    maxX: oyuncu === 0 ? MERKEZ_X - TOKMAK_R - 8 : ALAN.sag - TOKMAK_R - pay,
    minY: ALAN.ust + TOKMAK_R + pay,
    maxY: ALAN.alt - TOKMAK_R - pay
  };
}
function tokmakKirp(t, oyuncu) {
  const s = tokmakSiniri(oyuncu);
  t.x = kirp(t.x, s.minX, s.maxX);
  t.y = kirp(t.y, s.minY, s.maxY);
}
function hizKirp(o, tavan) {
  const h = Math.hypot(o.vx, o.vy);
  if (h > tavan) { o.vx = o.vx / h * tavan; o.vy = o.vy / h * tavan; }
}
/* Yumuşak tavan: 750'ye kadar dokunulmaz, üstü %35'e sıkıştırılır, 1000 mutlak. */
function diskTavani(d) {
  const h = Math.hypot(d.vx, d.vy);
  if (h <= DISK_YUMUSAK) return;
  const yeni = Math.min(DISK_TAVANI, DISK_YUMUSAK + (h - DISK_YUMUSAK) * 0.35);
  d.vx = d.vx / h * yeni; d.vy = d.vy / h * yeni;
}

/* ------------------------------------------------------------------- MAÇ */
function servisKonumu(st) {
  /* servisYonu: 1 → disk koltuk 0'ın (sol) yarısında, -1 → koltuk 1'in. */
  return { x: st.servisYonu === -1 ? MERKEZ_X + SERVIS_UZAKLIGI : MERKEZ_X - SERVIS_UZAKLIGI, y: MERKEZ_Y };
}
function tokmakBaslangic(i) {
  return { x: i === 0 ? ALAN.sol + 110 : ALAN.sag - 110, y: MERKEZ_Y, vx: 0, vy: 0 };
}
function macBaslat(opts) {
  const o = opts || {};
  const golHedefi = [3, 5, 7].includes(Number(o.golHedefi)) ? Number(o.golHedefi) : 5;
  const st = {
    kind: 'havahokeyi',
    seats: (o.seats || [0, 1]).slice(0, 2),
    disk: { x: MERKEZ_X, y: MERKEZ_Y, vx: 0, vy: 0 },
    tokmak: [tokmakBaslangic(0), tokmakBaslangic(1)],
    hedef: [{ x: tokmakBaslangic(0).x, y: MERKEZ_Y }, { x: tokmakBaslangic(1).x, y: MERKEZ_Y }],
    skor: [0, 0],                  // bu setteki goller
    setler: [0, 0],                // kazanılan setler
    maxSet: [1, 3, 5].includes(Number(o.maxSet)) ? Number(o.maxSet) : 3,
    renk: ['#22d3ee', '#fb4d6d'],  // tokmak renkleri (oyuncu kendi rengini seçer)
    golHedefi,
    faz: 'gerisayim',              // gerisayim | oyun | gol | bitti
    fazSn: GERI_SAYIM_SN,
    servisYonu: 1,                 // ilk servis koltuk 0'da
    gecenSn: 0,
    bekle: [0, 0],                 // tokmak başına art arda itme engeli (sn)
    sonGolAtan: null,
    sonOlay: 'yok',                // yok | duvar | vurus | gol
    olayNo: 0,
    status: 'playing',
    winner: null,
    result: null
  };
  const sk = servisKonumu(st);
  st.disk.x = sk.x; st.disk.y = sk.y;
  return st;
}
function olay(st, ad) { st.sonOlay = ad; st.olayNo += 1; }

function basaDon(st) {
  const sk = servisKonumu(st);
  st.disk.x = sk.x; st.disk.y = sk.y; st.disk.vx = 0; st.disk.vy = 0;
  st.tokmak[0] = tokmakBaslangic(0);
  st.tokmak[1] = tokmakBaslangic(1);
  st.hedef[0] = { x: st.tokmak[0].x, y: MERKEZ_Y };
  st.hedef[1] = { x: st.tokmak[1].x, y: MERKEZ_Y };
  st.faz = 'gerisayim';
  st.fazSn = GERI_SAYIM_SN;
}
function golAt(st, atan) {
  st.skor[atan] += 1;
  st.sonGolAtan = atan;
  st.disk.vx = 0; st.disk.vy = 0;
  /* Gol yiyen servis atar — klasik hava hokeyi kuralı. */
  st.servisYonu = atan === 0 ? -1 : 1;
  const sk = servisKonumu(st);
  st.disk.x = sk.x; st.disk.y = sk.y;
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

/* TOKMAK: hedefe hız + ivme sınırıyla gider (el ağırlığı). Hedefe yaklaşırken
   yavaşlar (takip kazancı), bu yüzden diskin önünde "titreyip" itmez. */
function tokmagiTasi(st, i, dt) {
  const t = st.tokmak[i];
  const h = { x: st.hedef[i].x, y: st.hedef[i].y };
  tokmakKirp(h, i);                       // hedef her zaman erişilebilir alanda
  let ix = (h.x - t.x) * TOKMAK_TAKIP, iy = (h.y - t.y) * TOKMAK_TAKIP;   // istenen hız
  const ih = Math.hypot(ix, iy);
  if (ih > TOKMAK_HIZI) { ix = ix / ih * TOKMAK_HIZI; iy = iy / ih * TOKMAK_HIZI; }
  let ax = ix - t.vx, ay = iy - t.vy;
  const am = Math.hypot(ax, ay), amax = TOKMAK_IVME * dt;
  if (am > amax) { ax = ax / am * amax; ay = ay / am * amax; }
  t.vx += ax; t.vy += ay;
  const nx = t.x + t.vx * dt, ny = t.y + t.vy * dt;
  t.x = nx; t.y = ny;
  tokmakKirp(t, i);
  /* sınıra dayandıysa o yöndeki hız sıfırlanır (orta çizgiye "çarpıp" sekmez,
     sınır düzeltmesi sahte hız üretmez) */
  if (t.x !== nx) t.vx = 0;
  if (t.y !== ny) t.vy = 0;
}

/* Disk bant içinde mi (kale ağzı hariç)? Bant normalini döndürür. */
function bantNormali(d) {
  const kaleAgzi = d.y > KALE_UST && d.y < KALE_ALT;
  if (d.y - DISK_R <= ALAN.ust + 0.01) return { x: 0, y: 1 };
  if (d.y + DISK_R >= ALAN.alt - 0.01) return { x: 0, y: -1 };
  if (!kaleAgzi && d.x - DISK_R <= ALAN.sol + 0.01) return { x: 1, y: 0 };
  if (!kaleAgzi && d.x + DISK_R >= ALAN.sag - 0.01) return { x: -1, y: 0 };
  return null;
}
function bantlaraSinirla(d) {
  const kaleAgzi = d.y > KALE_UST && d.y < KALE_ALT;
  d.y = kirp(d.y, ALAN.ust + DISK_R, ALAN.alt - DISK_R);
  if (!kaleAgzi) d.x = kirp(d.x, ALAN.sol + DISK_R, ALAN.sag - DISK_R);
}

/* Disk–tokmak çarpışması. Yalnız GERÇEK temas (iç içe geçme) varsa çalışır.
   Dönüş: vuruş gücü 0..1 (itme yoksa 0). */
function tokmaklaCarpis(st, i) {
  const d = st.disk, t = st.tokmak[i];
  const dx = d.x - t.x, dy = d.y - t.y;
  const enAz = DISK_R + TOKMAK_R;
  const k2 = dx * dx + dy * dy;
  if (k2 >= enAz * enAz) return 0;
  const uz = Math.sqrt(k2);
  /* tam üst üste (pratikte olmaz): tokmağın hareket yönünün tersine ayır */
  let nx, ny;
  if (uz > 1e-6) { nx = dx / uz; ny = dy / uz; }
  else { const th = Math.hypot(t.vx, t.vy) || 1; nx = t.vx / th || 1; ny = t.vy / th; }
  /* 1) konum: diski tokmağın dışına al */
  d.x = t.x + nx * enAz;
  d.y = t.y + ny * enAz;
  /* 2) hız: yalnız YAKLAŞIRKEN itme (normal boyunca) */
  const bx = d.vx - t.vx, by = d.vy - t.vy;
  const bn = bx * nx + by * ny;
  let guc = 0;
  if (bn < 0 && !(st.bekle && st.bekle[i] > 0)) {
    d.vx -= (1 + TOKMAK_ESNEKLIK) * KUTLE_PAYI * bn * nx;
    d.vy -= (1 + TOKMAK_ESNEKLIK) * KUTLE_PAYI * bn * ny;
    /* teğet: tokmağın yandan hareketi diske hafifçe aktarılır */
    const tgx = -ny, tgy = nx;
    const bt = bx * tgx + by * tgy;
    d.vx -= bt * TOKMAK_TEGET * tgx; d.vy -= bt * TOKMAK_TEGET * tgy;
    diskTavani(d);
    if (st.bekle) st.bekle[i] = VURUS_ARALIGI;
    guc = Math.min(1, Math.max(0.1, -bn / 900));
  } else if (bn < 0) {
    /* bekleme süresinde: disk tokmakla birlikte gider (taşıma), ek enerji yok */
    d.vx -= bn * nx; d.vy -= bn * ny;
    diskTavani(d);
  }
  /* 3) SIKIŞMA: disk banda itildiyse fırlamaz — banda paralel kayar. */
  const n = bantNormali(d);
  bantlaraSinirla(d);
  const dx2 = d.x - t.x, dy2 = d.y - t.y;
  if (n && dx2 * dx2 + dy2 * dy2 < enAz * enAz - 1) {
    const vn = d.vx * n.x + d.vy * n.y;
    if (vn < 0) { d.vx -= vn * n.x; d.vy -= vn * n.y; }      // banda doğru hız yok
    /* tokmağın yanından sıyrılacak şekilde teğete kaydır (enerji eklemeden) */
    const tx = -n.y, ty = n.x;
    const yan = (dx2 * tx + dy2 * ty) >= 0 ? 1 : -1;
    const ic = Math.sqrt(Math.max(0, enAz * enAz - (dx2 * n.x + dy2 * n.y) ** 2));
    const hedefT = (t.x * tx + t.y * ty) + yan * ic;
    const simdiT = d.x * tx + d.y * ty;
    d.x += (hedefT - simdiT) * tx; d.y += (hedefT - simdiT) * ty;
    bantlaraSinirla(d);
    /* sıyrılan disk yavaş çıkar: tokmak hızının en çok %35'i, en çok 320 */
    hizKirp(d, Math.min(320, Math.max(60, Math.hypot(t.vx, t.vy) * 0.35)));
    if (st.bekle) st.bekle[i] = Math.max(st.bekle[i], VURUS_ARALIGI);
  }
  if (guc) { st.temasKim = i; st.temasSn = st.gecenSn; }
  return guc;
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
  d.x = x + nx * enAz;
  d.y = y + ny * enAz;
  const vn = d.vx * nx + d.vy * ny;
  if (vn < 0) { d.vx -= (1 + DIREK_ESNEKLIK) * vn * nx; d.vy -= (1 + DIREK_ESNEKLIK) * vn * ny; return true; }
  return false;
}

/* --------------------------------------------------------------- FİZİK ADIMI */
function diskIlerle(st, dt) {
  const d = st.disk;
  const direnc = Math.exp(-HAVA_SURTUNME * dt);
  d.vx *= direnc; d.vy *= direnc;
  if (Math.abs(d.vx) < 0.5 && Math.abs(d.vy) < 0.5) { d.vx = 0; d.vy = 0; }
  d.x += d.vx * dt;
  d.y += d.vy * dt;

  let duvar = false;
  if (d.y - DISK_R < ALAN.ust) {
    d.y = ALAN.ust + DISK_R; if (d.vy < 0) { d.vy = -d.vy * BANT_ESNEKLIK; d.vx *= BANT_SURTUNME; duvar = Math.abs(d.vy) > 25; }
  } else if (d.y + DISK_R > ALAN.alt) {
    d.y = ALAN.alt - DISK_R; if (d.vy > 0) { d.vy = -d.vy * BANT_ESNEKLIK; d.vx *= BANT_SURTUNME; duvar = Math.abs(d.vy) > 25; }
  }
  const kaleAgzi = d.y > KALE_UST && d.y < KALE_ALT;
  if (!kaleAgzi && d.x - DISK_R < ALAN.sol) {
    d.x = ALAN.sol + DISK_R; if (d.vx < 0) { d.vx = -d.vx * BANT_ESNEKLIK; d.vy *= BANT_SURTUNME; duvar = Math.abs(d.vx) > 25; }
  } else if (!kaleAgzi && d.x + DISK_R > ALAN.sag) {
    d.x = ALAN.sag - DISK_R; if (d.vx > 0) { d.vx = -d.vx * BANT_ESNEKLIK; d.vy *= BANT_SURTUNME; duvar = Math.abs(d.vx) > 25; }
  }
  if (direkleCarpis(st, ALAN.sol, KALE_UST) | direkleCarpis(st, ALAN.sol, KALE_ALT) |
      direkleCarpis(st, ALAN.sag, KALE_UST) | direkleCarpis(st, ALAN.sag, KALE_ALT)) duvar = true;
  if (duvar) olay(st, 'duvar');

  const v0 = tokmaklaCarpis(st, 0);
  const v1 = tokmaklaCarpis(st, 1);
  if (v0 || v1) olay(st, 'vurus');

  hizKirp(d, DISK_TAVANI);                 // güvenlik: hiçbir yoldan tavan aşılmaz
  if (d.x < 4 - DISK_R) golAt(st, 1);
  else if (d.x > MASA_EN - 4 + DISK_R) golAt(st, 0);
}

function altAdim(st, dt) {
  st.gecenSn += dt;
  if (st.bekle) { st.bekle[0] = Math.max(0, st.bekle[0] - dt); st.bekle[1] = Math.max(0, st.bekle[1] - dt); }
  tokmagiTasi(st, 0, dt);
  tokmagiTasi(st, 1, dt);

  if (st.faz === 'gerisayim') {
    st.fazSn = Math.max(0, st.fazSn - dt);
    /* servis diski yerinde durur; tokmaklar onu itemez (henüz oyun yok) */
    const sk = servisKonumu(st);
    st.disk.x = sk.x; st.disk.y = sk.y; st.disk.vx = 0; st.disk.vy = 0;
    if (st.fazSn === 0) { st.faz = 'oyun'; olay(st, 'servis'); }
    return;
  }
  if (st.faz === 'gol') {
    st.fazSn = Math.max(0, st.fazSn - dt);
    if (st.fazSn === 0) basaDon(st);
    return;
  }
  if (st.faz !== 'oyun') return;
  diskIlerle(st, dt);
}

function adim(st, dtSn) {
  const dt = kirp(Number(dtSn) || 0, 0, 0.05);
  if (dt <= 0 || st.faz === 'bitti') return;
  const n = Math.max(1, Math.ceil(dt / ALT_ADIM_SN - 1e-9));
  const h = dt / n;
  for (let k = 0; k < n && st.faz !== 'bitti'; k++) altAdim(st, h);
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
  ADIM_SN, TOKMAK_HIZI, TOKMAK_IVME, DISK_TAVANI, GERI_SAYIM_SN, SERVIS_UZAKLIGI,
  tarafOf, tokmakKirp, macBaslat, adim, hedefYaz, renkYaz, RENKLER, macBitir, pesEt, gorunum
};
