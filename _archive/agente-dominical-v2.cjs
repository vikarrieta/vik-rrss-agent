'use strict';
const https = require('https');

// ── Constantes ─────────────────────────────────────────────────────────────
const AIRTABLE_BASE   = 'appRWskRNQ1sUT4cy';
const TABLE_JOURNAL   = 'tblVOlms0rbEDBGOy';
const TABLE_CATS      = 'tbl88RWvIapiwLGBQ';
const GMAIL_RECIPIENT = 'vik@monoblock.tv';

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
- Creatividad aplicada al día a día

CATEGORÍAS SUBSTACK HAPPIMESS:
- Activar: motivación y acción concreta
- Crecer: aprendizaje, procesos, experiencias que enseñan algo
- Descubrir: cultura, libros, fenómenos, curiosidades con criterio
- Disfrutar: placer cotidiano, lo pequeño que vale la pena
- Viajar: experiencias de viaje con foco en lo que revelan

REGLAS:
- El artículo puede nacer de algo que vivió Vik (del journal), pero la voz que lo procesa es la marca, no la persona
- Incluir SIEMPRE fuentes reales: libros, estudios, personas (nombre completo, año, por qué aplica)
- Mínimo 2 subtítulos H2 para estructurar — idealmente 3
- Extensión: 500-700 palabras
- Cierre: invitación concreta, no moraleja
- NUNCA: autoayuda motivacional vacía, imperativo ("tenés que", "deberías"), tono de gurú, clichés de productividad
`;

// ── Voz @vikarrieta (para preguntas del Diario) ────────────────────────────
const VOZ_VIK_DIARIO = `
VIK ARRIETA — PREGUNTAS PARA EL DIARIO
Founder-CEO de Monoblock (estudio de diseño editorial) y creadora de Happimess. Las preguntas del diario activan la voz personal de Vik, no la de la marca.

Las preguntas tienen que:
- Ser específicas, no genéricas — apuntan a momentos concretos: decisiones, conversaciones, tensiones, descubrimientos
- Mezclar vida profesional (Monoblock/Happimess), proceso creativo y criterio personal
- Invitar a encontrar la anécdota real, no a reflexionar en abstracto
- Activar el micropatrón de Vik: la voz interna que se cuela — el detalle honesto, irónico o autocrítico
- Generar material útil para futuros artículos de Substack de Happimess
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

  // Intento 1: parse directo
  try { return JSON.parse(raw); } catch (_) {}

  // Intento 2: reparar carácter por carácter.
  // Los textos largos suelen tener saltos de línea y tabs literales
  // dentro de los strings JSON, que JSON.parse rechaza.
  try {
    let out = '';
    let inStr = false;
    let esc = false;
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (esc)          { out += c; esc = false; continue; }
      if (c === '\\' && inStr) { out += c; esc = true;  continue; }
      if (c === '"')    { inStr = !inStr; out += c; continue; }
      if (inStr) {
        if      (c === '\n') { out += '\\n'; continue; }
        else if (c === '\r') { out += '\\r'; continue; }
        else if (c === '\t') { out += '\\t'; continue; }
        // Quitar otros caracteres de control que rompen JSON
        else if (c.charCodeAt(0) < 0x20) continue;
      }
      out += c;
    }
    return JSON.parse(out);
  } catch (e) {
    console.error('parseJSON: no se pudo parsear. Snippet pos 490-520:', raw.slice(490, 520));
    console.error('parseJSON error:', e.message);
    return null;
  }
}

// ── Airtable REST directo (sin MCP) ────────────────────────────────────────
async function fetchAirtableTable(tableId) {
  const token = (process.env.AIRTABLE_TOKEN || '').trim();
  if (!token) throw new Error('AIRTABLE_TOKEN no configurado');
  console.log(`   Token: ${token.slice(0, 6)}... (${token.length} chars) — debe empezar con "pat"`);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.airtable.com',
      path: `/v0/${AIRTABLE_BASE}/${tableId}?pageSize=100`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) reject(new Error(`Airtable [${tableId}]: ${JSON.stringify(parsed.error)}`));
          else resolve(parsed.records || []);
        } catch (e) {
          reject(new Error('Parse Airtable error: ' + data.slice(0, 300)));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ── HTML helpers ────────────────────────────────────────────────────────────
function card(inner, extraStyle = '') {
  return `<div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;margin-bottom:24px${extraStyle}">${inner}</div>`;
}

function renderSubstackSecciones(secciones) {
  return (secciones || []).map(s => {
    if (s.tipo === 'h2') {
      return `<h2 style="font-size:18px;font-weight:700;color:#111827;margin:24px 0 8px;padding-top:8px;border-top:1px solid #f3f4f6">${s.texto}</h2><div style="color:#1f2937;font-size:15px;line-height:1.8">${s.contenido}</div>`;
    }
    if (s.tipo === 'h3') {
      return `<h3 style="font-size:16px;font-weight:600;color:#374151;margin:18px 0 6px">${s.texto}</h3><div style="color:#1f2937;font-size:15px;line-height:1.8">${s.contenido}</div>`;
    }
    return `<p style="color:#1f2937;font-size:15px;line-height:1.8;margin:12px 0">${s.contenido}</p>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════════════════
(async () => {
  const today = new Date().toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    timeZone: 'America/Argentina/Buenos_Aires'
  });

  // ── PASO 1: Leer Airtable Journal ─────────────────────────────────────────
  console.log('📖 Leyendo Airtable vía REST...');

  let journalRecords = [];
  let catRecords = [];

  try {
    journalRecords = await fetchAirtableTable(TABLE_JOURNAL);
    console.log(`✅ Journal: ${journalRecords.length} registros`);
    if (journalRecords.length > 0) {
      const campos = Object.keys(journalRecords[0].fields);
      console.log('   Campos:', campos.join(', '));
      console.log('   Muestra reg[0]:', JSON.stringify(journalRecords[0].fields).slice(0, 400));
    }
  } catch (e) {
    console.error('❌ Error leyendo Journal:', e.message);
  }

  try {
    catRecords = await fetchAirtableTable(TABLE_CATS);
    console.log(`✅ Categorías: ${catRecords.length} registros`);
  } catch (e) {
    console.error('❌ Error leyendo Categorías:', e.message);
  }

  // Formatear registros del Journal como texto legible para el prompt
  const journalTexto = journalRecords.length > 0
    ? journalRecords.map((r, i) => {
        const f = r.fields;
        const lineas = Object.entries(f).map(([k, v]) => {
          const val = Array.isArray(v)
            ? v.map(x => x.url || x.filename || JSON.stringify(x)).join(', ')
            : typeof v === 'object' && v !== null
            ? JSON.stringify(v)
            : String(v);
          return `  ${k}: ${val}`;
        });
        return `REGISTRO ${i + 1} [ID: ${r.id}]\n${lineas.join('\n')}`;
      }).join('\n\n---\n\n')
    : 'Sin registros en el Journal esta semana.';

  // Resumen conciso de anécdotas para el prompt de generación
  const anecdotasResumen = journalRecords.length > 0
    ? journalRecords.slice(0, 8).map(r => {
        const f = r.fields;
        const titulo = f['Name'] || f['Nombre'] || f['Título'] || f['Titulo']
          || Object.values(f).find(v => typeof v === 'string' && v.length > 3)
          || r.id;
        const texto = f['Anécdota'] || f['Anecdota'] || f['Texto'] || f['Contenido'] || f['Notes'] || f['Nota'] || '';
        return `- "${titulo}"${texto ? ': ' + String(texto).slice(0, 250) : ''}`;
      }).join('\n')
    : 'Sin anécdotas en el journal esta semana.';

  // ── PASO 2: Generar artículo Substack + Preguntas ─────────────────────────
  console.log('📝 Generando artículo Substack + preguntas del Diario...');

  const substackPrompt = `${VOZ_HAPPIMESS}

${VOZ_VIK_DIARIO}

Hoy es ${today}.

MATERIAL DEL DIARIO DE VIK (anécdotas recientes en Airtable):
${anecdotasResumen}

INSTRUCCIÓN PRIORITARIA — BLOG HISTÓRICO:
Antes de escribir el artículo, usá web_search para buscar artículos publicados en el blog o Substack de Happimess (probá "happimess substack", "happimess.com blog", "site:happimess.com"). Necesitás:
1. Identificar 3-5 artículos recientes — sus temas, categorías y enfoque
2. Asegurarte de que el artículo nuevo NO repite un tema ya desarrollado
3. Usar el estilo y tono encontrado como referencia de coherencia editorial

TAREA 1 — Artículo Substack de Happimess:
- Tomá como DISPARADOR una de las anécdotas del diario (si hay material útil) o un tema del universo Happimess (si el journal está vacío)
- Desarrollá el artículo con la voz de la marca descripta arriba
- Indicá qué artículos del blog histórico encontraste y por qué el tema elegido los complementa
- Incluí fuentes reales: libros, estudios, personas relevantes (nombre completo, año, por qué aplica)
- Mínimo 3 subtítulos H2
- Extensión: 500-700 palabras

TAREA 2 — 3 preguntas disparadoras para el Diario de Vik:
- Específicas y concretas — activan una anécdota real, no una reflexión abstracta
- Apuntan a momentos: una decisión difícil, una conversación que cambió algo, un objeto o hábito con historia
- Mezclan vida profesional (Monoblock/Happimess), proceso creativo y criterio personal
- Cada una tiene potencial de convertirse en material para un futuro artículo de Substack
- Indicar qué categoría Substack alimentaría cada pregunta

Respondé SOLO con JSON válido, sin bloques markdown:
{
  "blog_historico": [
    "Título artículo encontrado — tema — categoría"
  ],
  "substack": {
    "titulo": "...",
    "bajada": "dos o tres líneas de presentación (gancho para abrir el mail)",
    "categoria": "Activar | Crecer | Descubrir | Disfrutar | Viajar",
    "anecdota_disparadora": "título de la anécdota usada del journal, o vacío si no aplicó",
    "secciones": [
      { "tipo": "p", "contenido": "párrafo introductorio" },
      { "tipo": "h2", "texto": "Primer subtítulo", "contenido": "desarrollo" },
      { "tipo": "h2", "texto": "Segundo subtítulo", "contenido": "desarrollo" },
      { "tipo": "h2", "texto": "Tercer subtítulo", "contenido": "desarrollo" }
    ],
    "cierre": "párrafo de cierre de la marca — invitación concreta, no moraleja",
    "fuentes": [
      "Nombre Apellido, Título del libro o estudio (año) — por qué es relevante para este artículo"
    ],
    "sugerencia_imagen_portada": "descripción visual concreta de la imagen ideal para portada"
  },
  "preguntas": [
    {
      "pregunta": "¿...?",
      "contexto": "qué tipo de anécdota puede activar — qué contenido Substack puede generar",
      "categoria_substack": "Activar | Crecer | Descubrir | Disfrutar | Viajar"
    }
  ]
}`;

  let substackHtml = '';
  let blogHistoricoHtml = '';
  let preguntasHtml = '';

  try {
    const substackResp = await callAnthropic(substackPrompt, {
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
      extraBetas: ['web-search-2025-03-05']
    });
    const substackData = parseJSON(extractText(substackResp));

    // — Blog histórico encontrado —
    const blogArticulos = substackData?.blog_historico || [];
    if (blogArticulos.length > 0) {
      blogHistoricoHtml = card(`
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
    <span style="font-size:20px">📚</span>
    <div style="font-weight:700;color:#111827;font-size:14px">Artículos existentes del blog (para no repetir)</div>
  </div>
  ${blogArticulos.map(a => `<div style="font-size:13px;color:#6b7280;margin-bottom:6px;padding-left:12px;border-left:2px solid #e5e7eb">• ${a}</div>`).join('')}`,
      ';background:#f9fafb;border-color:#e5e7eb');
    }

    // — Artículo Substack —
    const substack = substackData?.substack;
    if (substack) {
      const categoriaBadgeColor = {
        'Activar':    '#fef3c7;color:#92400e',
        'Crecer':     '#dcfce7;color:#166534',
        'Descubrir':  '#ede9fe;color:#5b21b6',
        'Disfrutar':  '#fce7f3;color:#9d174d',
        'Viajar':     '#dbeafe;color:#1e40af'
      }[substack.categoria] || '#f3f4f6;color:#374151';

      const fuentesHtml = substack.fuentes?.length
        ? `<div style="margin-top:20px;background:#f0f9ff;border-radius:8px;padding:14px">
             <div style="font-size:12px;color:#0369a1;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">📚 Fuentes</div>
             ${substack.fuentes.map(f => `<div style="font-size:13px;color:#0c4a6e;margin-bottom:6px">• ${f}</div>`).join('')}
           </div>`
        : '';

      substackHtml = card(`
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
    <div style="display:inline-block;background:#f0fdf4;color:#166534;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600">SUBSTACK · HAPPIMESS</div>
    ${substack.categoria ? `<div style="display:inline-block;background:${categoriaBadgeColor};padding:4px 10px;border-radius:20px;font-size:12px;font-weight:600">${substack.categoria}</div>` : ''}
  </div>
  <h2 style="margin:0 0 10px;color:#111827;font-size:22px;line-height:1.3">${substack.titulo}</h2>
  <p style="color:#6b7280;font-size:15px;font-style:italic;margin-bottom:16px;border-bottom:1px solid #f3f4f6;padding-bottom:16px">${substack.bajada}</p>
  ${substack.anecdota_disparadora ? `<div style="background:#fef3c7;border-radius:6px;padding:8px 12px;font-size:13px;color:#78350f;margin-bottom:16px">💡 Disparador del journal: "${substack.anecdota_disparadora}"</div>` : ''}
  ${renderSubstackSecciones(substack.secciones)}
  <div style="color:#374151;font-size:15px;line-height:1.8;margin-top:20px;padding-top:16px;border-top:1px solid #f3f4f6">${substack.cierre}</div>
  ${fuentesHtml}
  <div style="margin-top:16px;background:#f9fafb;border-radius:8px;padding:12px">
    <div style="font-size:12px;color:#9ca3af;font-weight:600;text-transform:uppercase">Imagen de portada sugerida</div>
    <div style="font-size:13px;color:#374151;margin-top:4px">🖼️ ${substack.sugerencia_imagen_portada || '—'}</div>
  </div>`);
    } else {
      substackHtml = `<p style="color:orange">⚠️ Substack generado pero JSON no parseable.</p>`;
    }

    // — Preguntas para el Diario —
    const preguntas = substackData?.preguntas || [];
    if (preguntas.length > 0) {
      const categoriaBadge = {
        'Activar':    '#fef3c7;color:#92400e',
        'Crecer':     '#dcfce7;color:#166534',
        'Descubrir':  '#ede9fe;color:#5b21b6',
        'Disfrutar':  '#fce7f3;color:#9d174d',
        'Viajar':     '#dbeafe;color:#1e40af'
      };
      preguntasHtml = card(`
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
    <span style="font-size:22px">✍️</span>
    <div>
      <div style="font-weight:700;color:#111827;font-size:16px">Preguntas para el Diario esta semana</div>
      <div style="color:#6b7280;font-size:13px">Las respuestas se guardan en Airtable y alimentan el próximo artículo</div>
    </div>
  </div>
  ${preguntas.map((p, i) => `
  <div style="background:#f8fafc;border-left:3px solid #6366f1;border-radius:0 8px 8px 0;padding:14px 16px;margin-bottom:12px">
    <div style="font-weight:700;color:#1f2937;font-size:15px;margin-bottom:6px">${i + 1}. ${p.pregunta}</div>
    <div style="color:#6b7280;font-size:13px;margin-bottom:6px">${p.contexto}</div>
    ${p.categoria_substack ? `<div style="display:inline-block;background:${categoriaBadge[p.categoria_substack] || '#f3f4f6;color:#374151'};padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600">Substack: ${p.categoria_substack}</div>` : ''}
  </div>`).join('')}`, ';background:#fafafa');
    }

  } catch (e) {
    console.error('❌ Error generando Substack/preguntas:', e.message);
    substackHtml = `<p style="color:red">Error al generar el artículo: ${e.message}</p>`;
  }

  // ── PASO 3: Armar y enviar el Gmail ──────────────────────────────────────
  console.log('📧 Enviando Gmail...');

  const gmailBody = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:640px;margin:0 auto;padding:32px 16px">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#1f2937 0%,#374151 100%);border-radius:16px;padding:28px 32px;margin-bottom:24px;color:#ffffff">
    <div style="font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px">Happimess · Substack semanal</div>
    <h1 style="margin:0 0 6px;font-size:26px;font-weight:700">Artículo listo para esta semana</h1>
    <p style="margin:0;color:#d1d5db;font-size:14px">${today}</p>
  </div>

  <!-- Índice -->
  ${card(`
  <div style="font-size:12px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:12px">Este mail tiene</div>
  <div style="display:flex;flex-direction:column;gap:8px">
    <div style="font-size:14px;color:#374151">📰 Artículo Substack listo — con fuentes y subtítulos</div>
    <div style="font-size:14px;color:#374151">📚 Contexto del blog histórico consultado</div>
    <div style="font-size:14px;color:#374151">✍️ 3 preguntas para el Diario de esta semana</div>
  </div>`)}

  <!-- Blog histórico -->
  ${blogHistoricoHtml}

  <!-- Substack -->
  <div style="border-top:2px solid #e5e7eb;margin:32px 0 24px;padding-top:8px">
    <div style="font-size:11px;color:#d1d5db;text-align:center;text-transform:uppercase;letter-spacing:0.1em">Happimess · Substack</div>
  </div>
  ${substackHtml}

  <!-- Preguntas -->
  <div style="border-top:2px solid #e5e7eb;margin:32px 0 24px;padding-top:8px">
    <div style="font-size:11px;color:#d1d5db;text-align:center;text-transform:uppercase;letter-spacing:0.1em">Diario · semana que viene</div>
  </div>
  ${preguntasHtml}

  <!-- Footer -->
  <div style="text-align:center;padding:24px 0;color:#9ca3af;font-size:13px">
    <p style="margin:0 0 8px">Este mail lo generó el agente de contenido de Happimess.</p>
    <p style="margin:0">Cada respuesta que escribas en el Diario alimenta el artículo de la semana siguiente.</p>
  </div>

</div>
</body>
</html>`;

  try {
    const accessToken = await getGmailAccessToken();
    const subject = `📰 Substack Happimess — ${today}`;
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

  console.log('🎉 Agente Substack Happimess completado');
})();
