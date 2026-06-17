// Netlify Function: pivot du parrainage public Paris Conseils
//
// Pour CHAQUE soumission, on :
//   1) POSTe un parrainageAdd par filleul au dashboard ICA (Google Apps Script)
//   2) Envoie 3 emails via Resend :
//        - au parrain  (accusé de réception)
//        - au conseiller assigné (notification opérationnelle)
//        - à chaque filleul (annonce élégante)
//
// Variables d'environnement requises (à définir dans Netlify > Site settings > Environment variables) :
//   PC_DASHBOARD_API_URL   URL Apps Script complète (script.google.com/macros/s/.../exec)
//   PC_DASHBOARD_USER      identifiant dashboard (ex: parrainage-bot@parisconseils.fr)
//   PC_DASHBOARD_PASS      mot de passe associé
//   RESEND_API_KEY         clé API Resend (re_xxx)
//   MAIL_FROM              expéditeur (ex: "Paris Conseils <parrainage@parisconseils.fr>")
//                          - le domaine doit être vérifié dans Resend
//   MAIL_CC_OPS            (optionnel) BCC opérationnel pour archiver chaque notification
//   CONSEILLERS_JSON       (optionnel) JSON {"nom-conseiller": "email@parisconseils.fr"}
//                          Sinon, l'email conseiller fallback vers contact@parisconseils.fr

const { emailParrain, emailConseiller, emailFilleul } = require('./emails');

// v200 — Cumul par nombre de filleuls confirmés sur l'année (fenêtre 12 mois glissante)
// Règle : 500 €/filleul pour les 2 premiers, puis 1 500 €/filleul dès le 3e
// AVEC RÉTROACTIVITÉ sur les 2 premiers (qui passent rétroactivement à 1 500 €).
// Plafond : 10 filleuls/an = 15 000 €.
function cumulAt(n) {
  if (n <= 0)  return 0;
  if (n === 1) return 500;
  if (n === 2) return 1000;
  if (n >= 3 && n <= 10) return n * 1500;  // 3=4500, 4=6000, ..., 10=15000
  return 15000;
}

// Palier label pour les mails
function palierLabel(n) {
  if (n <= 0)  return '';
  if (n === 1) return 'Première pierre';
  if (n === 2) return 'Seconde pierre';
  if (n === 3) return 'Jackpot rétroactif';
  if (n <= 5)  return 'Constellation en formation';
  if (n <= 9)  return 'Top parrain';
  return 'Sommet doré';
}

// True si ce parrainage déclenche la rétroactivité (3e filleul atteint)
function isJackpotTrigger(prevCount, newCount) {
  return prevCount < 3 && newCount >= 3;
}

async function postDashboard(env, parrain, conseiller, filleuls) {
  const out = [];
  for (let i = 0; i < filleuls.length; i++) {
    const f = filleuls[i] || {};
    const data = {
      parrainPrenom: (parrain.prenom || '').trim(),
      parrainNom:    (parrain.nom    || '').trim(),
      parrainEmail:  (parrain.email  || '').trim(),
      parrainTel:    (parrain.tel    || '').trim(),
      filleulPrenom: (f.prenom || '').trim(),
      filleulNom:    (f.nom    || '').trim(),
      filleulEmail:  (f.email  || '').trim(),
      notes:         [conseiller ? ('Conseiller souhaité : ' + conseiller) : '',
                      (f.message || '').trim(),
                      f.tel ? 'Tél filleul : ' + f.tel : '']
                       .filter(Boolean).join(' | '),
      sendEmail:     false,  // on gère nous-mêmes l'email via Resend
      consentRGPD:   true,
      statut:        'mail-envoye'
    };
    const q = new URLSearchParams({
      action: 'parrainageAdd',
      u: env.PC_DASHBOARD_USER,
      p: env.PC_DASHBOARD_PASS,
      data: JSON.stringify(data)
    });
    try {
      const r = await fetch(env.PC_DASHBOARD_API_URL + '?' + q.toString());
      const j = await r.json();
      out.push({ i, ok: !!j.ok, dashboard: j });
    } catch (err) {
      out.push({ i, ok: false, error: err.message });
    }
  }
  return out;
}

async function sendEmail({ apiKey, from, to, subject, html, replyTo, bcc }) {
  const body = { from, to: Array.isArray(to) ? to : [to], subject, html };
  if (replyTo) body.reply_to = replyTo;
  if (bcc)     body.bcc      = Array.isArray(bcc) ? bcc : [bcc];
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, response: j };
}

function resolveConseillerEmail(env, conseillerName) {
  try {
    if (env.CONSEILLERS_JSON) {
      const map = JSON.parse(env.CONSEILLERS_JSON);
      // Cherche par nom exact, puis par sous-chaîne insensible à la casse
      if (map[conseillerName]) return map[conseillerName];
      const key = Object.keys(map).find(k => k.toLowerCase() === (conseillerName||'').toLowerCase());
      if (key) return map[key];
    }
  } catch (e) { /* ignore */ }
  return env.MAIL_CONTACT || 'contact@parisconseils.fr';
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const env = process.env;
  const missing = ['PC_DASHBOARD_API_URL','PC_DASHBOARD_USER','PC_DASHBOARD_PASS','RESEND_API_KEY','MAIL_FROM']
                    .filter(k => !env[k]);
  if (missing.length) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: 'Server not configured', missingEnv: missing })
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Invalid JSON' }) };
  }

  const parrain    = payload.parrain    || {};
  const conseiller = (payload.conseiller || '').toString().trim() || 'Paris Conseils';
  const filleuls   = Array.isArray(payload.filleuls) ? payload.filleuls.filter(f => f && (f.nom || f.prenom)) : [];

  if (!filleuls.length || !(parrain.email || parrain.nom)) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Données incomplètes (parrain + au moins 1 filleul requis)' }) };
  }

  // 1) Dashboard
  const dashboardResults = await postDashboard(env, parrain, conseiller, filleuls);

  // 2) Emails
  const conseillerEmail = resolveConseillerEmail(env, conseiller);
  const total = cumulAt(filleuls.length);
  const bcc = env.MAIL_CC_OPS || null;

  const mailJobs = [];

  // Email parrain
  if (parrain.email) {
    mailJobs.push(sendEmail({
      apiKey: env.RESEND_API_KEY,
      from: env.MAIL_FROM,
      to: parrain.email,
      subject: `Merci ${parrain.prenom || ''} — votre recommandation est bien reçue`,
      html: emailParrain({ parrain, conseiller, filleuls, total }),
      replyTo: conseillerEmail,
      bcc
    }).then(r => ({ kind:'parrain', to: parrain.email, ...r })));
  }

  // Email conseiller
  mailJobs.push(sendEmail({
    apiKey: env.RESEND_API_KEY,
    from: env.MAIL_FROM,
    to: conseillerEmail,
    subject: `Nouveau parrainage — ${parrain.prenom || ''} ${parrain.nom || ''} (${filleuls.length} filleul${filleuls.length>1?'s':''})`,
    html: emailConseiller({ parrain, conseiller, filleuls }),
    replyTo: parrain.email || undefined,
    bcc
  }).then(r => ({ kind:'conseiller', to: conseillerEmail, ...r })));

  // Email filleul (un par filleul ayant un email)
  for (const f of filleuls) {
    if (f.email) {
      mailJobs.push(sendEmail({
        apiKey: env.RESEND_API_KEY,
        from: env.MAIL_FROM,
        to: f.email,
        subject: `${parrain.prenom || 'Un proche'} vous recommande Paris Conseils`,
        html: emailFilleul({ parrain, conseiller, filleul: f }),
        replyTo: conseillerEmail,
        bcc
      }).then(r => ({ kind:'filleul', to: f.email, ...r })));
    }
  }

  const mailResults = await Promise.all(mailJobs);

  const allMailsOk = mailResults.every(m => m.ok);
  const allDashOk  = dashboardResults.every(d => d.ok);
  const overallOk  = allMailsOk && allDashOk;

  return {
    statusCode: overallOk ? 200 : 207,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ok: overallOk,
      dashboard: { ok: allDashOk, count: dashboardResults.length, results: dashboardResults },
      mails:     { ok: allMailsOk, count: mailResults.length, results: mailResults }
    })
  };
};
