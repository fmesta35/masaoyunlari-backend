# Langırt (Kickoff Club) — kaynak

Kullanıcının verdiği "Kickoff Club" referans oyunundan türetilmiştir (Next.js yerine Vite + React + Tailwind 4, tek dosya).
Çıktı: `assets/oyunlar/langirt.html` (`npm i && npx vite build`, sonra `dist/index.html` kopyalanır).

- `src/lib/game-engine.ts` ve `src/components/foosball-canvas.ts` referanstan AYNEN alınmıştır (çizim + fizik tanımları).
  Sunucu fiziği `langirt-engine.js` bu motorun birebir portudur.
- `src/Online.tsx`: referansın maç ekranı (skor tabelası, çubuk seçici, şarj, dokunmatik çubuk, ayarlar, sesler, parçacıklar).
  Lobi/eşleştirme/AI/yerel mod/profil yoktur: eşleştirme ve maç sonu sitenin ortak katmanındadır; `/api/online`
  yoklaması yerine sitenin Socket.io kareleri kullanılır. Kendi çubuklarınız yerelde tahmin edilir, sunucu son sözü söyler.
- İletişim: iframe → üst `{src:'langirt', t:'ready'|'rods'|'shot'}`; üst → iframe `{dst:'langirt', t:'init'|'frame'}`.
