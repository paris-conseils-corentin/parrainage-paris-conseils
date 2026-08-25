// v250 — GET /.netlify/functions/parrainages-list
// Renvoie la liste des parrainages stockés dans Netlify Blobs.
//
// Auth acceptée :
//   1. Bearer <PARRAINAGE_ADMIN_TOKEN>  (usage admin/back-office)
//   2. Bearer <PRO_JWT_TOKEN>           (usage espace pro conseillers, via pro-login)
//
// Query params (optionnels) :
//   conseiller : filtre par conseiller (case insensitive, sous-chaîne)
//                → un conseiller ne voit que ses propres parrainages
//                → admin (rien ou conseiller=*) voit tout
//
// Comportement selon token :
//   - Admin token → tout accessible, filtre param respecté
//   - Pro JWT (role=admin) → tout accessible, filtre param respecté
//   - Pro JWT (role=conseiller) → filtre FORCÉ sur son conseiller_label,
//                                 le param 'conseiller' est ignoré (sécurité).

const { getStore } = require('@netlify/blobs');
const { verifyToken } = require('./pro-login');

// v250k — Helper robuste pour ouvrir un Blob store : essaie d'abord siteID+token
// explicites (indispensable quand le contexte auto n'est pas injecté par Netlify),
// puis retombe sur le contexte auto. Copie du pattern utilisé dans parrainage-relay.js.
function getBlobStore(name) {
  const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token  = process.env.NETLIFY_BLOBS_TOKEN
              || process.env.NETLIFY_FUNCTIONS_TOKEN
              || process.env.NETLIFY_AUTH_TOKEN
              || process.env.NETLIFY_API_TOKEN;
  if (siteID && token) {
    return getStore({ name, siteID, token, consistency: 'strong' });
  }
  return getStore(name);
}

const ALLOWED_ORIGINS = [
  'https://parrainage.parisconseils.fr',
  'https://parisconseils-parrainage.fr',
  'https://paris-conseils-dashboard.netlify.app',
  'https://paris-conseils-parrain.netlify.app',
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

exports.handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || '';
  const cors = corsHeaders(origin);

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'GET')     return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };

  const authHdr = event.headers.authorization || event.headers.Authorization || '';
  const bearer = authHdr.startsWith('Bearer ') ? authHdr.slice(7) : '';

  const adminToken = process.env.PARRAINAGE_ADMIN_TOKEN || '';
  const proSecret  = process.env.PRO_JWT_SECRET || '';

  let authOk = false;
  let effectiveConseillerFilter = null;
  let authKind = 'none';

  if (adminToken && bearer === adminToken) {
    authOk = true;
    authKind = 'admin-token';
  }

  if (!authOk && proSecret && bearer) {
    const payload = verifyToken(bearer, proSecret);
    if (payload) {
      authOk = true;
      authKind = 'pro-jwt-' + (payload.r || 'conseiller');
      if (payload.r !== 'admin') {
        effectiveConseillerFilter = (payload.c || payload.u || '').toString().toLowerCase().trim();
      }
    }
  }

  if (!authOk) {
    return { statusCode: 401, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'Unauthorized' }) };
  }

  const params = event.queryStringParameters || {};
  const rawFilter = (params.conseiller || '').toString().toLowerCase().trim();
  const conseillerFilter = (effectiveConseillerFilter !== null) ? effectiveConseillerFilter : rawFilter;
  const isAdminView = !conseillerFilter || conseillerFilter === '*' || conseillerFilter === 'admin';

  try {
    const store = getBlobStore('parrainages');
    const listing = await store.list();
    const records = [];
    for (const blob of (listing.blobs || [])) {
      const r = await store.get(blob.key, { type: 'json' });
      if (!r) continue;
      if (!isAdminView) {
        const c = (r.conseiller || '').toLowerCase();
        if (!c.includes(conseillerFilter)) continue;
      }
      records.push(r);
    }
    records.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, count: records.length, authKind, records }) };
  } catch (err) {
    return { statusCode: 500, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
