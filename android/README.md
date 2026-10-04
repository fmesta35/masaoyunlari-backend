# Masa Oyunları — Android uygulaması (.aab üretimi)

Bu klasör, `masaoyunlari.com.tr` sitesini **kendi WebView'i içinde** çalıştıran
gerçek bir Android uygulamasıdır. Google Play'e yüklenecek `.aab` dosyası
burada, **sizin bilgisayarınızda** üretilir.

---

## Neden TWA değil?

İlk akla gelen yöntem TWA'dır (Trusted Web Activity): uygulama siteyi Chrome'un
kendi sekmesinde açar. **TakasVarmi projesinde bu denendi ve Google Play
incelemesi reddetti** — gerekçe: *"gerçek bir uygulama değil, tarayıcı sekmesi"*.
O proje native bir WebView uygulamasına dönüştürülüp kabul edildi.

Masa Oyunları bu yüzden en baştan **native WebView** olarak kuruldu:
`androidbrowserhelper`, Chrome Custom Tabs ya da TWA başlatıcısı hiç yok.
Site, `MainActivity`'nin kendi `WebView` bileşeninde açılıyor.

Sitedeki her değişiklik (yeni oyun, kurucu panelinden masa ayarı, düzeltme)
uygulamada **anında** görünür; mağazaya yeni sürüm yüklemeniz gerekmez.
Mağaza güncellemesi yalnız şunlar değişince gerekir: uygulama adı, simge,
hedef Android sürümü ya da bu klasördeki kabuk kodu.

---

## Tek komutla derleme

`android` klasöründe bir CMD penceresi açıp:

```cmd
derle.bat
```

(ya da PowerShell'de: `powershell -ExecutionPolicy Bypass -File .\derle.ps1`)

Betik sırayla:

1. **JDK 17**'yi bulur, yoksa `winget` ile kurar.
2. **Android SDK**'yı bulur. Bilgisayarınızda zaten kurulu bir SDK varsa
   (TakasVarmi projesindeki `_tools\android-sdk` dahil) onu kullanır —
   birkaç GB'ı yeniden indirmez. Hiç yoksa indirip kurar.
3. **Gradle**'ı bulur/kurar.
4. **İmza anahtarı** yoksa oluşturur. Parolayı **siz** girersiniz; betik
   parolayı ekrana yazmaz, yalnızca `keystore.properties` dosyasına kaydeder.
5. **İmzalı `.aab`** dosyasını üretir ve klasörünü açar.

Çıktı: `android\app\build\outputs\bundle\release\app-release.aab`

> ⚠️ **`keystore/` klasörünün yedeğini alın.** Bu anahtar uygulamanızın
> kimliğidir: kaybederseniz Play'deki uygulamaya bir daha güncelleme
> yükleyemezsiniz, yeni paket adıyla sıfırdan uygulama açmanız gerekir.
> Anahtar ve parola `.gitignore` ile depo dışında tutulur — GitHub'a asla
> gitmez.

---

## Play Console'da yapılacaklar

Mağaza metinleri, görseller ve form cevapları depodaki **`PLAY-MAGAZA.md`**
dosyasında hazır. Özet akış:

1. Play Console → **Uygulama oluştur**
   (ad: *Masa Oyunları*, Oyun, Ücretsiz, Türkçe)
2. **Test → Kapalı test** sürümü oluşturup `app-release.aab` dosyasını yükleyin.
3. **Yayın → Kurulum → Uygulama imzalama** sayfasındaki **SHA-256 parmak izini**
   kopyalayıp depodaki `.well-known/assetlinks.json` içine yazın ve siteye
   yükleyin. Bu, `masaoyunlari.com.tr` bağlantılarının tarayıcı yerine
   uygulamada açılmasını sağlar (App Links).
4. Mağaza kaydını `PLAY-MAGAZA.md`'den doldurun; içerik derecelendirme ve
   "Veri güvenliği" formlarını gönderin.
5. Kapalı testte deneyin, sorun yoksa **Üretim**e yükseltin.

---

## Sürüm yükseltme

`app/build.gradle` içinde:

```gradle
versionCode 1        // her yüklemede ARTMALI, aynı değer iki kez yüklenemez
versionName "1.0.0"  // kullanıcıya görünen sürüm
```

`versionCode`'u bir artırıp `derle.bat`'ı tekrar çalıştırmanız yeterli.

---

## Klasör içeriği

| Yol | Ne |
|---|---|
| `app/src/main/java/.../MainActivity.java` | WebView kabuğu: açılış ekranı, çevrimdışı ekranı, geri tuşu, ekran kilidi, dış bağlantılar |
| `app/src/main/res/layout/activity_main.xml` | Ekran düzeni (webview + açılış + çevrimdışı) |
| `app/src/main/res/values/` | Uygulama adı, açılış adresi, renkler, tema |
| `app/src/main/res/mipmap-*/` | Uygulama simgeleri (`tools/android-ikonlari.py` üretir) |
| `app/src/main/AndroidManifest.xml` | İzinler, App Links, başlatıcı |
| `derle.bat` / `derle.ps1` | Tek komutla imzalı `.aab` |
| `keystore/`, `keystore.properties` | ⚠️ İmza anahtarı — depoya GİRMEZ |

Simgeleri yeniden üretmek için (logo değişirse):
`python3 tools/android-ikonlari.py`

---

## Oyun sitesine özgü kararlar

TakasVarmi kabuğundan bilerek ayrıldığımız yerler:

- **Aşağı çekip yenileme yok.** Masada yanlışlıkla yenilemek maçı koparır.
- **Kullanıcı ajanındaki `; wv` imzası korunur** ve ayrıca
  `MasaOyunlariApp/<sürüm>` eklenir; `js/webview.js` uygulama kipini bundan
  ve `window.MasaOyunlariApp` köprüsünden tanır.
- **Ekran oyun sırasında sönmez.** Site önce `navigator.wakeLock` dener;
  WebView'de o API yoksa native köprü `FLAG_KEEP_SCREEN_ON` ekler.
- **Dosya seçici / açılır pencere köprüsü yok** — oyun sitesi dosya yüklemiyor.
- **Geri tuşu** önce sayfanın kendi geçmişini tüketir, sonra "çıkmak için
  tekrar bas" uyarısı verir. Tek dokunuşla oyundan düşmek olmaz.
