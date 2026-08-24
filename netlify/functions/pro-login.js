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

  // v250g SECURITY — debug endpoint retiré (audit).
  // Le diag env se fait maintenant via parrainage-relay?action=env-debug (Bearer requis).

  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS_H, body: JSON.stringify({ ok: false, error: 'Method Not Allowed' }) };

  const secret = process.env.PRO_JWT_SECRET;
  if (!secret) return { statusCode: 500, headers: CORS_H, body: JSON.stringify({ ok: false, error: 'PRO_JWT_SECRET not configured' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_e) { return { statusCode: 400, headers: CORS_H, body: JSON.stringify({ ok: false, error: 'invalid JSON' }) }; }
  const login    = String(body.login || '').trim();
  const password = String(body.password || '');
  if (!login || !password) return { statusCode: 400, headers: CORS_H, body: JSON.stringify({ ok: false, error: 'missing login/password' }) };

  const url = process.env.RIP_SSO_URL || 'https://rip.parisconseils.fr/api/verify-password';
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Origin': 'https://parrainage.parisconseils.fr' },
      body: JSON.stringify({ login, password })
    });
  } catch (e) {
    return { statusCode: 502, headers: CORS_H, body: JSON.stringify({ ok: false, error: 'SSO unreachable: ' + e.message }) };
  }

  const j = await resp.json().catch(() => ({}));
  if (!resp.ok || !j.ok) {
    return { statusCode: 401, headers: CORS_H, body: JSON.stringify({ ok: false, error: j.error || 'invalid credentials' }) };
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    u: j.login,
    c: j.conseiller_label || j.login,
    r: j.role || 'conseiller',
    e: now + 12 * 60 * 60  // 12h
  };
  const token = signPayload(payload, secret);

  return {
    statusCode: 200,
    headers: CORS_H,
    body: JSON.stringify({ ok: true, token, user: payload })
  };
};

// Expose helpers pour parrainages-list.js (import via require)
module.exports.verifyToken = verifyToken;
module.exports.b64url = b64url;
