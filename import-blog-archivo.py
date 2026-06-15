"""
import-blog-archivo.py
Importación única: WordPress XML → Airtable tabla "Blog Archivo"
Sin dependencias externas — usa solo stdlib de Python.

Uso en CI: configurado en .github/workflows/import-blog-archivo.yml
"""

import os
import re
import json
import time
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime

# ── Configuración ─────────────────────────────────────────────────────────────

AIRTABLE_TOKEN = os.environ.get('AIRTABLE_TOKEN', '')
BASE_ID        = 'appRWskRNQ1sUT4cy'
TABLE_ID       = 'tblz2Wq0xNXBzJHya'
XML_DIR        = os.path.join(os.path.dirname(__file__), 'xml')

F = {
    'titulo':    'fldTm0nyRxVXWGIw0',
    'fecha':     'fldcekK9ouClJLjBN',
    'resumen':   'fldC2yHOnYCARigMA',
    'temas':     'fldkmUuAd4N5W9uhl',
    'contenido': 'fldvpU45QibURTLIF',
    'categoria': 'flduAIlIFnNxpWy8W',
    'slug':      'fldf8bPpPdmQk3jSc',
    'estado':    'fld1MdHRRXLoBqzOt',
}

NS = {
    'content': 'http://purl.org/rss/1.0/modules/content/',
    'wp':      'http://wordpress.org/export/1.2/',
    'dc':      'http://purl.org/dc/elements/1.1/',
}

STOPWORDS = {'de','la','el','en','un','una','que','y','a','es','se','no','lo',
             'le','las','los','del','al','por','con','su','para','como','más',
             'pero','sus','me','si','ya','fue','ha','te','esta','son','hay',
             'muy','todo','bien','cuando','también','sobre','ser','tienen',
             'entre','años','vez','cada','hacer','puede','soy','estar','tiene',
             'era','así','qué','porque','hasta','solo','sin','dos','donde',
             'mismo','nos','mis','otra','este','eso','algo','tan','mi','tu'}

# ── Helpers ───────────────────────────────────────────────────────────────────

def strip_html(html):
    if not html:
        return ''
    html = re.sub(r'<(script|style)[^>]*>.*?</(script|style)>', '', html,
                  flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r'<(p|br|h[1-6]|li|div|blockquote)[^>]*>', '\n', html,
                  flags=re.IGNORECASE)
    html = re.sub(r'<[^>]+>', '', html)
    for ent, rep in [('&nbsp;',' '),('&amp;','&'),('&lt;','<'),('&gt;','>'),
                     ('&quot;','"'),('&#8220;','"'),('&#8221;','"'),
                     ('&#8217;',"'"),('&#8216;',"'"),('&#8230;','...')]:
        html = html.replace(ent, rep)
    lines = [l.strip() for l in html.splitlines() if l.strip()]
    return '\n'.join(lines)

def make_resumen(text, max_chars=400):
    paragraphs = [p for p in text.split('\n') if len(p) > 50]
    result = ''
    for p in paragraphs:
        if len(result) + len(p) <= max_chars:
            result += p + ' '
        else:
            remaining = max_chars - len(result)
            if remaining > 80:
                result += p[:remaining].rsplit(' ', 1)[0] + '...'
            break
    return result.strip()

def make_temas(title, text, category):
    combined = (title + ' ' + text[:300]).lower()
    words = re.findall(r'\b[a-záéíóúüñ]{4,}\b', combined)
    freq = {}
    for w in words:
        if w not in STOPWORDS:
            freq[w] = freq.get(w, 0) + 1
    top = sorted(freq, key=lambda x: -freq[x])[:5]
    cat = category.lower()
    keywords = [cat] + [w for w in top if w != cat]
    return ', '.join(keywords[:6])

def parse_date(pub_date_str):
    try:
        return parsedate_to_datetime(pub_date_str).strftime('%Y-%m-%d')
    except Exception:
        return None

# ── Parseo de XMLs ────────────────────────────────────────────────────────────

def parse_xmls():
    posts = []
    for fname in sorted(os.listdir(XML_DIR)):
        if not fname.endswith('.xml'):
            continue
        category = fname.replace('happimess.WordPress.', '').replace('.xml', '')
        fpath = os.path.join(XML_DIR, fname)

        tree = ET.parse(fpath)
        root = tree.getroot()

        for item in root.findall('.//item'):
            status = item.find('wp:status', NS)
            ptype  = item.find('wp:post_type', NS)
            if status is None or ptype is None:
                continue
            if status.text != 'publish' or ptype.text != 'post':
                continue

            title   = item.findtext('title') or ''
            pub     = item.findtext('pubDate') or ''
            slug    = item.findtext('wp:post_name', namespaces=NS) or ''
            raw     = item.findtext('content:encoded', namespaces=NS) or ''
            content = strip_html(raw)

            posts.append({
                'titulo':    title[:500],
                'fecha':     parse_date(pub),
                'resumen':   make_resumen(content),
                'temas':     make_temas(title, content, category),
                'contenido': content[:95000],
                'categoria': category,
                'slug':      slug[:500],
                'estado':    'nuevo',
            })

    return posts

# ── API de Airtable ───────────────────────────────────────────────────────────

def airtable_create(records_batch):
    payload = {
        'records': [
            {
                'fields': {
                    F['titulo']:    r['titulo'],
                    F['resumen']:   r['resumen'],
                    F['temas']:     r['temas'],
                    F['contenido']: r['contenido'],
                    F['categoria']: r['categoria'],
                    F['slug']:      r['slug'],
                    F['estado']:    r['estado'],
                    **({F['fecha']: r['fecha']} if r['fecha'] else {}),
                }
            }
            for r in records_batch
        ]
    }
    body = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(
        f'https://api.airtable.com/v0/{BASE_ID}/{TABLE_ID}',
        data=body,
        method='POST',
        headers={
            'Authorization': f'Bearer {AIRTABLE_TOKEN}',
            'Content-Type':  'application/json',
        }
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    if not AIRTABLE_TOKEN:
        print('❌  Falta AIRTABLE_TOKEN.')
        raise SystemExit(1)

    print('📖  Parseando XMLs...')
    posts = parse_xmls()
    print(f'✅  {len(posts)} posts encontrados.')

    if len(posts) == 0:
        print('⚠️   No se encontraron posts. Verificá que la carpeta xml/ tenga los archivos.')
        raise SystemExit(1)

    print('🚀  Importando a Airtable (tandas de 10)...\n')

    BATCH = 10
    total, errores = 0, 0

    for i in range(0, len(posts), BATCH):
        batch = posts[i:i + BATCH]
        end   = min(i + BATCH, len(posts))
        try:
            airtable_create(batch)
            total += len(batch)
            print(f'  ✓ {end}/{len(posts)}')
        except urllib.error.HTTPError as e:
            errores += 1
            print(f'  ✗ Error HTTP {e.code} en registros {i+1}-{end}: {e.read().decode()}')
        except Exception as e:
            errores += 1
            print(f'  ✗ Error en registros {i+1}-{end}: {e}')
        time.sleep(0.25)  # respetar rate limit: 5 req/seg

    print(f'\n🎉  Importación completa.')
    print(f'    Importados: {total}  |  Errores: {errores}')
    if errores > 0:
        raise SystemExit(1)

if __name__ == '__main__':
    main()
