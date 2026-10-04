# Masa Oyunları — Android uygulaması (native WebView) rehberi

Bu belge, siteyi **Google Play'de bir Android uygulaması** olarak
yayınlamak için gereken her şeyi anlatır. Hem site tarafı hem de Android
projesi (`android/` klasörü) **hazır**; kalan iş `.aab` dosyasını derleyip
Play Console'a yüklemektir.

> Android projesinin kendi ayrıntılı rehberi: **`android/README.md`**
> Mağaza metinleri ve form cevapları: **`PLAY-MAGAZA.md`**

---

## 1. Hangi yöntem? TWA DEĞİL — kendi WebView'imiz

İki yol var ve **aralarındaki fark bir tercih meselesi değil, bir ret
sebebi**:

| | TWA (Trusted Web Activity) | **Native WebView (seçilen)** |
|---|---|---|
| Siteyi ne açar | Chrome'un kendi sekmesi | Uygulamanın kendi `WebView`'i |
| Play incelemesi | **TakasVarmi projesinde REDDEDİLDİ** — *"gerçek bir uygulama değil, tarayıcı sekmesi"* | Kabul edildi |
| Site güncellemesi | Anında yansır | Anında yansır |
| Çevrimdışı ekranı, açılış ekranı, geri tuşu | Chrome'un davranışı | Bizim denetimimizde |

Aynı hesapta yürüttüğümüz **TakasVarmi** projesinde önce TWA denendi; Google
Play incelemesi uygulamayı "tarayıcı sekmesi" gerekçesiyle reddetti ve proje
native bir WebView uygulamasına dönüştürülerek kabul edildi. Masa Oyunları bu
yüzden **en baştan native WebView** olarak kuruldu.

Site güncellemeleri yine mağazadan bağımsızdır: `git push` → dağıtım →
kullanıcı uygulamayı bir sonraki açışında yeni sürümü görür.

## 2. Sitede yapılanlar (bitti)

| Dosya | Ne yapar |
|---|---|
| `manifest.json` | Uygulama kimliği: ad, `standalone` görünüm, tema/arka plan rengi, 192 + 512 px **PNG** ikonlar (normal + `maskable`), Okey/Tavla/Satranç/Bilardo kısayolları |
| `assets/icons/icon-{192,512}[-maskable].png` | Play ve ana ekran ikonları (logo.png'den üretildi) |
| `sw.js` | Servis çalışanı: tarayıcıda kurulabilirlik + ağ koptuğunda beyaz ekran yerine uygulama kabuğu. `/api/*` ve `/socket.io/*` **asla** önbelleğe alınmaz |
| `js/webview.js` | Uygulama katmanı: ortam tespiti, servis çalışanı kaydı, **Android geri tuşu**, aşağı-çekip-yenilemeyi kapatma, oyun sırasında ekranı açık tutma, `?game=okey` kısayolları, "Uygulamayı yükle" düğmesi |
| `.well-known/assetlinks.json` | Alan adı ↔ uygulama eşleşmesi: bağlantılar tarayıcı yerine uygulamada açılsın diye (SHA-256 parmak izi 3.3'te doldurulacak) |
| `index.html` | `theme-color`, iOS tam ekran meta'ları, güvenli alan (çentik) payları, `body.gv-app` uyarlamaları |
| `server.js` | `/sw.js` ve `/.well-known/assetlinks.json` kök yoldan servis edilir |

### Android geri tuşu davranışı
1. Açık pencere/çekmece varsa kapanır
2. Oyun masasındaysanız "masadan ayrıl" akışı çalışır
3. Alt sayfadaysanız ana sayfaya dönülür
4. Ana sayfada iki kez arka arkaya basınca uygulamadan çıkılır

---

## 3. `.aab` dosyasını üretme

Android projesi depoda hazır: **`android/`** klasörü. Ayrıntılı anlatım
**`android/README.md`** dosyasında; özet:

### 3.1 Paket adı — SEÇİLDİ

```
tr.com.masaoyunlari.oyun
```

Bir daha **asla değişmez**: Play'de uygulamanın kalıcı kimliği budur.
`android/app/build.gradle`, `.well-known/assetlinks.json` ve
`PLAY-MAGAZA.md` bu ada göre doldurulmuştur; `test/android-uygulama.test.js`
üçünün birbiriyle uyuştuğunu her testte denetler.

> Mağazada **"Masa Oyunları"** diye arandığında çıkması paket adına değil,
> mağaza adına ve açıklamadaki kelimelere bağlıdır. İkisi de
> `PLAY-MAGAZA.md` içinde hazır.

### 3.2 Derleme (kendi bilgisayarınızda, tek komut)

`android` klasöründe bir CMD penceresi açın:

```cmd
derle.bat
```

Betik JDK 17'yi, Android SDK'yı ve Gradle'ı bulur (bilgisayarınızda zaten
kurulu olanları KULLANIR, gereksiz yere gigabaytlarca indirmez), imza
anahtarı yoksa parolasını size sorarak oluşturur ve imzalı paketi üretir:

```
android\app\build\outputs\bundle\release\app-release.aab
```

> ⚠️ **`android\keystore` klasörünün yedeğini alın.** Bu anahtar
> uygulamanızın kimliğidir; kaybederseniz Play'deki uygulamaya bir daha
> güncelleme yükleyemezsiniz. Anahtar ve parolası `.gitignore` ile depo
> dışında tutulur, GitHub'a asla gitmez.

### 3.3 `assetlinks.json`'u doldurun

Play Console → **Yayın → Kurulum → Uygulama imzalama** sayfasındaki
**SHA-256 sertifika parmak izini** kopyalayıp `.well-known/assetlinks.json`
içindeki yer tutucunun yerine yazın ve siteye yükleyin:

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

Play App Signing kullanıyorsanız listeye **hem yükleme (upload) hem uygulama
imzalama** parmak izini ekleyin. Dosyanın
`https://www.masaoyunlari.com.tr/.well-known/assetlinks.json` adresinde
yayında olması gerekir (Yöncü'de yeri: `public_html/.well-known/`).

Bu dosya doğru olduğunda `masaoyunlari.com.tr` bağlantıları tarayıcı yerine
doğrudan uygulamada açılır (App Links). Yanlışsa uygulama yine çalışır,
yalnız linkler tarayıcıya gider.

### 3.4 Play Console mağaza kaydı

Bütün metinler ve form cevapları **`PLAY-MAGAZA.md`** dosyasında hazır:
mağaza adı, kısa/uzun açıklama, "Veri güvenliği" tablosu ve içerik
derecelendirme anketinin madde madde cevapları.

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
2. **Test → Kapalı test** sürümü oluşturup `app-release.aab` yükleyin
3. SHA-256 parmak izini alıp 3.3'teki gibi `assetlinks.json`'a yazın
4. Mağaza kaydını doldurun (3.4), iki formu gönderin
5. Kapalı testte uygulamayı açın: **adres çubuğu yok** (zaten native
   WebView), bağlantılar uygulamada açılıyorsa assetlinks doğrulanmıştır
6. **Üretim**e yükseltin. İlk incelemenin birkaç gün sürmesi normaldir

### 3.6 Sonraki sürümler

`android/app/build.gradle` içindeki `versionCode`'u bir artırın
(`versionName`'i de isterseniz) ve `derle.bat`'ı tekrar çalıştırın.
**Sitedeki değişiklikler için buna gerek YOK** — onlar uygulamaya
kendiliğinden yansır.

## 4. Yayına almadan önce kontrol listesi

- [ ] Site **HTTPS** üzerinden açılıyor
- [ ] `https://.../manifest.json` 200 dönüyor ve `application/manifest+json`
- [ ] `https://.../sw.js` 200 dönüyor (`Service-Worker-Allowed: /` başlığıyla)
- [ ] Chrome'da site → menü → "Uygulamayı yükle" seçeneği çıkıyor (PWA tarafı)
- [ ] `node test/android-uygulama.test.js` ve `node test/play-basvuru.test.js` geçiyor
- [ ] `android\derle.bat` imzalı `.aab` üretiyor
- [ ] `android\keystore` klasörünün çevrimdışı yedeği alındı
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
veya simge değişikliği, hedef Android API sürümü yükseltmesi, ya da
`android/` klasöründeki kabuk kodunun değişmesi. Her yüklemede
`android/app/build.gradle` içindeki `versionCode` ARTMALIDIR.
