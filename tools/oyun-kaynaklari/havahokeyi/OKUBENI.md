# Hava Hokeyi (NEON RINK) — kaynak

Kullanıcının verdiği "NEON RINK" referans oyunundan (Vite + React + Tailwind 4) türetilmiştir.
Çıktı: `assets/oyunlar/havahokeyi.html` (tek dosya; `npm i && npx vite build`, sonra `dist/index.html` kopyalanır).

Referanstan farklar (hepsi `src/Online.tsx` ve küçük dışa aktarmalar):
- `App.tsx`: yardımcılar `export` edildi; `makeRinkCanvas(sol, sag, etiket)` kale/zemin ışıması renkleri artık parametre.
- `Online.tsx` + `main.tsx`: `?online=1` ile çevrimiçi mod. Fizik SUNUCUDADIR (`havahokeyi-engine.js`, 120 Hz);
  bu bileşen sunucu karelerini (üst pencere postMessage) yumuşatır, kendi tokmağını yerelde tahmin eder,
  referanstaki parçacık/ses/afiş/geri sayım efektlerini olaylardan (`olayNo/sonOlay/faz`) üretir.
- İletişim: iframe → üst: `{src:'havahokeyi', t:'ready'|'move'|'renk'}`; üst → iframe: `{dst:'havahokeyi', t:'init'|'frame'}`.
