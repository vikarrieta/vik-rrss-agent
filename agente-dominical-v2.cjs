'use strict';
const https = require('https');

// ── Constantes ─────────────────────────────────────────────────────────────
const AIRTABLE_BASE   = 'appRWskRNQ1sUT4cy';
const TABLE_JOURNAL   = 'tblVOlms0rbEDBGOy';
const TABLE_CATS      = 'tbl88RWvIapiwLGBQ';
const GMAIL_RECIPIENT = 'vik@monoblock.tv';

const DRIVE_FOLDERS = {
  'Criterio Propio':      'https://drive.google.com/drive/folders/1sR0Kct_Is7u-y9ljCPq7uhJjDOrgX6KB',
  'Detrás de Escena':     'https://drive.google.com/drive/folders/1xmi-Slocjpb4K9e8F08FTD0lWOKnbyGy',
  'Lifestyle Creativo':   'https://drive.google.com/drive/folders/1brONZaRmTfEqrcgtEBY0i7snKxNUFT2-',
  'Fan de lo que hacemos':'https://drive.google.com/drive/folders/1L_IeqeyOmNnAMhxKtQQ9hvtEg-SoskPF',
  'Sin Contexto':         'https://drive.google.com/drive/folders/19G4B8C2urkrgsJ722iIWCoPpGA8l77xO'
};

const VOZ = `
VOZ DE VIK — REGLAS ABSOLUTAS:
- Español rioplatense, voseo siempre
- Tono: poético pero asertivo — metáforas concretas, no poesía vaga
- Estructura: anécdota real → insight → pregunta genuina (referente: Leticia Fenoglio, CEO Franuí)
- NUNCA inventar detalles que no estén en la anécdota — si falta algo, notarlo
- NUNCA autoayuda genérica, anglicismos, ni hashtags dentro del copy
- Emojis: máx 2-3, solo si agregan tono
- Cierre: pregunta que nace del posteo, no un "¿qué te parece?" genérico

CATEGORÍAS:
- Criterio Propio 🔴: historia personal → insight → cierre empático. Formato B (150-300 palabras). 1/semana.
- Detrás de Escena 🟡: cocina real de Monoblock/Happimess con humor cómplice. Foto real + caption jugoso. 1/semana.
- Lifestyle Creativo 🟢: lo que lee, ve, obsesiona Vik. Siempre hay criterio. Carrusel o quote. 1 cada 2 semanas.
- Fan de lo que hacemos 🔵: Vik como primera fan de sus productos. Sin tono comercial. Máx 1 cada 2 semanas.

FORMATOS:
- A — Quote: una frase. Poética, asertiva, con ritmo.
- B — Reflexión con anécdota: escena concreta → reflexión → cierre que conecta. 150-300 palabras.
- C — Carrusel: 5-8 slides. Cover que engancha sin clickbait. Una idea por slide.
- D — Historia con punto: minirelato 2-3 párrafos. Observación final, no moraleja.`;

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
  return m ? JSON.parse(m[0]) : null;
}

// ── Airtable REST directo (sin MCP) ────────────────────────────────────────
async function fetchAirtableTable(tableId) {
  const token = (process.env.AIRTABLE_TOKEN || '').trim();
  if (!token) throw new Error('AIRTABLE_TOKEN no configurado');
  // Loggea primeros 6 chars para diagnosticar formato sin exponer el token completo
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

async function updateAirtableRecord(tableId, recordId, fields) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ fields });
    const req = https.request({
      hostname: 'api.airtable.com',
      path: `/v0/${AIRTABLE_BASE}/${tableId}/${recordId}`,
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${process.env.AIRTABLE_TOKEN}`,
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

  // ── PASO 1: Leer Airtable vía REST directo ────────────────────────────────
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
    if (catRecords.length > 0) {
      console.log('   Campos:', Object.keys(catRecords[0].fields).join(', '));
    }
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

  const categoriasTexto = catRecords.length > 0
    ? catRecords.map(r => {
        const f = r.fields;
        return Object.entries(f).map(([k, v]) => `${k}: ${v}`).join(' | ');
      }).join('\n')
    : 'Sin datos de categorías.';

  const hayMaterial = journalRecords.length >= 3;

  // Detectar nombre del campo Estado para actualizaciones posteriores
  const estadoFieldName = journalRecords.length > 0
    ? (Object.keys(journalRecords[0].fields).find(k => /^estado$/i.test(k)) || 'Estado')
    : 'Estado';

  // ── PASO 2: Generar copys o pitches ──────────────────────────────────────
  console.log(hayMaterial
    ? `✍️ ${journalRecords.length} registros — generando 3 copys...`
    : `💡 Solo ${journalRecords.length} registros — generando pitches...`
  );

  let seccionContenido = '';
  let registrosUsados = [];

  if (hayMaterial) {
    const generacionPrompt = `${VOZ}

Hoy es ${today}. Estos son los registros del Journal de @vikarrieta en Airtable:

${journalTexto}

Estado actual de categorías (para balancear el mix):
${categoriasTexto}

TAREA: Elegí las 3 anécdotas más fuertes (priorizando categorías con más "hambre" o sin posteos recientes).
Para cada una, generá el copy completo listo para publicar.

Respondé SOLO con JSON válido, sin markdown:
{
  "posteos": [
    {
      "id_registro": "recXXX",
      "titulo_anecdota": "...",
      "categoria": "Criterio Propio | Detrás de Escena | Lifestyle Creativo | Fan de lo que hacemos",
      "emoji_categoria": "🔴 | 🟡 | 🟢 | 🔵",
      "formato": "A | B | C | D",
      "dia_sugerido": "lunes | martes | miércoles | jueves | viernes",
      "hora_sugerida": "HH:MM",
      "copy": "texto completo del posteo",
      "slides": ["slide 1", "slide 2"],
      "pregunta_cierre": "...",
      "carpeta_drive": "Criterio Propio | Detrás de Escena | Lifestyle Creativo | Fan de lo que hacemos",
      "nota_imagen": "qué foto buscar o nombre de archivo"
    }
  ]
}

Nota: "slides" solo para Formato C. Para otros formatos dejar como [].`;

    try {
      const genResp = await callAnthropic(generacionPrompt);
      const genData = parseJSON(extractText(genResp));
      const posteos = genData?.posteos || [];
      registrosUsados = posteos.map(p => p.id_registro).filter(Boolean);

      seccionContenido = posteos.map((p, i) => {
        const driveLink = DRIVE_FOLDERS[p.carpeta_drive] || DRIVE_FOLDERS['Sin Contexto'];
        const slidesHtml = p.formato === 'C' && p.slides?.length
          ? `<div style="background:#fffbeb;border-left:3px solid #f59e0b;padding:12px 16px;margin:12px 0;border-radius:0 6px 6px 0">
               <strong>Slides del carrusel:</strong><br>
               ${p.slides.map((s, idx) => `<span style="color:#92400e">Slide ${idx+1}:</span> ${s}`).join('<br>')}
             </div>`
          : '';

        return card(`
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;border-bottom:1px solid #f3f4f6;padding-bottom:12px">
    <span style="font-size:24px">${p.emoji_categoria}</span>
    <div>
      <div style="font-weight:700;color:#111827;font-size:15px">${p.categoria}</div>
      <div style="color:#6b7280;font-size:13px">Formato ${p.formato} · ${p.dia_sugerido} ${p.hora_sugerida}</div>
    </div>
    <div style="margin-left:auto;background:#f3f4f6;padding:4px 10px;border-radius:20px;font-size:12px;color:#374151">Posteo ${i+1}/3</div>
  </div>
  <div style="font-size:13px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">Copy</div>
  <div style="background:#f9fafb;border-radius:8px;padding:16px;font-size:15px;line-height:1.7;color:#1f2937;white-space:pre-wrap">${p.copy}</div>
  ${slidesHtml}
  ${p.pregunta_cierre ? `<div style="background:#fef3c7;border-radius:8px;padding:12px 16px;margin-top:12px;font-size:14px;color:#78350f"><strong>💬 Pregunta de cierre:</strong> ${p.pregunta_cierre}</div>` : ''}
  <div style="margin-top:16px">
    <a href="${driveLink}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600">🖼️ Ver fotos en Drive</a>
  </div>
  ${p.nota_imagen ? `<div style="margin-top:8px;font-size:13px;color:#6b7280">📎 ${p.nota_imagen}</div>` : ''}`);
      }).join('');

    } catch (e) {
      console.error('❌ Error generando copys:', e.message);
      seccionContenido = `<p style="color:red">Error al generar copys: ${e.message}</p>`;
    }

  } else {
    // Pitches para categorías faltantes
    const categoriasConMaterial = [...new Set(journalRecords.map(r => {
      const f = r.fields;
      return f['Categoría sugerida'] || f['Categoria sugerida'] || f['Categoría'] || f['Categoria'] || '';
    }).filter(Boolean))];

    const todasCats = ['Criterio Propio', 'Detrás de Escena', 'Lifestyle Creativo', 'Fan de lo que hacemos'];
    const categoriasFaltantes = todasCats.filter(c => !categoriasConMaterial.includes(c));

    const pitchPrompt = `${VOZ}

Hoy es ${today}. El journal de @vikarrieta tiene poco material (${journalRecords.length} anécdota${journalRecords.length !== 1 ? 's' : ''}).

Material disponible:
${journalTexto}

Categorías SIN material esta semana: ${categoriasFaltantes.join(', ') || 'ninguna — usá las existentes'}
Categorías con algo: ${categoriasConMaterial.join(', ') || 'ninguna'}

CONTEXTO DE VIK: Founder-CEO de Monoblock (estudio de diseño editorial) y creadora de Happimess (calendarios y agendas). Trabaja desde Buenos Aires.

TAREA: Generá 2 pitches de ideas para CADA categoría faltante. Los pitches son disparadores para que Vik recuerde algo concreto.

Respondé SOLO con JSON válido:
{
  "pitches": [
    {
      "categoria": "...",
      "emoji": "...",
      "titulo": "título breve",
      "disparador": "pregunta o situación concreta",
      "angulo": "qué haría valioso este contenido",
      "formato_sugerido": "A | B | C | D"
    }
  ]
}`;

    try {
      const pitchResp = await callAnthropic(pitchPrompt);
      const pitchData = parseJSON(extractText(pitchResp));
      const pitches = pitchData?.pitches || [];

      const porCategoria = {};
      pitches.forEach(p => {
        if (!porCategoria[p.categoria]) porCategoria[p.categoria] = [];
        porCategoria[p.categoria].push(p);
      });

      seccionContenido = `
${card(`<h3 style="margin:0 0 8px;color:#991b1b">⚠️ Poco material esta semana</h3>
<p style="margin:0;color:#7f1d1d;font-size:14px">${journalRecords.length} anécdota${journalRecords.length !== 1 ? 's' : ''} en el journal. Acá van ideas para completar la semana:</p>`, ';background:#fef2f2;border-color:#fecaca')}
${Object.entries(porCategoria).map(([cat, items]) => card(`
  <h3 style="margin:0 0 16px;color:#111827">${items[0]?.emoji || ''} ${cat}</h3>
  ${items.map((p, i) => `
  <div style="background:#f9fafb;border-radius:8px;padding:16px;margin-bottom:12px">
    <div style="font-weight:700;color:#1f2937;margin-bottom:6px">Idea ${i+1}: ${p.titulo}</div>
    <div style="color:#374151;margin-bottom:8px;font-size:14px">💭 <em>${p.disparador}</em></div>
    <div style="color:#6b7280;font-size:13px">📐 ${p.angulo}</div>
    <div style="color:#9ca3af;font-size:12px;margin-top:4px">Formato sugerido: ${p.formato_sugerido}</div>
  </div>`).join('')}`)).join('')}`;

    } catch (e) {
      console.error('❌ Error generando pitches:', e.message);
      seccionContenido = `<p style="color:red">Error al generar pitches: ${e.message}</p>`;
    }
  }

  // ── PASO 3: Substack + Preguntas disparadoras (llamada única) ────────────
  // Combinadas para no superar el rate limit de 10k tokens/min
  console.log('📝 Generando Substack + preguntas (llamada combinada)...');

  // Pausa de 10s después del paso anterior para resetear la ventana de rate limit
  await new Promise(r => setTimeout(r, 10000));

  const anecdotasResumen = journalRecords.length > 0
    ? journalRecords.slice(0, 5).map(r => {
        const f = r.fields;
        const titulo = f['Name'] || f['Nombre'] || f['Título'] || f['Titulo']
          || Object.values(f).find(v => typeof v === 'string' && v.length > 3)
          || r.id;
        const texto = f['Anécdota'] || f['Anecdota'] || f['Texto'] || f['Contenido'] || f['Notes'] || f['Nota'] || '';
        return `- "${titulo}"${texto ? ': ' + String(texto).slice(0, 200) : ''}`;
      }).join('\n')
    : 'Sin anécdotas en el journal esta semana.';

  const combinadoPrompt = `Sos redactora editorial de Happimess y agente de contenido de @vikarrieta. Hoy es ${today}.

CONTEXTO:
- HAPPIMESS: marca de lifestyle de Vik Arrieta (Buenos Aires). Vende calendarios y agendas con diseño. Voz editorial, cálida, con criterio. NO es la voz personal de Vik.
- VIK: Founder-CEO de Monoblock (diseño editorial) y creadora de Happimess. Su Instagram documenta su vida creativa con criterio y sin filtro.

ANÉCDOTAS DE LA SEMANA EN EL JOURNAL:
${anecdotasResumen}

TAREA 1 — Artículo Substack de Happimess:
- Tomá como DISPARADOR una de las anécdotas del journal (indicá cuál)
- Desarrollá un tema del universo Happimess (diseño, creatividad, tiempo, organización con propósito)
- Incluí FUENTES REALES con nombre, autor y contexto
- Usá subtítulos H2 (mínimo 2 secciones)
- Extensión: 500-700 palabras

TAREA 2 — 3 preguntas disparadoras para el Diario de Vik:
- Específicas, no genéricas — apuntan a momentos concretos
- Mezclan vida profesional, proceso creativo y criterio personal
- Invitan a encontrar la anécdota, no a reflexionar en abstracto

Respondé SOLO con JSON válido, sin markdown:
{
  "substack": {
    "titulo": "...",
    "bajada": "dos o tres líneas de presentación",
    "anecdota_disparadora": "título de la anécdota usada",
    "secciones": [
      { "tipo": "p", "contenido": "párrafo introductorio" },
      { "tipo": "h2", "texto": "Primer subtítulo", "contenido": "desarrollo" },
      { "tipo": "h2", "texto": "Segundo subtítulo", "contenido": "desarrollo" },
      { "tipo": "h2", "texto": "Tercer subtítulo", "contenido": "desarrollo" }
    ],
    "cierre": "párrafo de cierre de la marca",
    "fuentes": [
      "Nombre Apellido, Título (año) — por qué es relevante"
    ],
    "sugerencia_imagen_portada": "descripción de imagen ideal",
    "tendencia_usada": "tendencia o fenómeno usado como gancho"
  },
  "preguntas": [
    {
      "pregunta": "¿...?",
      "contexto": "para qué sirve — qué contenido puede generar",
      "categoria_potencial": "Criterio Propio | Detrás de Escena | Lifestyle Creativo | Fan de lo que hacemos"
    }
  ]
}`;

  let substackHtml = '';
  let preguntasHtml = '';
  try {
    const combinadoResp = await callAnthropic(combinadoPrompt, {
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
      extraBetas: ['web-search-2025-03-05']
    });
    const combinadoData = parseJSON(extractText(combinadoResp));

    // — Substack —
    const substackData = combinadoData?.substack;
    if (substackData) {
      const fuentesHtml = substackData.fuentes?.length
        ? `<div style="margin-top:20px;background:#f0f9ff;border-radius:8px;padding:14px">
             <div style="font-size:12px;color:#0369a1;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">📚 Fuentes</div>
             ${substackData.fuentes.map(f => `<div style="font-size:13px;color:#0c4a6e;margin-bottom:6px">• ${f}</div>`).join('')}
           </div>`
        : '';

      substackHtml = card(`
  <div style="display:inline-block;background:#f0fdf4;color:#166534;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;margin-bottom:16px">SUBSTACK · HAPPIMESS</div>
  <h2 style="margin:0 0 10px;color:#111827;font-size:22px;line-height:1.3">${substackData.titulo}</h2>
  <p style="color:#6b7280;font-size:15px;font-style:italic;margin-bottom:16px;border-bottom:1px solid #f3f4f6;padding-bottom:16px">${substackData.bajada}</p>
  ${substackData.anecdota_disparadora ? `<div style="background:#fef3c7;border-radius:6px;padding:8px 12px;font-size:13px;color:#78350f;margin-bottom:16px">💡 Disparador: "${substackData.anecdota_disparadora}"</div>` : ''}
  ${renderSubstackSecciones(substackData.secciones)}
  <div style="color:#374151;font-size:15px;line-height:1.8;margin-top:20px;padding-top:16px;border-top:1px solid #f3f4f6">${substackData.cierre}</div>
  ${fuentesHtml}
  <div style="margin-top:16px;background:#f9fafb;border-radius:8px;padding:12px">
    <div style="font-size:12px;color:#9ca3af;font-weight:600;text-transform:uppercase">Imagen de portada sugerida</div>
    <div style="font-size:13px;color:#374151;margin-top:4px">🖼️ ${substackData.sugerencia_imagen_portada || '—'}</div>
    <div style="font-size:12px;color:#9ca3af;margin-top:6px">Tendencia: ${substackData.tendencia_usada || '—'}</div>
  </div>`);
    } else {
      substackHtml = `<p style="color:orange">⚠️ Substack generado pero JSON no parseable.</p>`;
    }

    // — Preguntas —
    const preguntas = combinadoData?.preguntas || [];
    if (preguntas.length > 0) {
      const emojiCat = {
        'Criterio Propio':       '🔴',
        'Detrás de Escena':      '🟡',
        'Lifestyle Creativo':    '🟢',
        'Fan de lo que hacemos': '🔵'
      };
      preguntasHtml = card(`
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
    <span style="font-size:22px">✍️</span>
    <div>
      <div style="font-weight:700;color:#111827;font-size:16px">Preguntas para tu Diario esta semana</div>
      <div style="color:#6b7280;font-size:13px">Las respuestas se guardan en Airtable y alimentan el próximo ciclo</div>
    </div>
  </div>
  ${preguntas.map((p, i) => `
  <div style="background:#f8fafc;border-left:3px solid #6366f1;border-radius:0 8px 8px 0;padding:14px 16px;margin-bottom:12px">
    <div style="font-weight:700;color:#1f2937;font-size:15px;margin-bottom:6px">${i+1}. ${p.pregunta}</div>
    <div style="color:#6b7280;font-size:13px;margin-bottom:4px">${p.contexto}</div>
    ${p.categoria_potencial ? `<div style="font-size:12px;color:#818cf8">${emojiCat[p.categoria_potencial] || ''} ${p.categoria_potencial}</div>` : ''}
  </div>`).join('')}`, ';background:#fafafa');
    }
  } catch (e) {
    console.error('❌ Error Substack/preguntas:', e.message);
    substackHtml = `<p style="color:red">Error al generar Substack/preguntas: ${e.message}</p>`;
  }

  // ── PASO 5: Actualizar estados en Airtable ────────────────────────────────
  if (hayMaterial && registrosUsados.length > 0) {
    console.log(`🔄 Actualizando ${registrosUsados.length} registros → listo_para_postear...`);
    for (const recId of registrosUsados) {
      try {
        await updateAirtableRecord(TABLE_JOURNAL, recId, { [estadoFieldName]: 'listo_para_postear' });
        console.log(`  ✅ ${recId}`);
      } catch (e) {
        console.error(`  ❌ ${recId}:`, e.message);
      }
    }
  }

  // ── PASO 6: Armar y enviar el Gmail ──────────────────────────────────────
  console.log('📧 Enviando Gmail...');

  const seccionTitulo = hayMaterial
    ? `<h2 style="color:#111827;font-size:20px;margin:0 0 8px">📅 Posteos de la semana</h2>
       <p style="color:#6b7280;margin:0 0 24px;font-size:14px">3 posteos listos. Revisá los copys, abrí Drive para las fotos, pedile a Cowork el diseño en Canva.</p>`
    : `<h2 style="color:#991b1b;font-size:20px;margin:0 0 8px">💡 Ideas para la semana</h2>
       <p style="color:#6b7280;margin:0 0 24px;font-size:14px">Poco material. Acá van disparadores para generar contenido fresco.</p>`;

  const gmailBody = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:640px;margin:0 auto;padding:32px 16px">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#1f2937 0%,#374151 100%);border-radius:16px;padding:28px 32px;margin-bottom:24px;color:#ffffff">
    <div style="font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px">@vikarrieta · resumen dominical</div>
    <h1 style="margin:0 0 6px;font-size:26px;font-weight:700">Semana nueva, contenido listo</h1>
    <p style="margin:0;color:#d1d5db;font-size:14px">${today}</p>
  </div>

  <!-- Índice -->
  ${card(`
  <div style="font-size:12px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:12px">Este mail tiene</div>
  <div style="display:flex;flex-direction:column;gap:8px">
    <div style="font-size:14px;color:#374151">${hayMaterial ? '✅ 3 posteos con copy completo' : '💡 Pitches de ideas por categoría'}</div>
    <div style="font-size:14px;color:#374151">🖼️ Links a carpetas de Drive por categoría</div>
    <div style="font-size:14px;color:#374151">📰 Artículo Substack con fuentes y subtítulos</div>
    <div style="font-size:14px;color:#374151">✍️ 3 preguntas para el Diario de esta semana</div>
  </div>`)}

  <!-- Copys o pitches -->
  <div style="margin-bottom:8px">${seccionTitulo}</div>
  ${seccionContenido}

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
    <p style="margin:0 0 8px">Este mail lo generó el agente de contenido @vikarrieta.</p>
    <p style="margin:0">Para diseños en Canva → abrí Cowork y pedí "armá el diseño del posteo de hoy"</p>
  </div>

</div>
</body>
</html>`;

  try {
    const accessToken = await getGmailAccessToken();
    const subject = hayMaterial
      ? `📅 Semana ${today} — 3 posteos + Substack + preguntas`
      : `💡 Semana ${today} — Ideas + Substack + preguntas`;
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

  console.log('🎉 Agente dominical v2 completado');
})();
