# GameVerse — Yöncü'ye Taşınan Katman (veritabanı + mail) Kurulum Rehberi

Bu rehberle **üyelik, arkadaş, maç geçmişi ve sohbet kayıtları Yöncü MySQL'de**,
**mailler Yöncü'den (PHP mail)** gider. Render yalnızca gerçek zamanlı katman
(oyun/sohbet/davet anlık iletişimi) olarak kalır — ona yük binmez.

---

## Adım 1 — cPanel'de MySQL oluşturun

1. Yöncü cPanel → **MySQL Veritabanları**
2. Yeni veritabanı: `masaoyun_gameverse` (ad not edin — ön ek otomatik gelebilir, örn. `masaoyunl_gameverse`)
3. Yeni kullanıcı: `masaoyun_gv` + **güçlü şifre** oluşturun
4. **Kullanıcıyı veritabanına ekleyin → Tüm izinleri verin**

## Adım 2 — config.php'yi sunucuda doldurun

`yoncu-api/config.php` içindeki 4 satırı (DB_HOST/NAME/USER/PASS) az önce
oluşturduğunuz bilgilerle doldurun. `GV_SERVER_KEY` için uzun rastgele bir
anahtar uydurun (40+ karakter) — **aynı anahtar Render'a da girecek**.

> Güvenlik: gerçek şifreler GitHub'a YAZILMAZ. Bu dosyayı sadece Yöncü'de düzenleyin.

## Adım 3 — Dosyaları Yöncü'ye yükleyin

| Ne | Nereye (Yöncü public_html) |
|---|---|
| `yoncu-api/` klasörünün **içeriği** (config.php, bootstrap.php, mailer.inc.php, auth.php, social.php) | **`/api/` klasörü oluşturup içine** |
| `js/config.js`, `js/auth.js`, `js/social.js` (20260820f) | site kökündeki `js/` |
| `index.html` | site kökü |

Sonunda linkler şöyle olmalı: `https://www.masaoyunlari.com.tr/api/auth.php?action=register`

## Adım 4 — Kurulumu tarayıcıdan doğrulayın

Açın: `https://www.masaoyunlari.com.tr/api/auth.php?action=selftest`

- Tüm adımlar `ok:true` olmalı (tablolar kendiliğinden kurulur — phpMyAdmin'e SQL girmek GEREKMEZ).
- Mail testi için: `.../api/auth.php?action=selftest&send=KENDIMAILADRESINIZ@gmail.com` → gelen kutusuna bakın (Spam dahil).

## Adım 5 — Render tarafı (son bağlantı)

Render → masaoyunlari-backend → **Environment**:

| Değişken | Değer |
|---|---|
| `GV_AUTH_API` | `https://www.masaoyunlari.com.tr/api` |
| `GV_SERVER_KEY` | config.php'ye yazdığınız anahtarın aynısı |

Sonra **Deploy latest commit**. (Bu modda `GV_SMTP_PASS` ve `GV_DATA_DIR` ARTIK GEREKMEZ — mail Yöncü'den, kayıtlar MySQL'den; kalıcı disk de opsiyonel olur.)

`https://masaoyunlari-backend.onrender.com/api/auth/mail-status` adresi artık PHP mail durumunu proxyleyerek gösterir.

## Doğrulama (uçtan uca)

1. Yeni bir üyeyle kayıt olun → onay maili GELMELİ (mail: info@masaoyunlari.com.tr'den).
2. Onay linki → giriş → sol panelde arkadaş listesi.
3. Sohbete bir şey yazın, sayfa yenileyin veya Render'ı yeniden başlatın → phpMyAdmin'de `gv_chat` tablosu dolmalı.
4. Bir maç bitirin → `gv_matches` tablosunda görünmeli.

## Notlar

- Render yeniden başlasa bile üyelikler/arkadaşlar/maçlar/mailler asla kaybolmaz — hepsi MySQL'de.
- Anlık "çevrimiçi" göstergesi bilinçli olarak Render'da tutulur (socket) — sayfa yenileyince kendiliğinden doğrulanır.
- `api.php` + `db.php` (site kökündeki ESKİ dosyalar) bu sistemin parçası değildir; isterseniz silin, isterseniz bırakın — yenileri `/api/` klasöründedir, çakışmaz.
