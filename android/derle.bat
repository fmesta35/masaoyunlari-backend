@echo off
REM Masa Oyunlari - TEK KOMUTLA HEM .aab HEM .apk derleme.
REM   .aab -> Play Console'a yuklenir (magaza baska dosya kabul etmez)
REM   .apk -> telefona dogrudan kurulur (.aab bir cihaza KURULAMAZ)
REM Ikisi ayni Gradle calismasindan ve ayni imza anahtarindan cikar, yani
REM telefonda denediginiz uygulama magazaya gidenle birebir aynidir.
REM Yalniz APK isterseniz derle-apk.bat, yalniz AAB isterseniz derle-aab.bat.
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0derle.ps1"
echo.
pause
