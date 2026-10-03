# -*- coding: utf-8 -*-
"""Kelimelik oyun sözlüğünü TDK Güncel Türkçe Sözlük'ten üretir.
Kelimelik'in kendi kuralı: sözlükte MADDE BAŞI ne ise o geçerlidir.
Ek almış biçimler (kediler, evde, geldim) geçerli DEĞİLDİR; fiiller mastar
hâliyle bulunur (gel ✗ / gelmek ✓). Özel adlar, element simgeleri ve
kısaltmalar çıkarılır, ülke adları eklenir.
Kullanım: python3 sozluk-uret.py <v12.gts.sqlite3.db> <cikti.txt>
"""
import sqlite3, collections, io, os, sys

TR = 'abcçdefgğhıijklmnoöprsştuüvyz'
SAPKA = {'â':'a','î':'i','û':'u','ê':'e','ô':'o','Â':'A','Î':'I','Û':'U'}
EN_UZUN = 15          # tahta 15×15 — daha uzun kelime zaten oynanamaz
EN_KISA = 2

ULKELER = """afganistan almanya andorra angola arjantin arnavutluk avustralya avusturya azerbaycan
bahamalar bahreyn bangladeş barbados belçika belize benin bolivya botsvana brezilya brunei
bulgaristan burundi butan cezayir cibuti çad çekya çin danimarka dominika ekvador endonezya
eritre ermenistan estonya esvatini etiyopya fas fiji filipinler filistin finlandiya fransa gabon
gambiya gana gine grenada guatemala guyana gürcistan haiti hindistan hırvatistan hollanda honduras
ırak iran irlanda ispanya israil isveç isviçre italya izlanda jamaika japonya kamboçya kamerun
kanada karadağ katar kazakistan kenya kıbrıs kırgızistan kiribati kolombiya komorlar kongo kosova
kostarika kuveyt küba laos lesotho letonya liberya libya litvanya lübnan lüksemburg macaristan
madagaskar makedonya malavi maldivler malezya mali malta meksika mısır moğolistan moldova monako
moritanya mozambik myanmar namibya nauru nepal nijer nijerya nikaragua norveç özbekistan pakistan
palau panama paraguay peru polonya portekiz romanya ruanda rusya samoa senegal seyşeller sırbistan
singapur slovakya slovenya somali sudan surinam suriye şili tacikistan tanzanya tayland tayvan togo
tonga tunus türkiye tuvalu uganda ukrayna umman uruguay vanuatu venezuela vietnam yemen yunanistan
zambiya zimbabve""".split()
EK_LISTE = ['go', 'jak', 'pi']   # Kelimelik'in eski listelerinden koruduğu kelimeler

def duz(s): return ''.join(SAPKA.get(ch, ch) for ch in s)
def trKucuk(s): return s.replace('I', 'ı').replace('İ', 'i').lower()

def uret(db_yolu):
    c = sqlite3.connect(db_yolu)
    anlamli = set(r[0] for r in c.execute('select distinct madde_id from anlam'))
    simge = set(r[0] for r in c.execute(
        "select distinct m.madde_id from madde m join anlam a on a.madde_id=m.madde_id "
        "where a.anlam like '%elementinin simgesi%' or a.anlam like '%kısaltması%' "
        "or a.anlam like '%simgesi'"))
    sayac = collections.Counter(); kabul = set()
    for mid, madde, ozel in c.execute('select madde_id, madde, ozel_mi from madde'):
        k = (madde or '').strip()
        if not k:                                sayac['boş madde'] += 1; continue
        if ozel:                                 sayac['özel ad'] += 1; continue
        if any(ch in k for ch in " -'./"):       sayac['çok sözcüklü, deyim, kısaltma'] += 1; continue
        # BÜYÜK harf içeren madde = element simgesi (pH, Ag), özel ad ya da atasözü
        if any(ch.isupper() for ch in duz(k)):   sayac['büyük harf içeren (simge/özel ad)'] += 1; continue
        if mid in simge:                         sayac['simge / kısaltma maddesi'] += 1; continue
        if mid not in anlamli:                   sayac['anlamı boş madde'] += 1; continue
        kk = trKucuk(duz(k))
        if any(ch not in TR for ch in kk):       sayac['Türk alfabesi dışı harf'] += 1; continue
        if len(kk) < EN_KISA:                    sayac['tek harfli'] += 1; continue
        if len(kk) > EN_UZUN:                    sayac['%d harften uzun' % EN_UZUN] += 1; continue
        kabul.add(kk)
    eklendi = 0
    for w in ULKELER + EK_LISTE:
        w = trKucuk(duz(w))
        if EN_KISA <= len(w) <= EN_UZUN and all(ch in TR for ch in w) and w not in kabul:
            kabul.add(w); eklendi += 1
    return kabul, sayac, eklendi

if __name__ == '__main__':
    db, cikti = sys.argv[1], sys.argv[2]
    kabul, sayac, eklendi = uret(db)
    for k, v in sayac.most_common(): print('  elendi — %-40s %6d' % (k, v))
    print('  eklendi — ülke adları + eski liste      %6d' % eklendi)
    print('  SONUÇ: %d kelime' % len(kabul))
    io.open(cikti, 'w', encoding='utf-8').write('\n'.join(sorted(kabul)))
    print('  dosya: %s (%.2f MB)' % (cikti, os.path.getsize(cikti) / 1048576))
