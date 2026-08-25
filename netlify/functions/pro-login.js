// v250 — Pro area login (SSO via rip.parisconseils.fr).
// Client POST { login, password } → this function calls
// https://rip.parisconseils.fr/api/verify-password. If OK, we sign a
// short-lived HMAC token (12 h) that the client uses for subsequent calls
// to parrainages-list, parrainage-relay, etc.
//
// ENV requis :
//   PRO_JWT_SECRET  = clé HMAC (random 32+ chars). Généré une fois, à conserver.
//   RIP_SSO_URL     = 'https://rip.parisconseils.fr/api/verify-password' (défaut)
//
// Format du token : base64url(payload).base64url(signature)
//   payload = { u: <login>, c: <conseiller_label>, r: <role>, e: <exp epoch s> }
//   signature = HMAC-SHA256(payload, PRO_JWT_SECRET)

const crypto = require('crypto');

// v250g SECURITY — CORS restreint aux domaines Paris Conseils (fix audit).
const ALLOWED_ORIGINS = [
  'https://parrainage.parisconseils.fr',
  'https://parisconseils-parrainage.fr',
  'https://paris-conseils-parrain.netlify.app',
  'https://parrainage-paris-conseils.netlify.app'
];
function corsFor(origin) {
  const ok = ALLOWED_ORIGINS.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
    'Vary': 'Origin'
  };
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function signPayload(payload, secret) {
  const p = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac('sha256', secret).update(p).digest());
  return `${p}.${sig}`;
}

function verifyToken(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [p, sig] = parts;
  const expected = b64url(crypto.createHmac('sha256', secret).update(p).digest());
  // v250g SECURITY — timing-safe comparison (fix audit).
  if (sig.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch (_e) { return null; }
  try {
    const payload = JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    if (!payload || !payload.e || payload.e < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (_e) { return null; }
}

exports.handler = async (event) => {
  const CORS_H = corsFor(event.headers.origin || event.headers.Origin || '');
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS_H, body: '' };

  // v250j — Diag temp : GET ?debug=proenv liste les env PRO_* et leur longueur (safe).
  if (event.httpMethod === 'GET' && (event.queryStringParameters || {}).debug === 'proenv') {
    const proKeys = Object.keys(process.env).filter(k => k.startsWith('PRO_'));
    const info = {};
    for (const k of proKeys) info[k] = (process.env[k] || '').length;
    return { statusCode: 200, headers: CORS_H, body: JSON.stringify({proKeys, info}) };
  }

  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS_H, body: JSON.stringify({ ok: false, error: 'Method Not Allowed' }) };

  const secret = process.env.PRO_JWT_SECRET;
  if (!secret) return { statusCode: 500, headers: CORS_H, body: JSON.stringify({ ok: false, error: 'PRO_JWT_SECRET not configured' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_e) { return { statusCode: 400, headers: CORS_H, body: JSON.stringify({ ok: false, error: 'invalid JSON' }) }; }
  const login    = String(body.login || '').trim();
  const password = String(body.password || '');
  if (!login || !password) return { statusCode: 400, headers: CORS_H, body: JSON.stringify({ ok: false, error: 'missing login/password' }) };

  // v250h — Auth par env vars Netlify (le SSO Flask n'est pas déployé côté Render).
  const CONSEILLERS = {
    curtet:  { pass: process.env.PRO_PASS_CURTET,   label: 'Corentin Curtet', role: 'admin',      aliases: ['corentin', 'corentin.curtet', 'curtet.corentin', 'curtet@parisconseils.fr'] },
    pereira: { pass: process.env.PRO_PASS_PEREIRA,  label: 'David Pereira',   role: 'conseiller', aliases: ['david',    'david.pereira',    'pereira.david',    'pereira@parisconseils.fr'] },
    moreau:  { pass: process.env.PRO_PASS_MOREAU,   label: 'Nicolas Moreau',  role: 'conseiller', aliases: ['nicolas',  'nicolas.moreau',   'moreau.nicolas',   'moreau@parisconseils.fr'] }
  };
  const loginNorm = login.toLowerCase().trim();
  let matched = null;
  for (const [key, cfg] of Object.entries(CONSEILLERS)) {
    if (loginNorm === key || cfg.aliases.includes(loginNorm)) { matched = { key, ...cfg }; break; }
  }
  if (!matched) return { statusCode: 401, headers: CORS_H, body: JSON.stringify({ ok: false, error: 'invalid credentials' }) };
  if (!matched.pass) return { statusCode: 503, headers: CORS_H, body: JSON.stringify({ ok: false, error: 'no password set for ' + matched.label }) };

  const a = Buffer.from(password);
  const b = Buffer.from(matched.pass);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { statusCode: 401, headers: CORS_H, body: JSON.stringify({ ok: false, error: 'invalid credentials' }) };
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = { u: matched.key, c: matched.label, r: matched.role, e: now + 12 * 60 * 60 };
  const token = signPayload(payload, secret);
  return { statusCode: 200, headers: CORS_H, body: JSON.stringify({ ok: true, token, user: payload }) };
};

module.exports.verifyToken = verifyToken;
module.exports.b64url = b64url;
