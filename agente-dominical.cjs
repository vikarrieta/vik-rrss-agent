const https = require('https');

const AIRTABLE_BASE = 'appRWskRNQ1sUT4cy';
const TABLE_JOURNAL = 'tblVOlms0rbEDBGOy';
const TABLE_CATS = 'tbl88RWvIapiwLGBQ';
const GMAIL_RECIPIENT = 'vik@monoblock.tv';

const today = new Date().toLocaleDateString('es-AR', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  timeZone: 'America/Argentina/Buenos_Aires'
});

// ── Obtener access_token de Gmail via OAuth2 refresh ─────────────────
async function getGmailAccessToken() {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token'
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
        else reject(new Error('No se pudo obtener access_token: ' + JSON.stringify(parsed)));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Enviar Gmail ──────────────────────────────────────────────────────
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
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

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

// ── Llamar a la API de Anthropic ──────────────────────────────────────
async function callAnthropic(prompt, mcpServers = []) {
  return new Promise((resolve, reject) => {
    const bodyObj = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }]
    };
    if (mcpServers.length > 0) bodyObj.mcp_servers = mcpServers;

    const body = JSON.stringify(bodyObj);
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'mcp-client-2025-04-04'
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

// ── Links a carpetas de Drive por categoría ───────────────────────────
// Reemplazar con los IDs reales de las carpetas en Google Drive de Vik
const DRIVE_FOLDERS = {
  'Criterio Propio': 'https://drive.google.com/drive/folders/1sR0Kct_Is7u-y9ljCPq7uhJjDOrgX6KB',
  'Detrás de Escena': 'https://drive.google.com/drive/folders/1xmi-Slocjpb4K9e8F08FTD0lWOKnbyGy',
  'Lifestyle Creativo': 'https://drive.google.com/drive/folders/1brONZaRmTfEqrcgtEBY0i7snKxNUFT2-',
  'Fan de lo que hacemos': 'https://drive.google.com/drive/folders/1L_IeqeyOmNnAMhxKtQQ9hvtEg-SoskPF',
  'Sin Contexto': 'https://drive.google.com/drive/folders/19G4B8C2urkrgsJ722iIWCoPpGA8l77xO'
};

// ── PASO 1: Leer Airtable ─────────────────────────────────────────────
const airtableMCP = [{
  type: 'url',
  url: 'https://mcp.airtable.com/mcp',
  name: 'airtable',
  authorization_token: process.env.AIRTABLE_TOKEN
}];

console.log('📖 Leyendo Airtable...');

const lecturaPrompt = `Usá el Airtable MCP para leer los datos necesarios. Base: ${AIRTABLE_BASE}.

TAREA 1: Leé TODOS los registros de la tabla Journal (${TABLE_JOURNAL}).
Devolveme una lista de los registros con estado "ideas_crudas" o "en_desarrollo", incluyendo:
- ID del registro
- Título / nombre de la anécdota
- Estado
- Categoría sugerida
- Anécdota (texto completo)
- Fotos asociadas

TAREA 2: Leé los registros de la tabla Categorías (${TABLE_CATS}).
Devolveme el estado de cada categoría (cuánto tiempo sin postear, si tiene hambre o está al día).

Respondé SOLO con un JSON válido, sin markdown, con esta estructura exacta:
{
  "anecdotas": [
    {
      "id": "recXXX",
      "titulo": "...",
      "estado": "ideas_crudas",
      "categoria": "...",
      "texto": "...",
      "fotos": "..."
    }
  ],
  "categorias": [
    {
      "nombre": "...",
      "estado": "hambre | al_dia | hace_tiempo",
      "ultimo_posteo": "..."
    }
  ]
}`;

let airtableData;
try {
  const airtableResp = await callAnthropic(lecturaPrompt, airtableMCP);
  const rawText = extractText(airtableResp);
  // Buscar JSON en la respuesta
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  airtableData = jsonMatch ? JSON.parse(jsonMatch[0]) : { anecdotas: [], categorias: [] };
  console.log(`✅ Encontradas ${airtableData.anecdotas?.length || 0} anécdotas disponibles`);
} catch (e) {
  console.error('Error leyendo Airtable:', e.message);
  airtableData = { anecdotas: [], categorias: [] };
}

const anecdotas = airtableData.anecdotas || [];
const categorias = airtableData.categorias || [];
const hayMaterial = anecdotas.length >= 3;

// ── PASO 2 y 3: Generar copys O pitches ──────────────────────────────
console.log(hayMaterial
  ? '✍️ Hay suficiente material — generando 3 copys...'
  : '💡 Poco material — generando pitches por categoría...'
);

const categoriasEditoriales = [
  'Criterio Propio 🔴',
  'Detrás de Escena 🟡',
  'Lifestyle Creativo 🟢',
  'Fan de lo que hacemos 🔵'
];

const vozInstrucciones = `
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

let seccionContenido = '';
let registrosUsados = [];

if (hayMaterial) {
  // ── Generar 3 copys a partir de anécdotas reales ──────────────────
  const anecdotasTexto = anecdotas.slice(0, 5).map((a, i) =>
    `ANÉCDOTA ${i+1} [ID: ${a.id}]\nTítulo: ${a.titulo}\nCategoría sugerida: ${a.categoria}\nTexto: ${a.texto}\nFotos disponibles: ${a.fotos || 'ninguna'}`
  ).join('\n\n---\n\n');

  const categoriasTexto = categorias.map(c =>
    `${c.nombre}: ${c.estado}${c.ultimo_posteo ? ` (último posteo: ${c.ultimo_posteo})` : ''}`
  ).join('\n');

  const generacionPrompt = `${vozInstrucciones}

Hoy es ${today}. Tenés estas anécdotas disponibles en el journal de Vik:

${anecdotasTexto}

Estado actual de categorías (para balancear):
${categoriasTexto || 'Sin datos de categorías — balancear de forma equitativa'}

TAREA: Elegí las 3 anécdotas más fuertes (priorizando las categorías con más "hambre").
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
      "hora_sugerida": "...",
      "copy": "...",
      "slides": ["slide 1", "slide 2", "..."],
      "pregunta_cierre": "...",
      "carpeta_drive": "Criterio Propio | Detrás de Escena | Lifestyle Creativo | Fan de lo que hacemos",
      "nota_imagen": "descripción de qué tipo de foto buscar o nombre de archivo si lo conocés"
    }
  ]
}

Nota: el campo "slides" solo se completa para Formato C (Carrusel). Para otros formatos dejarlo como array vacío [].`;

  try {
    const genResp = await callAnthropic(generacionPrompt);
    const rawGen = extractText(genResp);
    const jsonMatch = rawGen.match(/\{[\s\S]*\}/);
    const genData = jsonMatch ? JSON.parse(jsonMatch[0]) : { posteos: [] };
    const posteos = genData.posteos || [];
    registrosUsados = posteos.map(p => p.id_registro).filter(Boolean);

    seccionContenido = posteos.map((p, i) => {
      const driveLink = DRIVE_FOLDERS[p.carpeta_drive] || DRIVE_FOLDERS['Sin Contexto'];
      const slidesHtml = p.formato === 'C' && p.slides?.length
        ? `<div style="background:#fffbeb;border-left:3px solid #f59e0b;padding:12px 16px;margin:12px 0;border-radius:0 6px 6px 0">
            <strong>Slides del carrusel:</strong><br>
            ${p.slides.map((s, idx) => `<span style="color:#92400e">Slide ${idx+1}:</span> ${s}`).join('<br>')}
           </div>`
        : '';

      return `
<div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;margin-bottom:24px">
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

  <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
    <a href="${driveLink}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600">🖼️ Ver fotos en Drive</a>
  </div>
  ${p.nota_imagen ? `<div style="margin-top:8px;font-size:13px;color:#6b7280">📎 ${p.nota_imagen}</div>` : ''}
</div>`;
    }).join('');

  } catch (e) {
    console.error('Error generando copys:', e.message);
    seccionContenido = `<p style="color:red">Error al generar copys: ${e.message}</p>`;
  }

} else {
  // ── Generar pitches por categoría faltante ────────────────────────
  const categoriasConMaterial = [...new Set(anecdotas.map(a => a.categoria))];
  const categoriasFaltantes = ['Criterio Propio', 'Detrás de Escena', 'Lifestyle Creativo', 'Fan de lo que hacemos']
    .filter(c => !categoriasConMaterial.includes(c));

  const pitchPrompt = `${vozInstrucciones}

Hoy es ${today}. El journal de @vikarrieta tiene poco material (${anecdotas.length} anécdota${anecdotas.length !== 1 ? 's' : ''}).

Categorías SIN material esta semana: ${categoriasFaltantes.join(', ')}
Categorías con algo: ${categoriasConMaterial.join(', ') || 'ninguna'}

CONTEXTO DE VIK: Founder-CEO de Monoblock (estudio de diseño editorial) y creadora de Happimess (marca de lifestyle, calendarios y agendas). Trabaja desde Buenos Aires. Le interesa el diseño, la creatividad, el proceso de construir una marca con criterio, la vida cotidiana con consciencia.

TAREA: Generá 2 pitches de ideas originales para CADA categoría faltante. Los pitches son semillas para que Vik recuerde algo que le pasó o decida compartir algo concreto — no son copys inventados, son disparadores.

Respondé SOLO con JSON válido:
{
  "pitches": [
    {
      "categoria": "...",
      "emoji": "...",
      "titulo": "Título breve del pitch",
      "disparador": "Pregunta o situación concreta para que Vik explore si tiene algo similar",
      "angulo": "Qué haría valioso este contenido y por qué conectaría",
      "formato_sugerido": "A | B | C | D"
    }
  ]
}`;

  try {
    const pitchResp = await callAnthropic(pitchPrompt);
    const rawPitch = extractText(pitchResp);
    const jsonMatch = rawPitch.match(/\{[\s\S]*\}/);
    const pitchData = jsonMatch ? JSON.parse(jsonMatch[0]) : { pitches: [] };
    const pitches = pitchData.pitches || [];

    // Agrupar por categoría
    const porCategoria = {};
    pitches.forEach(p => {
      if (!porCategoria[p.categoria]) porCategoria[p.categoria] = [];
      porCategoria[p.categoria].push(p);
    });

    seccionContenido = `
<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:20px;margin-bottom:24px">
  <h3 style="margin:0 0 8px;color:#991b1b">⚠️ Poco material esta semana</h3>
  <p style="margin:0;color:#7f1d1d;font-size:14px">Hay ${anecdotas.length} anécdota${anecdotas.length !== 1 ? 's' : ''} en el journal — menos de 3. Acá van ideas para completar la semana:</p>
</div>

${Object.entries(porCategoria).map(([cat, items]) => `
<div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;margin-bottom:24px">
  <h3 style="margin:0 0 16px;color:#111827">${items[0]?.emoji || ''} ${cat}</h3>
  ${items.map((p, i) => `
  <div style="background:#f9fafb;border-radius:8px;padding:16px;margin-bottom:12px">
    <div style="font-weight:700;color:#1f2937;margin-bottom:6px">Idea ${i+1}: ${p.titulo}</div>
    <div style="color:#374151;margin-bottom:8px;font-size:14px">💭 <em>${p.disparador}</em></div>
    <div style="color:#6b7280;font-size:13px">📐 Ángulo: ${p.angulo}</div>
    <div style="color:#9ca3af;font-size:12px;margin-top:4px">Formato sugerido: ${p.formato_sugerido}</div>
  </div>`).join('')}
</div>`).join('')}`;

  } catch (e) {
    console.error('Error generando pitches:', e.message);
    seccionContenido = `<p style="color:red">Error al generar pitches: ${e.message}</p>`;
  }
}

// ── PASO 5: Artículo para Substack ───────────────────────────────────
console.log('📝 Generando artículo para Substack...');

// Los XMLs del blog están en el proyecto — pasamos extractos representativos como referencia
const substackPrompt = `Sos redactora editorial de Happimess. Hoy es ${today}.

HAPPIMESS es una marca de lifestyle creada por Vik Arrieta (Buenos Aires). Vende calendarios y agendas con diseño. Su voz: editorial, cálida, con criterio. No es la voz personal de Vik — es la voz de la marca. Más reflexiva, más diseñada. El blog de Happimess tiene 5 categorías: Activar (motivación y acción), Crecer (aprendizaje y desarrollo), Descubrir (cultura y curiosidad), Disfrutar (placer cotidiano) y Viajar (experiencias y lugares).

TAREA: Generá un artículo para el Substack de Happimess. El artículo debe:
1. Tomar un tema central del universo Happimess (diseño, creatividad, lifestyle consciente, tiempo, organización con propósito)
2. Cruzarlo con una tendencia actual relevante en diseño, cultura o trabajo creativo
3. Voz: la de la marca Happimess — editorial, generosa, con criterio. NO la voz personal de Vik.
4. Extensión: 400-600 palabras
5. Estructura: título, bajada (2-3 líneas), cuerpo del artículo, párrafo de cierre

Respondé SOLO con JSON válido:
{
  "titulo": "...",
  "bajada": "...",
  "cuerpo": "...",
  "cierre": "...",
  "sugerencia_imagen_portada": "descripción de imagen ideal para la portada",
  "tendencia_usada": "nombre de la tendencia o fenómeno cultural que usaste como gancho"
}`;

let substackHtml = '';
try {
  const substackResp = await callAnthropic(substackPrompt);
  const rawSubstack = extractText(substackResp);
  const jsonMatch = rawSubstack.match(/\{[\s\S]*\}/);
  const substackData = jsonMatch ? JSON.parse(jsonMatch[0]) : null;

  if (substackData) {
    substackHtml = `
<div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:28px;margin-bottom:24px">
  <div style="display:inline-block;background:#f0fdf4;color:#166534;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;margin-bottom:16px">SUBSTACK · HAPPIMESS</div>
  <h2 style="margin:0 0 10px;color:#111827;font-size:22px;line-height:1.3">${substackData.titulo}</h2>
  <p style="color:#6b7280;font-size:15px;font-style:italic;margin-bottom:20px;border-bottom:1px solid #f3f4f6;padding-bottom:16px">${substackData.bajada}</p>
  <div style="color:#1f2937;font-size:15px;line-height:1.8;white-space:pre-wrap">${substackData.cuerpo}</div>
  <div style="color:#374151;font-size:15px;line-height:1.8;margin-top:16px;padding-top:16px;border-top:1px solid #f3f4f6">${substackData.cierre}</div>
  <div style="margin-top:20px;background:#f9fafb;border-radius:8px;padding:14px">
    <div style="font-size:12px;color:#9ca3af;font-weight:600;text-transform:uppercase;letter-spacing:0.05em">Imagen de portada sugerida</div>
    <div style="font-size:14px;color:#374151;margin-top:4px">🖼️ ${substackData.sugerencia_imagen_portada}</div>
    <div style="font-size:12px;color:#9ca3af;margin-top:8px">Tendencia usada como gancho: ${substackData.tendencia_usada}</div>
  </div>
</div>`;
  }
} catch (e) {
  console.error('Error generando artículo Substack:', e.message);
  substackHtml = `<p style="color:red">Error al generar artículo: ${e.message}</p>`;
}

// ── PASO 6: Actualizar estados en Airtable ────────────────────────────
if (hayMaterial && registrosUsados.length > 0) {
  console.log('🔄 Actualizando estados en Airtable...');
  const updatePrompt = `Usá el Airtable MCP para actualizar registros en la base ${AIRTABLE_BASE}, tabla ${TABLE_JOURNAL}.

Para CADA uno de estos IDs de registro, actualizá el campo Estado (flddgvfDKoy0hAzi4) al valor "listo_para_postear":
${registrosUsados.map(id => `- ${id}`).join('\n')}

Confirmá cuando hayas actualizado todos los registros.`;

  try {
    await callAnthropic(updatePrompt, airtableMCP);
    console.log('✅ Estados actualizados en Airtable');
  } catch (e) {
    console.error('Error actualizando Airtable:', e.message);
  }
}

// ── PASO 7: Armar y enviar el Gmail ──────────────────────────────────
console.log('📧 Enviando Gmail...');

const seccionTitulo = hayMaterial
  ? `<h2 style="color:#111827;font-size:20px;margin:0 0 8px">📅 Posteos de la semana</h2>
     <p style="color:#6b7280;margin:0 0 24px;font-size:14px">3 posteos listos para publicar. Revisá los copys, abrí el Drive para elegir las fotos y usá Cowork para crear los diseños en Canva cuando quieras.</p>`
  : `<h2 style="color:#991b1b;font-size:20px;margin:0 0 8px">💡 Ideas para la semana</h2>
     <p style="color:#6b7280;margin:0 0 24px;font-size:14px">Poco material esta semana. Acá van disparadores para que recordés algo concreto o generes contenido fresco.</p>`;

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

  <!-- Índice rápido -->
  <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;margin-bottom:24px">
    <div style="font-size:12px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:12px">Este mail tiene</div>
    <div style="display:flex;flex-direction:column;gap:8px">
      <div style="font-size:14px;color:#374151">${hayMaterial ? '✅ 3 posteos con copy completo' : '💡 Pitches de ideas por categoría'}</div>
      <div style="font-size:14px;color:#374151">🖼️ Links a carpetas de Drive por categoría</div>
      <div style="font-size:14px;color:#374151">📰 Borrador artículo Substack de Happimess</div>
      <div style="font-size:14px;color:#374151">🎨 Diseños en Canva: pedile a Cowork "armá el diseño del posteo de hoy"</div>
    </div>
  </div>

  <!-- Sección principal: copys o pitches -->
  <div style="margin-bottom:8px">
    ${seccionTitulo}
  </div>
  ${seccionContenido}

  <!-- Separador -->
  <div style="border-top:2px solid #e5e7eb;margin:32px 0;padding-top:8px">
    <div style="font-size:11px;color:#d1d5db;text-align:center;text-transform:uppercase;letter-spacing:0.1em">Happimess · Substack</div>
  </div>

  <!-- Substack -->
  ${substackHtml}

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
    ? `📅 Semana ${today} — 3 posteos listos + artículo Substack`
    : `💡 Semana ${today} — Ideas + artículo Substack`;
  const result = await sendGmail(accessToken, subject, gmailBody);
  if (result.id) {
    console.log('✅ Gmail enviado a', GMAIL_RECIPIENT, '— ID:', result.id);
  } else {
    console.error('Error enviando Gmail:', JSON.stringify(result));
    process.exit(1);
  }
} catch (e) {
  console.error('Error con Gmail:', e.message);
  process.exit(1);
}

console.log('🎉 Agente dominical completado');
