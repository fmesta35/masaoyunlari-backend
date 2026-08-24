<?php
/*
 * GameVerse — Yöncü tarafı yapılandırması (SUNUCUDA DOLDURULUR!)
 *
 *  🚫  BU DOSYAYI SUNUCUYA BASA BASINA YUKLEMEYIN!  🚫
 *  Bu depo kopyasi SABLONDUR (BURAYA_... yer tutuculari icerir).
 *  Sunucuya yuklenirse gercek config.php EZILIR -> uyelik sistemi
 *  "Veritabanina baglanilamadi" hatasiyla DURUR. Sunucu uzerindeki
 *  /public_html/api/config.php TEK KAYNAKTIR ve oPanel'den duzenlenir.
 *  Burada yeni bir alan cikiyorsa (orn. GV_ADMIN_EMAIL) o SATIRI
 *  sunucudaki dosyanin sonuna ekleyin, dosyayi degistirMEYIN.
 *
 *  ⚠️⚠️  DİKKAT: BU DOSYA ŞABLONDUR  ⚠️⚠️
 *  Gerçek şifreleri ASLA bu dosyaya / GITHUB'A yazmayın! Gerçek doldurulmuş
 *  kopya YALNIZCA Yöncü sunucusunda (/public_html/api/config.php) yaşar ve
 *  orada oPanel Dosya Yöneticisi ile düzenlenir. GitHub'a gerçek şifre
 *  girilirse sızmış sayılır → şifreleri değiştirmek gerekir.
 *
 *  Doldurulacak alanlar:
 *    1) GV_DB_NAME / GV_DB_USER / GV_DB_PASS → oPanel MySQL Veritabanları
 *    2) GV_SERVER_KEY  → Render (backend) ile aynı uzun rastgele anahtar
 *    3) GV_SMTP_PASS   → oPanel'de açtığınız info@ kutusunun şifresi
 */

define('GV_DB_HOST', 'localhost');
define('GV_DB_NAME', 'BURAYA_VERITABANI_ADI');      // örn. masaoyun_db
define('GV_DB_USER', 'BURAYA_KULLANICI_ADI');       // örn. masaoyun_kurucu
define('GV_DB_PASS', 'BURAYA_SIFRE');               // MySQL kullanıcı şifresi

/* Render (backend) ile paylaşılan gizli anahtar: maç/sohbet kaydı gibi
 * yalnızca sunucunun yazabileceği uçları korur. Render'a GV_SERVER_KEY
 * olarak AYNI değer girilir. Uzun ve rastgele yapın (örn. 40+ karakter). */
define('GV_SERVER_KEY', 'BURAYA_UZUN_RASTGELE_ANAHTAR');

/* Site adresi (maildeki onay/sıfırlama linkleri buraya kurulur) */
define('GV_SITE_URL', 'https://www.masaoyunlari.com.tr');

/* Maillerin görünen göndereni (Yöncü panelinde açtığınız kutu) */
define('GV_MAIL_FROM', 'Masa Oyunları <info@masaoyunlari.com.tr>');
define('GV_MAIL_FROM_ADDR', 'info@masaoyunlari.com.tr');

/* SMTP ile gönderim (ÖNERİLİR — teslim oranı PHP mail()'den çok daha yüksek):
 * Yöncü'de açtığınız info@ kutusunun şifresini GV_SMTP_PASS'e yazın.
 * Boş/yer tutucu bırakılırsa sistem eskisi gibi PHP mail() ile gönderir. */
define('GV_SMTP_HOST', 'mail.masaoyunlari.com.tr');
define('GV_SMTP_PORT', 465);
define('GV_SMTP_USER', 'info@masaoyunlari.com.tr');
define('GV_SMTP_PASS', 'BURAYA_SMTP_ŞİFRESİ');

/* Yonetici (kurucu) hesabi — Kurucu Paneli yalniz bu e-posta
 * oturumunda acar. Hesap yoksa ilk kimlik isleminde OTOMATIK
 * olusturulur (onayli, sifre: kurucu123). Varsayilan:
 * kurucu@kurucu.com — degistirmek isterseniz degistirin. */
define('GV_ADMIN_EMAIL', 'kurucu@kurucu.com');
