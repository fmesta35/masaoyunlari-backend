# Cenga (3B) — oyun kaynağı

Bu klasör `assets/oyunlar/cenga3d.html` dosyasının kaynağıdır (referans Cenga
oyunu + çevrimiçi katman). Derleme tek bir HTML dosyası üretir (vite-plugin-singlefile).

    cd tools/oyun-kaynaklari/cenga3d
    npm install
    npm run build
    cp dist/index.html ../../../assets/oyunlar/cenga3d.html

Referans koda eklenenler (çevrimiçi mod, yalnız `?online=1` + iframe içinde açılır):
- `src/game/engine.ts`: `startOnline`, `receive`, `setNet`, kare/ses/efekt rölesi, aynalama.
- `src/App.tsx`: üst sayfa ile postMessage köprüsü (`ready` / `init` / `net`).
- `src/components/Hud.tsx`: çevrimiçi iken duraklat/ses düğmeleri ve ipuçları.

Oyun dosyası değişirse `js/cenga-online.js` içindeki `SRC` sürüm etiketini (`?v=`) artırın.
