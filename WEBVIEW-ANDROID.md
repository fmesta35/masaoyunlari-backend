# Masa Oyunları — Android uygulaması (WebView / TWA) rehberi

Bu belge, siteyi **Google Play'de bir Android uygulaması** olarak
yayınlamak için gereken her şeyi anlatır. Site kodunda gereken bütün
hazırlık **tamamlandı**; kalanlar Play Console ve paketleme adımlarıdır.

---

## 1. Hangi yöntem? WebView değil, TWA

İki yol var:

| | Saf WebView | **TWA (önerilen)** |
|---|---|---|
| Tarayıcı motoru | Uygulamaya gömülü eski WebView | Cihazdaki güncel Chrome |
| Performans | Daha yavaş, WebGL/ses kısıtlı | Chrome ile birebir |
| Çerez/oturum | Ayrı, kayboluyor | Chrome ile paylaşımlı |
| Play politikası | "Yalnızca web sarmalayıcı" gerekçesiyle **reddedilebilir** | Kabul edilir |
| Adres çubuğu | Yok | `assetlinks.json` doğrulanırsa yok |

**TWA (Trusted Web Activity)** seçildi. Uygulama, cihazdaki Chrome'u tam
ekran çalıştırır; kullanıcı tarayıcıda olduğunu anlamaz, ama site her
zaman günceldir — mağazaya yeni sürüm yüklemeden site güncellenir.

---

## 2. Sitede yapılanlar (bitti)

| Dosya | Ne yapar |
|---|---|
| `manifest.json` | Uygulama kimliği: ad, `standalone` görünüm, tema/arka plan rengi, 192 + 512 px **PNG** ikonlar (normal + `maskable`), Okey/Tavla/Satranç/Bilardo kısayolları |
| `assets/icons/icon-{192,512}[-maskable].png` | Play ve ana ekran ikonları (logo.png'den üretildi) |
| `sw.js` | Servis çalışanı: kurulabilirlik + ağ koptuğunda beyaz ekran yerine uygulama kabuğu. `/api/*` ve `/socket.io/*` **asla** önbelleğe alınmaz |
| `js/webview.js` | Uygulama katmanı: ortam tespiti, servis çalışanı kaydı, **Android geri tuşu**, aşağı-çekip-yenilemeyi kapatma, oyun sırasında ekranı açık tutma, `?game=okey` kısayolları, "Uygulamayı yükle" düğmesi |
| `.well-known/assetlinks.json` | Alan adı ↔ uygulama eşleşmesi (aşağıda doldurulacak) |
| `index.html` | `theme-color`, iOS tam ekran meta'ları, güvenli alan (çentik) payları, `body.gv-app` uyarlamaları |
| `server.js` | `/sw.js` ve `/.well-known/assetlinks.json` kök yoldan servis edilir |

### Android geri tuşu davranışı
1. Açık pencere/çekmece varsa kapanır
2. Oyun masasındaysanız "masadan ayrıl" akışı çalışır
3. Alt sayfadaysanız ana sayfaya dönülür
4. Ana sayfada iki kez arka arkaya basınca uygulamadan çıkılır

---

## 3. Yapılacaklar

### 3.1 Paket adını seç (bir kez, geri dönüşü yok)
Örnek: `tr.com.masaoyunlari.twa`

### 3.2 Uygulamayı paketle (Bubblewrap)

```bash
npm i -g @bubblewrap/cli
bubblewrap init --manifest https://www.masaoyunlari.com.tr/manifest.json
# Sorular: paket adı, uygulama adı, tema rengi (#0a0a1a), yönelim (any)
bubblewrap build
```

Çıktı: `app-release-signed.aab` → Play Console'a bu dosya yüklenir.

> Alternatif: https://www.pwabuilder.com adresine site adresini girip
> "Android → Generate" demek de aynı işi arayüzden yapar.

### 3.3 `assetlinks.json`'u doldur (adres çubuğu bunun için gizlenir)

Play Console → **Yayın → Kurulum → Uygulama imzalama** sayfasındaki
**SHA-256 sertifika parmak izini** kopyalayın ve depodaki
`.well-known/assetlinks.json` içine yazın:

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "tr.com.masaoyunlari.twa",
    "sha256_cert_fingerprints": ["AA:BB:CC:... (Play'den kopyalanan)"]
  }
}]
```

Play App Signing kullanıyorsanız listeye **hem yükleme (upload) hem
uygulama imzalama** parmak izini ekleyin.

Dosyanın şu adreste yayında olması gerekir:
`https://www.masaoyunlari.com.tr/.well-known/assetlinks.json`
Yöncü'de yeri: `public_html/.well-known/assetlinks.json`

Doğrulama: https://developers.google.com/digital-asset-links/tools/generator

### 3.4 Play Console mağaza kaydı
- Uygulama simgesi 512×512 (`assets/icons/icon-512.png`)
- Özellik grafiği 1024×500
- En az 2 telefon ekran görüntüsü (tablet ekranları da eklenirse iyi olur)
- Gizlilik politikası bağlantısı: `https://www.masaoyunlari.com.tr/gizlilik-politikasi.html`
- İçerik derecelendirme anketi ve "Veri güvenliği" formu (üyelik e-posta
  topluyor: **Kişisel bilgiler → E-posta adresi** olarak beyan edin)

---

## 4. Yayına almadan önce kontrol listesi

- [ ] Site **HTTPS** üzerinden açılıyor (TWA'nın ön koşulu)
- [ ] `https://.../manifest.json` 200 dönüyor ve `application/manifest+json`
- [ ] `https://.../sw.js` 200 dönüyor (`Service-Worker-Allowed: /` başlığıyla)
- [ ] Chrome'da site → menü → "Uygulamayı yükle" seçeneği çıkıyor
- [ ] Lighthouse → PWA "Installable" yeşil
- [ ] `assetlinks.json` doldurulmuş ve yayında
- [ ] Uygulamada geri tuşu uygulamayı ani kapatmıyor
- [ ] Oyun tahtasında aşağı çekince sayfa yenilenmiyor
- [ ] Oyun sırasında ekran sönmüyor

---

## 5. Sürüm güncellemesi

Site içeriği **mağazadan bağımsız** güncellenir: `git push` → Render/Yöncü
dağıtımı → kullanıcılar uygulamayı bir sonraki açışta yeni sürümü görür.
`sw.js` içindeki `SURUM` sabiti değiştiğinde eski önbellek temizlenir.

Mağazaya yeni paket yüklemek yalnızca şu durumlarda gerekir: uygulama adı
veya ikon değişikliği, hedef Android API sürümü yükseltmesi, TWA
ayarlarının (tema rengi, yönelim, paket adı) değişmesi.
