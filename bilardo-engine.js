'use strict';
/* ============================================================================
 * GameVerse — BİLARDO FİZİK MOTORU (sunucu-otoriteli, gerçekçi katı-cisim)
 * ============================================================================
 *
 * MİMARİ (Physics Controller)
 * ---------------------------
 *   P            : fiziksel sabitler — hepsi SI (metre, kilogram, saniye)
 *   Vec          : 3B vektör yardımcıları
 *   cueStrike()  : ISTEKA DARBESİ — impuls, falso, yükseklik açısı, defleksiyon
 *   stepBall()   : TEK TOP HAREKETİ — kayma/yuvarlanma/havada/falso sönümü
 *   ballBall()   : TOP-TOP çarpışması — normal impuls + Coulomb sürtünmesi (throw)
 *   cushion()    : BANT çarpışması — merkez ÜSTÜ temas, hıza bağlı esneklik, tutuş
 *   pockets      : cep ağzı boşlukları + çene (jaw) noktaları
 *   simulate()   : sabit adımlı çözücü + kare kaydı (istemci canlı izler)
 *   8-top kuralları: init/shoot — dış API eskisiyle AYNI kalır.
 *
 * KOORDİNAT SİSTEMİ
 * -----------------
 *   Fizik SAĞ ELLİ bir eksende çalışır: x sağa, y YUKARI, z masadan dışarı.
 *   Tuval (canvas) ekseni ise y'yi AŞAĞI sayar. Dönüşüm TEK BİR YERDE
 *   (toPx / fromCanvasAngle) yapılır — eskiden bu karışıklık falsolu
 *   vuruşlarda yön hatalarına yol açıyordu.
 *
 * NEDEN BAŞTAN YAZILDI
 * --------------------
 *   Önceki motor topları noktasal kütle gibi işliyordu: açısal momentum
 *   (falso) hiç yoktu, bant çarpışması eksen bileşenini ters çevirmekten
 *   ibaretti, top-top teması sürtünmesizdi. Bu yüzden ne çekme (draw), ne
 *   takip (follow), ne yan falso, ne masse, ne de "throw" vardı; oyun
 *   "gerçeği yansıtmıyordu". Bu sürüm topların DÖNMESİNİ ve temas
 *   noktalarındaki sürtünmeyi gerçek fizikle çözer.
 * ========================================================================= */

// ---------------------------------------------------------------- SABİTLER
const P = {
  // --- Masa (9 ft turnuva oyun yüzeyi) ---
  tableLength: 2.54,          // m
  tableWidth: 1.27,           // m

  // --- Top (WPA standardı) ---
  ballRadius: 0.028575,       // m (57.15 mm çap)
  ballMass: 0.163,            // kg

  // --- Sürtünme katsayıları ---
  muSlide: 0.20,              // top-çuha KAYMA (µs)
  muRoll: 0.010,              // top-çuha YUVARLANMA (µr)
  muSpin: 0.044,              // z ekseni falso sönümü (drilling friction)
  muBall: 0.055,              // top-top (throw / falso aktarımı)
  muCushion: 0.20,            // top-bant tutuşu

  // --- Esneklik (restitution) katsayıları ---
  eBall: 0.95,                // top-top
  eCushionBase: 0.86,         // bant: e = base - slope*|vn|, sınırlar arasında
  eCushionSlope: 0.05,
  eCushionMin: 0.62,
  eCushionMax: 0.92,
  eJaw: 0.60,                 // cep çenesi
  eCloth: 0.45,               // havadan inen topun çuhadan sekmesi

  // --- Geometri ---
  cushionHeightR: 1.27,       // bant burnu yüksekliği, R cinsinden (= 0.635 × çap)

  // --- Isteka ---
  cueMass: 0.54,              // kg (~19 oz)
  // DEFLEKSİYON (squirt) katsayısı: tan(sapma) = (a/R)·squirtCoef.
  // Fiziksel kaynağı ıstekanın ETKİN UÇ KÜTLESİDİR; katsayı ölçümlere göre
  // kalibre edildi — maksimum yan falsoda (a/R≈0,5) ~3° sapma. Düşük
  // defleksiyonlu ıstekalarda ~2°, sert uçlularda ~4° ölçülür.
  squirtCoef: 0.11,
  tipEfficiency: 0.86,        // deri uç + şaft kayıpları (ideal elastik değil)
  maxCueSpeed: 6.5,           // m/s (tam güç / açılış vuruşu → top ~8.6 m/s;
                              //      gerçek turnuva açılışları 7-9 m/s aralığındadır)
  minCueSpeed: 0.30,          // m/s (en yumuşak dokunuş → top ~0.46 m/s)
  maxTipOffset: 0.5,          // R cinsinden; ötesi kaçak vuruş (miscue) sayılır
  maxElevation: 60 * Math.PI / 180,
  jumpElevation: 25 * Math.PI / 180,  // bu açının üstünde top sıçrayabilir

  // --- Sayısal çözücü ---
  g: 9.80665,
  dt: 1 / 500,                // s — sabit adım
  maxTime: 20,                // s — bir atışın üst sınırı
  stopSpeed: 0.005,           // m/s
  stopSpin: 0.30,             // rad/s
  frameHz: 60,                // istemciye gönderilen kare sıklığı
  maxFrames: 900
};

// Türetilmiş sabitler
const R = P.ballRadius;
const M = P.ballMass;
const I_BALL = 0.4 * M * R * R;             // küre: I = (2/5)mR²
const CONTACT_H = (P.cushionHeightR - 1) * R;              // bant temasının merkez üstü yüksekliği
const CONTACT_XY = Math.sqrt(Math.max(0, R * R - CONTACT_H * CONTACT_H));

// ------------------------------------------------------- PİKSEL DÖNÜŞÜMÜ
// Tuval 900×500; oyun yüzeyi 784×392 piksel (gerçek 2:1 masa oranı).
const VIEW = { W: 900, H: 500, L: 58, R: 842, T: 54, B: 446 };
const S = (VIEW.R - VIEW.L) / P.tableLength;      // px/m (≈308.66)
const toPxX = x => VIEW.L + x * S;
const toPxY = y => VIEW.B - y * S;                // y yukarı → tuvalde aşağı
const px1 = v => Math.round(v * 10) / 10;

// İstemciyle ORTAK geometri (durum paketiyle de gönderilir; iki taraf
// sabitleri ayrı ayrı tutarsa er geç birbirinden kopar).
const C = {
  W: VIEW.W, H: VIEW.H, L: VIEW.L, R: VIEW.R, T: VIEW.T, B: VIEW.B,
  r: R * S,                                   // top yarıçapı (px)
  pocketR: 0,                                 // aşağıda dolduruluyor
  scale: S,
  frameMs: Math.round(1000 / P.frameHz),
  maxFrames: P.maxFrames,
  maxShot: 1                                  // güç 0..1 (eski API uyumu)
};

// ------------------------------------------------------------- CEPLER
// Köşe cepleri ağzı ~11.5 cm, orta cepler ~12.5 cm. Cep merkezleri oyun
// yüzeyinin biraz DIŞINDADIR; yakalama yarıçapı topun merkezine bakar.
const POCKET_DEFS = (() => {
  const L = P.tableLength, W = P.tableWidth;
  const cornerMouth = 0.115, sideMouth = 0.125;
  const cornerCap = 0.060, sideCap = 0.062;
  const out = 0.022;
  return [
    { x: -out, y: -out, cap: cornerCap, mouth: cornerMouth, kind: 'corner' },
    { x: L / 2, y: -out * 0.9, cap: sideCap, mouth: sideMouth, kind: 'side' },
    { x: L + out, y: -out, cap: cornerCap, mouth: cornerMouth, kind: 'corner' },
    { x: -out, y: W + out, cap: cornerCap, mouth: cornerMouth, kind: 'corner' },
    { x: L / 2, y: W + out * 0.9, cap: sideCap, mouth: sideMouth, kind: 'side' },
    { x: L + out, y: W + out, cap: cornerCap, mouth: cornerMouth, kind: 'corner' }
  ];
})();
C.pocketR = POCKET_DEFS[0].cap * S;
C.pockets = POCKET_DEFS.map(p => ({ x: px1(toPxX(p.x)), y: px1(toPxY(p.y)), r: px1(p.cap * S), kind: p.kind }));

// Bant boşlukları: cep ağzının önünde bant YOKTUR (yoksa cebe giden top
// ağzın önünde banda çarpıp geri dönerdi — eski motorun en can sıkıcı
// davranışlarından biri buydu).
function cushionGap(axis, coord) {
  // axis: 'x' → alt/üst bant boyunca x; 'y' → sol/sağ bant boyunca y
  for (const p of POCKET_DEFS) {
    if (axis === 'x') {
      if (Math.abs(coord - p.x) < p.mouth / 2 + R * 0.25) return true;
    } else if (Math.abs(coord - p.y) < p.mouth / 2 + R * 0.25) return true;
  }
  return false;
}
// Çene (jaw) noktaları: cep ağzının iki ucundaki yuvarlak köşeler. Toplar
// buradan sekerek "çıngırdayabilir" (rattle) — gerçek bir masanın hissi.
const JAWS = (() => {
  const L = P.tableLength, W = P.tableWidth, jr = 0.012;
  const j = [];
  for (const p of POCKET_DEFS) {
    const half = p.mouth / 2;
    if (p.kind === 'side') {
      const y = p.y < W / 2 ? 0 : W;
      j.push({ x: p.x - half, y, r: jr }, { x: p.x + half, y, r: jr });
    } else {
      const x = p.x < L / 2 ? 0 : L;
      const y = p.y < W / 2 ? 0 : W;
      const sx = x === 0 ? 1 : -1, sy = y === 0 ? 1 : -1;
      j.push({ x: x + sx * half, y, r: jr }, { x, y: y + sy * half, r: jr });
    }
  }
  return j;
})();

// --------------------------------------------------------------- VEKTÖR
const Vec = {
  len(x, y, z) { return Math.sqrt(x * x + y * y + (z || 0) * (z || 0)); },
  len2(x, y) { return Math.sqrt(x * x + y * y); }
};

// ===========================================================================
//  1) ISTEKA DARBESİ  —  Cue-Ball Dynamics
// ===========================================================================
/**
 * Istekanın topa aktardığı doğrusal ve açısal momentumu hesaplar.
 *
 *  Kullanılan model (Leckie & Greenspan, "An Event-Based Pool Physics
 *  Simulator"): ucun topa a (yan) ve b (dikey) kaçıklıkla, φ yükseklik
 *  açısıyla vurduğu varsayılır. Uç ile top arasında kayma olmadığı kabul
 *  edilerek impuls ıstekanın EKSENİ boyunca uygulanır:
 *
 *        F = 2 m V / ( 1 + m/M + (5/2R²)·(a² + b²cos²φ + c²sin²φ
 *                                          − 2·b·c·cosφ·sinφ) )
 *        c = √(R² − a² − b²)
 *
 *  Doğrusal hız  v = (F/m)·ĉ          (ĉ: ıstekanın baktığı yön)
 *  Açısal hız    ω = (r_c × F·ĉ)/I    (r_c: uç temas noktası)
 *
 *  DEFLEKSİYON (squirt): yan falsoda ucun ETKİN UÇ KÜTLESİ topu hedef
 *  doğrultudan biraz saptırır. Açı, uç kütlesi ile top kütlesinin oranına
 *  bağlıdır:  tanθ ≈ (a/R)·(5·Me)/(2m + 5·Me).
 *  (Tipik bir ısteka için maksimum yan falsoda ~2-3°, ölçümlerle uyumlu.)
 */
function cueStrike(aimAngle, power, tipX, tipY, elevation) {
  const p = Math.min(1, Math.max(0.02, Number(power) || 0));
  const V = P.minCueSpeed + (P.maxCueSpeed - P.minCueSpeed) * p;

  // Uç kaçıklığı R cinsinden gelir; kaçak vuruş sınırına kırpılır.
  let ax = Number(tipX) || 0, by = Number(tipY) || 0;
  const off = Math.hypot(ax, by);
  if (off > P.maxTipOffset) { const k = P.maxTipOffset / off; ax *= k; by *= k; }
  const a = ax * R, b = by * R;
  const c = Math.sqrt(Math.max(1e-9, R * R - a * a - b * b));

  let phi = Math.min(P.maxElevation, Math.max(0, Number(elevation) || 0));
  const cosF = Math.cos(phi), sinF = Math.sin(phi);

  const denom = 1 + M / P.cueMass + (5 / (2 * R * R)) *
    (a * a + b * b * cosF * cosF + c * c * sinF * sinF - 2 * b * c * cosF * sinF);
  // İdeal (tam elastik) impuls × uç verimi. Gerçek bir deri uç + şaft
  // enerjinin bir kısmını yutar; bu çarpan olmadan top ısteka hızının
  // 1,54 katına çıkar ki ölçümlerle uyuşmaz (gerçek oran ~1,3).
  const F = (2 * M * V) / denom * P.tipEfficiency;   // impuls (N·s)

  // --- Defleksiyon / squirt: topun çıkış doğrultusu nişandan sapar ---
  const squirt = Math.atan(ax * P.squirtCoef);
  const theta = aimAngle - squirt;             // yan falso, topu ters yöne iter

  // Isteka ekseni (dünya): ileri + aşağı
  const cx = Math.cos(theta) * cosF, cy = Math.sin(theta) * cosF, cz = -sinF;

  // Doğrusal hız
  const sp = F / M;
  let vx = sp * cx, vy = sp * cy, vz = sp * cz;

  // Masa, aşağı doğru bileşeni karşılar. Yüksek açılı vuruşlarda top
  // ısteka ile çuha arasında sıkışıp SIÇRAR (jump shot).
  if (vz < 0) {
    vz = phi > P.jumpElevation
      ? -vz * P.eCloth * Math.min(1, (phi - P.jumpElevation) / (P.maxElevation - P.jumpElevation) + 0.25)
      : 0;
  }

  // --- Açısal hız: ω = (r_c × p)/I ---
  // Temas noktası: nişan ekseninde -c, yan eksende a, dikeyde b.
  const fx = Math.cos(theta), fy = Math.sin(theta);          // ileri
  const sxv = Math.sin(theta), syv = -Math.cos(theta);       // "sağ" (yan falso ekseni)
  const rx = -fx * c + sxv * a, ry = -fy * c + syv * a, rz = b;
  const px_ = F * cx, py_ = F * cy, pz_ = F * cz;
  const wx = (ry * pz_ - rz * py_) / I_BALL;
  const wy = (rz * px_ - rx * pz_) / I_BALL;
  const wz = (rx * py_ - ry * px_) / I_BALL;

  return { vx, vy, vz, wx, wy, wz, impulse: F, cueSpeed: V, squirt };
}

// ===========================================================================
//  2) TEK TOP HAREKETİ  —  kayma / yuvarlanma / havada / falso sönümü
// ===========================================================================
/**
 * Temas noktasının (topun çuhaya değen alt noktası) hızı:
 *      u = v + R·(ẑ × ω)  →  (vx − R·ωy , vy + R·ωx)
 *
 * KAYMA (|u| > 0):   a = −µs·g·û          ,  dω/dt = (5µs·g)/(2R)·(ẑ × û)
 *                    (u büyüklüğü (7/2)µs·g ile söner; çekme/takip buradan doğar)
 * YUVARLANMA (u≈0):  a = −µr·g·v̂          ,  ω = (ẑ × v)/R ile kilitli
 * FALSO (z):         dωz/dt = −(5µsp·g)/(2R)·sign(ωz)
 *
 * Yan falso KAYMA fazında u'yu v ile aynı hizadan çıkardığı için sürtünme
 * kuvveti yana bileşen kazanır → YÖRÜNGE BÜKÜLÜR. Masse ve piqué vuruşların
 * kavisi ayrıca bir "kavis kuralı" yazılmadan, doğrudan bu denklemlerden çıkar.
 */
function stepBall(b, dt) {
  if (b.potted) return false;

  // --- HAVADA ---
  if (b.z > 1e-6 || b.vz > 1e-6) {
    b.vz -= P.g * dt;
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    if (b.z <= 0) {
      b.z = 0;
      if (b.vz < 0) {
        const vin = -b.vz;
        b.vz = vin * P.eCloth;
        if (b.vz < 0.05) { b.vz = 0; b.z = 0; }
        // İnişte çuha ile kısa bir sürtünme darbesi: falso ↔ hız alışverişi
        const J = (1 + P.eCloth) * M * vin;
        const ux = b.vx - R * b.wy, uy = b.vy + R * b.wx;
        const un = Vec.len2(ux, uy);
        if (un > 1e-6) {
          const jt = Math.min(P.muSlide * J, (2 / 7) * M * un);
          const tx = -ux / un, ty = -uy / un;
          b.vx += jt * tx / M; b.vy += jt * ty / M;
          b.wx += (-R) * (jt * ty) / I_BALL * -1;
          b.wy += (-R) * (jt * tx) / I_BALL;
        }
      }
    }
    return true;
  }

  // Masada duran topu masa aşağı itemez: artık negatif düşey hız birikmez.
  if (b.z <= 0 && b.vz < 0) b.vz = 0;

  const sp = Vec.len2(b.vx, b.vy);
  const ux = b.vx - R * b.wy;
  const uy = b.vy + R * b.wx;
  const un = Vec.len2(ux, uy);

  // KAYMA → YUVARLANMA GEÇİŞİ: |u| bir adımda (7/2)µs·g·dt kadar azalır.
  // Kalan u bu miktardan küçükse adım onu SIFIRIN ÖTESİNE taşır ve ayrık
  // çözücü her adımda yön değiştirip "çırpınır" (u ~0.004'te takılı kalır,
  // top hiç yavaşlamaz). Bu yüzden eşik sabit bir epsilon değil, TAM OLARAK
  // bir adımlık değişimdir; altına düşünce saf yuvarlanmaya kilitlenir.
  const duStep = 3.5 * P.muSlide * P.g * dt;

  if (un > duStep) {
    // ---------------------- KAYMA FAZI ----------------------
    const nx = ux / un, ny = uy / un;
    const dv = P.muSlide * P.g * dt;
    b.vx -= dv * nx; b.vy -= dv * ny;
    // dω/dt = (5µs g)/(2R)·(ẑ × û) ,  ẑ × û = (−ny, nx)
    const dw = (5 * P.muSlide * P.g) / (2 * R) * dt;
    b.wx += dw * (-ny);
    b.wy += dw * (nx);
  } else if (sp > 1e-5) {
    // ------------------ SAF YUVARLANMA FAZI ------------------
    const dv = P.muRoll * P.g * dt;
    const k = Math.max(0, sp - dv) / sp;
    b.vx *= k; b.vy *= k;
    // Yuvarlanma kilidi: ω = (ẑ × v)/R  →  (−vy/R, vx/R)
    b.wx = -b.vy / R; b.wy = b.vx / R;
  } else {
    b.vx = 0; b.vy = 0; b.wx = 0; b.wy = 0;
  }

  // ------------------- FALSO (z) SÖNÜMÜ -------------------
  if (Math.abs(b.wz) > 1e-6) {
    const dwz = (5 * P.muSpin * P.g) / (2 * R) * dt;
    b.wz = Math.abs(b.wz) <= dwz ? 0 : b.wz - Math.sign(b.wz) * dwz;
  }

  b.x += b.vx * dt; b.y += b.vy * dt;

  const stopped = Vec.len2(b.vx, b.vy) < P.stopSpeed &&
                  Math.abs(b.wz) < P.stopSpin &&
                  Vec.len2(ux, uy) < P.stopSpeed;
  if (stopped && b.z <= 0) { b.vx = b.vy = 0; b.wx = b.wy = 0; if (Math.abs(b.wz) < P.stopSpin) b.wz = 0; }
  return !stopped;
}

// ===========================================================================
//  3) TOP-TOP ÇARPIŞMASI  —  impuls + Coulomb sürtünmesi (THROW)
// ===========================================================================
/**
 * Normal impuls (eşit kütleler, esneklik e):   Jn = (1+e)·m·(v_rel·n̂)/2
 *
 * Teğetsel impuls: iki topun TEMAS NOKTASINDAKİ bağıl yüzey hızı
 *      u_rel = v_rel + R·(ω_i + ω_j) × n̂
 * sürtünme ile azaltılır. Coulomb sınırı µ·Jn, kaymayı tamamen durduran
 * impuls ise m·|u_t|/7'dir (iki özdeş küre için). Küçüğü uygulanır.
 *
 * Sonuç: kesme (cut) vuruşlarında hedef topun geometrik doğrultudan
 * SAPMASI ("cut-induced throw") ve falsonun karşı topa AKTARILMASI
 * (spin transfer) kendiliğinden ortaya çıkar.
 */
function ballBall(a, b, ev, t) {
  if (a.potted || b.potted) return false;
  let dx = b.x - a.x, dy = b.y - a.y, dz = (b.z || 0) - (a.z || 0);
  const d = Vec.len(dx, dy, dz);
  const min = 2 * R;
  if (!d || d >= min) return false;

  const nx = dx / d, ny = dy / d, nz = dz / d;

  // Çakışmayı ayır (pozisyon düzeltmesi)
  const over = (min - d) / 2 + 1e-9;
  a.x -= nx * over; a.y -= ny * over;
  b.x += nx * over; b.y += ny * over;

  const rvx = a.vx - b.vx, rvy = a.vy - b.vy, rvz = (a.vz || 0) - (b.vz || 0);
  const vn = rvx * nx + rvy * ny + rvz * nz;
  if (vn <= 0) return false;                     // ayrılıyorlar

  // --- Normal impuls ---
  // Çok düşük yaklaşma hızında esneklik sıfırlanır: yoksa sıkışık top
  // kümeleri mikro-sekmelerle sonsuza dek titreşir (atış hiç bitmez).
  // Eşik BİLEREK düşük tutulur (2 cm/s): daha yüksek bir değer açılış
  // vuruşunda ırkın içindeki temas zincirinden gerçek enerji çalıyor ve
  // toplar masaya yayılamıyordu.
  const eUse = vn < 0.02 ? 0 : P.eBall;
  const Jn = (1 + eUse) * M * vn / 2;
  a.vx -= Jn * nx / M; a.vy -= Jn * ny / M; a.vz = (a.vz || 0) - Jn * nz / M;
  b.vx += Jn * nx / M; b.vy += Jn * ny / M; b.vz = (b.vz || 0) + Jn * nz / M;

  // --- Teğetsel (sürtünme) impulsu: THROW + falso aktarımı ---
  const wsx = (a.wx + b.wx), wsy = (a.wy + b.wy), wsz = (a.wz + b.wz);
  // R·(ω_i+ω_j) × n̂
  const cx = R * (wsy * nz - wsz * ny);
  const cy = R * (wsz * nx - wsx * nz);
  const cz = R * (wsx * ny - wsy * nx);
  let utx = rvx + cx, uty = rvy + cy, utz = rvz + cz;
  const dot = utx * nx + uty * ny + utz * nz;
  utx -= dot * nx; uty -= dot * ny; utz -= dot * nz;
  const ut = Vec.len(utx, uty, utz);
  if (ut > 1e-7) {
    const Jt = Math.min(P.muBall * Jn, M * ut / 7);
    const tx = -utx / ut, ty = -uty / ut, tz = -utz / ut;
    a.vx += Jt * tx / M; a.vy += Jt * ty / M; a.vz = (a.vz || 0) + Jt * tz / M;
    b.vx -= Jt * tx / M; b.vy -= Jt * ty / M; b.vz = (b.vz || 0) - Jt * tz / M;
    // ω += (r × J)/I   (a için r = +R·n̂, b için r = −R·n̂)
    const jx = Jt * tx, jy = Jt * ty, jz = Jt * tz;
    a.wx += (R * (ny * jz - nz * jy)) / I_BALL;
    a.wy += (R * (nz * jx - nx * jz)) / I_BALL;
    a.wz += (R * (nx * jy - ny * jx)) / I_BALL;
    b.wx += (R * (ny * jz - nz * jy)) / I_BALL;
    b.wy += (R * (nz * jx - nx * jz)) / I_BALL;
    b.wz += (R * (nx * jy - ny * jx)) / I_BALL;
  }
  if (ev) ev.push({ t: +t.toFixed(3), type: 'ball', a: a.id, b: b.id, v: +vn.toFixed(3) });
  return true;
}

// ===========================================================================
//  4) BANT ÇARPIŞMASI  —  merkez ÜSTÜ temas, hıza bağlı esneklik, tutuş
// ===========================================================================
/**
 * Bant burnu topun MERKEZİNDEN YUKARIDA (h = 0.635×çap) temas eder; temas
 * noktası r_c = −n̂·√(R²−(h−R)²) + ẑ·(h−R). Bu yükseklik farkı sayesinde:
 *   • üst falso (topspin) banda çarpınca topu İLERİ fırlatır, alt falso keser,
 *   • yeterince hızlı + dik vuruşta top banttan ZIPLAYABİLİR (cushion jump),
 *   • yan falso çıkış AÇISINI değiştirir (running / reverse english).
 *
 * Esneklik hıza bağlıdır (kauçuk hızlı çarpmada daha çok enerji yutar):
 *      e = clamp(e0 − k·|vn| , emin , emax)
 * Bu yüzden "geliş açısı = çıkış açısı" eşitliği yüksek hızlarda bozulur.
 */
function cushion(b, ev, t) {
  if (b.potted) return false;
  const L = P.tableLength, W = P.tableWidth;
  let nx = 0, ny = 0;

  if (b.x < R && !cushionGap('y', b.y)) { b.x = R; nx = 1; }
  else if (b.x > L - R && !cushionGap('y', b.y)) { b.x = L - R; nx = -1; }
  if (b.y < R && !cushionGap('x', b.x)) { b.y = R; ny = 1; }
  else if (b.y > W - R && !cushionGap('x', b.x)) { b.y = W - R; ny = -1; }
  if (!nx && !ny) return false;

  // İki bandı aynı anda (köşe) — tek tek çözmek yeterli ve kararlıdır.
  if (nx && ny) { const n2 = Math.SQRT1_2; nx *= n2; ny *= n2; }

  const vn = b.vx * nx + b.vy * ny;             // < 0 ise banda giriyor
  if (vn >= 0) return false;

  const speed = Math.abs(vn);
  const e = Math.min(P.eCushionMax, Math.max(P.eCushionMin, P.eCushionBase - P.eCushionSlope * speed));
  const Jn = (1 + e) * M * speed;

  // Temas noktası (merkezden): bant yönünde içeri, ve YUKARI
  const rx = -nx * CONTACT_XY, ry = -ny * CONTACT_XY, rz = CONTACT_H;

  // Temas noktasının yüzey hızı: u = v + ω × r
  const uxs = b.vx + (b.wy * rz - b.wz * ry);
  const uys = b.vy + (b.wz * rx - b.wx * rz);
  const uzs = (b.vz || 0) + (b.wx * ry - b.wy * rx);
  // Teğetsel bileşen (normalden arındır)
  const d2 = uxs * nx + uys * ny;
  let tx = uxs - d2 * nx, ty = uys - d2 * ny, tz = uzs;
  const tn = Vec.len(tx, ty, tz);

  // Normal impuls
  b.vx += Jn * nx / M; b.vy += Jn * ny / M;

  // Teğetsel impuls (tutuş): Coulomb sınırı ve kaymayı durduran impulsun küçüğü
  if (tn > 1e-7) {
    const Jt = Math.min(P.muCushion * Jn, (2 / 7) * M * tn);
    const jx = -tx / tn * Jt, jy = -ty / tn * Jt, jz = -tz / tn * Jt;
    b.vx += jx / M; b.vy += jy / M; b.vz = (b.vz || 0) + jz / M;
    b.wx += (ry * jz - rz * jy) / I_BALL;
    b.wy += (rz * jx - rx * jz) / I_BALL;
    b.wz += (rx * jy - ry * jx) / I_BALL;
  }
  if ((b.vz || 0) > 0.05) b.z = Math.max(b.z, 1e-6);   // banttan zıpladı
  if (ev) ev.push({ t: +t.toFixed(3), type: 'cushion', id: b.id, v: +speed.toFixed(3) });
  return true;
}

// Cep çenesi (jaw) — küçük yuvarlak köşeler; çıngırdama buradan gelir.
function jaws(b, ev, t) {
  if (b.potted) return;
  for (const j of JAWS) {
    const dx = b.x - j.x, dy = b.y - j.y;
    const d = Vec.len2(dx, dy), min = R + j.r;
    if (!d || d >= min) continue;
    const nx = dx / d, ny = dy / d;
    b.x = j.x + nx * min; b.y = j.y + ny * min;
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) {
      const Jn = (1 + P.eJaw) * M * (-vn);
      b.vx += Jn * nx / M; b.vy += Jn * ny / M;
      if (ev) ev.push({ t: +t.toFixed(3), type: 'jaw', id: b.id });
    }
  }
}

function pocketCheck(b, shot, ev, t) {
  if (b.potted) return;
  for (const p of POCKET_DEFS) {
    if (Vec.len2(b.x - p.x, b.y - p.y) < p.cap) {
      b.potted = true; b.vx = b.vy = b.vz = 0; b.wx = b.wy = b.wz = 0; b.z = 0;
      shot.potted.push(b.id);
      if (ev) ev.push({ t: +t.toFixed(3), type: 'pot', id: b.id });
      return;
    }
  }
}

// ===========================================================================
//  5) ÇÖZÜCÜ  —  sabit adım + kare kaydı
// ===========================================================================
function simulate(st, shot) {
  const balls = st.balls;
  const ev = shot.events;
  const frameEvery = Math.max(1, Math.round(1 / (P.frameHz * P.dt)));
  const maxSteps = Math.ceil(P.maxTime / P.dt);

  const snap = force => {
    if (!force && shot.frames.length >= P.maxFrames) return;
    shot.frames.push(balls.map(b => b.potted ? null
      : [px1(toPxX(b.x)), px1(toPxY(b.y)), px1((b.z || 0) * S)]));
  };
  snap(true);

  let steps = 0, moving = true;
  while (moving && steps < maxSteps) {
    steps++;
    const t = steps * P.dt;

    moving = false;
    for (const b of balls) { if (stepBall(b, P.dt)) moving = true; }

    // Temaslar: konum düzeltmeli iki geçiş (kümelerde kararlılık için)
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < balls.length; i++) {
        const a = balls[i];
        if (a.potted) continue;
        for (let j = i + 1; j < balls.length; j++) {
          const b = balls[j];
          if (b.potted) continue;
          if (a.vx === 0 && a.vy === 0 && b.vx === 0 && b.vy === 0 &&
              a.z === 0 && b.z === 0 && pass > 0) continue;
          if (ballBall(a, b, pass === 0 ? ev : null, t)) moving = true;
        }
      }
    }
    for (const b of balls) {
      if (b.potted) continue;
      if (cushion(b, ev, t)) moving = true;
      jaws(b, ev, t);
      pocketCheck(b, shot, ev, t);
      // Güvenlik ağı: sayısal bir kaçış olursa topu masaya geri al.
      if (!b.potted) {
        if (b.x < -0.15 || b.x > P.tableLength + 0.15 || b.y < -0.15 || b.y > P.tableWidth + 0.15) {
          b.x = Math.min(P.tableLength - R, Math.max(R, b.x));
          b.y = Math.min(P.tableWidth - R, Math.max(R, b.y));
          b.vx *= 0.2; b.vy *= 0.2;
        }
      }
      if (!b.potted && !shot.firstHit && b.id !== 'cue') { /* ilk temas aşağıda */ }
    }
    if (steps % frameEvery === 0) snap(false);
    if (shot.frames.length >= P.maxFrames && !moving) break;
  }
  snap(true);
  shot.steps = steps;
  shot.duration = +(steps * P.dt).toFixed(3);
}

// ===========================================================================
//  6) 8-TOP KURALLARI  (dış API eskisiyle aynı)
// ===========================================================================
function rack() {
  const L = P.tableLength, W = P.tableWidth;
  const balls = [{ id: 'cue', n: 0, type: 'cue', x: L * 0.25, y: W / 2, z: 0, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, potted: false }];
  const order = [1, 9, 2, 10, 8, 3, 11, 4, 12, 5, 6, 13, 7, 14, 15];
  const apexX = L * 0.75, apexY = W / 2;
  const rowGap = 2 * R * Math.cos(Math.PI / 6) * 1.002;   // √3·R
  const colGap = 2 * R * 1.002;
  let k = 0;
  // Gerçek hayatta HİÇBİR ırk kusursuz değildir: toplar arasında onda bir
  // milimetrelik boşluklar kalır ve her açılış vuruşu bu yüzden farklı
  // dağılır. Bu mikro dağınıklık olmadan her açılış birebir aynı sonucu
  // verirdi (motor tümüyle belirlenimci).
  const jit = () => (Math.random() - 0.5) * 0.0003;   // ±0,15 mm
  for (let row = 0; row < 5; row++) {
    for (let j = 0; j <= row; j++) {
      const n = order[k++];
      balls.push({
        id: String(n), n,
        type: n === 8 ? 'eight' : n < 8 ? 'solid' : 'stripe',
        x: apexX + row * rowGap + jit(),
        y: apexY + (j - row / 2) * colGap + jit(),
        z: 0, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, potted: false
      });
    }
  }
  return balls;
}

function init() {
  return {
    balls: rack(), turn: 0, status: 'playing', winner: null,
    groups: [null, null], shots: 0, score: [0, 0], lastShot: null, table: C
  };
}

function remaining(st, type) { return st.balls.some(b => !b.potted && b.type === type); }

// Beyaz topu güvenli bir noktaya koy (faul sonrası). Eski motor topu
// koşulsuz baş noktaya koyuyordu; orası doluysa toplar İÇ İÇE GEÇİYORDU.
function respotCue(st) {
  const cue = st.balls.find(b => b.id === 'cue');
  const free = (x, y) => st.balls.every(b => b === cue || b.potted || Vec.len2(b.x - x, b.y - y) > 2 * R * 1.05) &&
    x > R && x < P.tableLength - R && y > R && y < P.tableWidth - R;
  const hx = P.tableLength * 0.25, hy = P.tableWidth / 2;
  if (free(hx, hy)) { cue.x = hx; cue.y = hy; }
  else {
    let placed = false;
    for (let ring = 1; ring <= 40 && !placed; ring++) {
      for (let a = 0; a < 16 && !placed; a++) {
        const ang = a * Math.PI / 8, d = ring * R * 0.6;
        const x = hx + Math.cos(ang) * d, y = hy + Math.sin(ang) * d;
        if (free(x, y)) { cue.x = x; cue.y = y; placed = true; }
      }
    }
    if (!placed) { cue.x = hx; cue.y = hy; }
  }
  cue.potted = false; cue.z = 0;
  cue.vx = cue.vy = cue.vz = cue.wx = cue.wy = cue.wz = 0;
  return [px1(toPxX(cue.x)), px1(toPxY(cue.y))];
}

/**
 * Atış yap.
 *   shoot(st, seat, angle, power [, opts])     ← eski çağrı biçimi (uyumlu)
 *   shoot(st, seat, { angle, power, spinX, spinY, elevation })
 *
 *   angle      : tuval açısı (atan2(dy, dx), y AŞAĞI) — istemciyle aynı
 *   power      : 0..1
 *   spinX      : yan falso (english), −0.5..0.5 (R cinsinden; + sağ)
 *   spinY      : üst/alt falso, −0.5..0.5 (+ üst = takip, − alt = çekme)
 *   elevation  : ısteka yükseklik açısı (radyan, 0..60°) — masse/piqué
 */
function shoot(st, seat, angle, power, opts) {
  if (!st || st.status !== 'playing') return { ok: false, reason: 'finished' };
  if (seat !== st.turn) return { ok: false, reason: 'not_your_turn' };

  let o = opts || {};
  if (angle && typeof angle === 'object') { o = angle; angle = o.angle; power = o.power; }
  angle = Number(angle); power = Number(power);
  if (!Number.isFinite(angle) || !Number.isFinite(power) || power <= 0 || power > 1) {
    return { ok: false, reason: 'bad_shot' };
  }
  const cue = st.balls.find(b => b.id === 'cue');
  if (!cue || cue.potted) return { ok: false, reason: 'cue_unavailable' };

  const spinX = Math.max(-P.maxTipOffset, Math.min(P.maxTipOffset, Number(o.spinX) || 0));
  const spinY = Math.max(-P.maxTipOffset, Math.min(P.maxTipOffset, Number(o.spinY) || 0));
  const elevation = Math.max(0, Math.min(P.maxElevation, Number(o.elevation) || 0));

  // Tuval açısı (y aşağı) → fizik açısı (y yukarı)
  const th = -angle;
  const k = cueStrike(th, power, spinX, spinY, elevation);

  cue.vx = k.vx; cue.vy = k.vy; cue.vz = Math.max(0, k.vz);
  cue.wx = k.wx; cue.wy = k.wy; cue.wz = k.wz;
  if (cue.vz > 0) cue.z = 1e-6;

  const shot = {
    seat, firstHit: null, railAfterContact: false, potted: [], foul: false,
    frames: [], events: [], cueSpeed: +k.cueSpeed.toFixed(3),
    spin: { x: spinX, y: spinY, elevation: +elevation.toFixed(3) },
    squirtDeg: +(k.squirt * 180 / Math.PI).toFixed(2)
  };

  simulate(st, shot);

  // İlk temas ve temas SONRASI bant (kural denetimi için olay akışından)
  for (const e of shot.events) {
    if (!shot.firstHit && e.type === 'ball' && (e.a === 'cue' || e.b === 'cue')) {
      shot.firstHit = e.a === 'cue' ? e.b : e.a;
    } else if (shot.firstHit && e.type === 'cushion') {
      shot.railAfterContact = true;
    }
  }

  // ----------------------------- KURALLAR -----------------------------
  const first = st.balls.find(b => b.id === shot.firstHit);
  const group = st.groups[seat];
  const scratch = shot.potted.includes('cue');
  shot.foul = scratch || !first ||
    !!(group && first.type !== group && !(first.id === '8' && !remaining(st, group))) ||
    (!shot.railAfterContact && !shot.potted.length);

  const colors = shot.potted.map(id => st.balls.find(b => b.id === id))
    .filter(b => b && (b.type === 'solid' || b.type === 'stripe'));
  if (!st.groups[0] && colors.length) {
    st.groups[seat] = colors[0].type;
    st.groups[1 - seat] = colors[0].type === 'solid' ? 'stripe' : 'solid';
  }

  const eight = shot.potted.includes('8');
  if (eight) {
    const legal = group && !remaining(st, group) && !shot.foul;
    st.status = 'finished';
    st.winner = legal ? seat : 1 - seat;
    st.result = { reason: 'finished', winnerSeat: st.winner };
  } else {
    const legalPocket = colors.some(b => !group || b.type === group);
    if (shot.foul || !legalPocket) st.turn = 1 - seat;
  }
  if (scratch) shot.cueRespot = respotCue(st);

  st.shots++;
  st.score = st.groups[0]
    ? [7 - st.balls.filter(b => !b.potted && b.type === st.groups[0]).length,
       7 - st.balls.filter(b => !b.potted && b.type === st.groups[1]).length]
    : [0, 0];
  st.lastShot = shot;
  return { ok: true, shot, state: st, winner: st.winner };
}

/**
 * Topların İSTEMCİ (piksel) görünümü. Motor içeride METRE ile çalışır;
 * istemci ise tuval pikseliyle çizer. Dönüşüm YALNIZCA burada ve kare
 * kaydında yapılır — iki taraf birbirinden kopamaz.
 */
function viewBalls(st) {
  return st.balls.map(b => ({
    id: b.id, n: b.n, type: b.type, potted: !!b.potted,
    x: px1(toPxX(b.x)), y: px1(toPxY(b.y)), z: px1((b.z || 0) * S)
  }));
}

module.exports = {
  init, shoot, viewBalls, constants: C, physics: P,
  // test/teşhis için iç fonksiyonlar
  _internals: { cueStrike, stepBall, ballBall, cushion, simulate, respotCue, toPxX, toPxY, R, M, I_BALL }
};
