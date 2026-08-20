<?php
// ============================================================================
// GEÇİCİ TEŞHİS DOSYASI — sadece MySQL bağlantı hatasını görmek içindir.
// !!! SORUN ÇÖZÜLÜNCE BU DOSYAYI SUNUCUDAN SİL (güvenlik: hata mesajı içerir) !!!
// Kullanım: /public_html/api/ içine yükle, tarayıcıdan aç:
//     https://www.masaoyunlari.com.tr/api/gv-dbtest.php
// ============================================================================
header('Content-Type: text/plain; charset=utf-8');
require __DIR__ . '/config.php';

echo "== GameVerse MySQL bağlantı testi ==\n\n";
echo "Host      : " . GV_DB_HOST . "\n";
echo "Veritabanı: " . GV_DB_NAME . "\n";
echo "Kullanıcı : " . GV_DB_USER . "\n\n";

try {
    $pdo = new PDO(
        'mysql:host=' . GV_DB_HOST . ';dbname=' . GV_DB_NAME . ';charset=utf8mb4',
        GV_DB_USER,
        GV_DB_PASS,
        array(PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION)
    );
    echo "SONUÇ: BAĞLANTI BAŞARILI ✓\n\n";
    echo "Mevcut tablolar:\n";
    $found = false;
    foreach ($pdo->query('SHOW TABLES') as $row) {
        $found = true;
        echo ' - ' . $row[0] . "\n";
    }
    if (!$found) echo " (henüz tablo yok — selftest ilk çalıştırmada otomatik oluşturur)\n";
} catch (Exception $e) {
    echo "SONUÇ: BAĞLANTI HATASI ✗\n";
    echo 'Mesaj: ' . $e->getMessage() . "\n\n";
    echo "Olası çözümler:\n";
    echo "1) oPanel → MySQL Veritabanları: bu isimde veritabanı VAR MI?\n";
    echo "   (Paneldeki TAM adı kopyala — önekli olabilir)\n";
    echo "2) Aynı sayfada kullanıcı VAR MI ve veritabanına EKLİ Mİ?\n";
    echo "   ('Kullanıcıyı Veritabanına Ekle' → TÜM YETKİLER)\n";
    echo "3) Şifre doğru mu? Gerekirse kullanıcıya yeni şifre ver,\n";
    echo "   config.php içindeki GV_DB_PASS satırını güncelle.\n";
}
