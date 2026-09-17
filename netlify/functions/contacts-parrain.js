// v295 — GET /.netlify/functions/contacts-parrain?q=...
//
// Pont entre l'espace pro du site parrainage et le fichier clients du cabinet
// (base contacts du RIP). Le parrain est presque toujours déjà client : au lieu
// de retaper son nom, son mail et son téléphone, le conseiller le cherche ici
// et l'insère d'un clic dans le bloc « parrain ».
//
// Chaîne d'appel :
//   espace-pro.html  --(JWT pro)-->  cette fonction  --(secret partagé)-->  RIP
//
// Sécurité :
//   1. Le JWT de l'espace pro est vérifié ici (même mécanique que
//      parrainages-list.js). Sans JWT valide : 401, aucun appel au RIP.
//   2. Le nom et le rôle du conseiller sont pris DANS LE JWT, jamais dans la
//      requête : un conseiller ne peut pas se faire passer pour un autre ni
//      demander « tout le fichier ».
//   3. Le RIP applique ensuite le même cloisonnement que son dashboard :
//      l'administrateur voit tout, un conseiller ne voit que ses contacts.
//   Le secret partagé ne sort jamais du serveur.

const { getStore } = require('@netlify/blobs');
const { verifyToken } = require('./pro-login');

function getBlobStore(name) {
  const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN
    || process.env.NETLIFY_FUNCTIONS_TOKEN
    || process.env.NETLIFY_AUTH_TOKEN
    || process.env.NETLIFY_API_TOKEN;
  if (siteID && token) return getStore({ name, siteID, token, consistency: 'strong' });
  return getStore(name);
}

const ALLOWED_ORIGINS = [
  'https://parrainage.parisconseils.fr',
  'https://parisconseils-parrainage.fr',
  'http://localhost:8888',
  'http://localhost:8000'
];

function corsHeaders(origin) {
  const ok = ALLOWED_ORIGINS.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

// Le secret du RIP : variable d'environnement d'abord, sinon celui déjà
// enregistré dans le store `parrainages-config` (clé `rip-webhook`) — le même
// que pour le webhook, pour n'avoir qu'un seul secret à gérer.
let __cfg = null;
async function ripConfig(env) {
  if (__cfg) return __cfg;
  let base = env.RIP_BASE_URL || null;
  let secret = env.RIP_WEBHOOK_SECRET || null;
  if (!secret || !base) {
    try {
      const c = await getBlobStore('parrainages-config').get('rip-webhook', { type: 'json' });
      if (c) {
        if (!secret && c.secret) secret = c.secret;
        if (!base && c.url) base = String(c.url).replace(/\/api\/parrainage\/webhook.*$/, '');
      }
    } catch (_e) { /* store absent : on reste sur l'environnement */ }
  }
  if (!base) base = 'https://rip.parisconseils.fr';
  __cfg = { base: base.replace(/\/+$/, ''), secret };
  return __cfg;
}

exports.handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || '';
  const cors = corsHeaders(origin);
  const json = (code, obj) => ({
    statusCode: code,
    headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(obj)
  });

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };

  const authHdr = event.headers.authorization || event.headers.Authorization || '';
  const bearer = authHdr.startsWith('Bearer ') ? authHdr.slice(7) : '';
  const adminToken = process.env.PARRAINAGE_ADMIN_TOKEN || '';
  const proSecret = process.env.PRO_JWT_SECRET || '';

  // Identité de l'appelant : elle vient du jeton, jamais de l'URL.
  let conseiller = '';
  let role = '';
  let autorise = false;
  if (adminToken && bearer && bearer === adminToken) {
    autorise = true; role = 'admin';
  } else if (proSecret && bearer) {
    const p = verifyToken(bearer, proSecret);
    if (p) {
      autorise = true;
      role = (p.r || 'conseiller').toString();
      conseiller = (p.c || p.u || '').toString();
    }
  }
  if (!autorise) return json(401, { ok: false, error: 'Session expirée — reconnectez-vous.' });

  const q = ((event.queryStringParameters || {}).q || '').toString().trim();
  if (q.length < 2) return json(200, { ok: true, contacts: [], q });

  const cfg = await ripConfig(process.env);
  if (!cfg.secret) {
    return json(503, { ok: false, error: 'Le lien avec le fichier clients n\'est pas encore configuré côté serveur.' });
  }

  const url = cfg.base + '/api/parrainage/contacts'
    + '?q=' + encodeURIComponent(q)
    + '&limite=12'
    + '&conseiller=' + encodeURIComponent(conseiller)
    + '&role=' + encodeURIComponent(role);

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'X-Parrainage-Secret': cfg.secret } });
    clearTimeout(t);
    if (!r.ok) {
      return json(502, { ok: false, error: 'Le fichier clients n\'a pas répondu (' + r.status + ').' });
    }
    const d = await r.json();
    return json(200, {
      ok: true,
      q,
      role,
      contacts: Array.isArray(d.contacts) ? d.contacts : []
    });
  } catch (e) {
    return json(504, { ok: false, error: 'Fichier clients injoignable : ' + String((e && e.message) || e) });
  }
};
