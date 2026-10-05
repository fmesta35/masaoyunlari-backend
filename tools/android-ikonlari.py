# -*- coding: utf-8 -*-
"""
ANDROID UYGULAMA SİMGELERİ — android/app/src/main/res/mipmap-*/

assets/logo.png'den Android'in istediği bütün simge biçimlerini üretir:

  ic_launcher.png            eski (API 25 ve altı) kare simge
  ic_launcher_round.png      eski yuvarlak simge
  ic_launcher_foreground.png uyarlanabilir simgenin ön planı (API 26+)
  ic_launcher_monochrome.png temalı simge (Android 13+ "Themed icons")

UYARLANABİLİR SİMGE GÜVENLİ ALANI
Android, uyarlanabilir simgenin 108x108 dp'lik tuvalinin yalnız ORTADAKİ
72x72 dp'sinin her zaman görüneceğini garanti eder; üretici maskesi köşeleri
(daire, squircle, yuvarlak kare...) kırpar. Bu yüzden logo, ön plan
katmanında tuvalin %66'sına sığdırılır — aksi halde bazı telefonlarda
logonun kenarları kesilir.

Kullanım:  python3 tools/android-ikonlari.py
"""
import os
from PIL import Image, ImageDraw, ImageFilter

KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KAYNAK = os.path.join(KOK, 'assets', 'logo.png')
RES = os.path.join(KOK, 'android', 'app', 'src', 'main', 'res')

# mipmap klasörü -> eski simgenin kenar uzunluğu (px)
YOGUNLUK = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
# Uyarlanabilir simge katmanları 108dp; aynı yoğunluklarda 108/48 kat büyük.
UYARLANABILIR = {k: int(round(v * 108 / 48)) for k, v in YOGUNLUK.items()}
# ---- KONUNUN TUVALDEKİ ORANLARI ------------------------------------------
# Launcher simgeyi kendi maskesiyle kırpar; maske neredeyse her zaman bir
# DAİREDİR (Pixel, One UI, MIUI yuvarlak kip). Bu yüzden ölçü KARE kutuya
# göre değil, merkeze olan EN UZAK DOLU PİKSELİN YARIÇAPINA göre veriliyor:
# zarın köşeleri ve tacın ucu dairenin içinde kaldığı sürece konu istediği
# kadar büyük olabilir. Kare kutuya göre ölçmek, köşeleri boş olan bu
# logoda gereksiz yere küçültüyordu.
#
#   kare/yuvarlak 0.455 → tuvalin yarıçapı 0.5; %9 kenar payı bırakıyoruz
#   on plan       0.300 → uyarlanabilir simgede 108dp tuvalin ortasındaki
#                         66dp'lik daire (yarıçap 0.3055) HER launcher'da
#                         görünür sayılır; tam ona oturuyoruz
KONU_YARICAP = 0.455        # eski kare ve yuvarlak simgeler
ON_PLAN_YARICAP = 0.300     # uyarlanabilir simge ön planı (66dp güvenli daire)
MARKA = (108, 92, 231)  # #6C5CE7 — colors.xml colorPrimary ile aynı


def kare_cerceve():
    """assets/logo.png'nin İÇİNDEKİ mor kare simgeyi kırp.

    Kaynak dosya zaten bir uygulama simgesi görseli: açık gri bir zemin
    üzerinde duran mor, köşeleri yuvarlatılmış bir kare. Simge üretirken o
    gri zemin işimize yaramıyor, bu yüzden kareyi bulup kırpıyoruz."""
    im = Image.open(KAYNAK).convert('RGB')
    g = im.size[0]
    # Payı sabit yazmak yerine mor pikselleri ARAYIP buluyoruz: kaynak görsel
    # ileride değişirse (farklı kadraj, farklı çözünürlük) kırpma kendiliğinden
    # doğru yerden yapılsın. Bulunan kutudan bir tık İÇERİ giriyoruz, çünkü
    # karenin kenarındaki açık renkli parlama konu maskesine "mor değil" diye
    # takılıp zarın etrafında beyaz bir çerçeve bırakıyordu.
    kutu = _mor_kutusu(im)
    ic = int(min(kutu[2] - kutu[0], kutu[3] - kutu[1]) * 0.035)
    return im.crop((kutu[0] + ic, kutu[1] + ic, kutu[2] - ic, kutu[3] - ic))


def _mor_kutusu(im):
    """Kaynaktaki mor karenin sınırları."""
    import colorsys
    g, y_boy = im.size
    px = im.load()
    minx, miny, maxx, maxy = g, y_boy, 0, 0
    for y in range(0, y_boy, 2):
        for x in range(0, g, 2):
            r, ye, b = px[x, y]
            h, s, v = colorsys.rgb_to_hsv(r / 255.0, ye / 255.0, b / 255.0)
            if 215 <= h * 360 <= 300 and s > 0.22:
                if x < minx: minx = x
                if x > maxx: maxx = x
                if y < miny: miny = y
                if y > maxy: maxy = y
    if maxx <= minx or maxy <= miny:
        return (0, 0, g, y_boy)
    return (minx, miny, maxx + 1, maxy + 1)


def konu_maskesi(im):
    """Mor zemini ayıklayıp GERİYE zar + tacı bırakan alfa maskesi.

    Uyarlanabilir simgede ön plan SAYDAM olmalı; zemini Android'in kendisi
    (adaptive-icon XML'indeki marka moru) çiziyor. Mor pikselleri burada
    renk tonundan ayırt ediyoruz: zar beyaz/siyah (doygunluğu düşük ya da
    çok koyu), taç altın sarısı (ton ~45°), zemin ise mor (ton ~258°)."""
    import colorsys
    g, boy = im.size
    piksel = im.load()
    maske = Image.new('L', (g, boy), 0)
    mp = maske.load()
    for y in range(boy):
        for x in range(g):
            r, yes, b = piksel[x, y]
            h, s, v = colorsys.rgb_to_hsv(r / 255.0, yes / 255.0, b / 255.0)
            ton = h * 360.0
            mor = (215 <= ton <= 300) and s > 0.22
            mp[x, y] = 0 if mor else 255
    # Çerçevenin köşelerindeki açık renkli parlamalar da "mor değil" sayılıp
    # maskede küçük lekeler bırakıyor. Yalnız KAYDA DEĞER BÜYÜKLÜKTEKİ
    # parçaları (zar + taç) tutup geri kalanını atıyoruz.
    maske = _kucuk_lekeleri_at(maske)
    # Kenarları yumuşat: sert maske, küçültülünce tırtıklı duruyor.
    return maske.filter(ImageFilter.GaussianBlur(radius=max(1, min(g, boy) // 220)))


def _kucuk_lekeleri_at(maske, esik=0.02):
    """Maskedeki bağlantılı parçalardan, toplam alanın `esik` oranından
    küçük olanları siler. Zar ve taç tek büyük parça; köşe lekeleri ufak."""
    import numpy as np
    from scipy import ndimage
    a = np.asarray(maske) > 127
    etiket, adet = ndimage.label(a)
    if adet <= 1:
        return maske
    alanlar = ndimage.sum(a, etiket, range(1, adet + 1))
    sinir = a.size * esik
    tut = np.zeros_like(a)
    for i, alan in enumerate(alanlar, start=1):
        if alan >= sinir:
            tut |= (etiket == i)
    return Image.fromarray((tut * 255).astype('uint8'), 'L')


def konu():
    """Zar + taç, saydam zeminde (uyarlanabilir simgenin ön planı)."""
    kare = kare_cerceve().convert('RGBA')
    kare.putalpha(konu_maskesi(kare.convert('RGB')))
    return kare.crop(kare.getbbox() or (0, 0, kare.size[0], kare.size[1]))


def _dolu_yaricap(im):
    """Konunun merkezine olan en uzak DOLU pikselin uzaklığı (piksel).

    Saydam köşeler sayılmaz; ölçü böylece gerçek siluete göre çıkar."""
    en, boy = im.size
    a = im.split()[3].load()
    cx, cy = (en - 1) / 2.0, (boy - 1) / 2.0
    enb = 0.0
    for y in range(boy):
        for x in range(en):
            if a[x, y] > 24:
                d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
                if d > enb: enb = d
    return max(enb, 1.0)


def _yerlestir(kenar, yaricap_orani, kaynak):
    """Konuyu, SİLUETİ verilen yarıçaplı dairenin içine TAM sığacak en büyük
       boyda tuvalin ortasına koy.

    Eskiden kare sınır kutusuna göre ölçekleniyordu; zarın köşeleri boş
    olduğu için bu gereğinden küçük bir simge veriyordu. Artık ölçü konunun
    merkezden en uzak dolu pikseline göre: daire maskesinde hiçbir şey
    kesilmeden olabilecek en büyük görünüm."""
    hedef = kenar * yaricap_orani
    mevcut = _dolu_yaricap(kaynak)
    olcek = hedef / mevcut
    yeni = (max(1, int(round(kaynak.size[0] * olcek))),
            max(1, int(round(kaynak.size[1] * olcek))))
    k = kaynak.resize(yeni, Image.LANCZOS)
    tuval = Image.new('RGBA', (kenar, kenar), (0, 0, 0, 0))
    tuval.alpha_composite(k, ((kenar - k.size[0]) // 2, (kenar - k.size[1]) // 2))
    return tuval


def kare(konu_im, kenar):
    """Eski (API 25 ve altı) kare simge: KENARDAN KENARA mor zemin + zar.

    Köşeler SAYDAM OLMAMALI. Bir ara yuvarlatılmış maske uygulanmıştı; kendi
    maskesini uygulamayan launcher'lar köşelerden duvar kâğıdını/koyu zemini
    gösteriyor, simge "siyah çerçeveli" görünüyordu. Doğrusu: tuvali baştan
    sona markanın moruyla doldurmak ve yuvarlatmayı launcher'a bırakmak."""
    tuval = Image.new('RGBA', (kenar, kenar), MARKA + (255,))
    tuval.alpha_composite(_yerlestir(kenar, KONU_YARICAP, konu_im))
    return tuval


# NOT: ic_launcher_round ARTIK ÜRETİLMİYOR. Mor DAİRE + saydam köşeler
# demekti; kendi tepsisini çizen launcher'larda (MIUI) köşeler koyu kalıyor,
# simge "siyah kutu içinde mor madalyon" gibi görünüyordu. Manifestteki
# android:roundIcon da kaldırıldı: daire isteyen launcher artık
# @mipmap/ic_launcher'ı kullanır — API 26+ için o zaten uyarlanabilir
# simgedir (zemin kenardan kenara mor), eskiler için de tam mor karedir.
# Her iki yolda da koyu köşe oluşmaz.


def on_plan(konu_im, kenar):
    """Uyarlanabilir simgenin ön planı: SAYDAM zemin, güvenli alana
       sığdırılmış zar. Zemini adaptive-icon XML'i (marka moru) veriyor."""
    return _yerlestir(kenar, ON_PLAN_YARICAP, konu_im)


def tek_renk(konu_im, kenar):
    """Temalı simge (Android 13+): yalnız siluet; rengi sistem verir."""
    on = on_plan(konu_im, kenar)
    duz = Image.new('RGBA', (kenar, kenar), (255, 255, 255, 0))
    duz.putalpha(on.split()[3])
    return duz


def yaz(im, klasor, ad):
    d = os.path.join(RES, 'mipmap-' + klasor)
    os.makedirs(d, exist_ok=True)
    yol = os.path.join(d, ad + '.png')
    im.save(yol, optimize=True)
    return yol


if __name__ == '__main__':
    k = konu()
    sayac = 0
    for yog, kenar in YOGUNLUK.items():
        yaz(kare(k, kenar), yog, 'ic_launcher')
        a = UYARLANABILIR[yog]
        yaz(on_plan(k, a), yog, 'ic_launcher_foreground')
        yaz(tek_renk(k, a), yog, 'ic_launcher_monochrome')
        sayac += 3

    # Açılış ekranı logosu (tek dosya, yoğunluktan bağımsız).
    d = os.path.join(RES, 'drawable-nodpi')
    os.makedirs(d, exist_ok=True)
    kare(k, 420).save(os.path.join(d, 'splash_logo.png'), optimize=True)
    sayac += 1
    print('yazildi:', sayac, 'dosya →', RES)
