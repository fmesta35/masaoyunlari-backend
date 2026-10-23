'use strict';

/* ============================================================================
 * GameVerse — 101 OKEY MOTORU (saf mantık, soket yok)
 * ============================================================================
 * Kullanıcının ilettiği kural metnine göre yazıldı. ÖNEMLİ: bu motor klasik
 * okey-engine.js'in YERİNE GEÇMEZ, yanında durur. Klasik "Okey" masaları eski
 * motorla (14/15 taş, eli tek seferde bitir) oynanmaya devam eder; bu dosya
 * yalnız "101 Okey" masaları içindir. Kullanıcı kararı: "Okey klasik kalsın,
 * 101 değişsin."
 *
 * OYNANIŞ
 *   - 106 taş: 4 renk × 1-13 × 2 + 2 sahte okey
 *   - Gösterge desteden çekilir, kimseye dağıtılmaz
 *   - Gerçek okey = gösterge + 1 (gösterge 13 ise aynı rengin 1'i)
 *   - Sahte okeyler OKEYİN kimliğini alır (gösterge+1; normal taş gibi oynanır).
 *     Eskiden göstergenin kimliğini alıyordu: gösterge mavi 13 iken masada
 *     ÜÇ tane mavi 13 görünüyordu (1 gösterge + 1 gerçek + 2 sahte). Doğru
 *     dağılım: göstergeyle aynı taştan destede yalnız 1 tane kalır; okeyin
 *     sayısından 2 gerçek okey (joker) + 2 sahte okey (o sayı yerine) olur.
 *   - Dağıtım: BAŞLAYAN 22, diğerleri 21 taş. Başlayan çekmeden bir taş atar.
 *   - Sıra: taş al (desteden ya da ÖNCEKİ oyuncunun attığından) → istersen
 *     aç / işle → bir taş at
 *   - EL AÇMA: ilk kez masaya taş koyarken perlerin toplamı EN AZ 101 olmalı.
 *     Alternatif: 5 ÇİFT ile açma (puan şartı aranmaz).
 *   - İŞLEME: açmış olan oyuncu, masadaki KENDİ ya da BAŞKASININ perlerine
 *     uyan taşlarını ekleyebilir. Açmadan işlenemez.
 *   - BİTİŞ: açmış bir oyuncu bütün taşlarını masaya koyup son taşını
 *     attığında el biter.
 *   - PUAN: el sonunda bitirmeyenlerin elinde kalan taşların değeri CEZA
 *     puanı olarak yazılır. Amaç toplamı DÜŞÜK tutmaktır.
 *
 * BELİRLEDİĞİMİZ KURALLAR (kullanıcı: "Oyununuzda tek bir kural seti
 * belirlemek önemli"). Bunlar yaygın uygulamalardan seçildi ve kurallar
 * sayfasında birebir aynı şekilde yazılıdır:
 *   - Bir perde EN FAZLA 1 gerçek okey kullanılabilir. (Bazı platformlar 2'ye
 *     izin verir; tek okeyli kural hem anlatması hem doğrulaması daha açık ve
 *     elde iki okey varken ikisini aynı pere gömme sömürüsünü kapatıyor.)
 *   - Seride 13'ten 1'e dönüş YOKTUR (12-13-1 geçersiz).
 *   - Bir kütte aynı renk iki kez bulunamaz.
 *
 * PUANLAMA — standart 101 kuralları (kullanıcı isteği: "okey ile bitme,
 * çifte bitme vs. normal bitmekten farklı olmalı, normal 101 kurallarına
 * göre ayarla"). Çarpan m: normal 1 · son taş OKEY atılarak bitiş ×2 ·
 * ÇİFTLE açıp bitiş ×2 · ikisi birden ×4.
 *   - Biten oyuncu:            −101 × m
 *   - Perle açmış oyuncu:      elindeki taş toplamı × m
 *   - Çiftle açmış oyuncu:     elindeki taş toplamı × 2m
 *   - Hiç açmamış oyuncu:      202 × min(m, 2)  (202 / 404)
 *   - ELDEN BİTİŞ (hiç kimse açmadan tek seferde açıp biten): biten −202
 *     (okeyle −404), diğer herkes 404 (okeyle 808).
 *   - Elde kalan gerçek okey 101 sayılır.
 *   - Deste biterse el berabere kapanır; elinde okey kalan her okey için
 *     101 ceza yazılır, diğerlerine yazılmaz.
 *   - Maç, masada belirlenen EL SAYISI oynanınca biter; EN DÜŞÜK toplam
 *     kazanır (puanlar eksiye düşebilir).
 *   - Açan oyuncu sonraki turlarda masaya YENİ per de koyabilir (101 şartı
 *     yalnız ilk açılışta); çiftle açan yalnız yeni ÇİFT koyabilir.
 * ========================================================================= */

const COLORS = ['t-red', 't-black', 't-blue', 't-yellow'];
const CEZA_SINIRI = 101;      // maç bu ceza toplamında biter
const ACMA_PUANI = 101;       // el açmak için gereken en az per toplamı
const CIFT_ACMA_ADEDI = 5;    // çift açmada gereken çift sayısı
const OKEY_CEZASI = 101;      // elde kalan gerçek okeyin ceza puanı (101 kuralı)
const ACMAYAN_CARPANI = 2;    // (eski) — açmayan artık sabit 202 alır, bkz. elBitti
const BITEN_PUANI = -101;     // eli bitirenin puanı (çarpanla)
const ACMAYAN_CEZASI = 202;   // hiç açmamış oyuncunun cezası (çarpan en fazla ×2)
const ELDEN_CEZASI = 404;     // elden bitişte diğer herkesin cezası (okeyle ×2)

function freshDeck(idPrefix) {
  const d = [];
  let id = 0;
  const px = idPrefix || 'k101';
  for (let cp = 0; cp < 2; cp++) {
    for (const c of COLORS) {
      for (let n = 1; n <= 13; n++) d.push({ id: `${px}-${id++}`, n, c, isFJ: false });
    }
  }
  d.push({ id: `${px}-${id++}`, n: 0, c: 't-joker', isFJ: true });
  d.push({ id: `${px}-${id++}`, n: 0, c: 't-joker', isFJ: true });
  return d;
}

function shuffle(arr, rng) {
  const rand = rng || Math.random;
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* Gerçek okey mi? Sahte okey (isFJ) göstergenin yerine geçen NORMAL bir
   taştır, joker DEĞİLDİR — bu ayrım okeyde sık karıştırılır. */
function isOkey(t, realOkey) {
  if (!t || !realOkey || t.isFJ) return false;
  return t.c === realOkey.c && t.n === realOkey.n;
}

/* Sahte okeyin GERÇEK rengi: taşın üstünde joker resmi var ama oyunda
   göstergenin yerine geçer, yani göstergenin rengindedir (t.dc). Doğrulama
   bunu atlarsa sahte okey hiçbir seriye giremez. */
function renkOf(t) { return (t && t.isFJ) ? t.dc : (t && t.c); }

/* Taşın ceza değeri: gerçek okey 50, diğerleri üzerindeki sayı (sahte okey
   göstergenin sayısını taşır). */
function cezaDegeri(t, realOkey) {
  if (!t) return 0;
  if (isOkey(t, realOkey)) return OKEY_CEZASI;
  return Number(t.n) || 0;
}

/* ---------------------------------------------------------------------------
 * PER DOĞRULAMA — tek bir per (masaya konan taş öbeği)
 * Klasik motordaki doğrulayıcı BÜTÜN ELİ çözmeye çalışır; 101'de perler
 * masaya TEK TEK konduğu için öbek bazlı bir doğrulayıcı gerekiyor.
 * Dönen değer: { ok, tur:'kut'|'seri', puan } ya da { ok:false, sebep }
 * ------------------------------------------------------------------------ */
function perDogrula(tiles, realOkey) {
  const ts = (tiles || []).filter(Boolean);
  if (ts.length < 3) return { ok: false, sebep: 'per en az 3 taş olmalı' };
  const okeyler = ts.filter(t => isOkey(t, realOkey));
  const dogal = ts.filter(t => !isOkey(t, realOkey));
  if (okeyler.length > 1) return { ok: false, sebep: 'bir perde en fazla 1 okey kullanılabilir' };
  if (dogal.length < 2) return { ok: false, sebep: 'perde en az 2 gerçek taş olmalı' };

  // --- KÜT: aynı sayı, farklı renkler ---
  const ayniSayi = dogal.every(t => t.n === dogal[0].n);
  if (ayniSayi && ts.length <= 4) {
    const renkler = new Set(dogal.map(renkOf));
    if (renkler.size === dogal.length) {
      // Okey, kullanılmayan bir rengi temsil eder.
      return { ok: true, tur: 'kut', puan: dogal[0].n * ts.length };
    }
    if (ts.length === 3 || ts.length === 4) return { ok: false, sebep: 'kütte aynı renk iki kez olamaz' };
  }

  // --- SERİ: aynı renk, ardışık sayılar, 13→1 dönüşü YOK ---
  const renk = renkOf(dogal[0]);
  if (!dogal.every(t => renkOf(t) === renk)) {
    return { ok: false, sebep: 'per ne küt ne seri: renkler ve sayılar uymuyor' };
  }
  const sayilar = dogal.map(t => t.n).sort((a, b) => a - b);
  for (let i = 1; i < sayilar.length; i++) {
    if (sayilar[i] === sayilar[i - 1]) return { ok: false, sebep: 'seride aynı sayı iki kez olamaz' };
  }
  const enKucuk = sayilar[0], enBuyuk = sayilar[sayilar.length - 1];
  const aralik = enBuyuk - enKucuk + 1;
  const bosluk = aralik - sayilar.length;          // seriyi tamamlamak için gereken taş
  if (bosluk > okeyler.length) return { ok: false, sebep: 'seride boşluk var' };
  if (aralik + (okeyler.length - bosluk) > 13) return { ok: false, sebep: 'seri 13\'ü aşamaz' };

  /* Puan: okey, serinin HANGİ boşluğunu doldurduysa o sayıyı taşır. Boşluk
     yoksa okey seriyi uçtan uzatır; oyuncunun lehine olan uç (büyük sayı)
     seçilir ama 13'ü aşamaz. */
  let puan = sayilar.reduce((a, b) => a + b, 0);
  if (okeyler.length) {
    if (bosluk === 1) {
      const toplamAralik = (enKucuk + enBuyuk) * aralik / 2;
      puan = toplamAralik;                          // boşluktaki sayı eklenmiş olur
    } else {
      puan += (enBuyuk < 13) ? enBuyuk + 1 : enKucuk - 1;
    }
  }
  return { ok: true, tur: 'seri', puan };
}

/* 5 çift ile açma: 10 taş, her ikisi AYNI renk ve sayı. Gerçek okey bir çifti
   tamamlayabilir (yalnız bir çiftte, perdeki kuralla aynı mantık). */
function ciftDogrula(gruplar, realOkey) {
  if (!Array.isArray(gruplar) || gruplar.length < CIFT_ACMA_ADEDI) {
    return { ok: false, sebep: CIFT_ACMA_ADEDI + ' çift gerekiyor' };
  }
  for (const g of gruplar) {
    const ts = (g || []).filter(Boolean);
    if (ts.length !== 2) return { ok: false, sebep: 'her çift 2 taş olmalı' };
    const okeyler = ts.filter(t => isOkey(t, realOkey));
    const dogal = ts.filter(t => !isOkey(t, realOkey));
    if (okeyler.length > 1) return { ok: false, sebep: 'çift iki okeyden oluşamaz' };
    if (okeyler.length === 1) continue;             // okey + taş = geçerli çift
    if (renkOf(dogal[0]) !== renkOf(dogal[1]) || dogal[0].n !== dogal[1].n) {
      return { ok: false, sebep: 'çift aynı renk ve aynı sayı olmalı' };
    }
  }
  return { ok: true };
}

function tekCiftGecerli(ts, realOkey) {
  ts = (ts || []).filter(Boolean);
  if (ts.length !== 2) return false;
  const okeyler = ts.filter(t => isOkey(t, realOkey));
  if (okeyler.length > 1) return false;
  if (okeyler.length === 1) return true;
  return renkOf(ts[0]) === renkOf(ts[1]) && ts[0].n === ts[1].n;
}

/* ---------------------------------------------------------------------------
 * EL (TUR) KURULUMU
 * ------------------------------------------------------------------------ */
function startRound(roundNo, seats, scores, rng, starterSeat) {
  const deck = shuffle(freshDeck(`k101-r${roundNo}`), rng);
  let indicator = null;
  for (let i = 0; i < deck.length; i++) {
    if (!deck[i].isFJ) { indicator = deck.splice(i, 1)[0]; break; }
  }
  if (!indicator) indicator = { id: 'k101-ind', c: 't-red', n: 1, isFJ: false };
  const realOkey = { c: indicator.c, n: indicator.n >= 13 ? 1 : indicator.n + 1 };

  deck.forEach(t => {
    if (!t.isFJ) t.isOkey = isOkey(t, realOkey);
    else { t.n = realOkey.n; t.dc = realOkey.c; }     // sahte okey OKEYE bürünür (gösterge+1)
  });

  const starter = (starterSeat !== undefined && seats.includes(starterSeat))
    ? starterSeat
    : seats[Math.floor((rng ? rng() : Math.random()) * seats.length)];

  const hands = {};
  hands[starter] = deck.splice(0, 22);
  seats.forEach(s => { if (s !== starter) hands[s] = deck.splice(0, 21); });

  return {
    round: roundNo,
    seats: seats.slice(),
    starter,
    turn: starter,
    phase: 'discard',                 // 22 taşlı başlayan ÇEKMEDEN atar
    deck,
    indicator,
    realOkey: { c: realOkey.c, n: realOkey.n },
    hands,
    discardPiles: Object.fromEntries(seats.map(s => [s, []])),
    melds: [],                        // masadaki açık perler: {id, seat, tur, tiles}
    opened: Object.fromEntries(seats.map(s => [s, false])),
    acilisTuru: Object.fromEntries(seats.map(s => [s, null])),   // 'per' | 'cift'
    acilisHamle: Object.fromEntries(seats.map(s => [s, null])),  // hangi turda açtı (elden bitiş için)
    hamleNo: 0,
    scores: Object.assign({}, scores),
    finished: false,
    result: null,
    meldSeq: 0
  };
}

function prevSeatOf(state, seat) {
  const i = state.seats.indexOf(seat);
  return i === -1 ? null : state.seats[(i - 1 + state.seats.length) % state.seats.length];
}
function nextSeatOf(state, seat) {
  const i = state.seats.indexOf(seat);
  return i === -1 ? null : state.seats[(i + 1) % state.seats.length];
}

function elindenAl(state, seat, tileIds) {
  const el = state.hands[seat] || [];
  const bulunan = [];
  for (const id of tileIds) {
    const i = el.findIndex(t => t.id === id);
    if (i === -1) return null;                 // taş oyuncuda değil
    bulunan.push(el[i]);
    el.splice(i, 1);
  }
  return bulunan;
}
function eleGeriKoy(state, seat, tiles) { (state.hands[seat] || []).push(...tiles); }

/* ---------------------------------------------------------------------------
 * EYLEMLER
 * ------------------------------------------------------------------------ */
function drawFromDeck(state, seat) {
  if (state.finished) return { ok: false, reason: 'round_over' };
  if (state.turn !== seat) return { ok: false, reason: 'not_your_turn' };
  if (state.phase !== 'draw') return { ok: false, reason: 'must_discard' };
  if (!state.deck.length) { elBerabere(state); return { ok: true, deckEmpty: true }; }
  const t = state.deck.shift();
  if (!t.isFJ) t.isOkey = isOkey(t, state.realOkey);
  state.hands[seat].push(t);
  state.phase = 'discard';
  return { ok: true, tile: t, deckLeft: state.deck.length };
}

function drawFromPrev(state, seat) {
  if (state.finished) return { ok: false, reason: 'round_over' };
  if (state.turn !== seat) return { ok: false, reason: 'not_your_turn' };
  if (state.phase !== 'draw') return { ok: false, reason: 'must_discard' };
  /* 101 KURALI: AÇMADAN YERDEN TAŞ ALINMAZ.
     Soldaki oyuncunun attığı taşı ancak EL AÇMIŞ oyuncu alabilir; henüz
     açmamış oyuncunun tek seçeneği ortadaki desteden çekmektir. Bu kural
     101'i klasik okeyden ayıran temel kısıtlardan biridir: açılmadan yerden
     toplamak, oyuncunun elini bedavaya tamamlamasını sağlardı.
     (Klasik Okey masalarında bu kısıt YOKTUR — okey-engine.js'e dokunulmadı.) */
  if (!state.opened[seat]) return { ok: false, reason: 'acmadan_yerden_alinmaz' };
  const prev = prevSeatOf(state, seat);
  const pile = state.discardPiles[prev] || [];
  if (!pile.length) return { ok: false, reason: 'empty_pile' };
  const t = pile.pop();
  state.hands[seat].push(t);
  state.phase = 'discard';
  return { ok: true, tile: t, from: prev };
}

/* EL AÇMA — gruplar: [[tileId,...], ...]. cift=true ise 5 çift açılışı. */
function openMelds(state, seat, gruplar, cift) {
  if (state.finished) return { ok: false, reason: 'round_over' };
  if (state.turn !== seat) return { ok: false, reason: 'not_your_turn' };
  if (state.phase !== 'discard') return { ok: false, reason: 'draw_first' };
  if (!Array.isArray(gruplar) || !gruplar.length) return { ok: false, reason: 'no_melds' };
  /* AÇMIŞ oyuncu sonraki turlarda masaya YENİ per koyabilir: 101 şartı
     aranmaz ama açılış türü korunur (çiftle açan yalnız çift, perle açan
     yalnız per koyar). */
  const sonradan = !!state.opened[seat];
  if (sonradan) {
    const tur = state.acilisTuru && state.acilisTuru[seat];
    if (tur === 'cift' && !cift) return { ok: false, reason: 'cift_acan_per_koyamaz' };
    if (tur === 'per' && cift) return { ok: false, reason: 'per_acan_cift_koyamaz' };
  }

  const tumIdler = [].concat(...gruplar);
  if (new Set(tumIdler).size !== tumIdler.length) return { ok: false, reason: 'duplicate_tile' };
  const alinan = elindenAl(state, seat, tumIdler);
  if (!alinan) return { ok: false, reason: 'tile_not_in_hand' };

  /* Son taşı da koyup elini boşaltmak YASAK: oyuncu atacak bir taş
     bırakmalı. Yoksa "aç ve aynı anda bit" oluyor, atma adımı kayboluyordu. */
  if (!state.hands[seat].length) { eleGeriKoy(state, seat, alinan); return { ok: false, reason: 'need_discard_tile' }; }

  // id -> taş eşlemesi (gruplar id taşıyor)
  const harita = new Map(alinan.map(t => [t.id, t]));
  const obekler = gruplar.map(g => g.map(id => harita.get(id)));

  if (cift && sonradan) {
    /* Sonradan konan çiftler: adet şartı yok, her çift tek tek sınanır. */
    for (const o of obekler) {
      if (!tekCiftGecerli(o, state.realOkey)) { eleGeriKoy(state, seat, alinan); return { ok: false, reason: 'bad_pairs', detail: 'her çift aynı renk ve aynı sayı olmalı' }; }
    }
  } else if (cift) {
    const d = ciftDogrula(obekler, state.realOkey);
    if (!d.ok) { eleGeriKoy(state, seat, alinan); return { ok: false, reason: 'bad_pairs', detail: d.sebep }; }
  } else {
    let toplam = 0;
    for (const o of obekler) {
      const d = perDogrula(o, state.realOkey);
      if (!d.ok) { eleGeriKoy(state, seat, alinan); return { ok: false, reason: 'bad_meld', detail: d.sebep }; }
      toplam += d.puan;
    }
    if (!sonradan && toplam < ACMA_PUANI) {
      eleGeriKoy(state, seat, alinan);
      return { ok: false, reason: 'below_101', puan: toplam, gereken: ACMA_PUANI };
    }
  }

  obekler.forEach(o => {
    const tur = cift ? 'cift' : perDogrula(o, state.realOkey).tur;
    state.melds.push({ id: 'm' + (++state.meldSeq), seat, tur, tiles: o });
  });
  if (!sonradan) {
    state.opened[seat] = true;
    state.acilisTuru[seat] = cift ? 'cift' : 'per';
    state.acilisHamle[seat] = state.hamleNo;
  }
  return { ok: true, sonradan, melds: state.melds.length, puan: cift ? null : obekler.reduce((a, o) => a + perDogrula(o, state.realOkey).puan, 0) };
}

/* İŞLEME — açmış oyuncu, masadaki bir pere elinden taş ekler. */
function addToMeld(state, seat, meldId, tileId) {
  if (state.finished) return { ok: false, reason: 'round_over' };
  if (state.turn !== seat) return { ok: false, reason: 'not_your_turn' };
  if (state.phase !== 'discard') return { ok: false, reason: 'draw_first' };
  if (!state.opened[seat]) return { ok: false, reason: 'not_opened' };
  const meld = state.melds.find(m => m.id === meldId);
  if (!meld) return { ok: false, reason: 'no_meld' };
  if (meld.tur === 'cift') return { ok: false, reason: 'pairs_locked' };  // çift perlerine işlenmez

  const alinan = elindenAl(state, seat, [tileId]);
  if (!alinan) return { ok: false, reason: 'tile_not_in_hand' };
  if (!state.hands[seat].length) { eleGeriKoy(state, seat, alinan); return { ok: false, reason: 'need_discard_tile' }; }

  const yeni = meld.tiles.concat(alinan);
  const d = perDogrula(yeni, state.realOkey);
  if (!d.ok) { eleGeriKoy(state, seat, alinan); return { ok: false, reason: 'bad_meld', detail: d.sebep }; }
  meld.tiles = yeni;
  return { ok: true, meldId, tur: d.tur };
}

/* İŞLEK TAŞ: masadaki (çift olmayan) bir pere uyan taş. 101 kuralı: işlek
   taş ATILAMAZ (son taş hariç). Atmaya çalışan 101 ceza alır, taş eline
   döner. Kural açmış/açmamış herkes için geçerlidir. */
function islekMeld(state, tile) {
  if (!tile) return null;
  for (const m of (state.melds || [])) {
    if (m.tur === 'cift') continue;
    if (perDogrula(m.tiles.concat([tile]), state.realOkey).ok) return m;
  }
  return null;
}
/* Otomatik oynayan (süre aşımı / bot) için GÜVENLİ atılacak taşlar: okey
   değil ve işlek değil. Boşsa çağıran istediğini seçer. */
function guvenliAtilacaklar(state, seat) {
  return (state.hands[seat] || []).filter(t => !isOkey(t, state.realOkey) && !islekMeld(state, t));
}

/* TAŞ ATMA — sırayı devreder; el boşaldıysa oyuncu bitirir.
   secenek.otomatik: süre aşımı / bot — işlek denetimi uygulanmaz (masa
   kilitlenmesin); çağıran zaten güvenli taşı seçer. */
function discard(state, seat, tileId, secenek) {
  if (state.finished) return { ok: false, reason: 'round_over' };
  if (state.turn !== seat) return { ok: false, reason: 'not_your_turn' };
  if (state.phase !== 'discard') return { ok: false, reason: 'draw_first' };
  const otomatik = !!(secenek && secenek.otomatik);
  const elde = (state.hands[seat] || []).find(x => x.id === tileId);
  if (!elde) return { ok: false, reason: 'tile_not_in_hand' };
  const sonTas = (state.hands[seat] || []).length === 1;
  let penalty = null;
  if (!sonTas && !otomatik) {
    if (isOkey(elde, state.realOkey)) {
      /* OKEY ATMAK: bitiş dışında gerçek okeyi atan 101 ceza alır (atış geçerli). */
      state.scores[seat] = (state.scores[seat] || 0) + OKEY_CEZASI;
      penalty = { seat, amount: OKEY_CEZASI, reason: 'real_okey_discarded' };
    } else {
      const m = islekMeld(state, elde);
      if (m) {
        state.scores[seat] = (state.scores[seat] || 0) + OKEY_CEZASI;
        return { ok: false, reason: 'islek_tas', meldId: m.id,
                 penalty: { seat, amount: OKEY_CEZASI, reason: 'islek_tas', tile: { n: elde.n, c: renkOf(elde) } } };
      }
    }
  }
  const alinan = elindenAl(state, seat, [tileId]);
  if (!alinan) return { ok: false, reason: 'tile_not_in_hand' };
  const t = alinan[0];
  state.discardPiles[seat].push(t);

  if (!state.hands[seat].length) {
    if (!state.opened[seat]) {
      // Açmadan bitilemez; taşı geri al (bu duruma normalde düşülemez).
      state.discardPiles[seat].pop();
      eleGeriKoy(state, seat, alinan);
      return { ok: false, reason: 'not_opened' };
    }
    elBitti(state, seat, { okeyle: isOkey(t, state.realOkey) });
    return { ok: true, tile: t, finished: true, result: state.result };
  }
  state.hamleNo = (state.hamleNo || 0) + 1;
  state.turn = nextSeatOf(state, seat);
  state.phase = 'draw';
  return { ok: true, tile: t, penalty };
}

/* ---------------------------------------------------------------------------
 * EL SONU VE PUANLAMA
 * ------------------------------------------------------------------------ */
/* Elde kalan taşların HAM toplamı (okey 101 sayılır). */
function elToplami(state, seat) {
  const el = state.hands[seat] || [];
  return el.reduce((a, t) => a + cezaDegeri(t, state.realOkey), 0);
}
/* Normal bitişteki (çarpansız) ceza — eski API, testler ve önizleme için. */
function elCezasi(state, seat) {
  if (!state.opened[seat]) return ACMAYAN_CEZASI;
  const ham = elToplami(state, seat);
  return (state.acilisTuru && state.acilisTuru[seat] === 'cift') ? ham * 2 : ham;
}

/* EL BİTTİ — standart 101 puanlaması (bkz. dosya başı). */
function elBitti(state, kazanan, secenek) {
  const okeyle = !!(secenek && secenek.okeyle);
  const ciftle = !!(state.acilisTuru && state.acilisTuru[kazanan] === 'cift');
  const baskaAcanVar = state.seats.some(s => s !== kazanan && state.opened[s]);
  const elden = !baskaAcanVar && state.acilisHamle && state.acilisHamle[kazanan] !== null &&
                state.acilisHamle[kazanan] === state.hamleNo;
  const m = (okeyle ? 2 : 1) * (ciftle ? 2 : 1);
  const cezalar = {};
  state.seats.forEach(s => {
    if (s === kazanan) { cezalar[s] = elden ? (okeyle ? -404 : -202) : BITEN_PUANI * m; return; }
    if (elden) { cezalar[s] = okeyle ? ELDEN_CEZASI * 2 : ELDEN_CEZASI; return; }
    if (!state.opened[s]) { cezalar[s] = ACMAYAN_CEZASI * Math.min(m, 2); return; }
    const ham = elToplami(state, s);
    const ciftAcan = state.acilisTuru && state.acilisTuru[s] === 'cift';
    cezalar[s] = ham * m * (ciftAcan ? 2 : 1);
  });
  state.seats.forEach(s => { state.scores[s] = (state.scores[s] || 0) + cezalar[s]; });
  state.finished = true;
  const winType = elden ? 'elden' : (okeyle && ciftle) ? 'cift_okey' : okeyle ? 'okey' : ciftle ? 'cift' : 'finish';
  state.result = { winner: kazanan, winType, carpan: elden ? null : m, okeyle, ciftle, elden, cezalar };
}

/* Deste bitti: el berabere. Elinde gerçek okey kalan her okey için 101. */
function elBerabere(state) {
  const cezalar = {};
  state.seats.forEach(s => {
    const okeySayisi = (state.hands[s] || []).filter(t => isOkey(t, state.realOkey)).length;
    cezalar[s] = okeySayisi * OKEY_CEZASI;
    state.scores[s] = (state.scores[s] || 0) + cezalar[s];
  });
  state.finished = true;
  state.result = { winner: null, winType: 'draw', cezalar };
}

/* Maç bitti mi? Ceza sınırına ULAŞAN varsa biter, EN DÜŞÜK toplam kazanır. */
function macBittiMi(scores, seats, sinir) {
  const limit = Number(sinir) || CEZA_SINIRI;
  const ulasan = seats.some(s => (scores[s] || 0) >= limit);
  if (!ulasan) return null;
  let en = Infinity, kazanan = null;
  seats.forEach(s => { const v = scores[s] || 0; if (v < en) { en = v; kazanan = s; } });
  return { winner: kazanan, score: en };
}

module.exports = {
  COLORS, CEZA_SINIRI, ACMA_PUANI, CIFT_ACMA_ADEDI, OKEY_CEZASI, ACMAYAN_CARPANI,
  BITEN_PUANI, ACMAYAN_CEZASI, ELDEN_CEZASI, elToplami,
  freshDeck, shuffle, isOkey, cezaDegeri, renkOf,
  perDogrula, ciftDogrula,
  startRound, prevSeatOf, nextSeatOf,
  drawFromDeck, drawFromPrev, openMelds, addToMeld, discard, islekMeld, guvenliAtilacaklar,
  elCezasi, elBitti, elBerabere, macBittiMi
};
