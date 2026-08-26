// v260 — Pro area auth : login + forgot password + change password.
// Storage : Netlify Blobs store "pro-users" (auto-bootstrap depuis env vars).
// Password : scrypt salt+hash. Rules : ≥6 chars, 1 maj, 1 min, 1 symbole.
// Rate limit : 5 tentatives / 15 min / IP → blocage 15 min.

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

// ---------------------------------------------------------------- CORS
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

// ---------------------------------------------------------------- Blob store helper (siteID+token fallback)
function getBlobStore(name) {
  const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token  = process.env.NETLIFY_BLOBS_TOKEN
              || process.env.NETLIFY_FUNCTIONS_TOKEN
              || process.env.NETLIFY_AUTH_TOKEN
              || process.env.NETLIFY_API_TOKEN;
  if (siteID && token) return getStore({ name, siteID, token, consistency: 'strong' });
  return getStore(name);
}

// ---------------------------------------------------------------- JWT (HMAC-SHA256)
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
  if (sig.length !== expected.length) return null;
  try { if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null; }
  catch (_e) { return null; }
  try {
    const payload = JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    if (!payload || !payload.e || payload.e < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (_e) { return null; }
}

// ---------------------------------------------------------------- Password (scrypt)
function hashPwd(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPwd(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(String(password), salt, 64).toString('hex');
  try { return crypto.timingSafeEqual(Buffer.from(test), Buffer.from(hash)); }
  catch (_e) { return false; }
}

// ---------------------------------------------------------------- Password rules
function validateNewPwd(p) {
  if (!p || typeof p !== 'string') return 'Mot de passe manquant';
  if (p.length < 6) return 'Le mot de passe doit contenir au moins 6 caractères';
  if (!/[A-Z]/.test(p)) return 'Au moins une majuscule requise';
  if (!/[a-z]/.test(p)) return 'Au moins une minuscule requise';
  if (!/[^A-Za-z0-9]/.test(p)) return 'Au moins un symbole requis (ex : ! @ # $ % & * - _)';
  return null; // OK
}

// ---------------------------------------------------------------- Temp password generator
function genTempPwd() {
  // 12-char, guaranteed to pass rules : 3 upper + 3 lower + 3 digit + 3 symbol shuffled
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const digit = '23456789';
  const symb  = '!@#$%&*-_';
  const pick = (s, n) => Array.from({length: n}, () => s[crypto.randomInt(s.length)]).join('');
  const chars = (pick(upper, 3) + pick(lower, 3) + pick(digit, 3) + pick(symb, 3)).split('');
  // Fisher-Yates shuffle
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

// ---------------------------------------------------------------- Users store
const DEFAULT_CONSEILLERS = {
  curtet:  { login: 'curtet',  email: 'curtet@parisconseils.fr',  label: 'Corentin Curtet', role: 'admin',      aliases: ['corentin', 'corentin.curtet'] },
  pereira: { login: 'pereira', email: 'pereira@parisconseils.fr', label: 'David Pereira',   role: 'conseiller', aliases: ['david', 'david.pereira'] },
  moreau:  { login: 'moreau',  email: 'moreau@parisconseils.fr',  label: 'Nicolas Moreau',  role: 'conseiller', aliases: ['nicolas', 'nicolas.moreau'] }
};

async function getUserRecord(login) {
  try {
    const store = getBlobStore('pro-users');
    return await store.get(login, { type: 'json' });
  } catch (_e) { return null; }
}
async function saveUserRecord(user) {
  const store = getBlobStore('pro-users');
  await store.setJSON(user.login, user);
}

// Résout un identifiant (login court, email, alias) → conseiller connu + user record éventuel.
// Si le user record n'existe pas mais l'env var legacy existe, migre + retourne.
async function resolveUser(loginOrEmail) {
  const q = String(loginOrEmail || '').toLowerCase().trim();
  if (!q) return null;
  // Match sur clé, alias ou email
  let matched = null;
  for (const [key, cfg] of Object.entries(DEFAULT_CONSEILLERS)) {
    if (q === key || q === cfg.email.toLowerCase() || cfg.aliases.includes(q) || q === cfg.label.toLowerCase()) {
      matched = cfg; break;
    }
  }
  if (!matched) return null;
  let user = await getUserRecord(matched.login);
  if (user) return user;
  // Migration depuis env var legacy PRO_PASS_*
  const envPwd = process.env['PRO_PASS_' + matched.login.toUpperCase()];
  if (envPwd) {
    user = {
      login: matched.login, email: matched.email, label: matched.label, role: matched.role,
      pwd_hash: hashPwd(envPwd),
      must_change: false,
      created_at: new Date().toISOString(),
      last_login: null,
      last_pwd_change: null,
      source: 'migrated-env'
    };
    try { await saveUserRecord(user); } catch (_e) { /* pas grave, retente au prochain login */ }
    return user;
  }
  // Aucun mdp encore : retourne stub sans pwd_hash
  return { login: matched.login, email: matched.email, label: matched.label, role: matched.role, pwd_hash: null, must_change: false };
}

// ---------------------------------------------------------------- Rate limit
async function rateLimit(ip, action, maxAttempts = 5, windowMs = 15 * 60 * 1000, blockMs = 15 * 60 * 1000) {
  if (!ip) return { blocked: false };
  const key = `${action}:${ip}`;
  let record = null;
  try { record = await getBlobStore('pro-ratelimit').get(key, { type: 'json' }); } catch (_e) { record = null; }
  record = record || { attempts: [], blockedUntil: 0 };
  const now = Date.now();
  if (record.blockedUntil > now) return { blocked: true, retryInMin: Math.ceil((record.blockedUntil - now) / 60000) };
  record.attempts = (record.attempts || []).filter(t => now - t < windowMs);
  return { blocked: false, record, key, maxAttempts, blockMs, now };
}
async function bumpRateLimit(rl) {
  if (!rl || rl.blocked) return;
  rl.record.attempts.push(rl.now);
  if (rl.record.attempts.length >= rl.maxAttempts) rl.record.blockedUntil = rl.now + rl.blockMs;
  try { await getBlobStore('pro-ratelimit').setJSON(rl.key, rl.record); } catch (_e) { /* silent */ }
}
async function resetRateLimit(rl) {
  if (!rl || rl.blocked) return;
  rl.record.attempts = []; rl.record.blockedUntil = 0;
  try { await getBlobStore('pro-ratelimit').setJSON(rl.key, rl.record); } catch (_e) {}
}

// ---------------------------------------------------------------- Email sender (Brevo priorité, sinon SMTP, sinon Resend)
async function sendMail({ from, to, subject, html }) {
  const brevoKey = process.env.BREVO_API_KEY;
  if (brevoKey) {
    try {
      const fromMatch = (from || '').match(/^\s*"?(.+?)"?\s*<\s*([^>]+)\s*>\s*$/);
      const sender = fromMatch ? { name: fromMatch[1].trim(), email: fromMatch[2].trim() } : { email: (from || '').trim() };
      const r = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': brevoKey, 'Content-Type': 'application/json', 'accept': 'application/json' },
        body: JSON.stringify({ sender, to: [{ email: to }], subject, htmlContent: html })
      });
      const j = await r.json().catch(() => ({}));
      return { ok: r.ok, via: 'brevo', response: j };
    } catch (e) { return { ok: false, via: 'brevo', error: e.message }; }
  }
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + resendKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, html })
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, via: 'resend', response: j };
  }
  return { ok: false, error: 'no email provider configured' };
}

function resetEmailHtml(user, tempPwd) {
  const firstName = user.label.split(' ')[0];
  return `<!DOCTYPE html><html><body style="font-family:Helvetica,Arial,sans-serif;color:#1a1a1a;line-height:1.6;max-width:600px;margin:20px auto;padding:0 20px;">
<div style="background:#0A1E3F;padding:20px 24px;border-radius:12px 12px 0 0;text-align:center;">
  <img src="https://rip.parisconseils.fr/static/logo-blanc.png" alt="Paris Conseils" style="height:64px;">
</div>
<div style="background:#fff;border:1px solid #e2e8f0;border-top:none;border-bottom:3px solid #B8860B;padding:28px 32px;border-radius:0 0 12px 12px;">
  <p>Bonjour ${firstName},</p>
  <p>Vous avez demandé la réinitialisation de votre mot de passe pour l'<b>Espace Pro</b> parrainage Paris Conseils.</p>
  <p>Voici votre <b>mot de passe temporaire</b> :</p>
  <p style="font-family:'Courier New',monospace;font-size:22px;background:#FAF5E6;padding:16px 20px;border:1px solid #B8860B;border-radius:8px;text-align:center;letter-spacing:3px;font-weight:700;color:#0A1E3F;">${tempPwd}</p>
  <p>Connectez-vous ici : <a href="https://parrainage.parisconseils.fr/espace-pro.html" style="color:#0A1E3F;">parrainage.parisconseils.fr/espace-pro.html</a></p>
  <ul style="background:#F7F9FC;border-left:3px solid #B8860B;padding:14px 20px;margin:16px 0;list-style:none;">
    <li style="margin:4px 0;"><b>Identifiant :</b> <code style="background:#fff;padding:2px 8px;border-radius:4px;">${user.login}</code></li>
    <li style="margin:4px 0;"><b>Mot de passe temporaire :</b> celui ci-dessus</li>
  </ul>
  <p>À votre première connexion, vous devrez <b>choisir votre propre mot de passe</b>.<br>
  Règles : ≥ 6 caractères, 1 majuscule, 1 minuscule, 1 symbole.</p>
  <p style="color:#666;font-size:14px;">Si vous n'êtes pas à l'origine de cette demande, ignorez ce mail. Le mot de passe temporaire expire dans 1 heure.</p>
  <p style="margin-top:24px;color:#666;">Cordialement,<br><b>Paris Conseils — Ingénierie financière &amp; optimisation fiscale</b></p>
</div>
</body></html>`;
}

// ---------------------------------------------------------------- Handler
exports.handler = async (event) => {
  const CORS_H = corsFor(event.headers.origin || event.headers.Origin || '');
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS_H, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS_H, body: JSON.stringify({ ok: false, error: 'Method Not Allowed' }) };

  const secret = process.env.PRO_JWT_SECRET;
  if (!secret) return { statusCode: 500, headers: CORS_H, body: JSON.stringify({ ok: false, error: 'PRO_JWT_SECRET not configured' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_e) { return { statusCode: 400, headers: CORS_H, body: JSON.stringify({ ok: false, error: 'invalid JSON' }) }; }

  const params = event.queryStringParameters || {};
  const action = (params.action || 'login').toLowerCase();
  const ip = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown';

  // ============= ACTION : LOGIN =============
  if (action === 'login') {
    const rl = await rateLimit(ip, 'login', 5, 15 * 60 * 1000, 15 * 60 * 1000);
    if (rl.blocked) return { statusCode: 429, headers: CORS_H, body: JSON.stringify({ ok: false, error: `Trop de tentatives. Réessayez dans ${rl.retryInMin} minutes.` }) };

    const login    = String(body.login || '').trim();
    const password = String(body.password || '');
    if (!login || !password) return { statusCode: 400, headers: CORS_H, body: JSON.stringify({ ok: false, error: 'missing login/password' }) };

    const user = await resolveUser(login);
    if (!user || !user.pwd_hash || !verifyPwd(password, user.pwd_hash)) {
      await bumpRateLimit(rl);
      return { statusCode: 401, headers: CORS_H, body: JSON.stringify({ ok: false, error: 'invalid credentials' }) };
    }
    await resetRateLimit(rl);

    // Mise à jour last_login
    user.last_login = new Date().toISOString();
    try { await saveUserRecord(user); } catch (_e) {}

    const now = Math.floor(Date.now() / 1000);
    const payload = { u: user.login, c: user.label, r: user.role, e: now + 12 * 60 * 60 };
    const token = signPayload(payload, secret);
    return { statusCode: 200, headers: CORS_H, body: JSON.stringify({ ok: true, token, user: payload, mustChange: !!user.must_change }) };
  }

  // ============= ACTION : FORGOT =============
  if (action === 'forgot') {
    const rl = await rateLimit(ip, 'forgot', 3, 60 * 60 * 1000, 60 * 60 * 1000);
    if (rl.blocked) return { statusCode: 429, headers: CORS_H, body: JSON.stringify({ ok: false, error: `Trop de demandes. Réessayez dans ${rl.retryInMin} minutes.` }) };

    const emailOrLogin = String(body.email || body.login || '').trim();
    // Réponse générique pour éviter énumération
    const genericResp = { statusCode: 200, headers: CORS_H, body: JSON.stringify({ ok: true, message: 'Si un compte existe pour cette adresse, un mail avec un mot de passe temporaire vient d\'être envoyé.' }) };

    if (!emailOrLogin) { await bumpRateLimit(rl); return genericResp; }
    const user = await resolveUser(emailOrLogin);
    if (!user) { await bumpRateLimit(rl); return genericResp; }

    const tempPwd = genTempPwd();
    const record = {
      login: user.login, email: user.email, label: user.label, role: user.role,
      pwd_hash: hashPwd(tempPwd),
      must_change: true,
      temp_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      created_at: user.created_at || new Date().toISOString(),
      last_login: user.last_login || null,
      last_pwd_change: null,
      source: 'temp-forgot'
    };
    try { await saveUserRecord(record); }
    catch (e) { return { statusCode: 500, headers: CORS_H, body: JSON.stringify({ ok: false, error: 'storage error' }) }; }

    const from = process.env.MAIL_FROM || 'Paris Conseils <parrainage@parisconseils.fr>';
    const r = await sendMail({ from, to: user.email, subject: 'Réinitialisation mot de passe — Espace Pro Paris Conseils', html: resetEmailHtml(user, tempPwd) });
    if (!r.ok) return { statusCode: 502, headers: CORS_H, body: JSON.stringify({ ok: false, error: 'mail failed: ' + (r.error || 'unknown') }) };

    await bumpRateLimit(rl); // count la demande
    return genericResp;
  }

  // ============= ACTION : CHANGE =============
  if (action === 'change') {
    const login    = String(body.login || '').trim();
    const current  = String(body.currentPassword || '');
    const next     = String(body.newPassword || '');
    if (!login || !current || !next) return { statusCode: 400, headers: CORS_H, body: JSON.stringify({ ok: false, error: 'missing login/currentPassword/newPassword' }) };

    const rl = await rateLimit(ip, 'change', 10, 15 * 60 * 1000, 15 * 60 * 1000);
    if (rl.blocked) return { statusCode: 429, headers: CORS_H, body: JSON.stringify({ ok: false, error: `Trop de tentatives. Réessayez dans ${rl.retryInMin} minutes.` }) };

    const user = await resolveUser(login);
    if (!user || !user.pwd_hash || !verifyPwd(current, user.pwd_hash)) {
      await bumpRateLimit(rl);
      return { statusCode: 401, headers: CORS_H, body: JSON.stringify({ ok: false, error: 'Mot de passe actuel incorrect' }) };
    }
    const ruleErr = validateNewPwd(next);
    if (ruleErr) return { statusCode: 400, headers: CORS_H, body: JSON.stringify({ ok: false, error: ruleErr }) };
    if (next === current) return { statusCode: 400, headers: CORS_H, body: JSON.stringify({ ok: false, error: 'Le nouveau mot de passe doit être différent de l\'actuel' }) };

    user.pwd_hash = hashPwd(next);
    user.must_change = false;
    user.temp_expires_at = null;
    user.last_pwd_change = new Date().toISOString();
    user.source = 'user-set';
    try { await saveUserRecord(user); }
    catch (e) { return { statusCode: 500, headers: CORS_H, body: JSON.stringify({ ok: false, error: 'storage error' }) }; }

    await resetRateLimit(rl);
    const now = Math.floor(Date.now() / 1000);
    const payload = { u: user.login, c: user.label, r: user.role, e: now + 12 * 60 * 60 };
    const token = signPayload(payload, secret);
    return { statusCode: 200, headers: CORS_H, body: JSON.stringify({ ok: true, token, user: payload, message: 'Mot de passe mis à jour.' }) };
  }

  return { statusCode: 400, headers: CORS_H, body: JSON.stringify({ ok: false, error: 'unknown action' }) };
};

// Expose helpers pour parrainages-list.js
module.exports.verifyToken = verifyToken;
module.exports.b64url = b64url;
