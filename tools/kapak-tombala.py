# -*- coding: utf-8 -*-
"""
TOMBALA KAPAĞI — çuha üzerinde bir tombala kartı ve çekilmiş numaralı toplar.

GÜVENLİ ALAN: kapaklar .game-thumb içinde `background-size:cover` ile
gösterilir; kutunun oranı 1.17–2.50 arasında gezdiği için her zaman yalnız
ortadaki %68 × %68'lik bant görünür (bkz. tools/kapak-ortak.py). Bu yüzden
ANA CİSİM (3×9 tombala kartı + önündeki üç top) tamamen o banda sığar;
kenarlardaki dağınık toplar yalnız derinlik içindir, kırpılabilir.

Kullanım: python3 tools/kapak-tombala.py
"""
import importlib.util, os, random
# kapak-ortak.py adında tire olduğu için normal import ile alınamaz.
KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_s = importlib.util.spec_from_file_location('ko', os.path.join(KOK, 'tools', 'kapak-ortak.py'))
ko = importlib.util.module_from_spec(_s); _s.loader.exec_module(ko)
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = ko.W, ko.H
CIKTI = os.path.join(KOK, 'assets', 'covers')

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


def ortala(d, kutu_g, kutu_y, metin, f):
    """Bir kutunun ortasına yazmak için gereken kaydırmayı döndürür."""
    k = d.textbbox((0, 0), metin, font=f)
    return ((kutu_g - (k[2] - k[0])) / 2 - k[0], (kutu_y - (k[3] - k[1])) / 2 - k[1])


def top(cap, numara, renk=(238, 240, 245), yazi=(28, 24, 40)):
    """Numaralı tombala topu: ko.kure üstüne beyaz madalyon ve sayı."""
    k = ko.kure(cap, renk, parlaklik=1.05)
    d = ImageDraw.Draw(k, 'RGBA')
    m = cap * 0.52                                   # ortadaki beyaz madalyon
    d.ellipse([(cap - m) / 2, (cap - m) / 2 - cap * .03,
               (cap + m) / 2, (cap + m) / 2 - cap * .03], fill=(252, 252, 255, 248))
    f = yazitipi(int(cap * .30))
    dx, dy = ortala(d, cap, cap, str(numara), f)
    d.text((dx, dy - cap * .03), str(numara), font=f, fill=yazi + (255,))
    return k


def kart(gen, satirlar, kapali):
    """3×9 tombala kartı. satirlar: her satırda 9 hücre (sayı ya da None).
       kapali: kapanmış sayıların kümesi — üzerine kırmızı pul basılır."""
    hucre = gen / 9.0
    yuk = hucre * 3
    pay = hucre * .30
    im = Image.new('RGBA', (int(gen + pay * 2), int(yuk + pay * 2.6)), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    r = int(hucre * .18)
    # karton: sıcak krem, altta kalınlık payı
    d.rounded_rectangle([0, int(pay * .5), im.width - 1, im.height - 1], r, fill=(196, 160, 104, 255))
    d.rounded_rectangle([0, 0, im.width - 1, im.height - int(pay * .7)], r, fill=(248, 238, 216, 255))
    f = yazitipi(int(hucre * .50))
    for sy in range(3):
        for sx in range(9):
            x0 = pay + sx * hucre
            y0 = pay + sy * hucre
            n = satirlar[sy][sx]
            if n is None:
                # boş göz: hafif gölgeli oyuk
                d.rounded_rectangle([x0 + 1, y0 + 1, x0 + hucre - 2, y0 + hucre - 2],
                                    int(hucre * .12), fill=(232, 216, 186, 255))
                continue
            d.rounded_rectangle([x0 + 1, y0 + 1, x0 + hucre - 2, y0 + hucre - 2],
                                int(hucre * .12), fill=(255, 250, 236, 255),
                                outline=(206, 180, 136, 255), width=max(1, int(hucre * .035)))
            dx, dy = ortala(d, hucre, hucre, str(n), f)
            if n in kapali:
                # Kapanmış sayı: kırmızı pul BASILIR ama sayı pulun üstünde
                # beyaz olarak okunmaya devam eder — gerçek tombalada da
                # kapatılan sayı görünür kalır.
                pd = hucre * .80
                px, py = x0 + (hucre - pd) / 2, y0 + (hucre - pd) / 2
                d.ellipse([px, py, px + pd, py + pd], fill=(198, 44, 58, 255))
                d.ellipse([px + pd * .16, py + pd * .12, px + pd * .58, py + pd * .44],
                          fill=(255, 255, 255, 64))
                d.text((x0 + dx, y0 + dy), str(n), font=f, fill=(255, 246, 246, 255))
            else:
                d.text((x0 + dx, y0 + dy), str(n), font=f, fill=(58, 44, 24, 255))
    return im


def tombala():
    # zemin: koyu fuşya-mor çuha (oyunun kart rengiyle aynı aile)
    kapak = ko.cuha(renk=(96, 28, 68), isik=(0.46, 0.30), guc=1.06, tohum=23).convert('RGBA')
    G = ko.guvenli_kutu()
    cx, cy = (G[0] + G[2]) / 2, (G[1] + G[3]) / 2
    gw = G[2] - G[0]
    rng = random.Random(20261010)

    # ---- arka planda dağınık toplar (derinlik) — güvenli bandın DIŞINDA
    for n in [7, 19, 34, 52, 61, 73, 85, 12, 46, 90]:
        c = int(gw * rng.uniform(.085, .120))
        t = top(c, n, renk=(222, 226, 236))
        x = int(rng.choice([rng.uniform(0, max(1, G[0] - c * .5)),
                            rng.uniform(G[2] - c * .5, W - c)]))
        y = int(rng.uniform(0, H - c))
        kapak = ko.golge(kapak, t.split()[3], (x + 8, y + 13), bulanik=16, koyuluk=130)
        gecici = t.copy(); gecici.putalpha(t.split()[3].point(lambda v: int(v * .74)))
        kapak.paste(gecici, (x, y), gecici)

    # ---- ortada tombala kartı (ANA CİSİM, güvenli bantta)
    satirlar = [
        [3,    None, 22,   None, 45,   None, 68,   None, 81  ],
        [None, 16,   None, 37,   None, 54,   None, 72,   88  ],
        [8,    None, 27,   None, 49,   61,   None, None, 90  ],
    ]
    kapali = {3, 22, 45, 81, 68, 16, 54, 27, 61}
    kg = int(gw * 0.88)
    k = kart(kg, satirlar, kapali).rotate(-2.4, resample=Image.BICUBIC, expand=True)
    kx = int(cx - k.width / 2)
    ky = int(cy - k.height * 0.62)
    kapak = ko.golge(kapak, k.split()[3], (kx + 9, ky + 18), bulanik=22, koyuluk=160)
    kapak.paste(k, (kx, ky), k)

    # ---- kartın önünde üç çekilmiş top (sahnenin odağı)
    onde = [(45, (240, 242, 248)), (72, (252, 226, 140)), (61, (236, 238, 246))]
    c = int(gw * 0.175)
    ara = int(c * .20)
    toplam = len(onde) * c + (len(onde) - 1) * ara
    tx = int(cx - toplam / 2)
    ty = int(cy + k.height * 0.30 - c * .30)
    for i, (n, renk) in enumerate(onde):
        t = top(c, n, renk=renk)
        x = tx + i * (c + ara)
        y = ty + (0 if i != 1 else -int(c * .10))
        kapak = ko.golge(kapak, t.split()[3], (x + 7, y + 15), bulanik=15, koyuluk=165)
        kapak.paste(t, (x, y), t)

    return ko.bitir(kapak, os.path.join(CIKTI, 'tombala.jpg'))


if __name__ == '__main__':
    print(tombala())
