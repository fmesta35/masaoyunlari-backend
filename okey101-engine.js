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
 *   - Sahte okeyler göstergenin kimliğini alır (normal taş gibi oynanır)
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
 *   - Elde kalan gerçek okeyin cezası 50'dir (üzerindeki sayı değil).
 *   - HİÇ AÇMAMIŞ oyuncunun el cezası İKİYE KATLANIR. Açmayı anlamlı kılan
 *     kural budur; olmazsa beklemek bedava olurdu.
 *   - Maç, bir oyuncunun ceza toplamı sınıra (varsayılan 101) ULAŞINCA biter;
 *     kazanan EN DÜŞÜK toplama sahip oyuncudur.
 *   - Deste biterse el berabere kapanır, kimseye ceza yazılmaz.
 * ========================================================================= */

const COLORS = ['t-red', 't-black', 't-blue', 't-yellow'];
const CEZA_SINIRI = 101;      // maç bu ceza toplamında biter
const ACMA_PUANI = 101;       // el açmak için gereken en az per toplamı
const CIFT_ACMA_ADEDI = 5;    // çift açmada gereken çift sayısı
const OKEY_CEZASI = 50;       // elde kalan gerçek okeyin ceza puanı
const ACMAYAN_CARPANI = 2;    // hiç açmamış oyuncunun cezası ×2

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
    else { t.n = indicator.n; t.dc = indicator.c; }   // sahte okey göstergeye bürünür
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
  if (state.opened[seat]) return { ok: false, reason: 'already_opened' };
  if (!Array.isArray(gruplar) || !gruplar.length) return { ok: false, reason: 'no_melds' };

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

  if (cift) {
    const d = ciftDogrula(obekler, state.realOkey);
    if (!d.ok) { eleGeriKoy(state, seat, alinan); return { ok: false, reason: 'bad_pairs', detail: d.sebep }; }
  } else {
    let toplam = 0;
    for (const o of obekler) {
      const d = perDogrula(o, state.realOkey);
      if (!d.ok) { eleGeriKoy(state, seat, alinan); return { ok: false, reason: 'bad_meld', detail: d.sebep }; }
      toplam += d.puan;
    }
    if (toplam < ACMA_PUANI) {
      eleGeriKoy(state, seat, alinan);
      return { ok: false, reason: 'below_101', puan: toplam, gereken: ACMA_PUANI };
    }
  }

  obekler.forEach(o => {
    const tur = cift ? 'cift' : perDogrula(o, state.realOkey).tur;
    state.melds.push({ id: 'm' + (++state.meldSeq), seat, tur, tiles: o });
  });
  state.opened[seat] = true;
  return { ok: true, melds: state.melds.length, puan: cift ? null : obekler.reduce((a, o) => a + perDogrula(o, state.realOkey).puan, 0) };
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

/* TAŞ ATMA — sırayı devreder; el boşaldıysa oyuncu bitirir. */
function discard(state, seat, tileId) {
  if (state.finished) return { ok: false, reason: 'round_over' };
  if (state.turn !== seat) return { ok: false, reason: 'not_your_turn' };
  if (state.phase !== 'discard') return { ok: false, reason: 'draw_first' };
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
    elBitti(state, seat);
    return { ok: true, tile: t, finished: true, result: state.result };
  }
  state.turn = nextSeatOf(state, seat);
  state.phase = 'draw';
  return { ok: true, tile: t };
}

/* ---------------------------------------------------------------------------
 * EL SONU VE PUANLAMA
 * ------------------------------------------------------------------------ */
function elCezasi(state, seat) {
  const el = state.hands[seat] || [];
  let ceza = el.reduce((a, t) => a + cezaDegeri(t, state.realOkey), 0);
  if (!state.opened[seat]) ceza *= ACMAYAN_CARPANI;
  return ceza;
}

function elBitti(state, kazanan) {
  const cezalar = {};
  state.seats.forEach(s => { cezalar[s] = (s === kazanan) ? 0 : elCezasi(state, s); });
  state.seats.forEach(s => { state.scores[s] = (state.scores[s] || 0) + cezalar[s]; });
  state.finished = true;
  state.result = { winner: kazanan, winType: 'finish', cezalar };
}

function elBerabere(state) {
  state.finished = true;
  state.result = { winner: null, winType: 'draw', cezalar: Object.fromEntries(state.seats.map(s => [s, 0])) };
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
  freshDeck, shuffle, isOkey, cezaDegeri, renkOf,
  perDogrula, ciftDogrula,
  startRound, prevSeatOf, nextSeatOf,
  drawFromDeck, drawFromPrev, openMelds, addToMeld, discard,
  elCezasi, elBitti, elBerabere, macBittiMi
};
