@echo off
REM Masa Oyunlari - YALNIZ .apk (hizli; sadece telefonda denemek icin).
REM Magazaya yuklenecek .aab de lazimsa derle.bat calistirin: o ikisini
REM birden, tek derlemeden uretir.
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0derle.ps1" -Apk
echo.
pause
