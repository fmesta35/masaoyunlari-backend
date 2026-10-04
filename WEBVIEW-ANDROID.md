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

### 3.1 Paket adı — SEÇİLDİ

```
tr.com.masaoyunlari.oyun
```

Bir daha **asla değişmez**: Play'de uygulamanın kalıcı kimliği budur.
`.well-known/assetlinks.json` ve `PLAY-MAGAZA.md` bu ada göre doldurulmuştur.

> Mağazada **"Masa Oyunları"** diye arandığında çıkması paket adına değil,
> mağaza adına ve açıklamadaki kelimelere bağlıdır. İkisi de
> `PLAY-MAGAZA.md` içinde hazır.

### 3.2 `.aab` dosyasını üret — PWABuilder (önerilen yol)

1. <https://www.pwabuilder.com> adresini aç.
2. Kutuya `https://www.masaoyunlari.com.tr` yaz, **Start** de.
   PWABuilder manifest'i, servis çalışanını ve HTTPS'i denetler.
3. **Package for stores → Android → Generate Package** de.
4. Açılan formu şöyle doldur:

   | Alan | Değer |
   |---|---|
   | Package ID | `tr.com.masaoyunlari.oyun` |
   | App name | `Masa Oyunları` |
   | Short name | `Masa Oyunları` |
   | App version / Version code | `1.0.0` / `1` |
   | Host | `www.masaoyunlari.com.tr` |
   | Start URL | `/` |
   | Theme / Background color | `#0a0a1a` |
   | Display mode | `standalone` |
   | Signing key | **Create new** (PWABuilder üretsin) |
   | Include source code | işaretle (ileride Bubblewrap'e geçebilmek için) |

5. İnen zip'in içinde şunlar olur:
   - `app-release-signed.aab` → **Play Console'a yüklenecek dosya**
   - `signing.keystore` + `signing-key-info.txt` → **imza anahtarı**
   - `assetlinks.json` → içindeki SHA-256 parmak izi 3.3'te kullanılacak

> ⚠️ **`signing.keystore` ve parolasını kaybetme.** Kaybedersen bu
> uygulamaya bir daha güncelleme yükleyemezsin; yeni paket adıyla sıfırdan
> uygulama açman gerekir. Bir yedeğini çevrimdışı sakla.

**Alternatif (kendi bilgisayarında, Bubblewrap):**

```bash
npm i -g @bubblewrap/cli
bubblewrap init --manifest https://www.masaoyunlari.com.tr/manifest.json
# Sorular: paket adı (tr.com.masaoyunlari.oyun), uygulama adı (Masa Oyunları),
#          tema rengi (#0a0a1a), yönelim (any)
bubblewrap build
```

Bubblewrap JDK ve Android SDK'yı kendisi indirir (birkaç GB).
Çıktı yine `app-release-signed.aab`.

### 3.3 `assetlinks.json`'u doldur (adres çubuğu bunun için gizlenir)

Play Console → **Yayın → Kurulum → Uygulama imzalama** sayfasındaki
**SHA-256 sertifika parmak izini** kopyalayın ve depodaki
`.well-known/assetlinks.json` içine yazın:

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "tr.com.masaoyunlari.oyun",
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

Bütün metinler ve form cevapları **`PLAY-MAGAZA.md`** dosyasında hazır:
mağaza adı, kısa/uzun açıklama, "Veri güvenliği" tablosu ve içerik
derecelendirme anketinin madde madde cevapları. Oradan kopyala.

Görseller depoda hazır:

| Alan | Dosya |
|---|---|
| Uygulama simgesi 512×512 | `assets/icons/icon-512.png` |
| Özellik grafiği 1024×500 | `assets/play/ozellik-grafigi-1024x500.png` |
| Telefon ekranları (6 adet, 1080×1920) | `assets/play/ekran/*.png` |

Gizlilik politikası (Play'in **zorunlu** tuttuğu alan):
`https://www.masaoyunlari.com.tr/gizlilik-politikasi.html`

### 3.5 Yayın akışı

1. Play Console → **Uygulama oluştur** (ad: Masa Oyunları, Oyun, Ücretsiz)
2. **Test → Kapalı test** sürümü oluştur, `.aab` dosyasını yükle
3. **Yayın → Kurulum → Uygulama imzalama** sayfasındaki SHA-256 parmak izini
   al, 3.3'teki gibi `assetlinks.json`'a yaz ve siteye yükle
4. Mağaza kaydını doldur (3.4), içerik derecelendirme ve Veri güvenliği
   formlarını gönder
5. Kapalı testte uygulamayı aç: **adres çubuğu görünmüyorsa** assetlinks
   doğrulanmış demektir. Görünüyorsa parmak izi ya da paket adı yanlıştır
6. **Üretim**e yükselt. İlk incelemenin birkaç gün sürmesi normaldir

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
