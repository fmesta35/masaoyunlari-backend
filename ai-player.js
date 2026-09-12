'use strict';

/*
 * GameVerse — İDARECİ YAPAY ZEKÂ (masayı terk eden oyuncunun yerine)
 * ==================================================================
 *
 * NEDEN VAR: 3–4 kişilik oyunlarda bir oyuncu masayı terk edince maç
 * çöküyordu. Kullanıcının kuralı: "yerine, oyun el sayısı tamamen
 * tamamlanana kadar idareten oynayan yapay zeka devralır." Böylece kalan
 * 2–3 kişi maçı sonuna kadar oynayabilir.
 *
 * TASARIM İLKESİ — BASİT VE GÜVENLİ (kullanıcı seçimi):
 * Bu yapay zekâ kazanmaya ÇALIŞMAZ. Görevi yalnız oyunu akıtmaktır:
 *   * her zaman KURALLARA UYGUN bir hamle yapar (motor reddetmez),
 *   * asla kilitlenmez (hamle bulunamazsa güvenli varsayılana düşer),
 *   * rastgelelik kullanmaz; aynı durumda aynı hamleyi yapar (hata ayıklanabilir),
 *   * elindeki bilgiyle "en zararsız" seçeneği alır — masadaki gerçek
 *     oyunculardan birine haksız avantaj/dezavantaj vermemek için agresif
 *     oynamaz.
 *
 * Modül SAF'tır: soket, oda yayını, puanlama bilmez. Yalnız oyun
 * durumundan bir hamle önerir; uygulamayı server.js yapar.
 */

// ---------------------------------------------------------------------------
// OKEY / OKEY 101
// ---------------------------------------------------------------------------

// Bir taşın "işe yararlık" puanı: aynı renkten komşu sayılar ve aynı
// sayıdan farklı renkler taşı değerli kılar. En düşük puanlı taş atılır.
function okeyTasDegeri(hand, t) {
  if (!t) return 0;
  if (t.isOkey || t.isFJ) return 1000;            // okey/sahte okey asla atılmaz
  let d = 0;
  for (const o of hand) {
    if (o === t || !o) continue;
    if (o.c === t.c && Math.abs(Number(o.n) - Number(t.n)) === 1) d += 3;  // seri komşusu
    if (o.c === t.c && Number(o.n) === Number(t.n)) d += 2;                // çift
    if (o.c !== t.c && Number(o.n) === Number(t.n)) d += 3;                // per
  }
  return d;
}

/*
 * Okey hamlesi önerir.
 *   state: okey-engine round state (turn, phase, hands, discardPiles ...)
 *   seat : yapay zekânın koltuğu
 * döner: { tur:'draw', kaynak:'deck'|'prev' } | { tur:'discard', tileId }
 *        | { tur:'finish', tileId } | null
 */
function okeyHamle(state, seat, engine) {
  if (!state || state.finished || state.turn !== seat) return null;

  if (state.phase === 'draw') {
    // GÜVENLİ SEÇİM: her zaman desteden çek. Önceki oyuncunun attığı taşı
    // almak ancak elimizi gerçekten ilerletiyorsa mantıklıdır; basit
    // yapay zekâda bunu hesaplamak yerine sapmasız davranırız. Deste
    // bittiyse motor eli berabere bitirir (kilitlenme yok).
    const prev = (state.discardPiles || [])[(seat - 1 + (state.hands || []).length) % ((state.hands || []).length || 1)] || [];
    if (!state.deck || !state.deck.length) {
      // Deste bitti: atılan taş varsa oradan al, yoksa motor beraberliği yazsın.
      return { tur: 'draw', kaynak: prev.length ? 'prev' : 'deck' };
    }
    return { tur: 'draw', kaynak: 'deck' };
  }

  if (state.phase === 'discard') {
    const hand = (state.hands || [])[seat] || [];
    if (!hand.length) return null;

    // Elimizde bitiş varsa bitir: oyunu uzatmak masadaki gerçek
    // oyunculara haksızlık olur (el bitmeden yeni el başlamaz).
    if (engine && typeof engine.handCanFinish === 'function') {
      for (const t of hand) {
        try {
          const kalan = hand.filter(x => x !== t);
          if (engine.handCanFinish(kalan.concat([t]), state.realOkey, state.variant, state.target)) {
            // handCanFinish 15 taşla çağrılır; atılacak taşı motor seçer.
            return { tur: 'finish', tileId: t.id };
          }
        } catch (_) { /* motor farklı imzadaysa bitişi hiç denemeyiz */ }
      }
    }

    // En düşük değerli taşı at.
    let enAz = hand[0], enAzD = okeyTasDegeri(hand, hand[0]);
    for (const t of hand) {
      const d = okeyTasDegeri(hand, t);
      if (d < enAzD) { enAz = t; enAzD = d; }
    }
    return { tur: 'discard', tileId: enAz.id };
  }

  return null;
}

// ---------------------------------------------------------------------------
// PİŞTİ
// ---------------------------------------------------------------------------
// Kural: eldeki herhangi bir kart oynanabilir. Basit yapay zekâ ilk kartı
// oynar — hile yok, avantaj yok, oyun akar.
function pistiHamle(state, seat) {
  if (!state || state.finished || state.turn !== seat) return null;
  const hand = (state.hands || [])[seat] || [];
  if (!hand.length) return null;
  return { tur: 'play', index: 0 };
}

// ---------------------------------------------------------------------------
// BATAK
// ---------------------------------------------------------------------------
function batakHamle(state, seat) {
  if (!state || state.finished) return null;

  // İhale: yapay zekâ ASLA ihaleye girmez (pas geçer). Terk eden oyuncunun
  // yerine oynayan bir bot, masadaki gerçek oyuncuların ihalesini
  // bozmamalıdır.
  if (state.phase === 'bid') {
    if (state.bidTurn !== seat) return null;
    return { tur: 'bid', value: 'pass' };
  }

  // Koz seçimi: yalnız ihaleyi alan seçer. Bot pas geçtiği için buraya
  // normalde düşmez; yine de kilitlenmesin diye elindeki en çok karta
  // sahip rengi seçer.
  if (state.phase === 'trump') {
    if (state.bidder !== seat) return null;
    const hand = (state.hands || [])[seat] || [];
    const say = {};
    hand.forEach(c => { say[c.s] = (say[c.s] || 0) + 1; });
    let en = null, enN = -1;
    Object.keys(say).forEach(s => { if (say[s] > enN) { en = s; enN = say[s]; } });
    return { tur: 'trump', suit: en || (state.SUITS && state.SUITS[0]) || '♠' };
  }

  if (state.phase === 'play') {
    if (state.turn !== seat) return null;
    const hand = (state.hands || [])[seat] || [];
    if (!hand.length) return null;
    const lead = state.trick && state.trick[0] ? state.trick[0].s : null;
    // KURAL: renge uymak zorunludur. Uyan kart varsa onlardan EN DÜŞÜĞÜNÜ
    // oynar (el almaya çalışmaz — "idareten" oynuyor).
    if (lead) {
      let enIdx = -1, enV = Infinity;
      hand.forEach((c, i) => { if (c.s === lead && c.v < enV) { enV = c.v; enIdx = i; } });
      if (enIdx >= 0) return { tur: 'play', index: enIdx };
    }
    // Renk yoksa (veya ilk oynayan biziyse) en düşük kartı oynar.
    let dIdx = 0, dV = Infinity;
    hand.forEach((c, i) => { if (c.v < dV) { dV = c.v; dIdx = i; } });
    return { tur: 'play', index: dIdx };
  }

  return null;
}

// Bu oyunda yapay zekâ devralabilir mi? (3–4 kişilik, el sayısı olan oyunlar)
const AI_OYUNLARI = new Set(['okey', 'okey101', 'pisti', 'batak']);
function aiDestekli(gameId) { return AI_OYUNLARI.has(String(gameId)); }

module.exports = { okeyHamle, pistiHamle, batakHamle, aiDestekli, AI_OYUNLARI, okeyTasDegeri };
