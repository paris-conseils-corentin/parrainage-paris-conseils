// Netlify Function: pivot du parrainage public Paris Conseils
//
// Pour CHAQUE soumission, on :
//   1) POSTe un parrainageAdd par filleul au dashboard ICA (Google Apps Script)
//   2) Envoie 3 emails via Resend :
//        - au parrain  (confirmation soignée)
//        - au conseiller assigné (fiche opérationnelle avec IBAN)
//        - à chaque filleul (annonce élégante)
//
// Les deux volets sont INDÉPENDANTS : si la config mail manque, le dashboard
// est quand même alimenté (et inversement). Chaque volet remonte son statut
// précis dans la réponse pour diagnostiquer depuis les logs Netlify.
//
// Variables d'environnement requises (Netlify > Site settings > Environment variables) :
//   — Dashboard —
//   PC_DASHBOARD_API_URL   URL Apps Script complète (script.google.com/macros/s/.../exec)
//   PC_DASHBOARD_USER      identifiant dashboard (ex: parrainage-bot@parisconseils.fr)
//   PC_DASHBOARD_PASS      mot de passe associé
//   — Emails —
//   RESEND_API_KEY         clé API Resend (re_xxx)
//   MAIL_FROM              expéditeur (ex: "Paris Conseils <parrainage@parisconseils.fr>")
//                          - le domaine doit être vérifié dans Resend
//   MAIL_CC_OPS            (optionnel) BCC opérationnel pour archiver chaque notification
//   CONSEILLERS_JSON       (optionnel) JSON {"nom-conseiller": "email@parisconseils.fr"}
//                          - complète/écrase l'annuaire intégré ci-dessous

const { emailParrain, emailConseiller, emailFilleul } = require('./emails');

// Annuaire intégré : même sans CONSEILLERS_JSON, chaque conseiller reçoit
// sa notification (fallback ultime : contact@parisconseils.fr).
const CONSEILLERS_DEFAUT = {
  'corentin curtet': 'curtet@parisconseils.fr',
  'curtet':          'curtet@parisconseils.fr',
  'david pereira':   'pereira@parisconseils.fr',
  'pereira':         'pereira@parisconseils.fr',
  'nicolas moreau':  'moreau@parisconseils.fr',
  'moreau':          'moreau@parisconseils.fr'
};

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

async function postDashboard(env, parrain, conseiller, filleuls, iban) {
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
                      f.tel ? 'Tél filleul : ' + f.tel : '',
                      iban  ? 'IBAN parrain : ' + iban : '']
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
  const key = (conseillerName || '').toLowerCase().trim();
  try {
    if (env.CONSEILLERS_JSON) {
      const map = JSON.parse(env.CONSEILLERS_JSON);
      if (map[conseillerName]) return map[conseillerName];
      const k = Object.keys(map).find(k2 => k2.toLowerCase() === key);
      if (k) return map[k];
    }
  } catch (e) { /* ignore */ }
  if (CONSEILLERS_DEFAUT[key]) return CONSEILLERS_DEFAUT[key];
  return env.MAIL_CONTACT || 'contact@parisconseils.fr';
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const env = process.env;
  const missingDash = ['PC_DASHBOARD_API_URL', 'PC_DASHBOARD_USER', 'PC_DASHBOARD_PASS'].filter(k => !env[k]);
  const missingMail = ['RESEND_API_KEY', 'MAIL_FROM'].filter(k => !env[k]);

  if (missingDash.length && missingMail.length) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: 'Server not configured', missingEnv: [...missingDash, ...missingMail] })
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
  const iban       = (payload.iban || '').toString().trim();
  const filleuls   = Array.isArray(payload.filleuls) ? payload.filleuls.filter(f => f && (f.nom || f.prenom)) : [];

  if (!filleuls.length || !(parrain.email || parrain.nom)) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Données incomplètes (parrain + au moins 1 filleul requis)' }) };
  }

  // 1) Dashboard (si configuré)
  const dashboardResults = missingDash.length
    ? []
    : await postDashboard(env, parrain, conseiller, filleuls, iban);

  // 2) Emails (si configurés)
  let mailResults = [];
  if (!missingMail.length) {
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
        subject: `Votre recommandation est bien enregistrée${parrain.prenom ? ' — merci ' + parrain.prenom : ''}`,
        html: emailParrain({ parrain, conseiller, filleuls, total, iban }),
        replyTo: conseillerEmail,
        bcc
      }).then(r => ({ kind: 'parrain', to: parrain.email, ...r })));
    }

    // Email conseiller
    const filleulNames = filleuls.map(f => (f.prenom + ' ' + (f.nom || '')).trim()).filter(Boolean).join(', ');
    mailJobs.push(sendEmail({
      apiKey: env.RESEND_API_KEY,
      from: env.MAIL_FROM,
      to: conseillerEmail,
      subject: `Nouveau parrainage à traiter — ${parrain.prenom || ''} ${parrain.nom || ''} → ${filleulNames}`,
      html: emailConseiller({ parrain, conseiller, filleuls, iban }),
      replyTo: parrain.email || undefined,
      bcc
    }).then(r => ({ kind: 'conseiller', to: conseillerEmail, ...r })));

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
        }).then(r => ({ kind: 'filleul', to: f.email, ...r })));
      }
    }

    mailResults = await Promise.all(mailJobs);
  }

  const allMailsOk = !missingMail.length && mailResults.every(m => m.ok);
  const allDashOk  = !missingDash.length && dashboardResults.every(d => d.ok);
  const overallOk  = allMailsOk && allDashOk;

  return {
    statusCode: overallOk ? 200 : 207,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ok: overallOk,
      dashboard: missingDash.length
        ? { ok: false, skipped: true, missingEnv: missingDash }
        : { ok: allDashOk, count: dashboardResults.length, results: dashboardResults },
      mails: missingMail.length
        ? { ok: false, skipped: true, missingEnv: missingMail }
        : { ok: allMailsOk, count: mailResults.length, results: mailResults }
    })
  };
};
