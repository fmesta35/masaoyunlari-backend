'use strict';
/* ============================================================================
 * 101 OKEY — AÇMADAN YERDEN TAŞ ALINMAZ
 * ============================================================================
 * Kullanıcı raporu: "101 okey kurallarına göre masaya taş açmadan karşı
 * oyuncunun taşını alamamam gerekiyordu. Açmadan karşı oyuncunun attığı taşı
 * alabildim masadan."
 *
 * NE DOĞRULANIR
 *   1) Açmamış oyuncu yerden (önceki oyuncunun attığından) taş ALAMAZ;
 *      sebep kodu 'acmadan_yerden_alinmaz' ve taş yerinde kalır.
 *   2) Açmamış oyuncu desteden çekebilir (kural yalnız yeri kapatır).
 *   3) Açmış oyuncu yerden taş ALABİLİR.
 *   4) KLASİK Okey bu kısıttan etkilenmez (kullanıcı kararı: "Okey klasik
 *      kalsın, 101 değişsin").
 *   5) Sunucu da aynı kuralı uygular (istemciye güvenilmez) ve ret sebebinin
 *      Türkçe karşılığı tanımlıdır.
 * ========================================================================= */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const KOK = path.join(__dirname, '..');
const E101 = require(path.join(KOK, 'okey101-engine.js'));
const EKLASIK = require(path.join(KOK, 'okey-engine.js'));

function masaKur(motor, kisi) {
  const seats = [];
  for (let i = 0; i < kisi; i++) seats.push(i);
  // startRound(roundNo, seats, scores, rng, starterSeat)
  return motor.startRound(1, seats, {}, () => 0.5, 0);
}

/* Sırası gelen oyuncunun ÖNÜNDEKİ oyuncunun atığına taş koy: yerden alma
   denemesi için ortam. */
function atikKoy(st, seat, tas) {
  const onceki = (seat - 1 + st.seats.length) % st.seats.length;
  st.discardPiles[onceki] = st.discardPiles[onceki] || [];
  st.discardPiles[onceki].push(tas);
  return onceki;
}

function main() {
  // ---------- 1) AÇMAMIŞ OYUNCU YERDEN ALAMAZ ----------
  {
    const st = masaKur(E101, 4);
    // Başlayan bir taş atsın ki sıra 1'e geçsin.
    const ilk = st.hands[0][0];
    const at = E101.discard(st, 0, ilk.id);
    assert.ok(at.ok, 'başlayan taş atabilmeli');
    assert.strictEqual(st.turn, 1, 'sıra sonraki oyuncuya geçmeli');
    assert.strictEqual(st.phase, 'draw', 'yeni sıra çekme ile başlar');
    assert.ok(!st.opened[1], '1 numaralı oyuncu henüz açmamış olmalı');

    const oncekiYigin = st.discardPiles[0].length;
    const r = E101.drawFromPrev(st, 1);
    assert.strictEqual(r.ok, false, 'açmamış oyuncu yerden taş alamamalı');
    assert.strictEqual(r.reason, 'acmadan_yerden_alinmaz', 'sebep açık olmalı');
    assert.strictEqual(st.discardPiles[0].length, oncekiYigin, 'taş yerinde kalmalı');
    assert.strictEqual(st.hands[1].length, 21, 'ele taş eklenmemeli');
    assert.strictEqual(st.phase, 'draw', 'sıra hâlâ çekme aşamasında olmalı');
    console.log('  ✓ 1) açmamış oyuncu yerden taş alamıyor');

    // ---------- 2) ama DESTEDEN çekebilir ----------
    const d = E101.drawFromDeck(st, 1);
    assert.ok(d.ok, 'açmamış oyuncu desteden çekebilmeli');
    assert.strictEqual(st.hands[1].length, 22, 'çekilen taş ele eklenmeli');
    console.log('  ✓ 2) açmamış oyuncu desteden çekebiliyor');
  }

  // ---------- 3) AÇMIŞ OYUNCU YERDEN ALABİLİR ----------
  {
    const st = masaKur(E101, 4);
    E101.discard(st, 0, st.hands[0][0].id);
    assert.strictEqual(st.turn, 1);
    st.opened[1] = true;                       // bu oyuncu daha önce açmış say
    const tas = { id: 'x-test', n: 5, c: 'k' };
    const onceki = atikKoy(st, 1, tas);
    const once = st.hands[1].length;
    const r = E101.drawFromPrev(st, 1);
    assert.ok(r.ok, 'açmış oyuncu yerden alabilmeli → ' + (r.reason || ''));
    assert.strictEqual(r.from, onceki, 'taş önceki oyuncunun yığınından gelmeli');
    assert.strictEqual(st.hands[1].length, once + 1, 'taş ele geçmeli');
    assert.strictEqual(st.hands[1][st.hands[1].length - 1].id, 'x-test', 'alınan taş o taş olmalı');
    console.log('  ✓ 3) açmış oyuncu yerden taş alabiliyor');
  }

  // ---------- 4) KLASİK OKEY ETKİLENMEZ ----------
  {
    const st = masaKur(EKLASIK, 4);
    EKLASIK.discard(st, 0, st.hands[0][0].id);
    assert.strictEqual(st.turn, 1, 'klasik okeyde de sıra geçmeli');
    const r = EKLASIK.drawFromPrev(st, 1);
    assert.ok(r.ok, 'klasik okeyde açma şartı YOKTUR → ' + (r.reason || ''));
    console.log('  ✓ 4) klasik okey eski kurallarla çalışmaya devam ediyor');
  }

  // ---------- 5) SUNUCU VE METİNLER ----------
  {
    const sunucu = fs.readFileSync(path.join(KOK, 'server.js'), 'utf8');
    assert.ok(/okeyMotoru\(room\)/.test(sunucu),
      'sunucu çekme işlemini masanın motoruna devretmeli (101 masasında 101 motoru)');
    const mesajlar = fs.readFileSync(path.join(KOK, 'js', 'messages.js'), 'utf8');
    assert.ok(/acmadan_yerden_alinmaz:/.test(mesajlar), 'ret sebebinin Türkçesi tanımlı olmalı');
    const istemci = fs.readFileSync(path.join(KOK, 'js', 'okey-online.js'), 'utf8');
    assert.ok(/source === 'prev' && gercek101\(gameState\)/.test(istemci),
      'istemci de açmadan yerden almayı engellemeli (anında geri bildirim)');
    const sayfa = fs.readFileSync(path.join(KOK, 'index.html'), 'utf8');
    assert.ok(/Açmayan oyuncu yerden taş alamaz/.test(sayfa), 'kural metni güncellenmeli');
    console.log('  ✓ 5) sunucu, istemci, mesajlar ve kural metni uyumlu');
  }

  console.log('OK 101 okey: açmadan yerden taş alınmıyor');
}

try { main(); }
catch (e) { console.error('101 YERDEN ALMA HATASI:', e); process.exit(1); }
