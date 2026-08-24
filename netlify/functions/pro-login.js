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

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

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
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    if (!payload || !payload.e || payload.e < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (_e) { return null; }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  // v250f - Debug endpoint : GET ?debug=env
  if (event.httpMethod === 'GET' && (event.queryStringParameters || {}).debug === 'env') {
    const keys = Object.keys(process.env);
    const proKeys = keys.filter(k => k.startsWith('PRO_') || k.startsWith('RIP_'));
    return { statusCode: 200, headers: CORS, body: JSON.stringify({
      envKeyCount: keys.length,
      proKeys,
      proJwtSecretLen: (process.env.PRO_JWT_SECRET || '').length,
      nodeVersion: process.version
    }) };
  }

  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ ok: false, error: 'Method Not Allowed' }) };

  const secret = process.env.PRO_JWT_SECRET;
  if (!secret) return { statusCode: 500, headers: CORS, body: JSON.stringify({ ok: false, error: 'PRO_JWT_SECRET not configured' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_e) { return { statusCode: 400, headers: CORS, body: JSON.stringify({ ok: false, error: 'invalid JSON' }) }; }
  const login    = String(body.login || '').trim();
  const password = String(body.password || '');
  if (!login || !password) return { statusCode: 400, headers: CORS, body: JSON.stringify({ ok: false, error: 'missing login/password' }) };

  const url = process.env.RIP_SSO_URL || 'https://rip.parisconseils.fr/api/verify-password';
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Origin': 'https://parrainage.parisconseils.fr' },
      body: JSON.stringify({ login, password })
    });
  } catch (e) {
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ ok: false, error: 'SSO unreachable: ' + e.message }) };
  }

  const j = await resp.json().catch(() => ({}));
  if (!resp.ok || !j.ok) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ ok: false, error: j.error || 'invalid credentials' }) };
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
    headers: CORS,
    body: JSON.stringify({ ok: true, token, user: payload })
  };
};

// Expose helpers pour parrainages-list.js (import via require)
module.exports.verifyToken = verifyToken;
module.exports.b64url = b64url;
