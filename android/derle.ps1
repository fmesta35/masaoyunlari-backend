# ============================================================================
# Masa Oyunlari - imzali .aab derleme (Windows, PowerShell)
#
#  Bu betigi android klasorunun ICINDEN calistirin:
#      powershell -ExecutionPolicy Bypass -File .\derle.ps1
#
#  Ne yapar:
#   1) JDK 17'yi bulur (yoksa winget ile kurar)
#   2) Android SDK'yi BULUR - bilgisayarda zaten varsa (ornegin TakasVarmi
#      projesindeki _tools\android-sdk) onu kullanir, yoksa kurar
#   3) Gradle'i bulur/kurar
#   4) Imza anahtari yoksa olusturur (parolayi SIZ girersiniz; betik parolayi
#      hicbir yere yazdirmaz, yalnizca keystore.properties'e kaydeder)
#   5) Imzali app-release.aab dosyasini uretir
#
#  ASCII disinda karakter KULLANILMADI: Windows PowerShell 5.1 bu dosyayi
#  Windows-1254 ile okuyup Turkce harfleri bozabiliyor ve betik calismiyor.
# ============================================================================

# -OtomatikAnahtar : imza anahtari YOKSA parolayi sormadan, kriptografik
#   olarak guclu rastgele bir parola URETIR ve keystore.properties ile
#   keystore\PAROLA-GIZLI-TUT.txt dosyalarina yazar. Gozetimsiz derleme
#   (ornegin uzaktan calistirma) icindir; parola ekrana YAZILMAZ.
#   Bu dosyalarin yedegini almak SIZE aittir.
#
# VARSAYILAN: tek calistirmada HEM .aab HEM .apk uretilir.
#   .aab  -> Play Console'a yuklenir (magaza baska bir dosya kabul etmez)
#   .apk  -> telefona dogrudan kurulur (.aab bir cihaza KURULAMAZ)
# Ikisi ayni Gradle calismasindan, ayni kaynaklardan ve AYNI imza
# anahtarindan cikar; boylece telefonda denediginiz uygulama ile magazaya
# giden paket birebir ayni olur. Ayri ayri uretmek, arada kod degisirse
# "denedigim surum bu degilmis" tuzagini doguruyordu.
#
# -Apk : YALNIZ .apk uret (hizli; sadece telefonda denemek icin)
# -Aab : YALNIZ .aab uret (yalnizca magazaya yukleyecekseniz)
param([switch]$OtomatikAnahtar, [switch]$Apk, [switch]$Aab)

$ErrorActionPreference = "Continue"
$root = $PSScriptRoot
Set-Location $root

# Java .properties dosyalari ISO-8859-1 okunur; Turkce "i" (U+0131) orada
# YOK. -Encoding ASCII ile yazilinca karakter "?" olur ve yol bozulur
# (kullanici klasoru C:\Users\Faz_l -> Gradle SDK'yi ve imza anahtarini
# bulamaz). Dogrusu Java'nin kendi kacis bicimi: ASCII disi her karakter
# \uXXXX olarak yazilir.
function JavaProp($metin) {
    $sb = New-Object System.Text.StringBuilder
    foreach ($ch in $metin.ToCharArray()) {
        if ([int]$ch -lt 128) { [void]$sb.Append($ch) }
        else { [void]$sb.AppendFormat('\u{0:x4}', [int]$ch) }
    }
    return $sb.ToString()
}

function Ok($m)   { Write-Host "OK   $m" -ForegroundColor Green }
function Info($m) { Write-Host "->   $m" -ForegroundColor Cyan }
function Err($m)  { Write-Host "HATA $m" -ForegroundColor Red }

Write-Host ""
# Hicbiri verilmediyse IKISI birden.
$aabYap = (-not $Apk) -or $Aab
$apkYap = (-not $Aab) -or $Apk
if ($Apk -and $Aab) { $aabYap = $true; $apkYap = $true }
$hedefAd = if ($aabYap -and $apkYap) { ".aab + .apk" }
           elseif ($apkYap) { ".apk (telefona kurulum)" }
           else { ".aab (Play Console)" }
Write-Host "=== Masa Oyunlari - Android $hedefAd derleme ===" -ForegroundColor Yellow
Write-Host ""

# ---------------------------------------------------------------- 1) JDK 17
$jdkHome = $null
if ($env:JAVA_HOME -and (Test-Path "$env:JAVA_HOME\bin\javac.exe")) { $jdkHome = $env:JAVA_HOME }
if (-not $jdkHome) {
    foreach ($dir in @("$env:ProgramFiles\Eclipse Adoptium", "$env:ProgramFiles\Java", "$env:ProgramFiles\Microsoft")) {
        if (Test-Path $dir) {
            $j = Get-ChildItem $dir -Directory -ErrorAction SilentlyContinue |
                 Where-Object { $_.Name -match "jdk-?1[78]" } | Select-Object -First 1
            if ($j) { $jdkHome = $j.FullName; break }
        }
    }
}
if (-not $jdkHome) {
    Info "JDK 17 bulunamadi, winget ile kuruluyor (birkac dakika surebilir)..."
    try { winget install --id EclipseAdoptium.Temurin.17.JDK -e --accept-package-agreements --accept-source-agreements } catch { }
    $dir = "$env:ProgramFiles\Eclipse Adoptium"
    if (Test-Path $dir) {
        $j = Get-ChildItem $dir -Directory -ErrorAction SilentlyContinue |
             Where-Object { $_.Name -match "jdk-?17" } | Select-Object -First 1
        if ($j) { $jdkHome = $j.FullName }
    }
}
if (-not $jdkHome) {
    Err "JDK 17 kurulamadi. https://adoptium.net adresinden elle kurup betigi tekrar calistirin."
    exit 1
}
$env:JAVA_HOME = $jdkHome
Ok "JDK: $jdkHome"

# ------------------------------------------------------------ 2) Android SDK
# Once bilgisayarda ZATEN KURULU bir SDK ariyoruz. TakasVarmi projesinde
# tam kurulu bir SDK var; onu yeniden indirmek birkac GB bosa trafik olur.
$sdkAdaylari = @(
    "$root\_tools\android-sdk",
    "$env:LOCALAPPDATA\Android\Sdk",
    "$env:USERPROFILE\AppData\Local\Android\Sdk",
    "$env:USERPROFILE\Desktop\Asil\Web\Takasvarmi.com.tr\TakasVarmi-WebView-v2\mobile-app\_tools\android-sdk"
)
if ($env:ANDROID_HOME) { $sdkAdaylari = @($env:ANDROID_HOME) + $sdkAdaylari }

$androidSdk = $null
foreach ($a in $sdkAdaylari) {
    if ($a -and (Test-Path "$a\platforms\android-36")) { $androidSdk = $a; break }
}
if (-not $androidSdk) {
    foreach ($a in $sdkAdaylari) {
        if ($a -and (Test-Path "$a\cmdline-tools\latest\bin\sdkmanager.bat")) { $androidSdk = $a; break }
    }
}

if (-not $androidSdk) {
    Info "Kurulu Android SDK bulunamadi, indiriliyor..."
    $androidSdk = "$root\_tools\android-sdk"
    New-Item -ItemType Directory -Force -Path "$root\_tools" | Out-Null
    $zip = "$root\_tools\cmdline-tools.zip"
    if (-not (Test-Path $zip)) {
        try {
            Invoke-WebRequest -Uri "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip" -OutFile $zip
        } catch {
            Err "Android SDK indirilemedi. https://developer.android.com/studio#command-tools adresinden"
            Err "'Command line tools only' Windows surumunu indirip su yola koyun: $zip"
            exit 1
        }
    }
    $tmp = "$root\_tools\_cmd_extract"
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    New-Item -ItemType Directory -Force -Path "$androidSdk\cmdline-tools" | Out-Null
    Move-Item -Path "$tmp\cmdline-tools" -Destination "$androidSdk\cmdline-tools\latest" -Force
    Remove-Item -Recurse -Force $tmp
}
$env:ANDROID_HOME = $androidSdk
$env:ANDROID_SDK_ROOT = $androidSdk
Ok "Android SDK: $androidSdk"

# Gerekli paketler eksikse tamamla (varsa sdkmanager hizlica gecer).
$sdkmanager = "$androidSdk\cmdline-tools\latest\bin\sdkmanager.bat"
if ((-not (Test-Path "$androidSdk\platforms\android-36")) -and (Test-Path $sdkmanager)) {
    Info "SDK paketleri tamamlaniyor (platforms;android-36, build-tools;36.0.0)..."
    1..20 | ForEach-Object { "y" } | & $sdkmanager --licenses 2>$null | Out-Null
    & $sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0" | Out-Null
}

# ----------------------------------------------------------------- 3) Gradle
$gradleBat = $null
$gradleAdaylari = @(
    "$root\_tools\gradle-8.13\bin\gradle.bat",
    "$env:USERPROFILE\Desktop\Asil\Web\Takasvarmi.com.tr\TakasVarmi-WebView-v2\mobile-app\_tools\gradle-8.13\bin\gradle.bat",
    "$env:USERPROFILE\Desktop\Asil\Web\Takasvarmi.com.tr\TakasVarmi-WebView-v2\mobile-app\_tools\gradle-8.7\bin\gradle.bat"
)
foreach ($g in $gradleAdaylari) { if (Test-Path $g) { $gradleBat = $g; break } }
if (-not $gradleBat) {
    $g = Get-Command gradle -ErrorAction SilentlyContinue
    if ($g) { $gradleBat = $g.Source }
}
if (-not $gradleBat) {
    Info "Gradle bulunamadi, indiriliyor..."
    New-Item -ItemType Directory -Force -Path "$root\_tools" | Out-Null
    $gzip = "$root\_tools\gradle.zip"
    if (-not (Test-Path $gzip)) {
        try { Invoke-WebRequest -Uri "https://services.gradle.org/distributions/gradle-8.13-bin.zip" -OutFile $gzip }
        catch {
            Err "Gradle indirilemedi. https://gradle.org/releases/ adresinden 8.13 'Binary-only'"
            Err "surumunu indirip su yola koyun: $gzip"
            exit 1
        }
    }
    Expand-Archive -Path $gzip -DestinationPath "$root\_tools" -Force
    $gradleBat = "$root\_tools\gradle-8.13\bin\gradle.bat"
}
Ok "Gradle: $gradleBat"
$env:PATH = "$jdkHome\bin;$env:PATH"

# ------------------------------------------------------------ 4) Imza anahtari
$keyDir   = "$root\keystore"
$keyFile  = "$keyDir\masaoyunlari-release.keystore"
$propFile = "$root\keystore.properties"
$keyAlias = "masaoyunlari"

if (-not (Test-Path $keyFile)) {
    Write-Host ""
    Write-Host "--- IMZA ANAHTARI OLUSTURULUYOR ---" -ForegroundColor Yellow
    Write-Host "Bu anahtar uygulamanizin KIMLIGIDIR. Kaybederseniz Play'deki" -ForegroundColor Yellow
    Write-Host "uygulamaya BIR DAHA guncelleme yukleyemezsiniz. Olustuktan sonra" -ForegroundColor Yellow
    Write-Host "keystore klasorunun yedegini cevrimdisi bir yerde saklayin." -ForegroundColor Yellow
    Write-Host ""
    if ($OtomatikAnahtar) {
        # Rastgele, guclu parola. Ekrana yazilmaz; yalnizca dosyaya gider.
        $bayt = New-Object byte[] 24
        [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bayt)
        $s1 = ([Convert]::ToBase64String($bayt) -replace '[^A-Za-z0-9]', '').Substring(0, 24)
        Info "Parola otomatik uretildi (ekrana yazilmaz)."
    } else {
        $p1 = Read-Host "Anahtar parolasi belirleyin (en az 6 karakter)" -AsSecureString
        $p2 = Read-Host "Parolayi tekrar girin" -AsSecureString
        $s1 = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($p1))
        $s2 = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($p2))
        if ($s1 -ne $s2) { Err "Parolalar ayni degil."; exit 1 }
        if ($s1.Length -lt 6) { Err "Parola en az 6 karakter olmali."; exit 1 }
    }

    New-Item -ItemType Directory -Force -Path $keyDir | Out-Null
    & "$jdkHome\bin\keytool.exe" -genkeypair -v `
        -keystore $keyFile -alias $keyAlias `
        -keyalg RSA -keysize 2048 -validity 10000 `
        -storepass $s1 -keypass $s1 `
        -dname "CN=Masa Oyunlari, OU=Masa Oyunlari, O=masaoyunlari.com.tr, L=Istanbul, C=TR" | Out-Null
    if (-not (Test-Path $keyFile)) { Err "Anahtar olusturulamadi."; exit 1 }

    $yol = JavaProp ($keyFile -replace '\\', '/')
    @(
        "storeFile=$yol",
        "storePassword=$(JavaProp $s1)",
        "keyAlias=$keyAlias",
        "keyPassword=$(JavaProp $s1)"
    ) | Set-Content -Path $propFile -Encoding ASCII
    # Parolayi ayrica okunakli bir not dosyasina yaz: keystore.properties
    # teknik bir dosya, kullanici yedeklerken ne oldugunu bilsin.
    @(
        "MASA OYUNLARI - ANDROID IMZA ANAHTARI",
        "=====================================",
        "Bu dosyayi ve yanindaki .keystore dosyasini CEVRIMDISI bir yerde",
        "saklayin. Kaybederseniz Play'deki uygulamaya bir daha guncelleme",
        "yukleyemezsiniz; yeni paket adiyla sifirdan uygulama acmaniz gerekir.",
        "",
        "Anahtar dosyasi : masaoyunlari-release.keystore",
        "Takma ad (alias): $keyAlias",
        "Parola          : $s1",
        "",
        "Bu klasor .gitignore ile depo disinda tutulur; GitHub'a gitmez."
    ) | Set-Content -Path "$keyDir\PAROLA-GIZLI-TUT.txt" -Encoding UTF8
    $s1 = $null; $s2 = $null
    Ok "Imza anahtari olusturuldu: $keyFile"
    Write-Host "     Parola: keystore\PAROLA-GIZLI-TUT.txt" -ForegroundColor Yellow
    Write-Host "     Yedegini alin! keystore/ ve keystore.properties depoya GIRMEZ (.gitignore)." -ForegroundColor Yellow
} else {
    Ok "Imza anahtari zaten var: $keyFile"
    if (-not (Test-Path $propFile)) {
        Err "keystore.properties yok ama anahtar var. Parolayi bilerek su dosyayi olusturun:"
        Err "  $propFile"
        Err "icerigi:  storeFile=... / storePassword=... / keyAlias=$keyAlias / keyPassword=..."
        exit 1
    }
}

# --------------------------------------------------------------- 5) local.properties
$sdkYol = JavaProp ($androidSdk -replace '\\', '/')
"sdk.dir=$sdkYol" | Set-Content -Path "$root\local.properties" -Encoding ASCII

# ------------------------------------------------------------------ 6) Derle
Write-Host ""
Info "Derleniyor (ilk derleme bagimliliklari indirir, birkac dakika surer)..."
$gorevler = @()
if ($aabYap) { $gorevler += "bundleRelease" }
if ($apkYap) { $gorevler += "assembleRelease" }
# Tek Gradle calismasi: iki cikti da AYNI derlemeden gelir.
& $gradleBat @gorevler --no-daemon --warning-mode=none
$kod = $LASTEXITCODE

$aabYol = "$root\app\build\outputs\bundle\release\app-release.aab"
$apkYol = "$root\app\build\outputs\apk\release\app-release.apk"
$bekleyen = @()
if ($aabYap) { $bekleyen += $aabYol }
if ($apkYap) { $bekleyen += $apkYol }
# @(...) : tek sonucta da DIZI dondur, .Count her durumda calissin.
$eksik = @($bekleyen | Where-Object { -not (Test-Path $_) })

Write-Host ""
if ($kod -eq 0 -and $eksik.Count -eq 0) {
    Ok "BITTI."
    Write-Host ""
    if ($aabYap) {
        $mb = [math]::Round((Get-Item $aabYol).Length / 1MB, 2)
        Write-Host "  PLAY CONSOLE'A YUKLENECEK (.aab):" -ForegroundColor Green
        Write-Host "     $aabYol  ($mb MB)" -ForegroundColor Green
        Write-Host ""
    }
    if ($apkYap) {
        $mb = [math]::Round((Get-Item $apkYol).Length / 1MB, 2)
        Write-Host "  TELEFONA KURULACAK (.apk):" -ForegroundColor Green
        Write-Host "     $apkYol  ($mb MB)" -ForegroundColor Green
        Write-Host ""
    }
    if ($apkYap) {
        Write-Host "Telefona nasil kurulur:" -ForegroundColor Cyan
        Write-Host "  1) APK'yi USB kablosuyla, e-postayla ya da WhatsApp ile telefona gonderin." -ForegroundColor Cyan
        Write-Host "  2) Telefonda dosyaya dokunun. Android 'bilinmeyen kaynak' uyarisi verirse" -ForegroundColor Cyan
        Write-Host "     'Ayarlar'a gidip o uygulamaya (Dosyalar / Chrome / WhatsApp) kurulum" -ForegroundColor Cyan
        Write-Host "     izni verin; bu izin yalnizca o uygulama icin gecerlidir." -ForegroundColor Cyan
        Write-Host "  3) Play surumuyle AYNI paket adini tasidigi icin ikisi bir arada duramaz;" -ForegroundColor Cyan
        Write-Host "     Play'den kurmadan once bu APK'yi kaldirin." -ForegroundColor Cyan
        Write-Host ""
    }
    if ($aabYap) {
        Write-Host "Sonraki adim: Play Console > Uygulama imzalama sayfasindaki SHA-256" -ForegroundColor Cyan
        Write-Host "parmak izini .well-known/assetlinks.json icine yazip siteye yukleyin." -ForegroundColor Cyan
    }
    $ac = if ($aabYap) { Split-Path $aabYol } else { Split-Path $apkYol }
    try { Start-Process $ac } catch { }
} else {
    Err "Derleme basarisiz (cikis kodu $kod). Yukaridaki kirmizi satirlari gonderin."
    exit 1
}
