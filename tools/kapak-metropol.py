# -*- coding: utf-8 -*-
"""
METROPOL KAPAGI - tepeden hafif acili gorunen emlak tahtasi: kenarlardaki
renk bantli kareler, uzerinde ev ve otel, bir kose piyonu ve zar cifti.

Kare listesi MOTORDAN okunur (metropol-engine.js): renk gruplari ve siralama
oradaki KARELER dizisinin aynisidir, boylece kapak ile oyun ayni tahtayi
gosterir.

GUVENLI ALAN: kapaklar .game-thumb icinde `background-size:cover` ile
gosterilir; her zaman yalniz ortadaki %68 x %68'lik bant gorunur. Tahta o
banda sigar; zarlar kenarda durur ve kirpilabilir.

Kullanim: python3 tools/kapak-metropol.py
"""
import importlib.util, os, json, subprocess
KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_s = importlib.util.spec_from_file_location('ko', os.path.join(KOK, 'tools', 'kapak-ortak.py'))
ko = importlib.util.module_from_spec(_s); _s.loader.exec_module(ko)
from PIL import Image, ImageDraw

W, H = ko.W, ko.H
CIKTI = os.path.join(KOK, 'assets', 'covers')
N = 11


def motor_verisi():
    """Kare tanimlarini motordan al (tek kaynak)."""
    betik = (
        "const E=require('%s');"
        "console.log(JSON.stringify({kareler:E.KARELER.map(k=>({t:k.t,g:k.g||null})),"
        "renk:E.GRUP_RENKLERI}));"
    ) % os.path.join(KOK, 'metropol-engine.js')
    return json.loads(subprocess.check_output(['node', '-e', betik], text=True))


def kare_yeri(i):
    """40 kareyi 11x11 cercevede yerine koy - istemcideki kareYeri ile ayni."""
    if i <= 10: return (N - 1, N - 1 - i)
    if i <= 20: return (N - 1 - (i - 10), 0)
    if i <= 30: return (0, i - 20)
    return (i - 30, N - 1)


def ev(cap, renk):
    """Kucuk bir ev: govde + catisi. Tahtada bina kademesini gosterir."""
    t = Image.new('RGBA', (cap, cap), (0, 0, 0, 0))
    d = ImageDraw.Draw(t)
    g = cap * 0.70
    x0 = (cap - g) / 2
    d.rectangle([x0, cap * 0.42, x0 + g, cap * 0.92], fill=renk,
                outline=(0, 0, 0, 120), width=max(1, int(cap * .06)))
    d.polygon([(x0 - cap * .07, cap * 0.44), (cap / 2, cap * 0.10),
               (x0 + g + cap * .07, cap * 0.44)],
              fill=tuple(min(255, int(c * 1.22)) for c in renk[:3]) + (255,),
              outline=(0, 0, 0, 120))
    return t


def metropol():
    V = motor_verisi()
    kapak = ko.cuha(renk=(16, 52, 30), isik=(0.5, 0.3), guc=1.0, tohum=141).convert('RGBA')
    G = ko.guvenli_kutu()
    cx, cy = (G[0] + G[2]) / 2, (G[1] + G[3]) / 2
    gh = G[3] - G[1]

    kenar = gh * 0.99
    k = kenar / N
    x0, y0 = cx - kenar / 2, cy - kenar / 2
    def P(r, c): return (x0 + c * k, y0 + r * k)

    kat = Image.new('RGBA', kapak.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(kat, 'RGBA')
    # tahta govdesi
    d.rounded_rectangle([x0 - k * .3, y0 - k * .3, x0 + kenar + k * .3, y0 + kenar + k * .3],
                        int(k * .5), fill=(22, 40, 24, 255))
    # orta alan: koyu yesil cuha
    d.rectangle([P(1, 1), P(10, 10)], fill=(208, 228, 202, 255))

    TIP_RENK = {
        'go': (214, 232, 208, 255), 'cezaevi': (206, 224, 200, 255),
        'park': (206, 224, 200, 255), 'cezaevineGit': (206, 224, 200, 255),
        'sans': (255, 232, 180, 255), 'fon': (204, 228, 255, 255),
        'vergi': (242, 216, 216, 255), 'gar': (226, 240, 222, 255),
        'idare': (226, 240, 222, 255), 'mulk': (233, 243, 230, 255),
    }
    for i, kr in enumerate(V['kareler']):
        r, c = kare_yeri(i)
        p1, p2 = P(r, c), P(r + 1, c + 1)
        d.rectangle([p1, p2], fill=TIP_RENK.get(kr['t'], (233, 243, 230, 255)),
                    outline=(0, 0, 0, 110), width=max(1, int(k * .06)))
        if kr['g']:
            hx = V['renk'][kr['g']]
            rgb = tuple(int(hx[j:j+2], 16) for j in (1, 3, 5)) + (255,)
            # Renk bandi kenara gore ic tarafa bakar - gercek tahtada oyle.
            if i <= 10:    bant = [p1[0], p1[1], p2[0], p1[1] + k * .26]
            elif i <= 20:  bant = [p2[0] - k * .26, p1[1], p2[0], p2[1]]
            elif i <= 30:  bant = [p1[0], p2[1] - k * .26, p2[0], p2[1]]
            else:          bant = [p1[0], p1[1], p1[0] + k * .26, p2[1]]
            d.rectangle(bant, fill=rgb)
        # kose kareleri capraz tarali
        if i in (0, 10, 20, 30):
            d.line([p1, p2], fill=(0, 0, 0, 34), width=max(1, int(k * .08)))

    # orta logo serisi: capraz kirmizi bant
    d.polygon([P(3.1, 2.0), P(2.0, 3.1), P(7.9, 9.0), P(9.0, 7.9)],
              fill=(176, 48, 40, 230))

    kapak = ko.golge(kapak, kat.split()[3], (10, 18), bulanik=24, koyuluk=165)
    kapak = Image.alpha_composite(kapak, kat)

    # binalar: bir renk grubunda evler, bir baskasinda otel
    YESIL = (36, 150, 84, 255)
    KIRMIZI = (198, 46, 42, 255)
    for i in (1, 3, 6, 8, 9):
        r, c = kare_yeri(i)
        cap = int(k * .62)
        t = ev(cap, YESIL)
        px, py = P(r + 0.62, c + 0.5)
        kapak = ko.golge(kapak, t.split()[3], (int(px - cap / 2) + 2, int(py - cap / 2) + 5),
                         bulanik=6, koyuluk=140)
        kapak.paste(t, (int(px - cap / 2), int(py - cap / 2)), t)
    for i in (31, 34):
        r, c = kare_yeri(i)
        cap = int(k * .80)
        t = ev(cap, KIRMIZI)
        px, py = P(r + 0.5, c + 0.42)
        kapak = ko.golge(kapak, t.split()[3], (int(px - cap / 2) + 2, int(py - cap / 2) + 6),
                         bulanik=7, koyuluk=145)
        kapak.paste(t, (int(px - cap / 2), int(py - cap / 2)), t)

    # piyonlar: dort oyuncu tahtanin dort yaninda
    PIYON = [(226, 59, 59), (47, 125, 224), (31, 174, 87), (232, 179, 34)]
    for n, i in enumerate((0, 12, 24, 37)):
        r, c = kare_yeri(i)
        cap = int(k * .52)
        t = ko.kure(cap, PIYON[n], parlaklik=0.95, ambiyans=0.34)
        px, py = P(r + 0.5, c + 0.5)
        kapak = ko.golge(kapak, t.split()[3], (int(px - cap / 2) + 3, int(py - cap / 2) + 6),
                         bulanik=7, koyuluk=150)
        kapak.paste(t, (int(px - cap / 2), int(py - cap / 2)), t)

    # zar cifti: orta alanda, capraz bandin ustunde
    for (fx, fy, don, noktalar) in ((4.0, 5.4, -13, ((.3, .3), (.7, .7), (.5, .5))),
                                    (6.2, 6.5, 9, ((.3, .3), (.7, .3), (.3, .7), (.7, .7)))):
        zcap = int(k * 1.35)
        z = Image.new('RGBA', (zcap, zcap), (0, 0, 0, 0))
        dz = ImageDraw.Draw(z)
        dz.rounded_rectangle([0, 0, zcap - 1, zcap - 1], int(zcap * .22), fill=(248, 244, 232, 255))
        dz.rounded_rectangle([0, 0, zcap - 1, int(zcap * .84)], int(zcap * .22), fill=(255, 253, 246, 255))
        for (nx, ny) in noktalar:
            rr = zcap * .10
            dz.ellipse([zcap * nx - rr, zcap * ny - rr, zcap * nx + rr, zcap * ny + rr],
                       fill=(32, 46, 30, 255))
        z = z.rotate(don, resample=Image.BICUBIC, expand=True)
        px, py = P(fy, fx)
        zx, zy = int(px - z.size[0] / 2), int(py - z.size[1] / 2)
        kapak = ko.golge(kapak, z.split()[3], (zx + 6, zy + 12), bulanik=12, koyuluk=160)
        kapak.paste(z, (zx, zy), z)

    return ko.bitir(kapak, os.path.join(CIKTI, 'metropol.jpg'), vinyet=0.55)


if __name__ == '__main__':
    print(metropol())
