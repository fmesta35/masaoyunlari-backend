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
| `yoncu-api/` klasörünün **içeriği** (bootstrap.php, mailer.inc.php, auth.php, social.php, admin.php) | **`/api/` klasörü oluşturup içine** |
| `js/config.js`, `js/auth.js`, `js/social.js` (20260820f) | site kökündeki `js/` |
| `index.html` | site kökü |

> 🚫 **`config.php` ASLA yüklenmez!** Depodaki config.php şablondur
> (`BURAYA_...` yer tutucuları). Sunucudaki gerçek `config.php` (gerçek DB
> ve SMTP şifreleriyle) **TEK KAYNAKTIR**; dosya yöneticisinde düzenlenir.
> Şablonu sunucuya yüklerseniz bilgiler ezilir ve üyelik sistemi
> **"Veritabanına bağlanılamadı"** hatasıyla DURUR. Şablonda yeni bir alan
> (örn. `GV_ADMIN_EMAIL`) çıktıysa, o SATIRI sunucudaki gerçek dosyanın
> sonuna kopyalayın — dosyayı baştan yüklemeyin.

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

---

## 📦 Dosya Dağılımı — Ne Yöncü'ye, Ne Render'a? (özet tablo)

Kural basit: **Tarayıcının indirdiği her şey Yöncü'ye**, **Node.js'in çalıştırdığı
her şey Render'a**. İkisi de aynı GitHub deposundan beslenir; Render depoyu
otomatik çeker, Yöncü'ye ise ilgili dosyaları FTP/dosya yöneticisiyle siz atarsınız.

### A) YÖNCÜ'ye yüklenecekler (paylaşımlı hosting — `public_html`)

| Dosya / klasör | Nereye | Not |
|---|---|---|
| `index.html` | site kökü | Tüm arayüz. **Her güncellemede yeniden yükleyin.** |
| `css/style.css` | `css/` | |
| `js/` klasörünün TAMAMI | `js/` | `config.js`, `okey-online.js`, `room-waiting-fix.js`, `board-fit.js`, `socket.io.min.js` ve diğerleri |
| `assets/` | `assets/` | logo, favicon |
| `manifest.json` | site kökü | PWA |
| `yoncu-api/` içeriği | **`/api/` klasörü** | `bootstrap.php`, `auth.php`, `social.php`, `admin.php`, `mailer.inc.php`, `.htaccess` |

> 🚫 `yoncu-api/config.php` **ASLA yüklenmez** — sunucudaki gerçek dosya tek kaynaktır.
> 🚫 `node_modules/`, `test/`, `server.js`, `*-engine.js` Yöncü'ye **gitmez** (PHP hosting bunları çalıştıramaz).

### B) GitHub → RENDER'da kalacaklar (Node.js sunucusu)

| Dosya | Görevi |
|---|---|
| `server.js` | Socket.IO gerçek zamanlı motor: odalar, koltuklar, sıra, saatler |
| `server-auth.js`, `auth-remote.js`, `db.js`, `mailer.js` | Üyelik/oturum katmanı (uzak modda Yöncü MySQL'e proxy) |
| `okey-engine.js`, `tavla-engine.js`, `dama-engine.js`, `turkdamasi-engine.js`, `reversi-engine.js`, `gomoku-engine.js`, `connect4-engine.js`, `bilardo-engine.js`, `pisti-engine.js`, `batak-engine.js` | Sunucu yetkili oyun kuralları |
| `config.js` (kökteki) | Backend URL çözümü |
| `package.json`, `package-lock.json` | Bağımlılıklar |
| `test/` | Regresyon testleri (`npm test`) |

> Render bu dalı izler: **`arena/01a038be-masaoyunlari-backend`**. Push edildiğinde otomatik dağıtır.

### C) İKİ TARAFTA DA bulunanlar (bilinçli kopya)

`index.html`, `css/`, `js/`, `assets/` Render'da da durur — çünkü Render statik
sunucu olarak da çalışır (`https://masaoyunlari-backend.onrender.com/index.html`).
Böylece Yöncü'ye yükleme yapmadan da test edebilirsiniz. **Canlı site Yöncü'dür**;
Render kopyası yalnız test/yedek amaçlıdır.

### D) Silinebilecek eski dosyalar

`api.php` ve `db.php` (site kökündeki ESKİ PHP katmanı) bu sistemin parçası
değildir. Yeni katman `/api/` klasöründedir. İsterseniz silin.

### E) ⚠️ Güncelleme sonrası ÖNBELLEK

`index.html` içindeki `?v=...` etiketleri tarayıcı önbelleğini kırar. Bir `js/`
dosyasını değiştirdiğinizde **hem o dosyayı hem de `index.html`'i** Yöncü'ye
yükleyin; aksi halde kullanıcılar eski JS ile çalışmaya devam eder.
