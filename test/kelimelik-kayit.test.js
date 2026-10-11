'use strict';
/*
 * KELİMELİK KAYIT BÜTÜNLÜĞÜ — yeni bir oyun eklenirken ONLARCA ayrı
 * listeye/tabloya kaydedilmesi gerekiyor; biri atlanırsa oyun sessizce
 * yarım çalışır (lobi boş kalır, bekleme odası açılmaz, puan işlenmez,
 * rakip ayrılınca masa donar). Bu test kaydın tamamını denetler.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const kok = path.join(__dirname, '..');
const oku = p => fs.readFileSync(path.join(kok, p), 'utf8');
const index = oku('index.html');
const server = oku('server.js');
const lobi = oku('js/lobby-sync.js');
const bekleme = oku('js/room-waiting-fix.js');

function icerir(metin, parca, nerede) {
  assert.ok(metin.includes(parca), nerede + ' → eksik: ' + parca);
}

// ---------------- dosyalar ----------------
for (const d of ['kelimelik-engine.js', 'kelimelik-sozluk.txt', 'kelimelik-bildirim.js',
                 'js/kelimelik-online.js', 'assets/covers/kelimelik.jpg',
                 'tools/kelimelik-sozluk.py', 'tools/kapak-kelimelik.py']) {
  assert.ok(fs.existsSync(path.join(kok, d)), 'dosya eksik: ' + d);
}

// sözlük sunucuda kalmalı: istemciye hiç inmemeli
assert.ok(!index.includes('kelimelik-sozluk'), 'sözlük index.html\'e gömülmemeli');
assert.ok(!oku('js/kelimelik-online.js').includes('SOZLUK'),
  'sözlük istemci adaptörüne sızmamalı (sunucuda kalmalı)');
const sozluk = oku('kelimelik-sozluk.txt').split('\n').filter(Boolean);
assert.ok(sozluk.length > 50000, 'sözlük en az 50 bin kelime olmalı: ' + sozluk.length);
assert.ok(sozluk.every(w => w.length >= 2 && w.length <= 15), 'sözlükte 2-15 harf dışı kelime var');

// ---------------- index.html kayıtları ----------------
icerir(index, "'battleship', 'kelimelik']", 'TWO_PLAYER_GAMES / ONLINE_GAMES');
assert.ok(/const TWO_PLAYER_GAMES = \[[^\]]*'kelimelik'/.test(index), 'TWO_PLAYER_GAMES');
assert.ok(/const ONLINE_GAMES = \[[^\]]*'kelimelik'/.test(index), 'ONLINE_GAMES');
icerir(index, "kelimelik:{name:'Kelimelik'", 'GAMES kaydı');
icerir(index, "cover:'assets/covers/kelimelik.jpg'", 'kapak yolu');
icerir(index, 'kelimelik:[]', 'ROOMS kaydı');
icerir(index, 'kelimelik:{win:25', 'GAME_REWARDS');
assert.ok(/kelimelik:\{legend:/.test(index), 'GAME_THRESHOLDS eksik');
assert.ok((index.match(/battleship:0,kelimelik:0/g) || []).length >= 3,
  'st.scores üç yerde de (varsayılan, sıfırlama, demo) kelimelik taşımalı');
icerir(index, 'kelimelik:rKelimelik', 'kurallar çizici eşlemesi');
icerir(index, 'function rKelimelik', 'rKelimelik tanımı');
icerir(index, 'RULES', 'kurallar tablosu');
assert.ok(/kelimelik:`<div class="rules-content">/.test(index), 'RULES.kelimelik eksik');
icerir(index, 'js/kelimelik-online.js', 'betik etiketi');
icerir(index, '.kl-tahta{', 'tahta CSS');
icerir(index, '#pg-room.gv-fs .kl-wrap', 'tam ekran CSS');
icerir(index, '.kl-joker-ov,.kl-hayalet', 'tam ekran kaplama listesi (GV_FS_KAPLAMALAR)');

// kurallar metni ZORUNLU maddeleri anlatmalı
const kural = index.slice(index.indexOf('kelimelik:`<div class="rules-content">'));
for (const p of ['madde başı', 'gelmek', 'otomatik pas', 'üst üste 3', 'diskalifiye',
                 'Bingo', 'Kelime Bildir', 'her iki oyuncunun da']) {
  assert.ok(kural.slice(0, 3000).includes(p), 'kurallar metninde eksik: ' + p);
}

// ---------------- server.js kayıtları ----------------
icerir(server, "require('./kelimelik-engine')", 'motor require');
icerir(server, "require('./kelimelik-bildirim')", 'bildirim modülü');
assert.ok(/ALL_GAMES[\s\S]{0,220}'kelimelik'/.test(server), 'ALL_GAMES');
assert.ok(/PRESET_GAME_BASES[\s\S]{0,320}kelimelik: 1101/.test(server), 'hazır masa taban numarası 1101');
icerir(server, 'function startKelimelik', 'masa başlatma');
icerir(server, 'function kelimelikState', 'durum üreticisi');
icerir(server, 'function kelimelikOtomatikPas', 'otomatik pas');
icerir(server, "room.gameId === 'kelimelik'", 'startRoomGame dalı');
icerir(server, 'room.kelimelik = null', 'oda sıfırlama');
icerir(server, 'if (room.kelimelik) return room.kelimelik.turn', 'turnSeatOf');
for (const ev of ['kelimelikMove', 'kelimelikPass', 'kelimelikSwap', 'kelimelikShuffle', 'kelimelikReport']) {
  icerir(server, "socket.on('" + ev + "'", 'soket olayı ' + ev);
}
// rakip ayrılınca masa donmasın: oyun listesine eklenmiş olmalı
assert.ok(/wasPlaying && \(room\.dama[^)]*room\.kelimelik/.test(server),
  'ayrılan oyuncu dalında room.kelimelik eksik → masa donar');
assert.ok(/!room\.dama && !room\.reversi && !room\.gomoku && !room\.kelimelik/.test(server),
  'hamle süresi denetiminde room.kelimelik eksik → saat donar');
icerir(server, "app.get('/api/kelimelik/reports'", 'yönetici bildirim ucu');

// ---------------- istemci köprüleri ----------------
/* Bu üç köprü eskiden ELLE yazılmış oyun listeleriydi ve her yeni oyunda
   biri unutuluyordu (kullanıcı raporu: yeni oyunlar masada açılmıyor).
   Üçü de artık ONLINE_GAMES / GAMES'ten türüyor; test de mekanizmayı
   doğruluyor, liste içeriğini değil. */
icerir(lobi, 'function oyunEslemesi()', 'lobi başlık→gameId eşlemesi GAMES\'ten türemeli');
icerir(lobi, 'window.GAMES', 'lobi eşlemesi GAMES\'i okumalı');
icerir(bekleme, 'function bridgeGames()', 'BRIDGE listesi ONLINE_GAMES\'ten türemeli');
icerir(bekleme, 'window.ONLINE_GAMES', 'köprü listesi ONLINE_GAMES\'i okumalı');
assert.ok(/engineReady = bridgeGame\(/.test(bekleme),
  'engineReady de aynı listeden gelmeli (bekleme odası "başlatılıyor" demeli)');
/* Kelimelik gerçekten listede mi? Kaynak değil, DAVRANIŞ üzerinden:
   index.html'in ONLINE_GAMES dizisi kelimelik'i içermeli. */
assert.ok(/ONLINE_GAMES = \[[^\]]*'kelimelik'/.test(oku('index.html')),
  'kelimelik ONLINE_GAMES içinde olmalı');

// ---------------- adaptör ----------------
const adaptor = oku('js/kelimelik-online.js');
icerir(adaptor, "id: 'kelimelik', kinds: ['kelimelik']", 'GVArena tanımı');
icerir(adaptor, "reject: ['kelimelikRejected']", 'red olayı');
icerir(adaptor, 'damga:', 'damga (rövanşta tahta sıfırlansın)');
for (const sec of ['kl-onay', 'kl-geri', 'kl-temiz', 'kl-karistir', 'kl-takas', 'kl-pas', 'kl-bildir']) {
  icerir(adaptor, sec, 'kumanda düğmesi ' + sec);
}
icerir(adaptor, '__gvKaplamaKati', 'tam ekranda kaplama katmanı');
icerir(adaptor, "window.addEventListener('gv:roomLeft', sifirla)", 'odadan çıkışta taslak temizlenmeli');

console.log('OK kelimelik kayıt bütünlüğü (motor, sunucu, lobi, bekleme odası, adaptör, kurallar, kapak)');
