# -*- coding: utf-8 -*-
"""
KIZMA BIRADER KAPAGI - tepeden gorunen Ludo tahtasi, piyonlar ve zar.

Tahta MOTORDAN okunur (kizmabirader-engine.js): tur yolu, ev yollari ve
baslangiclar oradaki dizilerin aynisidir, boylece kapak ile oyun ayni
tahtayi gosterir.

GUVENLI ALAN: kapaklar .game-thumb icinde `background-size:cover` ile
gosterilir; her zaman yalniz ortadaki %68 x %68'lik bant gorunur. Tahta o
banda sigar; zar kenarda durur ve kirpilabilir.

Kullanim: python3 tools/kapak-kizmabirader.py
"""
import importlib.util, os, json, subprocess
KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_s = importlib.util.spec_from_file_location('ko', os.path.join(KOK, 'tools', 'kapak-ortak.py'))
ko = importlib.util.module_from_spec(_s); _s.loader.exec_module(ko)
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = ko.W, ko.H
CIKTI = os.path.join(KOK, 'assets', 'covers')
N = 15

FONT_ADAYLAR = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
]
def yazitipi(boy):
    for y in FONT_ADAYLAR:
        if os.path.exists(y):
            try: return ImageFont.truetype(y, boy)
            except Exception: pass
    return ImageFont.load_default()


def motor_verisi():
    """Tahta dizilerini motordan al (tek kaynak)."""
    betik = (
        "const E=require('%s');"
        "console.log(JSON.stringify({tur:E.TUR_YOLU,ev:E.EV_YOLU,bas:E.BASLANGIC,"
        "us:E.US_KOSELERI,guv:[...E.GUVENLI],yil:[...E.YILDIZ],renk:E.RENKLER}));"
    ) % os.path.join(KOK, 'kizmabirader-engine.js')
    cikti = subprocess.check_output(['node', '-e', betik], text=True)
    return json.loads(cikti)


def kizmabirader():
    V = motor_verisi()
    kapak = ko.cuha(renk=(54, 20, 44), isik=(0.5, 0.28), guc=1.0, tohum=89).convert('RGBA')
    G = ko.guvenli_kutu()
    cx, cy = (G[0] + G[2]) / 2, (G[1] + G[3]) / 2
    gh = G[3] - G[1]

    kenar = gh * 0.98
    h = kenar / N
    x0, y0 = cx - kenar / 2, cy - kenar / 2
    def P(r, c): return (x0 + c * h, y0 + r * h)

    kat = Image.new('RGBA', kapak.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(kat, 'RGBA')
    d.rounded_rectangle([x0 - h * .35, y0 - h * .35, x0 + kenar + h * .35, y0 + kenar + h * .35],
                        int(h * 1.1), fill=(26, 12, 24, 255))

    renkler = [tuple(int(V['renk'][i][j:j+2], 16) for j in (1, 3, 5)) for i in range(4)]

    # usler
    for i, (ur, uc) in enumerate(V['us']):
        p1, p2 = P(ur, uc), P(ur + 6, uc + 6)
        d.rounded_rectangle([p1, p2], int(h * .7), fill=renkler[i] + (56,),
                            outline=renkler[i] + (190,), width=max(2, int(h * .13)))
        ic1, ic2 = P(ur + 1.1, uc + 1.1), P(ur + 4.9, uc + 4.9)
        d.rounded_rectangle([ic1, ic2], int(h * .45), fill=(244, 236, 217, 235))

    # tur yolu
    guv = set(V['guv']); yil = set(V['yil']); bas = V['bas']
    for i, (r, c) in enumerate(V['tur']):
        p1, p2 = P(r, c), P(r + 1, c + 1)
        renk = (244, 236, 217, 255)
        if i in bas:
            renk = renkler[bas.index(i)] + (170,)
        elif i in yil or i in guv:
            renk = (227, 215, 187, 255)
        d.rectangle([p1, p2], fill=renk, outline=(0, 0, 0, 46), width=max(1, int(h * .07)))

    # ev yollari
    for i, hucreler in enumerate(V['ev']):
        for (r, c) in hucreler:
            d.rectangle([P(r, c), P(r + 1, c + 1)], fill=renkler[i] + (205,),
                        outline=(0, 0, 0, 46), width=max(1, int(h * .07)))

    # merkez: dort ucgen
    m1, m2 = P(6, 6), P(9, 9)
    mx, my = (m1[0] + m2[0]) / 2, (m1[1] + m2[1]) / 2
    koseler = [(m1[0], m1[1]), (m2[0], m1[1]), (m2[0], m2[1]), (m1[0], m2[1])]
    for i in range(4):
        a, b = koseler[i], koseler[(i + 1) % 4]
        d.polygon([a, b, (mx, my)], fill=renkler[[1, 2, 3, 0][i]] + (225,))

    kapak = ko.golge(kapak, kat.split()[3], (10, 18), bulanik=22, koyuluk=160)
    kapak = Image.alpha_composite(kapak, kat)

    # piyonlar: biri yolda, ikisi uste, biri ev yolunda
    yerler = [(0, V['tur'][5], 1.0), (1, V['tur'][18], 1.0), (2, V['tur'][31], 1.0),
              (0, V['ev'][0][3], 1.0), (3, V['tur'][44], 1.0),
              (1, [V['us'][1][0] + 2, V['us'][1][1] + 2], .92)]
    for (renk, rc, olcek) in yerler:
        cap = int(h * 0.92 * olcek)
        t = ko.kure(cap, renkler[renk], parlaklik=0.95, ambiyans=0.36)
        px, py = P(rc[0] + 0.5, rc[1] + 0.5)
        kapak = ko.golge(kapak, t.split()[3], (int(px - cap / 2) + 3, int(py - cap / 2) + 7),
                         bulanik=8, koyuluk=150)
        kapak.paste(t, (int(px - cap / 2), int(py - cap / 2)), t)

    # zar: tahtanin sag altinda
    zcap = int(h * 2.6)
    z = Image.new('RGBA', (zcap, zcap), (0, 0, 0, 0))
    dz = ImageDraw.Draw(z)
    dz.rounded_rectangle([0, 0, zcap - 1, zcap - 1], int(zcap * .22), fill=(244, 236, 217, 255))
    dz.rounded_rectangle([0, 0, zcap - 1, int(zcap * .82)], int(zcap * .22), fill=(252, 248, 236, 255))
    for (fx, fy) in ((.26, .26), (.74, .26), (.26, .5), (.74, .5), (.26, .74), (.74, .74)):
        rr = zcap * .085
        dz.ellipse([zcap * fx - rr, zcap * fy - rr, zcap * fx + rr, zcap * fy + rr],
                   fill=(42, 18, 48, 255))
    z = z.rotate(-11, resample=Image.BICUBIC, expand=True)
    zx, zy = int(x0 + kenar - zcap * .55), int(y0 + kenar - zcap * .35)
    kapak = ko.golge(kapak, z.split()[3], (zx + 7, zy + 14), bulanik=14, koyuluk=165)
    kapak.paste(z, (zx, zy), z)

    return ko.bitir(kapak, os.path.join(CIKTI, 'kizmabirader.jpg'), vinyet=0.55)


if __name__ == '__main__':
    print(kizmabirader())
