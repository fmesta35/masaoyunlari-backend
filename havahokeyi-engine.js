'use strict';
/* ============================================================================
 * HAVA HOKEYİ — SAF FİZİK MOTORU (sunucu yetkili, görüş-zamanlı temas)
 * ============================================================================
 * Kullanıcı istekleri (sırayla):
 *  1) "olur olmadık fiziksel kuvvetler, temas etmeden uçmalar var"
 *  2) "kayma etkisini yok etmişsin (buz hokeyi gibi) ve mouse hizasında
 *     kontrol edilen tutamaçlar çok geriden geliyor — önceden %100 senkrondu"
 *
 * TASARIM
 *  · TOKMAK = oyuncunun imleci/parmağı. Ekranda imlecin TAM altında çizilir
 *    (gecikmesiz). Sunucu tokmağı "hedefe koşturmaz"; istemcinin bildirdiği
 *    konumun KENDİSİDİR.
 *  · Her konum bildirimi bir GÖRÜŞ ZAMANI (vt) taşır: "diskin bu anki
 *    hâlini görürken tokmağım buradaydı". Sunucu son ~0,45 sn'lik disk
 *    geçmişini saklar; tokmağın iki bildirim arasındaki yolu o zamanlardaki
 *    diskle kesişiyorsa vuruşu O ANDA uygular ve diski bugüne yeniden
 *    hesaplar. Böylece oyuncunun ekranda gördüğü temas, sunucudaki temasın
 *    AYNISIDIR. Rakip de vuran tokmağı aynı görüş zamanından (iz akışı)
 *    çizdiği için o da temassız uçuş görmez.
 *  · Eski "gecikme telafisi"nin kusuru: istemci kendi TAHMİN ettiği tokmakla
 *    vuruş beyan ediyor, sunucu 380 birim sapmayı bile kabul ediyordu ve
 *    gerçek zamanlı sunucu tokmağı ayrıca çarpışıyordu. Artık tek kaynak var:
 *    bildirilen imleç yolu.
 *  · DİSK hava yastığında kayar (çok az sürtünme), bantlar ve direkler
 *    enerjinin küçük bir kısmını alır.
 *  · Banda/köşeye SIKIŞAN disk fırlamaz: bant boyunca, tokmaktan uzağa
 *    ölçülü bir hızla kayar.
 *  · Kimse dokunmadan disk hızlanmaz; gol, rakibin son anda kurtarışı
 *    gelebilsin diye kale çizgisinden 0,25 sn sonra kesinleşir.
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

const DISK_TAVANI = 1250;         // mutlak hız tavanı
const DISK_YUMUSAK = 950;         // bunun üstü sıkıştırılır
const HAVA_SURTUNME = 0.05;       // 1/sn — hava yastığı: disk uzun süre kayar
const BANT_ESNEKLIK = 0.95;
const DIREK_ESNEKLIK = 0.9;
const TOKMAK_ESNEKLIK = 0.88;
const KUTLE_PAYI = 0.9;           // tokmak (el) diskten çok ağır
const TOKMAK_TEGET = 0.08;        // yandan sıyırmanın diske verdiği açı
const TOKMAK_HIZ_TAVANI = 2200;   // vuruşta hesaba katılan en yüksek tokmak hızı
const VURUS_ARALIGI = 0.03;       // aynı tokmağın art arda itme aralığı (sn)
const GECMIS_SN = 0.45;           // geri sarılabilecek en uzun süre
const IZ_SESSIZ_SN = 0.1;         // bu kadar bildirim gelmezse tokmak "duran engel" sayılır
const GOL_ONAY_SN = 0.25;
const IMLEC_HIZ_SINIRI = 6000;   // birim/sn — bildirimler arası en büyük imleç sıçrayışı
const GERI_SAYIM_SN = 3;
const TOKMAK_HIZI = TOKMAK_HIZ_TAVANI;   // geriye uyum (dışa aktarılan ad)

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
function hizKirp(o, tavan) {
  const h = Math.hypot(o.vx, o.vy);
  if (h > tavan) { o.vx = o.vx / h * tavan; o.vy = o.vy / h * tavan; }
}
function diskTavani(d) {
  const h = Math.hypot(d.vx, d.vy);
  if (h <= DISK_YUMUSAK) return;
  const yeni = Math.min(DISK_TAVANI, DISK_YUMUSAK + (h - DISK_YUMUSAK) * 0.4);
  d.vx = d.vx / h * yeni; d.vy = d.vy / h * yeni;
}

/* ------------------------------------------------------------------- MAÇ */
function tokmakBaslangic(i) {
  return { x: i === 0 ? ALAN.sol + 150 : ALAN.sag - 150, y: MERKEZ_Y, vx: 0, vy: 0 };
}
function macBaslat(opts) {
  const o = opts || {};
  const golHedefi = [3, 5, 7].includes(Number(o.golHedefi)) ? Number(o.golHedefi) : 5;
  const st = {
    kind: 'havahokeyi',
    seats: (o.seats || [0, 1]).slice(0, 2),
    disk: { x: MERKEZ_X, y: MERKEZ_Y, vx: 0, vy: 0 },
    tokmak: [tokmakBaslangic(0), tokmakBaslangic(1)],
    hedef: [{ x: ALAN.sol + 150, y: MERKEZ_Y }, { x: ALAN.sag - 150, y: MERKEZ_Y }],
    iz: [[], []],                  // imleç bildirimleri {e, x, y} (e: görüş zamanı, motor sn)
    izVaris: [-1e9, -1e9],         // son bildirimin VARIŞ anı (motor sn)
    gecmis: [],                    // disk geçmişi {e, x, y, vx, vy}
    golBekle: null,                // { atan, e } — kale çizgisi geçildi, onay bekliyor
    duzeltE: null,                 // geri sarılıp yeniden hesaplanan ilk an (yayın için)
    skor: [0, 0],
    setler: [0, 0],
    maxSet: [1, 3, 5].includes(Number(o.maxSet)) ? Number(o.maxSet) : 3,
    renk: ['#22d3ee', '#fb4d6d'],
    golHedefi,
    faz: 'gerisayim',              // gerisayim | oyun | gol | bitti
    fazSn: GERI_SAYIM_SN,
    oyunBasE: 0,
    servisYonu: 1,
    gecenSn: 0,
    bekle: [0, 0],
    sonVurus: [-1e9, -1e9],        // seat başına son itmenin görüş zamanı
    sonGolAtan: null,
    sonOlay: 'yok',
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
  st.disk = { x: MERKEZ_X, y: MERKEZ_Y, vx: 0, vy: 0 };
  st.faz = 'gerisayim';
  st.fazSn = GERI_SAYIM_SN;
  st.gecmis = [];
  st.golBekle = null;
}
function golAt(st, atan) {
  st.skor[atan] += 1;
  st.sonGolAtan = atan;
  st.disk = { x: MERKEZ_X, y: MERKEZ_Y, vx: 0, vy: 0 };
  st.gecmis = [];
  st.golBekle = null;
  /* Gol yiyen servis atar — klasik hava hokeyi kuralı. */
  st.servisYonu = atan === 0 ? -1 : 1;
  olay(st, 'gol');
  st.setSonu = false;
  if (st.skor[atan] >= st.golHedefi) {
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

/* --------------------------------------------------------------- ÇARPIŞMA */
/* Disk banda dayanmış mı? Dayandığı bantların iç normalleri. */
function bantlar(d) {
  const n = [];
  const kaleAgzi = d.y > KALE_UST && d.y < KALE_ALT;
  if (d.y - DISK_R <= ALAN.ust + 0.5) n.push({ x: 0, y: 1 });
  if (d.y + DISK_R >= ALAN.alt - 0.5) n.push({ x: 0, y: -1 });
  if (!kaleAgzi && d.x - DISK_R <= ALAN.sol + 0.5) n.push({ x: 1, y: 0 });
  if (!kaleAgzi && d.x + DISK_R >= ALAN.sag - 0.5) n.push({ x: -1, y: 0 });
  return n;
}
function bantIcineAl(d) {
  const kaleAgzi = d.y > KALE_UST && d.y < KALE_ALT;
  d.y = kirp(d.y, ALAN.ust + DISK_R, ALAN.alt - DISK_R);
  if (!kaleAgzi) d.x = kirp(d.x, ALAN.sol + DISK_R, ALAN.sag - DISK_R);
}
/* Disk ile tokmak (m: {x,y,vx,vy}). İtme yalnız GERÇEK temasta ve YAKLAŞIRKEN.
   bekleyen: art arda itme engeli aktif mi. Dönüş: itme gücü (0 = yok). */
function carp(d, m, bekleyen) {
  const dx = d.x - m.x, dy = d.y - m.y;
  const enAz = DISK_R + TOKMAK_R;
  const k2 = dx * dx + dy * dy;
  if (k2 >= enAz * enAz) return 0;
  const uz = Math.sqrt(k2);
  let nx, ny;
  if (uz > 1e-6) { nx = dx / uz; ny = dy / uz; }
  else { const h = Math.hypot(m.vx, m.vy) || 1; nx = (m.vx / h) || 1; ny = m.vy / h; }
  d.x = m.x + nx * enAz; d.y = m.y + ny * enAz;
  const mvx = m.vx, mvy = m.vy;
  const bx = d.vx - mvx, by = d.vy - mvy;
  const bn = bx * nx + by * ny;
  let guc = 0;
  if (bn < 0) {
    if (!bekleyen) {
      d.vx -= (1 + TOKMAK_ESNEKLIK) * KUTLE_PAYI * bn * nx;
      d.vy -= (1 + TOKMAK_ESNEKLIK) * KUTLE_PAYI * bn * ny;
      const tgx = -ny, tgy = nx, bt = bx * tgx + by * tgy;
      d.vx -= bt * TOKMAK_TEGET * tgx; d.vy -= bt * TOKMAK_TEGET * tgy;
      guc = Math.min(1, Math.max(0.1, -bn / 900));
    } else { d.vx -= bn * nx; d.vy -= bn * ny; }       // taşıma: ek enerji yok
    diskTavani(d);
  }
  /* SIKIŞMA: disk banda itildiyse bant boyunca, tokmaktan uzağa kayar. */
  const bn2 = bantlar(d);
  if (bn2.length) {
    bantIcineAl(d);
    const ex = d.x - m.x, ey = d.y - m.y;
    if (ex * ex + ey * ey < enAz * enAz - 1) {
      let en = null, enIyi = -Infinity;
      for (const w of bn2) {
        for (const yon of [1, -1]) {
          const tx = -w.y * yon, ty = w.x * yon;
          let serbest = true;
          for (const w2 of bn2) if (w2 !== w && tx * w2.x + ty * w2.y < -0.5) serbest = false;
          const skor = (tx * ex + ty * ey) + (serbest ? 0 : -1e6);
          if (skor > enIyi) { enIyi = skor; en = { x: tx, y: ty }; }
        }
      }
      /* bant boyunca tokmağın dışına çıkacağı noktaya kaydır (tekrar tekrar
         iç içe geçip "takılı" kalmasın), sonra o yönde ölçülü hızla kaysın */
      const px = d.x - m.x, py = d.y - m.y, B = 2 * (px * en.x + py * en.y), C = px * px + py * py - enAz * enAz;
      const kay = (-B + Math.sqrt(Math.max(0, B * B - 4 * C))) / 2;
      if (kay > 0 && kay < enAz * 2) { d.x += en.x * kay; d.y += en.y * kay; bantIcineAl(d); }
      const hiz = kirp(Math.hypot(mvx, mvy) * 0.6, 150, 520);
      d.vx = en.x * hiz; d.vy = en.y * hiz;
      guc = guc || 0.2;
    }
  }
  return guc;
}
function direkleCarpis(d, x, y) {
  const dx = d.x - x, dy = d.y - y;
  const enAz = DISK_R + DIREK_R;
  const k2 = dx * dx + dy * dy;
  if (k2 >= enAz * enAz) return false;
  const uz = Math.sqrt(k2) || 0.001;
  const nx = dx / uz, ny = dy / uz;
  d.x = x + nx * enAz; d.y = y + ny * enAz;
  const vn = d.vx * nx + d.vy * ny;
  if (vn < 0) { d.vx -= (1 + DIREK_ESNEKLIK) * vn * nx; d.vy -= (1 + DIREK_ESNEKLIK) * vn * ny; return true; }
  return false;
}
/* Diski dt kadar ilerlet (bant, direk, kale çizgisi). Dönüş: 'duvar' | 'cizgi0' | 'cizgi1' | null */
function serbestIlerle(d, dt) {
  const r = Math.exp(-HAVA_SURTUNME * dt);
  d.vx *= r; d.vy *= r;
  d.x += d.vx * dt; d.y += d.vy * dt;
  let ses = null;
  if (d.y - DISK_R < ALAN.ust) { d.y = ALAN.ust + DISK_R; if (d.vy < 0) { d.vy = -d.vy * BANT_ESNEKLIK; if (d.vy > 30) ses = 'duvar'; } }
  else if (d.y + DISK_R > ALAN.alt) { d.y = ALAN.alt - DISK_R; if (d.vy > 0) { d.vy = -d.vy * BANT_ESNEKLIK; if (d.vy < -30) ses = 'duvar'; } }
  const kaleAgzi = d.y > KALE_UST && d.y < KALE_ALT;
  if (!kaleAgzi && d.x - DISK_R < ALAN.sol) { d.x = ALAN.sol + DISK_R; if (d.vx < 0) { d.vx = -d.vx * BANT_ESNEKLIK; if (d.vx > 30) ses = 'duvar'; } }
  else if (!kaleAgzi && d.x + DISK_R > ALAN.sag) { d.x = ALAN.sag - DISK_R; if (d.vx > 0) { d.vx = -d.vx * BANT_ESNEKLIK; if (d.vx < -30) ses = 'duvar'; } }
  if (direkleCarpis(d, ALAN.sol, KALE_UST) | direkleCarpis(d, ALAN.sol, KALE_ALT) |
      direkleCarpis(d, ALAN.sag, KALE_UST) | direkleCarpis(d, ALAN.sag, KALE_ALT)) ses = 'duvar';
  hizKirp(d, DISK_TAVANI);
  if (d.x < 4 - DISK_R) return 'cizgi1';          // sol kale: koltuk 1'in golü
  if (d.x > MASA_EN - 4 + DISK_R) return 'cizgi0';
  return ses;
}

/* ------------------------------------------------------------- İMLEÇ İZİ */
/* j koltuğunun e anındaki tokmağı (bildirimlerden ara değer). Bildirimler e'yi
   kapsamıyorsa null. Hız: e çevresindeki ~30 ms'lik yoldan. */
function izdeTokmak(st, j, e, uzatma) {
  const iz = st.iz[j];
  if (!iz.length) return null;
  const son = iz[iz.length - 1];
  if (e > son.e + (uzatma || 0) || e < iz[0].e) return null;
  const konum = t => {
    if (t >= son.e) return { x: son.x, y: son.y };
    let k = iz.length - 1;
    while (k > 0 && iz[k - 1].e > t) k--;
    const a = iz[Math.max(0, k - 1)], b = iz[k];
    if (b.e <= a.e) return { x: b.x, y: b.y };
    const f = kirp((t - a.e) / (b.e - a.e), 0, 1);
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  };
  const p = konum(e);
  const pencere = 0.03;
  const q = konum(Math.max(iz[0].e, e - pencere));
  const dt = Math.max(1e-3, Math.min(pencere, e - iz[0].e));
  const m = { x: p.x, y: p.y, vx: (p.x - q.x) / dt, vy: (p.y - q.y) / dt };
  if (e > son.e) { m.vx = 0; m.vy = 0; }
  hizKirp(m, TOKMAK_HIZ_TAVANI);
  return m;
}

/* Gerçek zamanlı alt adım: disk serbest ilerler; bildirimi kesilen (sessiz)
   oyuncunun tokmağı son konumunda DURAN engel sayılır. */
function altAdim(st, dt) {
  st.gecenSn += dt;
  st.bekle[0] = Math.max(0, st.bekle[0] - dt); st.bekle[1] = Math.max(0, st.bekle[1] - dt);
  if (st.faz === 'gerisayim') {
    st.fazSn = Math.max(0, st.fazSn - dt);
    st.disk.x = MERKEZ_X; st.disk.y = MERKEZ_Y;
    if (st.fazSn === 0) {
      st.faz = 'oyun'; st.oyunBasE = st.gecenSn; st.gecmis = [];
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
  const r = st.golBekle ? null : serbestIlerle(d, dt);
  if (st.golBekle) { d.x += d.vx * dt; d.y += d.vy * dt; }
  if (r === 'duvar') olay(st, 'duvar');
  else if (r === 'cizgi0' || r === 'cizgi1') st.golBekle = { atan: r === 'cizgi0' ? 0 : 1, e: st.gecenSn };
  if (!st.golBekle) {
    for (const j of [0, 1]) {
      if (st.gecenSn - st.izVaris[j] < IZ_SESSIZ_SN) continue;
      const m = { x: st.tokmak[j].x, y: st.tokmak[j].y, vx: 0, vy: 0 };
      const g = carp(d, m, st.bekle[j] > 0);
      if (g) { st.bekle[j] = VURUS_ARALIGI; st.sonVurus[j] = st.gecenSn; olay(st, 'vurus'); }
    }
  }
  st.gecmis.push({ e: st.gecenSn, x: d.x, y: d.y, vx: d.vx, vy: d.vy, gol: st.golBekle ? 1 : 0 });
  while (st.gecmis.length && st.gecenSn - st.gecmis[0].e > GECMIS_SN) st.gecmis.shift();
  if (st.golBekle && st.gecenSn - st.golBekle.e >= GOL_ONAY_SN) golAt(st, st.golBekle.atan);
}

function adim(st, dtSn) {
  const dt = kirp(Number(dtSn) || 0, 0, 0.05);
  if (dt <= 0 || st.faz === 'bitti') return;
  const n = Math.max(1, Math.ceil(dt / ALT_ADIM_SN - 1e-9));
  const h = dt / n;
  for (let k = 0; k < n && st.faz !== 'bitti'; k++) altAdim(st, h);
}

/* İMLEÇ BİLDİRİMİ: seat'in tokmağı, görüş zamanı e'de (x, y)'de.
   e verilmezse "şimdi" kabul edilir (klavye/eski istemci/testler). */
function izEkle(st, seat, x, y, eGorus) {
  const i = tarafOf(seat);
  const hx = Number(x), hy = Number(y);
  if (!Number.isFinite(hx) || !Number.isFinite(hy)) return { ok: false, reason: 'gecersiz_hamle' };
  const p = { x: hx, y: hy };
  tokmakKirp(p, i);
  const zamanli = eGorus !== undefined && eGorus !== null && Number.isFinite(Number(eGorus));
  let e = zamanli ? Number(eGorus) : st.gecenSn;
  e = kirp(e, st.gecenSn - GECMIS_SN, st.gecenSn);
  const iz = st.iz[i];
  if (iz.length && e < iz[iz.length - 1].e) e = iz[iz.length - 1].e;     // zaman geri gitmez
  /* ilk bildirimde önceki konum: tokmağın bilinen son yeri, bir adım önce */
  if (!iz.length) iz.push({ e: e - ADIM_SN, x: st.tokmak[i].x, y: st.tokmak[i].y });
  const onceki = iz[iz.length - 1];
  /* ışınlanma sınırı: elle yapılamayacak sıçrayış (6000 birim/sn üstü) kırpılır */
  const izin = IMLEC_HIZ_SINIRI * Math.max(ADIM_SN, e - onceki.e);
  const sx = p.x - onceki.x, sy = p.y - onceki.y, sk = Math.hypot(sx, sy);
  if (zamanli && sk > izin) { p.x = onceki.x + sx / sk * izin; p.y = onceki.y + sy / sk * izin; tokmakKirp(p, i); }
  iz.push({ e, x: p.x, y: p.y });
  while (iz.length > 2 && iz[iz.length - 1].e - iz[0].e > GECMIS_SN + 0.1) iz.shift();
  st.izVaris[i] = st.gecenSn;
  st.hedef[i] = { x: p.x, y: p.y };
  const t = st.tokmak[i];
  const dtT = Math.max(1e-3, e - onceki.e);
  t.vx = (p.x - onceki.x) / dtT; t.vy = (p.y - onceki.y) / dtT;
  hizKirp(t, TOKMAK_HIZ_TAVANI);
  t.x = p.x; t.y = p.y;
  if (st.faz === 'oyun') vurusAra(st, i, onceki, iz[iz.length - 1]);
  return { ok: true };
}

/* İki bildirim arasındaki imleç yolu, o zamanlardaki diskle kesişiyor mu?
   Kesişiyorsa vuruşu o anda uygula ve diski bugüne yeniden hesapla. */
function vurusAra(st, i, a, b) {
  let g = st.gecmis;
  /* geçmiş henüz yoksa (oyun yeni başladı) disk o aralıkta duruyor sayılır */
  if (g.length < 2) {
    const d = st.disk;
    g = [{ e: b.e - ADIM_SN, x: d.x, y: d.y, vx: d.vx, vy: d.vy, gol: 0 }, { e: b.e, x: d.x, y: d.y, vx: d.vx, vy: d.vy, gol: 0 }];
    st.gecmis = g;
  }
  /* imleç uzun süre durduysa (bildirim aralığı büyük) yolun yalnız son 80 ms'i */
  const bas = Math.max(a.e, b.e - 0.08, st.oyunBasE - ADIM_SN, st.sonVurus[i] + VURUS_ARALIGI);
  const enAz = DISK_R + TOKMAK_R;
  for (let n = 1; n < g.length; n++) {
    const s0 = g[n - 1], s1 = g[n];
    if (s1.e <= bas || s0.e >= b.e || s0.gol || s1.gol) continue;
    const t0 = Math.max(s0.e, bas), t1 = Math.min(s1.e, b.e);
    if (t1 <= t0) continue;
    const ds = s1.e - s0.e || 1e-6;
    const disk = t => { const f = (t - s0.e) / ds; return { x: s0.x + (s1.x - s0.x) * f, y: s0.y + (s1.y - s0.y) * f,
      vx: s0.vx + (s1.vx - s0.vx) * f, vy: s0.vy + (s1.vy - s0.vy) * f }; };
    const ma = izdeTokmak(st, i, t0), mb = izdeTokmak(st, i, t1);
    if (!ma || !mb) continue;
    const da = disk(t0), db = disk(t1);
    /* göreli konum doğrusal: |p0 + (p1-p0)u| = enAz → ilk u */
    const p0x = da.x - ma.x, p0y = da.y - ma.y, p1x = db.x - mb.x, p1y = db.y - mb.y;
    const qx = p1x - p0x, qy = p1y - p0y;
    const A = qx * qx + qy * qy, B = 2 * (p0x * qx + p0y * qy), C = p0x * p0x + p0y * p0y - enAz * enAz;
    let u;
    if (C <= 0) u = 0;                                    // aralık başında zaten temas
    else if (A < 1e-9) continue;
    else {
      const D = B * B - 4 * A * C;
      if (D < 0) continue;
      u = (-B - Math.sqrt(D)) / (2 * A);
      if (u < 0 || u > 1) continue;
    }
    const tc = t0 + (t1 - t0) * u;
    const dc = disk(tc), mc = izdeTokmak(st, i, tc);
    const bn = (dc.vx - mc.vx) * (dc.x - mc.x) + (dc.vy - mc.vy) * (dc.y - mc.y);
    if (bn >= 0) continue;                                // uzaklaşıyor / teğet
    const j = 1 - i;
    if (st.sonVurus[j] > tc) return false;               // rakibin sonraki vuruşu silinmez
    yenidenHesapla(st, n, tc, dc, mc, i);
    return true;
  }
  return false;
}

/* tc anında (geçmişin n. kaydından önce) i koltuğunun tokmağı diske vurur;
   disk bugüne yeniden hesaplanır, sonrasında iki tokmak da izlerinden çarpışır. */
function yenidenHesapla(st, n, tc, dc, mc, i) {
  const g = st.gecmis;
  const d = { x: dc.x, y: dc.y, vx: dc.vx, vy: dc.vy };
  const bekle = [0, 0];
  let e = tc;
  const guc = carp(d, mc, false);
  if (!guc) return;
  bekle[i] = VURUS_ARALIGI;
  st.sonVurus[i] = e;
  const yeni = g.slice(0, n);
  yeni.push({ e, x: d.x, y: d.y, vx: d.vx, vy: d.vy, gol: 0 });
  let golBekle = null;
  const simdi = st.gecenSn;
  while (e < simdi - 1e-9) {
    const dt = Math.min(ALT_ADIM_SN, simdi - e);
    e += dt;
    bekle[0] = Math.max(0, bekle[0] - dt); bekle[1] = Math.max(0, bekle[1] - dt);
    if (!golBekle) {
      const r = serbestIlerle(d, dt);
      if (r === 'cizgi0' || r === 'cizgi1') golBekle = { atan: r === 'cizgi0' ? 0 : 1, e };
    } else { d.x += d.vx * dt; d.y += d.vy * dt; }
    if (!golBekle) {
      for (const j of [0, 1]) {
        const m = izdeTokmak(st, j, e, 0.02);
        if (!m) continue;
        if (carp(d, m, bekle[j] > 0) && bekle[j] <= 0) { bekle[j] = VURUS_ARALIGI; st.sonVurus[j] = e; }
      }
    }
    yeni.push({ e, x: d.x, y: d.y, vx: d.vx, vy: d.vy, gol: golBekle ? 1 : 0 });
  }
  st.gecmis = yeni;
  st.disk = d;
  st.golBekle = golBekle;
  st.bekle[0] = Math.max(st.bekle[0], bekle[0]); st.bekle[1] = Math.max(st.bekle[1], bekle[1]);
  st.duzeltE = st.duzeltE === null || st.duzeltE === undefined ? tc : Math.min(st.duzeltE, tc);
  olay(st, 'vurus');
  if (golBekle && st.gecenSn - golBekle.e >= GOL_ONAY_SN) golAt(st, golBekle.atan);
}

/* Tokmak konumu (istemciden gelir): yalnız kendi yarı sahasına yazılır.
   eGorus: istemcinin o an gördüğü disk zamanı (motor sn). */
function hedefYaz(st, seat, x, y, eGorus) { return izEkle(st, seat, x, y, eGorus); }

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
  ADIM_SN, ALT_ADIM_SN, TOKMAK_HIZI, DISK_TAVANI, GERI_SAYIM_SN, GECMIS_SN, GOL_ONAY_SN,
  tarafOf, tokmakKirp, macBaslat, adim, hedefYaz, izEkle, izdeTokmak, carp, serbestIlerle,
  renkYaz, RENKLER, macBitir, pesEt, gorunum
};
