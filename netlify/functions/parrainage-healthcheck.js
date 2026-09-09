// v284 — Surveillance quotidienne du parcours parrainage (planifiée dans netlify.toml, 07:00 UTC = 9h Paris).
// Délègue au relay (?action=healthcheck) : pages servies, intégrité des scripts du formulaire,
// base Blobs, fournisseur mail, config RIP. Le relay envoie lui-même le mail d'alerte (ou le « OK » du lundi).
const SITE_URL = 'https://parrainage.parisconseils.fr';

exports.handler = async () => {
  const token = process.env.PARRAINAGE_ADMIN_TOKEN || '';
  if (!token) return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'PARRAINAGE_ADMIN_TOKEN manquant' }) };
  try {
    const r = await fetch(`${SITE_URL}/.netlify/functions/parrainage-relay?action=healthcheck`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': 'parrainage-healthcheck/1.0' }
    });
    const text = await r.text();
    console.log('[healthcheck]', r.status, text.slice(0, 1500));
    return { statusCode: 200, body: JSON.stringify({ ok: r.status === 200, relayStatus: r.status }) };
  } catch (e) {
    console.error('[healthcheck] échec', e);
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: String(e && e.message || e) }) };
  }
};
