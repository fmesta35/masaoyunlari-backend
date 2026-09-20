# -*- coding: utf-8 -*-
"""
Oyun kapaklarını üretir.  Kullanım:  python3 tools/kapak-uret.py [oyun ...]

Tasarım ilkesi: KADRAJ GENİŞ OLACAK. Eski kapaklar tek bir cisme aşırı
yakındı (tek top, tek pul); artık her kapakta oyunun tahtası/taşları
bütün olarak, uzaktan ve net görünüyor. Ana cisimler kapak-ortak.py'deki
güvenli alan kuralına (ortadaki %68'lik kutu) göre yerleştirilir.
"""
import importlib.util, os, sys, math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_s = importlib.util.spec_from_file_location('ko', os.path.join(KOK, 'tools', 'kapak-ortak.py'))
ko = importlib.util.module_from_spec(_s); _s.loader.exec_module(ko)
W, H = ko.W, ko.H
CIKTI = os.path.join(KOK, 'assets', 'covers')
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'


def yaz(d, xy, metin, boy, renk, ortala=True):
    f = ImageFont.truetype(FONT, int(boy))
    x0, y0, x1, y1 = d.textbbox((0, 0), metin, font=f)
    x, y = xy
    if ortala:
        x -= (x1 - x0) / 2 + x0; y -= (y1 - y0) / 2 + y0
    d.text((x, y), metin, font=f, fill=renk)


# ============================================================ BİLARDO
def bilardo():
    """Yeşil çuha, ıstaka ve topluluk hâlinde toplar — masaya uzaktan bakış."""
    kapak = ko.cuha(renk=(22, 104, 66), isik=(0.50, 0.34)).convert('RGBA')
    d = ImageDraw.Draw(kapak)

    # Üst bant: masanın ahşap bandı ve iki cebi (derinlik hissi)
    bant = ko.ahsap(W, int(H * .17), koyu=(74, 42, 20), acik=(132, 84, 42), damar=14)
    kapak.paste(bant, (0, 0))
    d.rectangle([0, int(H * .17) - 6, W, int(H * .17) + 4], fill=(14, 62, 40))
    for cx in (int(W * .12), int(W * .88)):
        d.ellipse([cx - 58, int(H * .17) - 62, cx + 58, int(H * .17) + 30], fill=(10, 14, 12))

    # Topların yerleşimi (üçgen dizilim) — güvenli kutunun içinde
    G = ko.guvenli_kutu()
    mx, my = (G[0] + G[2]) / 2, (G[1] + G[3]) / 2
    cap = int(W * .112)
    # Küme SOLDA, ıstaka topu SAĞDA: ıstaka kümeyi kesmeden beyaz topa dayanır.
    dizi = [
        (-1.05, 0.52, (18, 18, 22), '8'),     # siyah 8
        (-1.78, 0.02, (206, 38, 34), '3'),
        (-1.05, -0.48, (36, 74, 186), '2'),
        (-0.32, 0.02, (240, 176, 26), '1'),
        (-1.05, 0.02, (168, 58, 156), '4'),   # kümenin ortası
        (1.32, 0.30, (236, 238, 242), ''),    # beyaz (ıstaka topu)
    ]
    for u, v, renk, no in dizi:
        x = mx + u * cap * 1.30
        y = my + v * cap * 1.26
        c = int(cap * (1.0 + v * .06))
        # Beyaz top koyu görünmesin diye daha yüksek ortam ışığı alır.
        top = ko.kure(c, renk, parlaklik=1.0 if no else 1.15,
                      ambiyans=0.20 if no else 0.62)
        kapak = ko.golge(kapak, top.split()[3],
                         (int(x - c / 2 + c * .10), int(y - c / 2 + c * .17)),
                         bulanik=int(c * .16), koyuluk=132)
        kapak.paste(top, (int(x - c / 2), int(y - c / 2)), top)
        if no:                                   # numara kuşağı
            n = Image.new('RGBA', (c, c), (0, 0, 0, 0))
            nd = ImageDraw.Draw(n)
            nd.ellipse([c * .27, c * .24, c * .73, c * .70], fill=(248, 248, 246))
            yaz(nd, (c * .50, c * .465), no, c * .30, (26, 26, 30))
            n = n.rotate(-9, resample=Image.BICUBIC, center=(c / 2, c / 2))
            n.putalpha(Image.eval(n.split()[3], lambda a: min(a, 250)))
            kapak.paste(n, (int(x - c / 2), int(y - c / 2)), n)

    # Istaka: sağ alttan beyaz topa doğru
    ist = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    idr = ImageDraw.Draw(ist)
    x0, y0 = W * 1.06, H * 1.34
    x1, y1 = mx + cap * 1.32 + cap * .52, my + cap * .30 + cap * .36
    for t, (rr, kal) in enumerate([((58, 34, 18), 26), ((176, 132, 78), 20)]):
        idr.line([x0, y0, x1, y1], fill=rr + (255,), width=int(kal * 1.6 - t * 6))
    idr.line([x1, y1, x1 + (x0 - x1) * .12, y1 + (y0 - y1) * .12],
             fill=(236, 232, 224, 255), width=16)      # beyaz bilezik
    idr.line([x1, y1, x1 + (x0 - x1) * .035, y1 + (y0 - y1) * .035],
             fill=(46, 92, 120, 255), width=15)        # mavi uç
    kapak = ko.golge(kapak, ist.split()[3], (10, 22), bulanik=22, koyuluk=120)
    kapak = Image.alpha_composite(kapak, ist)
    return ko.bitir(kapak, os.path.join(CIKTI, 'bilardo.jpg'))


# ======================================================= TAHTA YARDIMCISI
def perspektif_tahta(kapak, n, kare, ust_daralt, renk_a, renk_b, cizgi=None,
                     merkez=None, kenarlik=None):
    """
    n x n tahtayı hafif perspektifle çizer.
    Dönüş: her hücrenin (merkez_x, merkez_y, hücre_genişliği) listesi.
    """
    G = ko.guvenli_kutu()
    cx = (G[0] + G[2]) / 2 if merkez is None else merkez[0]
    cy = (G[1] + G[3]) / 2 if merkez is None else merkez[1]
    tg = kare * n                     # ön kenarın genişliği
    ty = kare * n * .78               # görünen yükseklik (perspektif kısaltması)
    ust = tg * ust_daralt

    def nokta(u, v):                  # u,v ∈ [0,1]; v=0 arka, v=1 ön
        g = ust + (tg - ust) * v
        # NOT: kenarlık için v hafif negatif olabiliyor; (-0.05)**1.06 Python'da
        # karmaşık sayı döndürür, bu yüzden üs mutlak değere uygulanır.
        e = math.copysign(abs(v) ** 1.06, v)
        return cx + (u - .5) * g, cy - ty / 2 + ty * e

    if kenarlik:
        k = [nokta(-.045, -.05), nokta(1.045, -.05), nokta(1.05, 1.05), nokta(-.05, 1.05)]
        ImageDraw.Draw(kapak).polygon(k, fill=kenarlik)

    d = ImageDraw.Draw(kapak, 'RGBA')
    hucre = []
    for r in range(n):
        for c in range(n):
            u0, u1 = c / n, (c + 1) / n
            v0, v1 = r / n, (r + 1) / n
            p = [nokta(u0, v0), nokta(u1, v0), nokta(u1, v1), nokta(u0, v1)]
            d.polygon(p, fill=(renk_a if (r + c) % 2 == 0 else renk_b))
            if cizgi:
                d.line(p + [p[0]], fill=cizgi, width=2)
            mx = sum(q[0] for q in p) / 4; my = sum(q[1] for q in p) / 4
            hucre.append((mx, my, abs(p[1][0] - p[0][0])))
    return hucre


# ============================================================ REVERSİ
def reversi():
    """8x8 tahtada gerçek bir oyun durumu — tahta bütün olarak görünür."""
    kapak = ko.ahsap(koyu=(58, 36, 18), acik=(104, 68, 34), damar=30).convert('RGBA')
    kare = W * .0672          # tahtanın tamamı güvenli kutunun içinde kalsın
    hucre = perspektif_tahta(kapak, 8, kare, .80,
                             (26, 112, 72, 255), (22, 100, 64, 255),
                             cizgi=(10, 48, 32, 190), kenarlik=(46, 27, 12, 255))
    # Basit ama inandırıcı bir dizilim (satır, sütun, renk)
    siyah = [(2,3),(3,3),(3,4),(4,2),(4,3),(4,5),(5,4),(2,5),(6,3)]
    beyaz = [(3,2),(2,4),(4,4),(5,3),(5,5),(3,5),(6,4),(1,4),(4,6)]
    for liste, ust, yan, kenar in [
            (siyah, (30, 30, 36), (12, 12, 16), (58, 58, 66)),
            (beyaz, (240, 240, 236), (186, 186, 182), (255, 255, 252))]:
        for (r, c) in liste:
            mx, my, g = hucre[r * 8 + c]
            cap = g * .80
            p = ko.pul(cap, cap * .74, ust, yan, cap * .12, kenar)
            kapak = ko.golge(kapak, p.split()[3],
                             (int(mx - p.width / 2 + 5), int(my - p.height / 2 + 9)),
                             bulanik=8, koyuluk=120)
            kapak.paste(p, (int(mx - p.width / 2), int(my - p.height / 2)), p)
    return ko.bitir(kapak, os.path.join(CIKTI, 'reversi.jpg'))


# ============================================================= GOMOKU
def gomoku():
    """Ahşap tahta, kesişimlere konmuş taşlar ve kazanan beşli dizi."""
    kapak = ko.ahsap(koyu=(156, 108, 56), acik=(206, 160, 100), damar=64).convert('RGBA')
    G = ko.guvenli_kutu()
    n = 9
    kare = W * .0700
    cx, cy = (G[0] + G[2]) / 2, (G[1] + G[3]) / 2
    tg, ty = kare * (n - 1), kare * (n - 1) * .74
    ust = tg * .82

    def nokta(u, v):
        g = ust + (tg - ust) * v
        return cx + (u - .5) * g, cy - ty / 2 + ty * (v ** 1.05)

    d = ImageDraw.Draw(kapak, 'RGBA')
    for i in range(n):                      # ızgara çizgileri
        t = i / (n - 1)
        d.line([nokta(t, 0), nokta(t, 1)], fill=(48, 28, 10, 235), width=4)
        d.line([nokta(0, t), nokta(1, t)], fill=(48, 28, 10, 235), width=4)
    for (a, b) in [(.2, .2), (.8, .2), (.5, .5), (.2, .8), (.8, .8)]:   # yıldız noktalar
        x, y = nokta(a, b)
        d.ellipse([x - 6, y - 5, x + 6, y + 5], fill=(40, 22, 8, 255))

    siyah = [(2,2),(3,3),(4,4),(5,5),(6,6),(4,2),(6,3)]       # kazanan çapraz
    beyaz = [(3,5),(4,5),(5,3),(2,4),(5,6),(6,5),(3,1)]
    for liste, ust_r, yan_r, kenar in [
            (siyah, (34, 34, 40), (10, 10, 14), (92, 92, 104)),
            (beyaz, (246, 244, 238), (198, 194, 186), (255, 255, 255))]:
        for (r, c) in liste:
            x, y = nokta(c / (n - 1), r / (n - 1))
            g = ust + (tg - ust) * (r / (n - 1))
            cap = (g / (n - 1)) * 1.00
            p = ko.pul(cap, cap * .70, ust_r, yan_r, cap * .14, kenar)
            kapak = ko.golge(kapak, p.split()[3],
                             (int(x - p.width / 2 + 5), int(y - p.height / 2 + 9)),
                             bulanik=9, koyuluk=125)
            kapak.paste(p, (int(x - p.width / 2), int(y - p.height / 2)), p)
    return ko.bitir(kapak, os.path.join(CIKTI, 'gomoku.jpg'))


# ============================================================ CONNECT 4
def connect4():
    """Mavi çerçevenin tamamı: 7x6 delik, içine düşmüş kırmızı/sarı pullar."""
    kapak = ko.cuha(renk=(30, 44, 74), isik=(.5, .3), guc=.9, tohum=8).convert('RGBA')
    G = ko.guvenli_kutu()
    sut, sat = 7, 6
    adim = min((G[2] - G[0]) / sut, (G[3] - G[1]) / (sat + .35))
    gw, gh = adim * sut, adim * sat
    x0 = (W - gw) / 2; y0 = (H - gh) / 2 - adim * .06

    gov = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(gov)
    pay = adim * .16
    gd.rounded_rectangle([x0 - pay, y0 - pay, x0 + gw + pay, y0 + gh + pay],
                         radius=adim * .3, fill=(32, 78, 206, 255))
    gd.rounded_rectangle([x0 - pay, y0 - pay, x0 + gw + pay, y0 + gh * .30],
                         radius=adim * .3, fill=(46, 96, 228, 255))     # üst ışık
    # ayaklar
    for fx in (x0 + gw * .12, x0 + gw * .88):
        gd.rounded_rectangle([fx - adim * .20, y0 + gh + pay - 4,
                              fx + adim * .20, y0 + gh + pay + adim * .32],
                             radius=adim * .1, fill=(26, 62, 172, 255))

    # Sütun sütun doldurulmuş bir oyun durumu (alttan yukarı)
    sutunlar = [['K'], ['S', 'K'], ['K', 'S', 'K'], ['S', 'K', 'S', 'K'],
                ['K', 'S', 'S'], ['S', 'K'], []]
    renkler = {'K': ((214, 44, 44), (150, 22, 22)), 'S': ((246, 196, 40), (186, 140, 16))}
    delik = adim * .78
    for c in range(sut):
        for r in range(sat):
            cx = x0 + adim * (c + .5); cy = y0 + gh - adim * (r + .5)
            tas = sutunlar[c][r] if r < len(sutunlar[c]) else None
            if tas:
                ust, yan = renkler[tas]
                gd.ellipse([cx - delik/2, cy - delik/2, cx + delik/2, cy + delik/2], fill=yan + (255,))
                gd.ellipse([cx - delik*.44, cy - delik*.44, cx + delik*.44, cy + delik*.44], fill=ust + (255,))
                gd.ellipse([cx - delik*.30, cy - delik*.34, cx - delik*.02, cy - delik*.06],
                           fill=(255, 255, 255, 86))
            else:
                gd.ellipse([cx - delik/2, cy - delik/2, cx + delik/2, cy + delik/2], fill=(12, 20, 44, 255))
                gd.ellipse([cx - delik*.46, cy - delik*.42, cx + delik*.46, cy + delik*.50],
                           fill=(18, 30, 62, 255))
    kapak = ko.golge(kapak, gov.split()[3], (12, 26), bulanik=26, koyuluk=150)
    kapak = Image.alpha_composite(kapak, gov)
    return ko.bitir(kapak, os.path.join(CIKTI, 'connect4.jpg'))


# ============================================================== PİŞTİ
SIMGE = {'maca': (18, 18, 22), 'sinek': (18, 18, 22),
         'kupa': (200, 32, 40), 'karo': (200, 32, 40)}


def simge_ciz(d, x, y, b, tur):
    """Kupa/karo/maça/sinek sembolü — b: sembolün yüksekliği."""
    r = SIMGE[tur]
    if tur == 'karo':
        d.polygon([(x, y - b/2), (x + b*.38, y), (x, y + b/2), (x - b*.38, y)], fill=r)
    elif tur == 'kupa':
        d.ellipse([x - b*.42, y - b*.44, x - b*.02, y + b*.04], fill=r)
        d.ellipse([x + b*.02, y - b*.44, x + b*.42, y + b*.04], fill=r)
        d.polygon([(x - b*.42, y - b*.14), (x + b*.42, y - b*.14), (x, y + b*.50)], fill=r)
    elif tur == 'maca':
        d.polygon([(x, y - b*.50), (x + b*.42, y + b*.10), (x - b*.42, y + b*.10)], fill=r)
        d.ellipse([x - b*.42, y - b*.10, x - b*.02, y + b*.28], fill=r)
        d.ellipse([x + b*.02, y - b*.10, x + b*.42, y + b*.28], fill=r)
        d.polygon([(x - b*.16, y + b*.50), (x + b*.16, y + b*.50), (x, y + b*.16)], fill=r)
    else:  # sinek
        y0 = y - b*.10
        d.ellipse([x - b*.17, y0 - b*.46, x + b*.17, y0 - b*.12], fill=r)
        d.ellipse([x - b*.44, y0 - b*.16, x - b*.06, y0 + b*.22], fill=r)
        d.ellipse([x + b*.06, y0 - b*.16, x + b*.44, y0 + b*.22], fill=r)
        d.polygon([(x - b*.17, y + b*.50), (x + b*.17, y + b*.50), (x, y + b*.06)], fill=r)


def kart_ciz(deger, tur, g, yatik):
    """Tek bir oyun kâğıdı — RGBA, istenen açıyla döndürülmüş."""
    y = int(g * 1.45)
    im = Image.new('RGBA', (int(g), y), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, g - 1, y - 1], radius=g * .085, fill=(250, 249, 245),
                        outline=(196, 192, 184), width=max(2, int(g * .012)))
    r = SIMGE[tur]
    yaz(d, (g * .175, y * .115), deger, g * .27, r)
    simge_ciz(d, g * .175, y * .215, g * .17, tur)
    simge_ciz(d, g * .56, y * .56, g * .62, tur)         # büyük orta sembol
    return im.rotate(yatik, resample=Image.BICUBIC, expand=True)


def pisti():
    """Çuha üzerinde açılmış birkaç kâğıt ve yan destede kapalı kâğıtlar."""
    kapak = ko.cuha(renk=(20, 92, 60), isik=(.48, .34), tohum=5).convert('RGBA')
    G = ko.guvenli_kutu()
    mx, my = (G[0] + G[2]) / 2, (G[1] + G[3]) / 2
    g = (G[2] - G[0]) * .27

    # Arkada kapalı deste
    for i in range(5):
        srt = Image.new('RGBA', (int(g), int(g * 1.45)), (0, 0, 0, 0))
        sd = ImageDraw.Draw(srt)
        sd.rounded_rectangle([0, 0, g - 1, g * 1.45 - 1], radius=g * .085,
                             fill=(38, 62, 148), outline=(240, 240, 240), width=int(g * .035))
        for yy in range(int(g * .12), int(g * 1.33), int(g * .10)):
            sd.line([g * .12, yy, g * .88, yy - g * .06], fill=(86, 112, 206), width=3)
        srt = srt.rotate(-24 + i * 2.2, resample=Image.BICUBIC, expand=True)
        px, py = int(mx - g * 1.62 + i * 5), int(my - g * .72 - i * 6)
        kapak = ko.golge(kapak, srt.split()[3], (px + 8, py + 14), bulanik=13, koyuluk=120)
        kapak.paste(srt, (px, py), srt)

    # Önde açık kâğıtlar — pişti'nin yıldızı: vale ve maça
    for (dg, tr, ac, dx, dy) in [('A', 'kupa', -20, -.30, .18),
                                 ('10', 'karo', -7, .18, .06),
                                 ('J', 'sinek', 7, .64, .00),
                                 ('A', 'maca', 21, 1.08, .12)]:
        k = kart_ciz(dg, tr, g, ac)
        px, py = int(mx + g * dx - k.width * .5), int(my + g * dy - k.height * .5)
        kapak = ko.golge(kapak, k.split()[3], (px + 10, py + 18), bulanik=15, koyuluk=135)
        kapak.paste(k, (px, py), k)
    return ko.bitir(kapak, os.path.join(CIKTI, 'pisti.jpg'))


OYUNLAR = {'bilardo': bilardo, 'reversi': reversi, 'gomoku': gomoku,
           'connect4': connect4, 'pisti': pisti}




# ============================================================== BATAK
def batak():
    """
    Kullanıcının ilettiği dört as görselinden üretilir.
    Kaynak görselin altındaki ZARLAR istenmediği için kırpılarak atılır
    (kırmızı zar y=273'te başlıyor), kalan kart yelpazesinin beyaz zemini
    kenarlardan taşırma ile ayıklanır ve çuha üzerine oturtulur.
    """
    src = Image.open(os.path.join(KOK, 'assets', 'kaynak', 'batak-aslar.jpg')).convert('RGB')
    kart = src.crop((25, 52, 350, 271))
    SC = 4                                     # küçük kaynak; büyüterek netleştir
    kart = kart.resize((kart.width * SC, kart.height * SC), Image.LANCZOS)

    # Beyaz ZEMİNİ ayıkla — kart yüzleri de beyaz olduğu için köşelerden taşır.
    flood = kart.convert('RGB')
    for pt in [(0, 0), (flood.width - 1, 0), (0, flood.height - 1),
               (flood.width - 1, flood.height - 1), (flood.width // 2, 0), (2, flood.height // 2)]:
        ImageDraw.floodfill(flood, pt, (255, 0, 255), thresh=26)
    f = np.asarray(flood).astype(int)
    zemin = (f[:, :, 0] > 230) & (f[:, :, 1] < 40) & (f[:, :, 2] > 230)
    kart.putalpha(Image.fromarray(np.where(zemin, 0, 255).astype(np.uint8))
                  .filter(ImageFilter.GaussianBlur(1.2)))
    kart = kart.crop(kart.getbbox())

    kapak = ko.cuha(renk=(20, 92, 60), isik=(.52, .40), tohum=4).convert('RGBA')
    # Genişlik, en soldaki A♥ simgesi güvenli kutunun içinde kalacak kadar.
    hedef = int(W * .78)
    kart = kart.resize((hedef, int(kart.height * hedef / kart.width)), Image.LANCZOS)
    kx = (W - kart.width) // 2
    # Dikeyde "A" simgeleri sırasına göre hizala: bu sıra görselin %40'ında.
    ky = int(H * .5 - kart.height * .40)            # yelpaze alt kenardan taşar
    kapak = ko.golge(kapak, kart.split()[3], (kx + 10, ky + 20), bulanik=18, koyuluk=150)
    kapak.paste(kart, (kx, ky), kart)
    return ko.bitir(kapak, os.path.join(CIKTI, 'batak.jpg'))


OYUNLAR['batak'] = batak


# ====================================================== DAMA / TÜRK DAMASI
def _dama_tahtasi(kapak, kare_oran=.0672):
    """8x8 dama tahtasını perspektifle çizer, hücre merkezlerini döndürür."""
    return perspektif_tahta(kapak, 8, W * kare_oran, .80,
                            (222, 200, 164, 255), (96, 58, 32, 255),
                            cizgi=(58, 34, 16, 90), kenarlik=(52, 30, 14, 255))


def _tas_koy(kapak, hucre, yerler, ust, yan, kenar, kat=1):
    for (r, c) in yerler:
        mx, my, g = hucre[r * 8 + c]
        cap = g * .80
        p = ko.pul(cap, cap * .72, ust, yan, cap * .16, kenar)
        kapak = ko.golge(kapak, p.split()[3],
                         (int(mx - p.width / 2 + 5), int(my - p.height / 2 + 9)),
                         bulanik=8, koyuluk=125)
        for k in range(kat):                      # üst üste dizili taşlar (dam)
            kapak.paste(p, (int(mx - p.width / 2), int(my - p.height / 2 - k * cap * .15)), p)
    return kapak


def dama():
    """İngiliz Daması: siyah karelerde dizili açık/koyu taşlar, tahta bütün görünür."""
    kapak = ko.ahsap(koyu=(52, 32, 16), acik=(92, 60, 30), damar=40).convert('RGBA')
    h = _dama_tahtasi(kapak)
    koyu  = [(0,1),(0,3),(0,5),(0,7),(1,0),(1,2),(1,4),(1,6),(2,3),(2,5),(3,2)]
    acik  = [(7,0),(7,2),(7,4),(7,6),(6,1),(6,3),(6,5),(6,7),(5,2),(5,4),(4,5)]
    kapak = _tas_koy(kapak, h, koyu, (44, 44, 52), (16, 16, 22), (96, 96, 110))
    kapak = _tas_koy(kapak, h, acik, (244, 238, 226), (196, 188, 172), (255, 255, 250))
    kapak = _tas_koy(kapak, h, [(3, 4)], (244, 238, 226), (196, 188, 172), (255, 250, 210), kat=2)
    return ko.bitir(kapak, os.path.join(CIKTI, 'dama.jpg'))


def turkdamasi():
    """Türk Daması: taşlar 2. ve 3. sıraları TAM doldurur (kuralın görsel imzası)."""
    kapak = ko.ahsap(koyu=(46, 30, 18), acik=(86, 56, 34), damar=46, tohum=17).convert('RGBA')
    h = _dama_tahtasi(kapak)
    koyu = [(1, c) for c in range(8)] + [(2, c) for c in range(8)]
    acik = [(6, c) for c in range(8)] + [(5, c) for c in range(8)]
    kapak = _tas_koy(kapak, h, koyu, (168, 40, 40), (104, 18, 18), (214, 96, 96))
    kapak = _tas_koy(kapak, h, acik, (244, 238, 226), (196, 188, 172), (255, 255, 250))
    return ko.bitir(kapak, os.path.join(CIKTI, 'turkdamasi.jpg'))


# =============================================================== TAVLA
def tavla():
    """Açık tavla tahtası: 24 ok, dizili pullar, ortada bar ve iki zar."""
    kapak = ko.ahsap(koyu=(44, 26, 14), acik=(84, 52, 26), damar=52, tohum=23).convert('RGBA')
    G = ko.guvenli_kutu()
    tg, ty = (G[2] - G[0]), (G[3] - G[1])
    x0, y0 = G[0], G[1]
    gov = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(gov)
    d.rounded_rectangle([x0 - 16, y0 - 16, x0 + tg + 16, y0 + ty + 16],
                        radius=14, fill=(58, 34, 16, 255))
    d.rectangle([x0, y0, x0 + tg, y0 + ty], fill=(184, 142, 96, 255))     # oyun alanı
    bar_g = tg * .055
    barx = x0 + tg / 2
    ok_g = (tg - bar_g) / 12                                              # 12 ok
    ok_y = ty * .42
    for i in range(12):
        sol = x0 + i * ok_g + (bar_g if i >= 6 else 0)
        renk = (216, 196, 168, 255) if i % 2 == 0 else (150, 54, 42, 255)
        d.polygon([(sol + 3, y0), (sol + ok_g - 3, y0), (sol + ok_g / 2, y0 + ok_y)], fill=renk)
        renk2 = (150, 54, 42, 255) if i % 2 == 0 else (216, 196, 168, 255)
        d.polygon([(sol + 3, y0 + ty), (sol + ok_g - 3, y0 + ty),
                   (sol + ok_g / 2, y0 + ty - ok_y)], fill=renk2)
    d.rectangle([barx - bar_g / 2, y0, barx + bar_g / 2, y0 + ty], fill=(70, 42, 20, 255))

    # Pullar (ok numarası, adet, renk) — gerçek bir açılış dizilimi
    dizilim = [(0, 5, 'b'), (4, 3, 's'), (5, 5, 's'), (7, 3, 'b'), (11, 2, 's')]
    pr = {'b': ((238, 232, 220), (188, 180, 166), (255, 255, 252)),
          's': ((46, 44, 52), (18, 18, 24), (104, 104, 118))}
    cap = ok_g * .82
    for (i, adet, r) in dizilim:
        sol = x0 + i * ok_g + (bar_g if i >= 6 else 0)
        cx = sol + ok_g / 2
        for k in range(adet):
            p = ko.pul(cap, cap * .80, *pr[r][:2], cap * .16, pr[r][2])
            py = y0 + 6 + k * cap * .72
            gov.paste(p, (int(cx - p.width / 2), int(py)), p)
        for k in range(max(0, adet - 2)):                  # karşı tarafta da birkaç pul
            p = ko.pul(cap, cap * .80, *pr['s' if r == 'b' else 'b'][:2], cap * .16,
                       pr['s' if r == 'b' else 'b'][2])
            py = y0 + ty - 6 - (k + 1) * cap * .72
            gov.paste(p, (int(cx - p.width / 2), int(py)), p)

    # Zarlar — tahtanın sağ yarısında
    for (zx, zy, nokta_sayi, ac) in [(x0 + tg * .70, y0 + ty * .46, 5, -8),
                                     (x0 + tg * .81, y0 + ty * .52, 3, 11)]:
        zg = tg * .062
        z = Image.new('RGBA', (int(zg) + 8, int(zg) + 8), (0, 0, 0, 0))
        zd = ImageDraw.Draw(z)
        zd.rounded_rectangle([4, 4, zg, zg], radius=zg * .18, fill=(248, 246, 240),
                             outline=(196, 190, 178), width=3)
        yerler = {3: [(.25, .25), (.5, .5), (.75, .75)],
                  5: [(.26, .26), (.74, .26), (.5, .5), (.26, .74), (.74, .74)]}[nokta_sayi]
        for (a, b) in yerler:
            zd.ellipse([4 + zg * a - zg * .09, 4 + zg * b - zg * .09,
                        4 + zg * a + zg * .09, 4 + zg * b + zg * .09], fill=(40, 40, 46))
        z = z.rotate(ac, resample=Image.BICUBIC, expand=True)
        gov = ko.golge(gov, z.split()[3], (int(zx) + 6, int(zy) + 10), bulanik=9, koyuluk=120)
        gov.paste(z, (int(zx), int(zy)), z)

    kapak = ko.golge(kapak, gov.split()[3], (10, 22), bulanik=24, koyuluk=150)
    kapak = Image.alpha_composite(kapak, gov)
    return ko.bitir(kapak, os.path.join(CIKTI, 'tavla.jpg'))


OYUNLAR.update({'dama': dama, 'turkdamasi': turkdamasi, 'tavla': tavla})


# ============================================================== SATRANÇ
"""
Satranç kapağı: kurulmuş tahtada OTUZ İKİ TAŞIN TAMAMI görünür.
Taşlar yandan silueti çizilerek üretilir (piyon, kale, at, fil, vezir, şah);
her taşa dikey ışık geçişi, ince kenar ışığı ve kendi gölgesi verilir.
Işık soldan gelir — iletilen örnek kareler gibi sıcak, koyu bir salon.
"""
TAS_YUK = {'piyon': 1.02, 'kale': 1.22, 'at': 1.42, 'fil': 1.52,
           'vezir': 1.70, 'sah': 1.86}          # hücre enine oranla yükseklik
DIZILIM = ['kale', 'at', 'fil', 'vezir', 'sah', 'fil', 'at', 'kale']


def _tas_maskesi(tur, g, y):
    """Taşın siluetini bir maskeye çizer. u: yatay (-0.5..0.5), v: dikey (0 taban)."""
    m = Image.new('L', (int(g), int(y)), 0)
    d = ImageDraw.Draw(m)
    X = lambda u: g * (0.5 + u)
    Y = lambda v: y * (1 - v)
    def kutu(u0, v0, u1, v1, **k): d.rectangle([X(u0), Y(v1), X(u1), Y(v0)], fill=255, **k)
    def oval(u0, v0, u1, v1): d.ellipse([X(u0), Y(v1), X(u1), Y(v0)], fill=255)
    def cokgen(pts): d.polygon([(X(a), Y(b)) for a, b in pts], fill=255)

    # --- her taşta ortak: geniş taban ve etek ---
    oval(-0.46, 0.00, 0.46, 0.09)
    cokgen([(-0.44, 0.06), (0.44, 0.06), (0.26, 0.20), (-0.26, 0.20)])

    if tur == 'piyon':
        cokgen([(-0.15, 0.18), (0.15, 0.18), (0.11, 0.50), (-0.11, 0.50)])
        oval(-0.20, 0.48, 0.20, 0.57)
        oval(-0.18, 0.57, 0.18, 0.93)
    elif tur == 'kale':
        cokgen([(-0.26, 0.18), (0.26, 0.18), (0.23, 0.60), (-0.23, 0.60)])
        oval(-0.32, 0.56, 0.32, 0.66)
        kutu(-0.34, 0.64, 0.34, 0.86)
        # mazgallar: üstten üç boşluk oyulur
        for u0, u1 in [(-0.20, -0.07), (0.07, 0.20)]:
            d.rectangle([X(u0), Y(0.88), X(u1), Y(0.76)], fill=0)
    elif tur == 'fil':
        cokgen([(-0.19, 0.18), (0.19, 0.18), (0.14, 0.52), (-0.14, 0.52)])
        oval(-0.24, 0.49, 0.24, 0.58)
        oval(-0.21, 0.56, 0.21, 0.80)
        cokgen([(-0.13, 0.76), (0.13, 0.76), (0.0, 0.95)])
        oval(-0.06, 0.93, 0.06, 1.00)
        d.line([X(0.02), Y(0.88), X(0.14), Y(0.70)], fill=0, width=max(2, int(g * .05)))
    elif tur == 'vezir':
        cokgen([(-0.21, 0.18), (0.21, 0.18), (0.16, 0.50), (-0.16, 0.50)])
        oval(-0.26, 0.47, 0.26, 0.57)
        oval(-0.25, 0.55, 0.25, 0.78)
        cokgen([(-0.28, 0.74), (0.28, 0.74), (0.24, 0.84), (-0.24, 0.84)])
        for u in (-0.20, -0.10, 0.0, 0.10, 0.20):        # taç dişleri
            cokgen([(u - 0.045, 0.82), (u + 0.045, 0.82), (u, 0.95)])
            oval(u - 0.035, 0.93, u + 0.035, 1.00)
    elif tur == 'sah':
        cokgen([(-0.21, 0.18), (0.21, 0.18), (0.16, 0.50), (-0.16, 0.50)])
        oval(-0.26, 0.47, 0.26, 0.57)
        oval(-0.25, 0.55, 0.25, 0.76)
        cokgen([(-0.27, 0.72), (0.27, 0.72), (0.22, 0.84), (-0.22, 0.84)])
        kutu(-0.055, 0.82, 0.055, 1.00)                  # haçın dikeyi
        kutu(-0.17, 0.90, 0.17, 0.955)                   # haçın yatayı
    else:  # at — sağa bakan at başı
        cokgen([(-0.25, 0.18), (0.23, 0.18), (0.21, 0.42), (-0.23, 0.42)])
        cokgen([
            (-0.23, 0.38), (0.21, 0.38),                 # boyun tabanı
            (0.14, 0.50), (0.27, 0.59), (0.41, 0.65),    # çene ve burun
            (0.43, 0.72), (0.31, 0.78),                  # burun ucu
            (0.19, 0.83), (0.13, 0.80), (0.07, 0.97),    # alın ve kulak
            (-0.01, 0.83), (-0.13, 0.84),                # yele başlangıcı
            (-0.23, 0.74), (-0.29, 0.57)
        ])
        for (a, b) in [(-0.02, 0.86), (-0.10, 0.80), (-0.18, 0.72)]:   # yele dişleri
            cokgen([(a, b), (a + 0.09, b - 0.03), (a + 0.02, b + 0.07)])
        d.ellipse([X(0.16), Y(0.77), X(0.23), Y(0.70)], fill=0)        # göz
    return m


def _tas(tur, g, beyaz):
    """Maskeyi ışıklandırıp RGBA taş üretir: dikey geçiş + sol kenar ışığı."""
    y = int(g * TAS_YUK[tur])
    g = int(g)
    m = _tas_maskesi(tur, g, y)
    ust, alt = ((253, 246, 230), (198, 179, 146)) if beyaz else ((92, 80, 68), (18, 15, 12))
    yy, xx = np.mgrid[0:y, 0:g].astype(np.float32)
    dv = yy / max(1.0, y - 1.0)                       # 0 tepe -> 1 taban
    isik = np.clip(1.24 - (xx / g) * 0.62, 0.56, 1.24)  # ışık soldan
    arr = np.stack([ust[i] + (alt[i] - ust[i]) * dv for i in range(3)], axis=2) * isik[:, :, None]
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).convert('RGBA')
    im.putalpha(m.filter(ImageFilter.GaussianBlur(0.6)))
    # sol kenar ışığı: maskeyi hafif sağa kaydırıp farkını aydınlatır
    kenar = Image.new('RGBA', im.size, (255, 236, 198, 0))
    fark = Image.fromarray(np.clip(
        np.asarray(m).astype(int) - np.asarray(m.transform(
            m.size, Image.AFFINE, (1, 0, 3, 0, 1, 0))).astype(int), 0, 255).astype(np.uint8))
    # Siyah taşlar koyu tahtaya karışmasın diye kenar ışığı onlarda DAHA güçlü.
    kenar.putalpha(Image.eval(fark.filter(ImageFilter.GaussianBlur(1.0)),
                              lambda v: int(v * (0.80 if beyaz else 1.0))))
    return Image.alpha_composite(im, kenar)


def satranc():
    """
    Alçak kamera: tahtaya oyuncunun göz hizasından bakılır. Böylece taşlar
    büyük ve okunaklı olur, otuz ikisi birden kadraja girer. Işık soldaki
    pencereden gelir; havada toz zerreleri uçuşur.
    """
    # --- koyu salon + soldaki pencereden düşen sıcak ışık ---
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    r = np.sqrt(((xx - W * .13) / (W * .62))**2 + ((yy - H * .18) / (H * .78))**2)
    l = np.clip(1.30 - r * 1.12, 0.03, 1.0)
    zemin = np.stack([18 + 232 * l**1.25, 13 + 190 * l**1.45, 8 + 128 * l**1.70], axis=2)
    kapak = Image.fromarray(np.clip(zemin, 0, 255).astype(np.uint8)) \
                 .filter(ImageFilter.GaussianBlur(11)).convert('RGBA')

    # --- tahta: yakın sıra geniş, uzak sıra dar (güçlü perspektif) ---
    cx = W * .50
    ON, ARKA = W * .105, W * .053            # yakın / uzak hücre eni
    TG, UST = ON * 8, ARKA * 8
    Y0, Y1 = H * .535, H * .952              # tahtanın üst ve alt kenarı

    def nokta(u, v):                          # u 0..1 soldan sağa, v 0..1 arkadan öne
        # NOT: kenarlık için v hafif negatif olabiliyor; negatif tabanın
        # kesirli üssü Python'da karmaşık sayı verir, o yüzden mutlak değer.
        e = math.copysign(abs(v) ** 1.42, v)  # uzak sıralar sıkışsın
        g = UST + (TG - UST) * e
        return cx + (u - .5) * g, Y0 + (Y1 - Y0) * e

    d = ImageDraw.Draw(kapak, 'RGBA')
    d.polygon([nokta(-.04, -.03), nokta(1.04, -.03), nokta(1.05, 1.04), nokta(-.05, 1.04)],
              fill=(46, 28, 14, 255))          # tahta kenarlığı
    hucre = []
    for rr in range(8):
        for c in range(8):
            p = [nokta(c / 8, rr / 8), nokta((c + 1) / 8, rr / 8),
                 nokta((c + 1) / 8, (rr + 1) / 8), nokta(c / 8, (rr + 1) / 8)]
            acik = (rr + c) % 2 == 0
            # uzak kareler ışıktan uzaklaştığı için hafifçe koyulaşır
            k = 0.62 + 0.38 * (rr / 7)
            renk = (int(232 * k), int(212 * k), int(176 * k), 255) if acik \
                   else (int(104 * k), int(64 * k), int(36 * k), 255)
            d.polygon(p, fill=renk)
            mx = sum(q[0] for q in p) / 4
            my = (p[2][1] + p[3][1]) / 2       # taş karenin ÖN kenarına basar
            hucre.append((mx, my, abs(p[1][0] - p[0][0])))

    # --- 32 taş: arkadan öne, öndekiler arkadakilerin üstüne binsin ---
    def sira(rr, liste, beyaz):
        for c in range(8):
            mx, my, g = hucre[rr * 8 + c]
            t = _tas(liste[c], g * 1.02, beyaz)
            px, py = int(mx - t.width / 2), int(my - t.height)
            gl = Image.new('RGBA', kapak.size, (0, 0, 0, 0))
            gs = Image.new('RGBA', t.size, (0, 0, 0, 135)); gs.putalpha(t.split()[3])
            gs = gs.resize((t.width, max(4, int(t.height * .20))))
            gl.paste(gs, (px + int(g * .22), int(my - g * .10)), gs)
            kapak.alpha_composite(gl.filter(ImageFilter.GaussianBlur(int(g * .10) + 2)))
            kapak.paste(t, (px, py), t)

    sira(0, DIZILIM, False)                    # siyah taş sırası (en uzak)
    sira(1, ['piyon'] * 8, False)
    sira(6, ['piyon'] * 8, True)
    sira(7, DIZILIM, True)                     # beyaz taş sırası (en yakın)

    # --- havada uçuşan toz: ışığı görünür kılar ---
    toz = Image.new('RGBA', kapak.size, (0, 0, 0, 0))
    td = ImageDraw.Draw(toz)
    rng = np.random.default_rng(31)
    for _ in range(140):
        x, y = rng.random() * W, rng.random() * H * .72
        rr2 = 1.2 + rng.random() * 3.4
        a = int(30 + 150 * (1 - x / W) * rng.random())
        td.ellipse([x - rr2, y - rr2, x + rr2, y + rr2], fill=(255, 226, 176, a))
    kapak = Image.alpha_composite(kapak, toz.filter(ImageFilter.GaussianBlur(1.1)))

    return ko.bitir(kapak, os.path.join(CIKTI, 'chess.jpg'), vinyet=.70, netlik=86)


OYUNLAR['satranc'] = satranc
OYUNLAR['chess'] = satranc


if __name__ == '__main__':
    istenen = sys.argv[1:] or list(OYUNLAR)
    for ad in istenen:
        OYUNLAR[ad]()
        print('üretildi:', ad)
