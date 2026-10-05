@echo off
REM Masa Oyunlari - TELEFONA KURULACAK .apk derleme.
REM Play Console'a .aab yuklenir (derle.bat), ama .aab telefona KURULAMAZ;
REM uygulamayi kendi cihazinizda denemek icin bu dosyayi cift tiklayin.
REM Ikisi de ayni imza anahtariyla imzalanir, davranis birebir aynidir.
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0derle.ps1" -Apk
echo.
pause
