# GameVerse - Profesyonel Masa Oyunları Platformu

Türkiye'nin en popüler çok oyunculu masa oyunları platformu. Okey, Tavla, Satranç, Dama ve daha fazlası!

## 🎮 Özellikler

- **Responsive Tasarım**: Mobil, tablet ve masaüstü uyumlu
- **SEO Uyumlu**: Meta etiketleri, Open Graph ve Structured Data
- **Yüksek Performans**: Optimize edilmiş CSS/JS, lazy loading
- **Temiz Kod**: Modüler yapı, JSDoc dokümantasyonu
- **PWA Desteği**: Offline çalışma, install edilebilir
- **Dark/Light Mode**: Kullanıcı tercihine göre tema

## 📁 Dosya Yapısı

```
/workspace/
├── index.html          # Ana HTML dosyası (inline CSS + JS)
├── css/
│   └── style.css       # Ayrı stil dosyası
├── js/
│   ├── app.js          # Ana uygulama modülü
│   ├── games.js        # Oyun mantığı modülü
│   └── utils.js        # Yardımcı fonksiyonlar
├── assets/
│   ├── icons/          # Favicon ve ikonlar
│   ├── images/         # Görseller
│   └── sounds/         # Ses dosyaları
├── images/             # Ek görseller
├── api.php             # PHP API endpoint'i
├── db.php              # Veritabanı bağlantısı
├── manifest.json       # PWA manifest
└── README.md           # Bu dosya
```

## 🚀 Kurulum (Paylaşımlı Hosting)

1. **Dosyaları Yükleyin**
   - Tüm dosyaları hostinginizin public_html veya www klasörüne yükleyin
   
2. **Veritabanı Ayarları**
   - `db.php` dosyasını düzenleyin:
   ```php
   $host = 'localhost';
   $user = 'your_db_user';
   $db   = 'your_db_name';
   $pass = 'your_db_password';
   ```

3. **Veritabanı Tablolarını Oluşturun**
   ```sql
   CREATE TABLE users (
       id INT AUTO_INCREMENT PRIMARY KEY,
       username VARCHAR(50) UNIQUE NOT NULL,
       email VARCHAR(100),
       password VARCHAR(255),
       score INT DEFAULT 0,
       is_guest TINYINT DEFAULT 0,
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
   );
   
   CREATE TABLE rooms (
       id INT AUTO_INCREMENT PRIMARY KEY,
       game_id VARCHAR(50) NOT NULL,
       room_name VARCHAR(100),
       max_players INT DEFAULT 2,
       current_players INT DEFAULT 0,
       status ENUM('waiting', 'playing', 'finished') DEFAULT 'waiting',
       is_private TINYINT DEFAULT 0,
       created_by INT,
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
   );
   
   CREATE TABLE room_players (
       id INT AUTO_INCREMENT PRIMARY KEY,
       room_id INT NOT NULL,
       user_id INT NOT NULL,
       seat_index INT NOT NULL,
       is_ready TINYINT DEFAULT 0,
       FOREIGN KEY (room_id) REFERENCES rooms(id),
       FOREIGN KEY (user_id) REFERENCES users(id)
   );
   
   CREATE TABLE chats (
       id INT AUTO_INCREMENT PRIMARY KEY,
       room_id INT,
       username VARCHAR(50) NOT NULL,
       message TEXT NOT NULL,
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
   );
   ```

4. **PHP Sürümü**
   - Minimum PHP 7.4 önerilir
   - PDO MySQL extension aktif olmalı

## 🎯 Kullanılan Teknolojiler

- **Frontend**: HTML5, CSS3, Vanilla JavaScript (ES6+)
- **Backend**: PHP 7.4+
- **Database**: MySQL/MariaDB
- **Stil**: CSS Variables, Flexbox, Grid
- **PWA**: Service Worker, Web App Manifest

## 📱 Responsive Breakpoints

- Desktop: > 1024px
- Tablet: 768px - 1024px
- Mobile: < 768px
- Small Mobile: < 480px

## 🔧 Özelleştirme

### Renk Teması
`index.html` içindeki CSS variables'ı düzenleyin:

```css
:root {
  --primary: #6c5ce7;
  --accent: #00cec9;
  --bg: #0a0a1a;
  /* ... */
}
```

### Logo
Header kısmındaki emojiyi kendi logonuzla değiştirin:
```html
<div class="logo">🎮 GameVerse</div>
```

## 📊 SEO Optimizasyonları

- Meta description ve keywords
- Open Graph tags (sosyal medya)
- Structured Data (JSON-LD)
- Semantic HTML
- Alt text for images
- Sitemap.xml (eklenebilir)
- Robots.txt (eklenebilir)

## ⚡ Performans İpuçları

1. Görselleri optimize edin (WebP formatı önerilir)
2. CDN kullanın (Cloudflare vb.)
3. Gzip/Brotli compression aktif edin
4. Browser caching ayarlayın
5. Lazy loading kullanın

## 🔒 Güvenlik

- SQL Injection koruması (PDO prepared statements)
- XSS koruması (htmlspecialchars)
- CSRF token (form'larda kullanılabilir)
- HTTPS kullanımı önerilir

## 📄 Lisans

Bu proje özel bir proje olarak geliştirilmiştir.

## 👥 İletişim

Sorularınız için: info@gameverse.com

---

**GameVerse** © 2024 - Tüm Hakları Saklıdır.
