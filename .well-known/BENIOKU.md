# `.well-known/assetlinks.json` — Android uygulaması bağlantısı

Bu dosya, Google Play'e yüklenecek Android uygulamasının (TWA) bu alan
adına ait olduğunu Android'e kanıtlar. Doğru doldurulmazsa uygulama
sitenizi **tarayıcı adres çubuğuyla** açar (TWA yerine "Custom Tab"
görünümü) — kullanıcı uygulama içinde olduğunu hissetmez.

## Doldurulacak iki alan

1. `package_name` — uygulamanızın paket adı
   (örn. `tr.com.masaoyunlari.twa`). Play Console'da bir kez belirlenir,
   sonradan DEĞİŞTİRİLEMEZ.
2. `sha256_cert_fingerprints` — uygulamayı imzalayan sertifikanın
   SHA-256 parmak izi. Play Console → **Yayın → Kurulum → Uygulama
   imzalama** sayfasındaki "SHA-256 sertifika parmak izi" değeri.
   (Play App Signing kullanıyorsanız hem *upload* hem *app signing*
   parmak izini listeye ekleyin.)

## Nereye konur

Dosya sitenin KÖKÜNDE, tam olarak şu adreste yayında olmalıdır:

    https://www.masaoyunlari.com.tr/.well-known/assetlinks.json

Yöncü'de: `public_html/.well-known/assetlinks.json`
İçerik türü `application/json` dönmelidir (sunucu bunu kendisi ayarlar).

## Doğrulama

    https://developers.google.com/digital-asset-links/tools/generator

adresinden ya da uygulamayı kurup adres çubuğunun görünmediğini
kontrol ederek doğrulayabilirsiniz.
