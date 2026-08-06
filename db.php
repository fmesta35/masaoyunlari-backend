<?php
$host = 'localhost';
$user = 'masaoyun_kurucu'; 
$db   = 'masaoyun_db';      // phpMyAdmin'deki veritabanı adın
$pass = 'kurucu123';        // cPanel'de belirlediğin şifre

try {
    $pdo = new PDO("mysql:host=$host;dbname=$db;charset=utf8mb4", $user, $pass);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
} catch (PDOException $e) {
    die("Veritabanı bağlantı hatası: " . $e->getMessage());
}
?>