'use strict';
/* ============================================================================
 * KURUCU PANELİ — Yöncü'de kayıtlı ESKİ ayar bloğu YENİ oyunu içermiyorsa
 * ============================================================================
 * Kullanıcı raporu: "Amiral battıda 10 masa var ama kurucu paneli
 * güncellenmemiş ... oda sayısı hala kurucu panelinde sıfır gösteriyor ama
 * normalde lobide 10 gözüküyor. Kurucu panelde doğrusu düzeltilmeli,
 * ekleme çıkarma diğerlerindeki gibi yapılmalı."
 *
 * Kök neden: js/admin-panel.js'in fetchSettings() Yöncü sayfasında PHP'den
 * dönen HAM (birleştirilmemiş) ayar JSON'unu doğrudan settingsCache yapardı.
 * battleship, bu JSON kaydedildiğinde henüz eklenmemiş bir oyun olduğu için
 * blokta YOKTU → gameRow('battleship') {visible:true} varsayılanına
 * düşüyor (tables YOK) → "0 masa" gösteriyordu. Sunucu tarafı
 * (server.js normPresetConfig) aynı durumu zaten alan-alan varsayılanla
 * BİRLEŞTİREREK doğru çözüyordu — hata yalnız istemciydeydi.
 *
 * Bu test, gerçek bir sayfa/hostname açmadan, js/admin-panel.js'in test
 * kancasıyla (window.__adminPanelTest.mergeIntoDefault) dışa açılan
 * birleştirme mantığını doğrudan doğrular.
 * ========================================================================= */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');

async function main() {
  const vc = new VirtualConsole();
  vc.on('jsdomError', () => {});
  vc.on('error', () => {});

  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'dangerously', virtualConsole: vc });
  const win = dom.window;

  // Gerçek uygulamadaki GAMES tanımıyla AYNI oyun listesi (battleship dahil).
  win.GAMES = {
    chess: { name: 'Satranç', icon: '♟️' }, tavla: { name: 'Tavla', icon: '🎲' },
    dama: { name: 'İngiliz Daması', icon: '⬛' }, turkdamasi: { name: 'Türk Daması', icon: '🔲' },
    okey: { name: 'Okey', icon: '🀄' }, okey101: { name: '101 Okey', icon: '🀄' },
    pisti: { name: 'Pişti', icon: '🃏' }, batak: { name: 'Batak', icon: '🃏' },
    reversi: { name: 'Reversi', icon: '⚫' }, gomoku: { name: 'Gomoku', icon: '⚪' },
    connect4: { name: 'Connect4', icon: '🔴' }, bilardo: { name: 'Bilardo', icon: '🎱' },
    battleship: { name: 'Amiral Battı', icon: '🚢' }
  };
  win.st = { user: null };
  win.GV = { toast() {} };

  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'admin-panel.js'), 'utf8');
  const script = win.document.createElement('script');
  script.textContent = src;
  win.document.body.appendChild(script);

  await new Promise(r => setTimeout(r, 50));
  assert.ok(win.__adminPanelTest, 'test kancası yüklendi (window.__adminPanelTest)');
  const { mergeIntoDefault, defaultSettings } = win.__adminPanelTest;

  // ---------- 1) battleship'İ İÇERMEYEN eski Yöncü kaydı ----------
  const eskiKayit = {
    chess: { visible: true, tables: [{ name: 'Masa #1', type: 'normal', durationMinutes: 15 }] },
    tavla: { visible: false }
    // battleship YOK — kullanıcının bildirdiği tam senaryo.
  };
  const birlesik = mergeIntoDefault(eskiKayit);
  assert.ok(birlesik.battleship, 'battleship anahtarı sonuçta bulunmalı (varsayılandan gelir)');
  assert.ok(Array.isArray(birlesik.battleship.tables) && birlesik.battleship.tables.length === 10,
    'battleship kayıtta yoksa bile VARSAYILAN 10 masayla gelmeli — "0 masa" hatası düzeldi: ' +
    JSON.stringify(birlesik.battleship));
  assert.strictEqual(birlesik.battleship.visible, true, 'battleship varsayılan olarak görünür');
  console.log('  ✓ 1) Yöncü kaydında olmayan battleship, varsayılan 10 masayla geliyor ("0 masa" hatası düzeldi)');

  // ---------- 2) kayıtlı olan oyunların değerleri KORUNUR (ezilmez) ----------
  assert.strictEqual(birlesik.chess.tables.length, 1, 'chess için KAYITLI masa listesi korunmalı (varsayılana dönmemeli)');
  assert.strictEqual(birlesik.chess.tables[0].name, 'Masa #1');
  assert.strictEqual(birlesik.tavla.visible, false, 'tavla için KAYITLI visible=false korunmalı');
  // tavla kayıtta tables içermiyor → varsayılan masa listesi korunur (server.js normPresetConfig ile aynı davranış):
  assert.ok(Array.isArray(birlesik.tavla.tables) && birlesik.tavla.tables.length === 10,
    'tavla tables alanı kayıtta yoksa varsayılan 10 masa korunur');
  console.log('  ✓ 2) Kayıtlı oyunların değerleri (visible/tables) EZİLMEDEN korunuyor — yalnız eksik alan/oyun varsayılana düşüyor');

  // ---------- 3) tamamen boş/geçersiz kayıt (ilk kurulum) → tüm varsayılanlar ----------
  const bosBirlesik = mergeIntoDefault(null);
  const varsayilan = defaultSettings();
  assert.deepStrictEqual(Object.keys(bosBirlesik).sort(), Object.keys(varsayilan).sort(), 'boş kayıt: tüm oyunlar varsayılanla gelir');
  assert.strictEqual(bosBirlesik.battleship.tables.length, 10, 'boş kayıtta da battleship 10 masa');
  console.log('  ✓ 3) Kayıt hiç yoksa (null) tüm oyunlar sunucudaki gibi varsayılan masa sayısıyla geliyor');

  console.log('\n✅ ADMIN-PANEL-GAMES-MERGE: Yöncü\'de eksik oyun kaydı artık "0 masa" hatası vermiyor');
  win.close();
  process.exit(0);
}

main().catch(e => {
  console.error('❌ admin-panel-games-merge.test.js HATA:', e);
  process.exit(1);
});
