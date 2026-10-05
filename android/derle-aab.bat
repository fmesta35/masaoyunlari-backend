@echo off
REM Masa Oyunlari - YALNIZ .aab (Play Console'a yukleyecekseniz).
REM Telefonda da denemek isterseniz derle.bat calistirin: o ikisini
REM birden, tek derlemeden uretir.
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0derle.ps1" -Aab
echo.
pause
