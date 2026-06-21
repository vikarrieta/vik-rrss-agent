'use strict';
const https = require('https');

// ── Constantes ─────────────────────────────────────────────────────────────
const AIRTABLE_BASE    = 'appRWskRNQ1sUT4cy';
const TABLE_IDEAS       = 'tblOAexQYZfkcqWjw'; // Banco de ideas
const TABLE_BLOG        = 'tblz2Wq0xNXBzJHya'; // Blog Archivo
const TABLE_SUBSTACK    = 'tblAHdpM3BoyhOaHj'; // Substack
const GMAIL_RECIPIENT   = 'vik@monoblock.tv';
const UMBRAL_IDEAS_BAJO = 3; // si hay menos ideas nuevas que esto, sumamos respaldo del blog

// ── Voz Happimess ──────────────────────────────────────────────────────────
const VOZ_HAPPIMESS = `
HAPPIMESS — VOZ EDITORIAL PARA SUBSTACK
Happimess es una marca de lifestyle creada por Vik Arrieta (Buenos Aires). Diseña y vende calendarios y agendas. Es una marca editorial, DISTINTA de @vikarrieta personal.

TONO:
- Editorial, generosa, con criterio — como una columna de revista bien escrita, no un diario personal
- Cálida pero diseñada: sin los micropatrones de Vik (sin paréntesis de voz interna, sin diminutivos de cariño, sin humor ejecutivo seco)
- Español rioplatense, voseo siempre
- Usa fuentes y referencias reales para dar peso editorial

UNIVERSO TEMÁTICO:
- Tiempo como material creativo
- Diseño como forma de pensar y de vivir
- Organización con propósito (no productividad vacía)
- Lifestyle consciente
- Imaginación radical como acto político
- Curiosidad como motor de crecimiento
- La comunidad como espacio de transformación

CATEGORÍAS SUBSTACK HAPPIMESS:
- Activar: motivación y acción concreta
- Crecer: aprendizaje, procesos, experiencias que enseñan algo
- Descubrir: cultura, libros, fenómenos, curiosidades con criterio
- Disfrutar: placer cotidiano, lo pequeño que vale la pena
- Viajar: experiencias de viaje con foco en lo que revelan

REGLAS:
- Nota SIEMPRE gratuita, sin paywall
- Incluir SIEMPRE 1 a 3 fuentes web verificables: libros, estudios, artículos (nombre, año/fecha, por qué aplica) — buscadas con web_search, no inventadas
- Mínimo 2 subtítulos H2 para estructurar — idealmente 3
- Extensión: 500-700 palabras
- Cierre: invitación concreta, no moraleja
- NUNCA: autoayuda motivacional vacía, imperativo ("tenés que", "deberías"), tono de gurú, clichés de productividad
`;

// ── Gmail OAuth ─────────────────────────────────────────────────────────────
async function getGmailAccessToken() {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      client_id:     process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN,
      grant_type:    'refresh_token'
    }).toString();

    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const parsed = JSON.parse(data);
        if (parsed.access_token) resolve(parsed.access_token);
        else reject(new Error('No access_token: ' + JSON.stringify(parsed)));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function sendGmail(accessToken, subject, htmlBody) {
  const message = [
    `To: ${GMAIL_RECIPIENT}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(htmlBody).toString('base64')
  ].join('\r\n');

  const encodedMessage = Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ raw: encodedMessage });
    const req = https.request({
      hostname: 'gmail.googleapis.com',
      path: '/gmail/v1/users/me/messages/send',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Anthropic API ───────────────────────────────────────────────────────────
async function callAnthropic(prompt, opts = {}) {
  const { tools = [], extraBetas = [] } = opts;

  const bodyObj = {
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
    messages: [{ role: 'user', content: prompt }]
  };
  if (tools.length > 0) bodyObj.tools = tools;

  const betas = ['mcp-client-2025-04-04', ...extraBetas];
  const body = JSON.stringify(bodyObj);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta':    betas.join(',')
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const parsed = JSON.parse(data);
        if (parsed.error) reject(new Error('API error: ' + parsed.error.message));
        else resolve(parsed);
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function extractText(response) {
  return (response.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n');
}


function parseJSON(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  const raw = m[0];
  try { return JSON.parse(raw); } catch (_) {}
  try {
    return JSON.parse(repairJSON(raw));
  } catch (e) {
    console.error('parseJSON: no se pudo parsear.', e.message);
    return null;
  }
}
 
// Repara JSON generado por un LLM: normaliza control chars dentro de strings
// y, sobre todo, escapa comillas dobles "internas" que el modelo dejó sin
// escapar (ej: una cita textual dentro de un campo markdown), que es la causa
// más común de "Expected ',' or '}' after property value".
function repairJSON(raw) {
  let out = '';
  let inStr = false;
  let esc = false;
 
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
 
    if (esc) { out += c; esc = false; continue; }
    if (c === '\\' && inStr) { out += c; esc = true; continue; }
 
    if (c === '"') {
      if (!inStr) {
        // Apertura de string: siempre válida.
        inStr = true;
        out += c;
        continue;
      }
      // Estamos dentro de un string y encontramos una comilla.
      // Miramos qué sigue (saltando espacios) para decidir si es un
      // cierre legítimo o una comilla interna sin escapar.
      let j = i + 1;
      while (j < raw.length && /\s/.test(raw[j])) j++;
      const next = raw[j];
      const esCierreLegitimo =
        next === undefined ||
        next === ',' || next === '}' || next === ']' || next === ':';
 
      if (esCierreLegitimo) {
        inStr = false;
        out += c;
      } else {
        // Comilla interna: la escapamos y seguimos dentro del string.
        out += '\\"';
      }
      continue;
    }
 
    if (inStr) {
      if      (c === '\n') { out += '\\n'; continue; }
      else if (c === '\r') { out += '\\r'; continue; }
      else if (c === '\t') { out += '\\t'; continue; }
      else if (c.charCodeAt(0) < 0x20) continue;
    }
 
    out += c;
  }
 
  return out;
}

// ── Airtable REST directo (sin MCP) ────────────────────────────────────────
const AIRTABLE_TOKEN = (process.env.AIRTABLE_TOKEN || '').trim();

function airtableRequest(method, path, bodyObj) {
  return new Promise((resolve, reject) => {
    const body = bodyObj ? JSON.stringify(bodyObj) : null;
    const headers = { 'Authorization': `Bearer ${AIRTABLE_TOKEN}` };
    if (body) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = https.request({
      hostname: 'api.airtable.com',
      path,
      method,
      headers
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) reject(new Error(`Airtable ${method} ${path}: ${JSON.stringify(parsed.error)}`));
          else resolve(parsed);
        } catch (e) {
          reject(new Error('Parse Airtable error: ' + data.slice(0, 300)));
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// Trae TODOS los registros de una tabla (pagina con offset), con filtro y campos opcionales.
async function fetchAirtableTable(tableId, { filterByFormula, fields, sort } = {}) {
  if (!AIRTABLE_TOKEN) throw new Error('AIRTABLE_TOKEN no configurado');

  let all = [];
  let offset = null;
  do {
    const params = new URLSearchParams();
    params.set('pageSize', '100');
    if (filterByFormula) params.set('filterByFormula', filterByFormula);
    if (offset) params.set('offset', offset);
    if (fields) fields.forEach(f => params.append('fields[]', f));
    if (sort) sort.forEach((s, i) => {
      params.set(`sort[${i}][field]`, s.field);
      params.set(`sort[${i}][direction]`, s.direction || 'asc');
    });

    const path = `/v0/${AIRTABLE_BASE}/${tableId}?${params.toString()}`;
    const resp = await airtableRequest('GET', path);
    all = all.concat(resp.records || []);
    offset = resp.offset || null;
  } while (offset);

  return all;
}

async function updateAirtableRecords(tableId, records) {
  // records: [{ id, fields }]. Airtable acepta máx 10 por request.
  for (let i = 0; i < records.length; i += 10) {
    const batch = records.slice(i, i + 10);
    await airtableRequest('PATCH', `/v0/${AIRTABLE_BASE}/${tableId}`, { records: batch });
  }
}

async function createAirtableRecord(tableId, fields) {
  return airtableRequest('POST', `/v0/${AIRTABLE_BASE}/${tableId}`, { records: [{ fields }] });
}

// ── Helpers de fecha ─────────────────────────────────────────────────────────
function isoWeekNumber(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

// ── HTML helpers (mail) ─────────────────────────────────────────────────────
function card(inner, extraStyle = '') {
  return `<div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;margin-bottom:24px${extraStyle}">${inner}</div>`;
}

function mdToHtmlBasic(md) {
  // Conversión simple de Markdown a HTML para mostrar la nota en el mail.
  // (El draft "real" que se guarda en Airtable y se usa para publicar es el Markdown, esto es solo preview.)
  return (md || '')
    .split(/\n{2,}/)
    .map(block => {
      const t = block.trim();
      if (t.startsWith('## ')) return `<h2 style="font-size:18px;font-weight:700;color:#111827;margin:24px 0 8px">${t.slice(3)}</h2>`;
      if (t.startsWith('### ')) return `<h3 style="font-size:16px;font-weight:600;color:#374151;margin:18px 0 6px">${t.slice(4)}</h3>`;
      return `<p style="color:#1f2937;font-size:15px;line-height:1.8;margin:12px 0">${t.replace(/\n/g, '<br>')}</p>`;
    })
    .join('');
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════════════════
(async () => {
  const today = new Date().toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    timeZone: 'America/Argentina/Buenos_Aires'
  });
  const semanaActual = isoWeekNumber(new Date());

  // ── PASO 1: Leer Banco de ideas (nuevo) ───────────────────────────────────
  console.log('📖 Leyendo Banco de ideas...');
  let ideasNuevas = [];
  try {
    ideasNuevas = await fetchAirtableTable(TABLE_IDEAS, {
      filterByFormula: "{Estado}='nuevo'",
      fields: ['ID entrada', 'Fecha', 'Tipo', 'Contenido', 'Descripción adjunto']
    });
    console.log(`✅ Banco de ideas: ${ideasNuevas.length} entradas nuevas`);
  } catch (e) {
    console.error('❌ Error leyendo Banco de ideas:', e.message);
  }

  // ── PASO 2: Leer Blog Archivo liviano (respaldo) ──────────────────────────
  let blogNuevo = [];
  if (ideasNuevas.length < UMBRAL_IDEAS_BAJO) {
    console.log('📚 Pocas ideas nuevas — sumando respaldo de Blog Archivo...');
    try {
      blogNuevo = await fetchAirtableTable(TABLE_BLOG, {
        filterByFormula: "{Estado}='nuevo'",
        fields: ['Título', 'Resumen', 'Temas clave', 'Categorías', 'Fecha original']
      });
      console.log(`✅ Blog Archivo (no usado): ${blogNuevo.length} posts disponibles como respaldo`);
    } catch (e) {
      console.error('❌ Error leyendo Blog Archivo:', e.message);
    }
  } else {
    console.log('📚 Suficientes ideas nuevas — no se busca respaldo del blog.');
  }

  // ── PASO 3: Última nota publicada (continuidad/contraste) ────────────────
  let ultimaNota = null;
  try {
    const ultimas = await fetchAirtableTable(TABLE_SUBSTACK, {
      fields: ['Título', 'Fecha publicación', 'Fuente'],
      sort: [{ field: 'Fecha publicación', direction: 'desc' }]
    });
    ultimaNota = ultimas.find(r => r.fields && r.fields['Título']) || null;
    console.log(ultimaNota
      ? `✅ Última nota: "${ultimaNota.fields['Título']}"`
      : '— No hay notas previas publicadas todavía.');
  } catch (e) {
    console.error('❌ Error leyendo última nota de Substack:', e.message);
  }

  // Si no hay material en absoluto, avisar y salir sin romper el workflow.
  if (ideasNuevas.length === 0 && blogNuevo.length === 0) {
    console.log('⚠️ No hay ideas nuevas ni respaldo de blog disponible. Avisando a Vik y saliendo.');
    try {
      const accessToken = await getGmailAccessToken();
      await sendGmail(accessToken, `⚠️ Sin material para la nota de Substack — ${today}`,
        `<p>No encontré ideas nuevas en el Banco de ideas ni posts sin usar en el Blog Archivo.</p>
         <p>Esta semana no se generó nota. Capturá algo en la app cuando puedas.</p>`);
    } catch (e) {
      console.error('❌ Error avisando por mail:', e.message);
    }
    return;
  }

  // ── PASO 4: Detectar ancla explícita (@tema: o Tipo=ancla_semanal) ────────
  const ancla = ideasNuevas.find(r => {
    const tipo = r.fields?.['Tipo']?.name || r.fields?.['Tipo'];
    const contenido = (r.fields?.['Contenido'] || '').trim();
    return tipo === 'ancla_semanal' || /^@tema:/i.test(contenido);
  });

  // ── PASO 5: Armar contexto para el prompt ─────────────────────────────────
  const ideasTexto = ideasNuevas.length > 0
    ? ideasNuevas.map(r => {
        const f = r.fields || {};
        const tipo = f['Tipo']?.name || f['Tipo'] || 'texto';
        const contenido = f['Contenido'] || f['Descripción adjunto'] || '(sin texto)';
        return `[id: ${r.id}] (${tipo}, ${f['Fecha'] || 's/fecha'}): ${contenido}`;
      }).join('\n')
    : 'Sin ideas nuevas esta semana.';

  const blogTexto = blogNuevo.length > 0
    ? blogNuevo.map(r => {
        const f = r.fields || {};
        return `[id: ${r.id}] "${f['Título']}" — ${f['Categorías'] || ''} — temas: ${f['Temas clave'] || ''} — resumen: ${f['Resumen'] || ''}`;
      }).join('\n')
    : 'No se consultó el blog histórico (había suficiente material nuevo) o no quedan posts sin usar.';

  const anclaTexto = ancla
    ? `SÍ — Vik dejó una ancla explícita para esta semana: "${(ancla.fields['Contenido'] || '').replace(/^@tema:/i, '').trim()}" [id: ${ancla.id}]. Es PRIORITARIA: el tema de la nota tiene que ser ese, salvo que sea inviable.`
    : 'No hay ancla explícita esta semana.';

  const continuidadTexto = ultimaNota
    ? `Última nota publicada: "${ultimaNota.fields['Título']}" (fuente: ${ultimaNota.fields['Fuente']?.name || ultimaNota.fields['Fuente'] || '?'}). Decidí si conviene continuar ese hilo o contrastar con algo distinto.`
    : 'No hay notas previas — no aplica continuidad/contraste.';

  // ── PASO 6: Generar nota + posteo IG ───────────────────────────────────────
  console.log('📝 Decidiendo tema y generando nota + posteo...');

  const prompt = `${VOZ_HAPPIMESS}

Hoy es ${today} (semana ISO ${semanaActual}).

CASCADA DE DECISIÓN DEL TEMA (aplicar en este orden):
1. Ancla explícita de Vik (@tema: o tipo "ancla_semanal") → si existe, manda.
2. Si no hay ancla: volumen de entradas por tema entre las ideas nuevas — agrupá las ideas nuevas por tema implícito y elegí el tema con más entradas.
3. Si hay empate en volumen: desempatá por diversidad de materiales (preferí el tema que combina tipos distintos — texto + imagen + link — sobre el que tiene un solo tipo repetido).
4. Si seguís sin poder decidir, o si no hay material nuevo suficiente: usá el Blog Archivo como respaldo, eligiendo un post para "refrescar" en una nota nueva.
5. Por último, mirá la continuidad/contraste con la última nota publicada para afinar el ángulo (no el tema en sí).

ANCLA EXPLÍCITA:
${anclaTexto}

IDEAS NUEVAS (Banco de ideas, Estado=nuevo):
${ideasTexto}

BLOG ARCHIVO DISPONIBLE COMO RESPALDO (Estado=nuevo, no usado todavía):
${blogTexto}

CONTINUIDAD CON LA ÚLTIMA NOTA:
${continuidadTexto}

INSTRUCCIÓN — Citas web:
Usá web_search para encontrar 1 a 3 fuentes reales y verificables (estudios, libros, artículos, personas) que le den peso editorial a la nota. No inventes fuentes.

TAREA 1 — Nota de Substack (Happimess, gratuita, sin paywall):
- Desarrollá el artículo con la voz de la marca descripta arriba, sobre el tema que decidiste con la cascada
- Mínimo 2 subtítulos H2 (idealmente 3)
- Extensión 500-700 palabras
- Incluí las fuentes encontradas

TAREA 2 — Posteo de Instagram derivado de la nota:
- Hook corto (primera línea, frena el scroll)
- Caption de 3-5 líneas que resume la idea central de la nota e invita a leerla completa
- 5-8 hashtags relevantes (mezclando lifestyle/diseño/Happimess)

IMPORTANTE — formato JSON:
- Respondé SOLO con JSON válido, sin bloques markdown (sin \`\`\`).
- Dentro de CUALQUIER valor de string del JSON (especialmente "markdown", "caption", "fuentes"), NUNCA uses comillas dobles rectas (") para citar algo. Si necesitás citar texto literal, usá comillas simples ('texto') o comillas tipográficas (“texto”). Una comilla doble recta sin escapar rompe el JSON.
 
Respondé SOLO con JSON válido, sin bloques markdown:
{
  "tema_elegido": "...",
  "fuente": "ideas_nuevas | blog_refrescado | mixto",
  "razonamiento_cascada": "qué paso de la cascada se aplicó y por qué",
  "ideas_usadas_ids": ["id de Banco de ideas que se usaron, si aplica"],
  "blog_usado_ids": ["id de Blog Archivo que se usaron, si aplica"],
  "substack": {
    "titulo": "...",
    "bajada": "una o dos líneas de presentación",
    "categoria": "Activar | Crecer | Descubrir | Disfrutar | Viajar",
    "markdown": "la nota completa en formato Markdown, con ## para subtítulos H2",
    "fuentes": ["Nombre Apellido / medio, Título (año) — por qué es relevante"]
  },
  "instagram": {
    "hook": "...",
    "caption": "...",
    "hashtags": ["#...", "#..."]
  }
}`;

  let resultado = null;
  try {
    const resp = await callAnthropic(prompt, {
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
      extraBetas: ['web-search-2025-03-05']
    });
    resultado = parseJSON(extractText(resp));
    if (!resultado) throw new Error('No se pudo parsear la respuesta del modelo');
  } catch (e) {
    console.error('❌ Error generando la nota:', e.message);
    try {
      const accessToken = await getGmailAccessToken();
      await sendGmail(accessToken, `❌ Error generando la nota de Substack — ${today}`,
        `<p>El agente falló generando la nota: ${e.message}</p>`);
    } catch (_) {}
    process.exit(1);
  }

  console.log(`✅ Tema elegido: ${resultado.tema_elegido} (fuente: ${resultado.fuente})`);
  console.log(`   Cascada: ${resultado.razonamiento_cascada}`);

  // ── PASO 7: Guardar draft en Airtable (tabla Substack) ────────────────────
  console.log('💾 Guardando draft en Airtable...');
  const instagramTexto = [
    resultado.instagram?.hook || '',
    '',
    resultado.instagram?.caption || '',
    '',
    (resultado.instagram?.hashtags || []).join(' ')
  ].join('\n');

  const citasTexto = (resultado.substack?.fuentes || []).map(f => `- ${f}`).join('\n');

  try {
    await createAirtableRecord(TABLE_SUBSTACK, {
      'Título': resultado.substack?.titulo || resultado.tema_elegido,
      'Semana': semanaActual,
      'Fuente': resultado.fuente === 'blog_refrescado' ? 'blog_refrescado'
               : resultado.fuente === 'mixto' ? 'mixto' : 'ideas_nuevas',
      'Draft Substack': resultado.substack?.markdown || '',
      'Draft Instagram': instagramTexto,
      'Citas usadas': citasTexto,
      'Estado': 'borrador'
    });
    console.log('✅ Draft guardado en Airtable');
  } catch (e) {
    console.error('❌ Error guardando draft en Airtable:', e.message);
  }

  // ── PASO 8: Marcar como usado lo que se utilizó ───────────────────────────
  try {
    const idsUsados = new Set(resultado.ideas_usadas_ids || []);
    if (ancla) idsUsados.add(ancla.id); // el ancla siempre se considera usada
    if (idsUsados.size > 0) {
      await updateAirtableRecords(TABLE_IDEAS,
        [...idsUsados].map(id => ({ id, fields: { 'Estado': 'procesado' } })));
      console.log(`✅ ${idsUsados.size} idea(s) marcada(s) como procesada(s)`);
    }
  } catch (e) {
    console.error('❌ Error marcando ideas como procesadas:', e.message);
  }

  try {
    const blogIdsUsados = resultado.blog_usado_ids || [];
    if (blogIdsUsados.length > 0) {
      await updateAirtableRecords(TABLE_BLOG,
        blogIdsUsados.map(id => ({
          id,
          fields: {
            'Estado': 'usado',
            'Fecha de uso': new Date().toISOString().slice(0, 10),
            'Nota de uso': `Refrescado en: "${resultado.substack?.titulo || resultado.tema_elegido}"`
          }
        })));
      console.log(`✅ ${blogIdsUsados.length} post(s) del blog marcado(s) como usado(s)`);
    }
  } catch (e) {
    console.error('❌ Error marcando posts del blog como usados:', e.message);
  }

  // ── PASO 9: Mandar el mail del sábado con el borrador final ───────────────
  console.log('📧 Enviando Gmail...');

  const categoriaBadgeColor = {
    'Activar':    '#fef3c7;color:#92400e',
    'Crecer':     '#dcfce7;color:#166534',
    'Descubrir':  '#ede9fe;color:#5b21b6',
    'Disfrutar':  '#fce7f3;color:#9d174d',
    'Viajar':     '#dbeafe;color:#1e40af'
  }[resultado.substack?.categoria] || '#f3f4f6;color:#374151';

  const fuentesHtml = (resultado.substack?.fuentes || []).length
    ? `<div style="margin-top:20px;background:#f0f9ff;border-radius:8px;padding:14px">
         <div style="font-size:12px;color:#0369a1;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">📚 Fuentes</div>
         ${resultado.substack.fuentes.map(f => `<div style="font-size:13px;color:#0c4a6e;margin-bottom:6px">• ${f}</div>`).join('')}
       </div>`
    : '';

  const substackHtml = card(`
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
    <div style="display:inline-block;background:#f0fdf4;color:#166534;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600">SUBSTACK · HAPPIMESS</div>
    ${resultado.substack?.categoria ? `<div style="display:inline-block;background:${categoriaBadgeColor};padding:4px 10px;border-radius:20px;font-size:12px;font-weight:600">${resultado.substack.categoria}</div>` : ''}
  </div>
  <h2 style="margin:0 0 10px;color:#111827;font-size:22px;line-height:1.3">${resultado.substack?.titulo || resultado.tema_elegido}</h2>
  <p style="color:#6b7280;font-size:15px;font-style:italic;margin-bottom:16px;border-bottom:1px solid #f3f4f6;padding-bottom:16px">${resultado.substack?.bajada || ''}</p>
  ${mdToHtmlBasic(resultado.substack?.markdown)}
  ${fuentesHtml}`);

  const instagramHtml = card(`
  <div style="display:inline-block;background:#fce7f3;color:#9d174d;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;margin-bottom:14px">POSTEO INSTAGRAM</div>
  <p style="font-weight:700;color:#111827;font-size:15px;margin-bottom:8px">${resultado.instagram?.hook || ''}</p>
  <p style="color:#1f2937;font-size:14px;line-height:1.7;white-space:pre-wrap">${resultado.instagram?.caption || ''}</p>
  <p style="color:#6b7280;font-size:13px;margin-top:10px">${(resultado.instagram?.hashtags || []).join(' ')}</p>`,
  ';background:#fdf2f8');

  const cascadaHtml = card(`
  <div style="font-size:12px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:10px">Cómo se eligió el tema</div>
  <p style="font-size:14px;color:#374151;margin-bottom:6px"><b>Fuente:</b> ${resultado.fuente}</p>
  <p style="font-size:14px;color:#374151">${resultado.razonamiento_cascada || ''}</p>`,
  ';background:#f9fafb');

  const gmailBody = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:640px;margin:0 auto;padding:32px 16px">

  <div style="background:linear-gradient(135deg,#1f2937 0%,#374151 100%);border-radius:16px;padding:28px 32px;margin-bottom:24px;color:#ffffff">
    <div style="font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px">Happimess · Secretaria sabatina</div>
    <h1 style="margin:0 0 6px;font-size:26px;font-weight:700">Borrador listo para esta semana</h1>
    <p style="margin:0;color:#d1d5db;font-size:14px">${today}</p>
  </div>

  ${cascadaHtml}
  ${substackHtml}
  ${instagramHtml}

  <div style="text-align:center;padding:24px 0;color:#9ca3af;font-size:13px">
    <p style="margin:0 0 8px">Esto es un borrador — el draft completo (Markdown) también quedó guardado en Airtable, tabla Substack.</p>
    <p style="margin:0">Publicación siempre manual: revisá, editá si hace falta, y publicá vos.</p>
  </div>

</div>
</body>
</html>`;

  try {
    const accessToken = await getGmailAccessToken();
    const subject = `📰 Borrador Substack — ${resultado.substack?.titulo || resultado.tema_elegido} — ${today}`;
    const result = await sendGmail(accessToken, subject, gmailBody);
    if (result.id) {
      console.log('✅ Gmail enviado a', GMAIL_RECIPIENT, '— ID:', result.id);
    } else {
      console.error('❌ Error enviando Gmail:', JSON.stringify(result));
      process.exit(1);
    }
  } catch (e) {
    console.error('❌ Error Gmail:', e.message);
    process.exit(1);
  }

  console.log('🎉 Agente sabatino completado');
})();
