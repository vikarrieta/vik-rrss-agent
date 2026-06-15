/**
 * import-blog-archivo.cjs
 * Importación única: WordPress XML → Airtable tabla "Blog Archivo"
 *
 * Uso local:   AIRTABLE_TOKEN=xxx node import-blog-archivo.cjs
 * Uso en CI:   configurado en .github/workflows/import-blog-archivo.yml
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { XMLParser } = require('fast-xml-parser') ;

// ── Configuración ────────────────────────────────────────────────────────────

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID        = 'appRWskRNQ1sUT4cy';
const TABLE_ID       = 'tblz2Wq0xNXBzJHya';

// Field IDs de Blog Archivo
const F = {
  titulo:    'fldTm0nyRxVXWGIw0',
  fecha:     'fldcekK9ouClJLjBN',
  resumen:   'fldC2yHOnYCARigMA',
  temas:     'fldkmUuAd4N5W9uhl',
  contenido: 'fldvpU45QibURTLIF',
  categoria: 'flduAIlIFnNxpWy8W',
  slug:      'fldf8bPpPdmQk3jSc',
  estado:    'fld1MdHRRXLoBqzOt',
};

// Directorio con los XMLs — ajustar si se corre localmente desde otro path
const XML_DIR = path.join(__dirname, 'xml');

// ── Helpers ──────────────────────────────────────────────────────────────────

const STOPWORDS = new Set(['de','la','el','en','un','una','que','y','a','es','se','no','lo','le','las','los','del','al','por','con','su','para','como','más','pero','sus','me','si','ya','fue','ha','te','esta','son','hay','muy','todo','bien','cuando','también','sobre','ser','tienen','entre','años','vez','cada','hacer','puede','soy','estar','tiene','era','así','qué','porque','hasta','solo','sin','dos','donde','mismo','nos','mis','otra','este','eso','algo','tan','mi','tu']);

function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/(script|style)>/gi, '')
    .replace(/<(p|br|h[1-6]|li|div|blockquote)[^>]*/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#82[12]0;/g, '"').replace(/&#8217;/g, "'").replace(/&#8230;/g, '...')
    .split('\n').map(l => l.trim()).filter(l => l.length > 0).join('\n');
}

function makeResumen(text, max = 400) {
  const paragraphs = text.split('\n').filter(p => p.length > 50);
  let result = '';
  for (const p of paragraphs) {
    if (result.length + p.length <= max) {
      result += p + ' ';
    } else {
      const remaining = max - result.length;
      if (remaining > 80) result += p.slice(0, remaining).replace(/\s\S+$/, '') + '...';
      break;
    }
  }
  return result.trim();
}

function makeTemas(title, text, category) {
  const combined = (title + ' ' + text.slice(0, 300)).toLowerCase();
  const words = (combined.match(/\b[a-záéíóúüñ]{4,}\b/g) || []);
  const freq = {};
  for (const w of words) {
    if (!STOPWORDS.has(w)) freq[w] = (freq[w] || 0) + 1;
  }
  const top = Object.keys(freq).sort((a,b) => freq[b]-freq[a]).slice(0,5);
  const cat = category.toLowerCase();
  return [cat, ...top.filter(w => w !== cat)].slice(0, 6).join(', ');
}

function parseDate(pubDateStr) {
  try {
    return new Date(pubDateStr).toISOString().slice(0, 10);
  } catch { return null; }
}

// ── Parseo de XMLs ───────────────────────────────────────────────────────────

function parseXmls() {
  const parser = new XMLParser({
    ignoreAttributes: false,
    cdataPropName: '__cdata',
    parseTagValue: false,
  });

  const allPosts = [];
  const xmlFiles = fs.readdirSync(XML_DIR).filter(f => f.endsWith('.xml'));

  for (const fname of xmlFiles.sort()) {
    const category = fname.replace('happimess.WordPress.', '').replace('.xml', '');
    const xml = fs.readFileSync(path.join(XML_DIR, fname), 'utf-8');
    const parsed = parser.parse(xml);

    const items = [].concat(parsed?.rss?.channel?.item || []);

    for (const item of items) {
      const status = item['wp:status']?.__cdata || item['wp:status'] || '';
      const ptype  = item['wp:post_type']?.__cdata || item['wp:post_type'] || '';
      if (status !== 'publish' || ptype !== 'post') continue;

      const title   = item.title?.__cdata || item.title || '';
      const link    = item.link || '';
      const pubDate = item.pubDate || '';
      const slug    = item['wp:post_name']?.__cdata || item['wp:post_name'] || '';
      const rawContent = item['content:encoded']?.__cdata || item['content:encoded'] || '';
      const content = stripHtml(rawContent);

      allPosts.push({
        titulo:    String(title).slice(0, 500),
        fecha:     parseDate(pubDate),
        resumen:   makeResumen(content),
        temas:     makeTemas(String(title), content, category),
        contenido: content.slice(0, 95000), // Airtable limit ~100K
        categoria: category,
        slug:      String(slug).slice(0, 500),
        estado:    'nuevo',
      });
    }
  }

  return allPosts;
}

// ── API de Airtable ──────────────────────────────────────────────────────────

function airtableRequest(records) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      records: records.map(r => ({
        fields: {
          [F.titulo]:    r.titulo,
          [F.resumen]:   r.resumen,
          [F.temas]:     r.temas,
          [F.contenido]: r.contenido,
          [F.categoria]: r.categoria,
          [F.slug]:      r.slug,
          [F.estado]:    r.estado,
          ...(r.fecha ? { [F.fecha]: r.fecha } : {}),
        }
      }))
    });

    const options = {
      hostname: 'api.airtable.com',
      path:     `/v0/${BASE_ID}/${TABLE_ID}`,
      method:   'POST',
      headers:  {
        'Authorization': `Bearer ${AIRTABLE_TOKEN}`,
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(body),
      }
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`Airtable error ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!AIRTABLE_TOKEN) {
    console.error('❌  Falta AIRTABLE_TOKEN en las variables de entorno.');
    process.exit(1);
  }

  console.log('📖  Parseando XMLs...');
  let posts;
  try {
    posts = parseXmls();
  } catch (e) {
    // fast-xml-parser might not be installed — fallback message
    console.error('❌  Error al parsear XMLs:', e.message);
    console.error('    Asegurate de correr: npm install fast-xml-parser');
    process.exit(1);
  }

  console.log(`✅  ${posts.length} posts encontrados.`);
  console.log('🚀  Importando a Airtable (tandas de 10)...\n');

  const BATCH = 10;
  let total = 0;
  let errores = 0;

  for (let i = 0; i < posts.length; i += BATCH) {
    const batch = posts.slice(i, i + BATCH);
    const end = Math.min(i + BATCH, posts.length);
    try {
      await airtableRequest(batch);
      total += batch.length;
      process.stdout.write(`  ✓ ${end}/${posts.length}\r`);
    } catch (e) {
      errores++;
      console.error(`\n  ✗ Error en registros ${i+1}-${end}:`, e.message);
    }
    // Respetar rate limit de Airtable: 5 req/seg
    await sleep(250);
  }

  console.log(`\n\n🎉  Importación completa.`);
  console.log(`    Importados: ${total}  |  Errores: ${errores}`);
}

main().catch(e => { console.error(e); process.exit(1); });
