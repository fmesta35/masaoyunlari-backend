@echo off
REM Masa Oyunlari - .aab derleme. CMD'den cift tiklayarak ya da
REM "derle.bat" yazarak calistirabilirsiniz; is PowerShell betigine devredilir.
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0derle.ps1"
echo.
pause
