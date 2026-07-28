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

// v200am — Bascule Resend → SMTP direct via parisconseils.fr
// build-stamp: 2026-06-20-SMTP-DIRECT
const crypto = require('crypto');
const nodemailer = require('nodemailer');

// SMTP transporter singleton — créé à la première utilisation.
let __smtpTransporter = null;
function getSmtpTransporter() {
  if (__smtpTransporter) return __smtpTransporter;
  const host   = process.env.SMTP_HOST;
  const port   = parseInt(process.env.SMTP_PORT || '587', 10);
  const user   = process.env.SMTP_USER;
  const pass   = process.env.SMTP_PASSWORD || process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  __smtpTransporter = nodemailer.createTransport({
    host,
    port,
    // 465 = SSL implicite (secure=true), 587/25 = STARTTLS (secure=false)
    secure: port === 465,
    auth: { user, pass },
    // o2switch tolère parfois des certificats auto-signés sur leur SMTP
    tls: { rejectUnauthorized: process.env.SMTP_TLS_STRICT === 'true' }
  });
  return __smtpTransporter;
}

// =====================================================================
// TEMPLATES HTML INLINE
// =====================================================================
const NAVY = '#1a2842', NAVY_D = '#0c1a35';
const GOLD = '#c9a542', GOLD_L = '#f0d077';
const CREAM = '#fbf7ec', INK = '#1a1a1a', MUTED = '#6b7280';
const LOGO_URL = process.env.MAIL_LOGO_URL || 'https://paris-conseils-parrain.netlify.app/logo-paris-conseils.png';

const escapeHtml = (s) => String(s||'').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

function starsRow(nLit) {
  let html = '<div style="text-align:center;font-size:28px;letter-spacing:6px;line-height:1;margin:14px 0;">';
  for (let i = 0; i < 10; i++) {
    const color = i < nLit ? GOLD : '#cbd2de';
    html += `<span style="color:${color};">${i < nLit ? '★' : '☆'}</span>`;
  }
  return html + '</div>';
}

// HEADER BLANC pour que le logo (texte noir + swoosh bleu) soit parfaitement lisible
function baseShell(opts) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>${opts.title}</title></head>
<body style="margin:0;padding:0;background:${CREAM};font-family:Georgia,'Times New Roman',serif;color:${INK};">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:${CREAM};padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 6px 30px rgba(12,26,53,0.08);">
        <tr><td style="background:#ffffff;padding:36px 40px 28px 40px;text-align:center;">
          <img src="${LOGO_URL}" alt="Paris Conseils — Ingénierie financière & optimisation fiscale" width="280" height="auto" style="display:inline-block;max-width:280px;height:auto;border:0;outline:none;text-decoration:none;">
        </td></tr>
        <tr><td style="height:3px;background:${GOLD};line-height:0;font-size:0;">&nbsp;</td></tr>
        <tr><td style="padding:28px 40px 0 40px;text-align:center;">
          <div style="font-family:Georgia,serif;font-size:10px;letter-spacing:5px;color:${GOLD};text-transform:uppercase;">${opts.eyebrow}</div>
        </td></tr>
        <tr><td style="padding:14px 40px 8px 40px;text-align:center;">
          <h1 style="font-family:'Playfair Display',Georgia,serif;font-size:28px;font-weight:400;color:${NAVY_D};margin:0;line-height:1.2;">${opts.title}</h1>
        </td></tr>
        ${opts.subtitle ? `<tr><td style="padding:0 40px 20px 40px;text-align:center;">
          <div style="font-family:Georgia,serif;font-style:italic;font-size:15px;color:${MUTED};">${opts.subtitle}</div>
        </td></tr>` : ''}
        <tr><td style="padding:10px 40px 30px 40px;font-family:Georgia,serif;font-size:15px;line-height:1.7;color:${INK};">${opts.body}</td></tr>
        <tr><td style="background:${CREAM};padding:24px 40px;text-align:center;font-family:Georgia,serif;font-size:12px;color:${MUTED};border-top:1px solid #eee;">
          <div style="margin-bottom:8px;">Paris Conseils — Ingénierie financière &amp; optimisation fiscale</div>
          <div>Confidentialité absolue · Secret professionnel</div>
          <div style="margin-top:14px;">
            <a href="https://paris-conseils-parrain.netlify.app" style="color:${NAVY};text-decoration:none;">paris-conseils-parrain.netlify.app</a>
            &nbsp;·&nbsp;
            <a href="mailto:contact@parisconseils.fr" style="color:${NAVY};text-decoration:none;">contact@parisconseils.fr</a>
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

// v200r — Bloc explicatif des paliers, personnalisé selon l'étape du parrain
function blocExplicationPaliers(nbFilleulsApres) {
  const n = Math.max(0, Math.min(10, nbFilleulsApres|0));
  let titreEtape, corps;
  if (n === 0) {
    titreEtape = 'Bienvenue dans le programme';
    corps = `<p style="margin:0 0 10px;">Vous n'avez encore transmis <strong>aucun filleul</strong>. Voici comment ça fonctionne :</p>
      <ul style="margin:0;padding-left:18px;line-height:1.7;">
        <li><strong>1<sup>er</sup> filleul</strong> qui valide une opération : vous recevez <strong>500 €</strong></li>
        <li><strong>2<sup>e</sup> filleul</strong> qui valide : vous recevez <strong>+500 €</strong> (1 000 € cumulés)</li>
        <li><strong>3<sup>e</sup> filleul</strong> qui valide : <strong>1 500 €</strong> + <strong>rétroactivité de 1 000 € chacun</strong> sur vos 2 premiers (qui passent à 1 500 € chacun), soit <strong>1 500 + 1 500 + 1 500 = 4 500 €</strong> de cumul</li>
        <li><strong>À partir du 4<sup>e</sup></strong> et jusqu'au 10<sup>e</sup> : <strong>+ 1 500 €</strong> par filleul supplémentaire</li>
        <li><strong>Plafond annuel</strong> : 10 filleuls = <strong>15 000 €</strong></li>
      </ul>`;
  } else if (n === 1) {
    titreEtape = `Vous avez transmis 1 filleul`;
    corps = `<p style="margin:0 0 10px;">Si ce filleul valide une opération, vous recevez <strong>500 €</strong>. Voici la suite :</p>
      <ul style="margin:0;padding-left:18px;line-height:1.7;">
        <li><strong>2<sup>e</sup> filleul</strong> qui valide : <strong>+500 €</strong> (1 000 € cumulés)</li>
        <li><strong>3<sup>e</sup> filleul</strong> qui valide : <strong>1 500 €</strong> + <strong>rétroactivité de 1 000 € chacun</strong> sur vos 2 premiers (qui passent à 1 500 € chacun), soit <strong>1 500 + 1 500 + 1 500 = 4 500 €</strong> d'un coup</li>
        <li><strong>Du 4<sup>e</sup> au 10<sup>e</sup></strong> : <strong>+ 1 500 €</strong> par filleul supplémentaire</li>
        <li><strong>Plafond annuel</strong> : 10 filleuls = <strong>15 000 €</strong></li>
      </ul>`;
  } else if (n === 2) {
    titreEtape = `Vous avez transmis 2 filleuls`;
    corps = `<p style="margin:0 0 10px;">Si ces 2 filleuls valident une opération, vous touchez déjà <strong>1 000 €</strong> (500 € chacun).
      <strong>Un 3<sup>e</sup> filleul change la donne</strong> :</p>
      <ul style="margin:0;padding-left:18px;line-height:1.7;">
        <li>Vous touchez <strong>1 500 €</strong> sur le 3<sup>e</sup></li>
        <li>+ <strong>rétroactivité de 1 000 € chacun</strong> sur vos 2 premiers — ils passent à <strong>1 500 € chacun</strong></li>
        <li>Soit <strong>1 500 + 1 500 + 1 500 = 4 500 €</strong> au 3<sup>e</sup> filleul validé</li>
        <li>Puis <strong>+ 1 500 €</strong> par filleul supplémentaire jusqu'au 10<sup>e</sup> (plafond <strong>15 000 €</strong>)</li>
      </ul>`;
  } else {
    const totalActuel = 1500 * n; // v200av-fix : 1500€/filleul à partir du 3e (rétro 1500 chacun pour 1er+2e)
    titreEtape = `Vous avez transmis ${n} filleuls`;
    corps = `<p style="margin:0 0 10px;">Avec ${n} filleuls validés, vous êtes à <strong>${totalActuel.toLocaleString('fr-FR')} €</strong>
      (rétroactivité du 3<sup>e</sup> appliquée : vos 2 premiers sont à 1 500 € chacun, puis 1 500 € par filleul à partir du 3<sup>e</sup>).</p>
      <ul style="margin:0;padding-left:18px;line-height:1.7;">
        ${n < 10 ? `<li>Chaque filleul supplémentaire qui valide une opération : <strong>+ 1 500 €</strong></li>
        <li><strong>Plafond annuel</strong> : 10 filleuls = <strong>15 000 €</strong> (il vous reste ${10 - n} filleul${10-n>1?'s':''} possible${10-n>1?'s':''})</li>` :
        `<li>Vous avez atteint le <strong>plafond annuel de 15 000 €</strong>. Bravo !</li>`}
      </ul>`;
  }
  return `<div style="background:#fdf6e3;border:1px solid ${GOLD};border-left:4px solid ${GOLD};border-radius:10px;padding:18px 22px;margin:22px 0;">
      <div style="font-family:Georgia,serif;font-size:10px;letter-spacing:3px;color:#8a6818;text-transform:uppercase;font-weight:700;margin-bottom:8px;">📍 Où en êtes-vous ? · ${escapeHtml(titreEtape)}</div>
      <div style="font-family:Georgia,serif;font-size:14px;color:${NAVY_D};">${corps}</div>
      <div style="margin-top:14px;padding-top:12px;border-top:1px dashed ${GOLD};font-size:12px;color:${MUTED};text-align:center;">
        ⏳ Programme valable jusqu'au <strong style="color:${NAVY_D};">31 décembre 2026</strong> — chaque année repart à zéro le 1<sup>er</sup> janvier.
      </div>
    </div>`;
}

function emailParrain({ parrain, conseiller, filleuls, total, nbFilleulsConfirmes }) {
  const nbConfirmes = (typeof nbFilleulsConfirmes === 'number') ? nbFilleulsConfirmes : 0;
  const nbApresAjout = nbConfirmes + filleuls.length;
  const triggersRetro = nbConfirmes < 3 && nbApresAjout >= 3;
  const stars = starsRow(Math.min(nbApresAjout, 10));
  // v200aa — Nom complet du conseiller pour affichage
  const conseillerNom = conseillerComplet(conseiller);
  const filleulsHtml = filleuls.map((f, i) => `<tr><td style="padding:14px 18px;border-bottom:1px solid #f0eee6;font-family:Georgia,serif;">
      <div style="font-family:'Playfair Display',Georgia,serif;font-size:16px;color:${NAVY_D};">${i+1}. ${escapeHtml(f.prenom)} ${escapeHtml(f.nom)}</div>
      ${f.email ? `<div style="font-size:13px;color:${MUTED};margin-top:3px;">✉ ${escapeHtml(f.email)}</div>` : ''}
      ${f.tel   ? `<div style="font-size:13px;color:${MUTED};margin-top:3px;">☎ ${escapeHtml(f.tel)}</div>` : ''}
    </td></tr>`).join('');
  const body = `<p>Bonjour ${escapeHtml(parrain.prenom)},</p>
    <p>Nous avons bien reçu votre recommandation. <strong>${filleuls.length} proche${filleuls.length>1?'s ont':' a'} été transmis</strong> à votre conseiller <strong>${escapeHtml(conseillerNom)}</strong>, qui prendra contact avec chacun sous <strong>48 heures</strong>.</p>
    <div style="background:linear-gradient(135deg,${NAVY} 0%,${NAVY_D} 100%);border-radius:14px;padding:24px 20px;margin:24px 0;text-align:center;">
      <div style="font-family:Georgia,serif;font-size:10px;letter-spacing:4px;color:${GOLD_L};text-transform:uppercase;margin-bottom:4px;">Votre constellation</div>
      ${stars}
      <div style="font-family:'Playfair Display',Georgia,serif;font-size:16px;color:${GOLD_L};font-style:italic;margin-top:4px;">${Math.min(nbApresAjout,10)} étoile${nbApresAjout>1?'s':''} sur 10</div>
    </div>
    ${triggersRetro ? `<div style="background:#fdf6e3;border:1px solid ${GOLD};border-left:4px solid ${GOLD};border-radius:10px;padding:18px 22px;margin:22px 0;">
      <div style="font-family:Georgia,serif;font-size:10px;letter-spacing:3px;color:#8a6818;text-transform:uppercase;font-weight:700;margin-bottom:6px;">★ ★ ★ Effet rétroactif déclenché</div>
      <div style="font-family:'Playfair Display',Georgia,serif;font-size:18px;color:${NAVY_D};line-height:1.4;">Avec ce 3<sup>e</sup> filleul, vos 2 premiers parrainages passent rétroactivement à <strong>1 000 €</strong> chacun. Vous gagnez un complément de <strong>1 000 €</strong>.</div>
    </div>` : ''}
    ${blocExplicationPaliers(nbApresAjout)}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:24px 0;background:${CREAM};border-radius:10px;">${filleulsHtml}</table>
    <div style="background:${NAVY};color:#fff;padding:20px 24px;border-radius:10px;text-align:center;margin:24px 0;">
      <div style="font-family:Georgia,serif;font-size:11px;letter-spacing:3px;color:${GOLD_L};text-transform:uppercase;margin-bottom:6px;">Votre potentiel total</div>
      <div style="font-family:'Playfair Display',Georgia,serif;font-size:36px;font-weight:700;color:${GOLD_L};">${total.toLocaleString('fr-FR')} €</div>
      <div style="font-size:13px;color:#cfd9ec;margin-top:6px;font-style:italic;">selon les filleuls qui souscrivent — plafond 15 000 € / an</div>
    </div>
    <p style="text-align:center;margin:30px 0;">
      <a href="https://paris-conseils-parrain.netlify.app/parrainage.html" style="display:inline-block;background:${GOLD};color:${NAVY_D};padding:14px 30px;text-decoration:none;border-radius:8px;font-family:Georgia,serif;letter-spacing:2px;font-size:12px;text-transform:uppercase;font-weight:700;">★ Recommander un nouveau filleul</a>
    </p>
    <p style="font-style:italic;color:${MUTED};border-left:2px solid ${GOLD};padding:6px 0 6px 16px;margin:24px 0;">« Le savoir est la seule matière qui s'accroît quand on la partage. »<br><span style="font-size:12px;">— Socrate</span></p>
    <p>Merci de votre confiance,<br>L'équipe Paris Conseils</p>`;
  return baseShell({ title: 'Recommandation bien reçue', eyebrow: 'Accusé de réception',
    subtitle: `${filleuls.length} proche${filleuls.length>1?'s recommandés':' recommandé'} · conseiller ${escapeHtml(conseillerNom)}`, body });
}

// v200aa — Helpers pour transformer le slug conseiller en prénom / nom complet
function conseillerPrenom(value) {
  const v = (value || '').toString().trim().toLowerCase();
  if (v.includes('pereira')) return 'David';
  if (v.includes('moreau'))  return 'Nicolas';
  if (v.includes('curtet'))  return 'Corentin';
  if (!v || v === 'paris conseils' || v === 'paris-conseils') return null;
  // Fallback : 1er mot capitalisé
  const parts = value.toString().trim().split(/\s+/);
  const p = parts[0] || '';
  return p ? (p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()) : null;
}
function conseillerComplet(value) {
  const v = (value || '').toString().trim().toLowerCase();
  if (v.includes('pereira')) return 'David Pereira';
  if (v.includes('moreau'))  return 'Nicolas Moreau';
  if (v.includes('curtet'))  return 'Corentin Curtet';
  if (!v || v === 'paris conseils' || v === 'paris-conseils') return 'Paris Conseils';
  return value;
}

// v200ak — Mail conseiller minimaliste : juste une notification + lien dashboard.
// On NE met PAS les coordonnées des filleuls dans le mail (sécurité + RGPD).
// Le conseiller doit aller sur le dashboard pour voir les détails et marquer comme contacté.
function emailConseiller({ parrain, conseiller, filleuls }) {
  const prenomCons = conseillerPrenom(conseiller) || 'cher conseiller';
  const nbFilleuls = filleuls.length;
  const body = `<p>Bonjour <strong>${escapeHtml(prenomCons)}</strong>,</p>
    <p>Vous venez de recevoir <strong>${nbFilleuls} nouveau${nbFilleuls>1?'x':''} parrainage${nbFilleuls>1?'s':''}</strong> à traiter.</p>
    <div style="background:#fff8d0;border:1px solid ${GOLD};border-left:4px solid ${GOLD};border-radius:10px;padding:20px 24px;margin:24px 0;">
      <div style="font-family:Georgia,serif;font-size:11px;letter-spacing:3px;color:#8a6818;text-transform:uppercase;font-weight:700;margin-bottom:8px;">★ Prochaine étape</div>
      <div style="font-family:'Playfair Display',Georgia,serif;font-size:18px;color:${NAVY_D};line-height:1.5;">
        Connectez-vous au <strong>dashboard équipe</strong> pour consulter les détails (nom, email, téléphone, projet) de vos filleuls
        et <strong>contacter chacun sous 48 heures</strong>.
      </div>
    </div>
    <p style="text-align:center;margin:30px 0;">
      <a href="https://paris-conseils-dashboard.netlify.app/equipe.html" style="display:inline-block;background:${NAVY};color:#fff;padding:16px 32px;text-decoration:none;border-radius:8px;font-family:Georgia,serif;letter-spacing:2px;font-size:13px;text-transform:uppercase;font-weight:700;">Ouvrir le dashboard →</a>
    </p>
    <p style="font-size:12px;color:${MUTED};font-style:italic;border-left:2px solid ${GOLD};padding:6px 0 6px 16px;margin:20px 0;">
      Pour des raisons de confidentialité (RGPD) et de sécurité, les coordonnées des filleuls
      ne sont pas dans cet email. Connectez-vous au dashboard équipe avec votre identifiant
      conseiller pour les consulter et les marquer comme contactés.
    </p>
    <p>Merci de votre réactivité,<br>L'équipe Paris Conseils</p>`;
  return baseShell({ title: 'Nouveau parrainage à traiter', eyebrow: 'Notification conseiller',
    subtitle: `${nbFilleuls} filleul${nbFilleuls>1?'s':''} · à traiter sous 48 h via le dashboard`, body });
}

function emailFilleul({ parrain, conseiller, filleul }) {
  const cleanCons = (conseiller || '').toString().trim();
  const lc = cleanCons.toLowerCase();
  const hasSpecific = lc && lc !== 'paris conseils' && lc !== 'paris-conseils';
  const map = { 'pereira':'David Pereira','moreau':'Nicolas Moreau','curtet':'Corentin Curtet',
    'david pereira':'David Pereira','nicolas moreau':'Nicolas Moreau','corentin curtet':'Corentin Curtet' };
  const conseillerDisplay = hasSpecific ? (map[lc] || cleanCons) : 'Un conseiller Paris Conseils';
  const body = `<p>Bonjour ${escapeHtml(filleul.prenom)},</p>
    <p><strong>${escapeHtml(parrain.prenom)} ${escapeHtml(parrain.nom)}</strong> vous a recommandé auprès de Paris Conseils, cabinet d'<em>ingénierie financière et d'optimisation fiscale</em>.</p>
    <p>Un proche qui prend le temps de vous recommander, c'est rarement anodin. Notre rôle est d'apporter à chacun de nos clients un <strong>accompagnement sur-mesure</strong>, dans la plus stricte confidentialité.</p>
    <div style="background:${CREAM};border-radius:10px;padding:24px;margin:28px 0;text-align:center;">
      <div style="font-family:Georgia,serif;font-size:10px;letter-spacing:4px;color:${GOLD};text-transform:uppercase;margin-bottom:10px;">Votre interlocuteur</div>
      <div style="font-family:'Playfair Display',Georgia,serif;font-size:22px;color:${NAVY_D};">${escapeHtml(conseillerDisplay)}</div>
      <div style="font-size:13px;color:${MUTED};margin-top:8px;font-style:italic;">${hasSpecific ? 'prendra contact avec vous sous 48 heures' : 'vous contactera dans les meilleurs délais'}</div>
    </div>
    <p>Cette première conversation est <strong>sans engagement</strong>. Elle sert avant tout à comprendre votre situation, vos objectifs.</p>
    <p>Si vous préférez ne pas être contacté, répondez simplement à cet email — nous respecterons votre choix immédiatement.</p>
    <p>À très bientôt,<br>L'équipe Paris Conseils</p>`;
  return baseShell({ title: `${escapeHtml(parrain.prenom)} vous recommande Paris Conseils`,
    eyebrow: 'Une recommandation pour vous', subtitle: 'Accompagnement confidentiel · ingénierie patrimoniale', body });
}

// v200h — Stockage persistant via Netlify Blobs
// Chaque parrainage est enregistré dans le store "parrainages" avec un UUID.
// Le dashboard équipe lit ces blobs via /.netlify/functions/parrainages-list.
// v200p — Helper robuste : auto-context OR explicit siteID+token (fallback drop-deploy)
function getBlobStore(name) {
  const { getStore } = require('@netlify/blobs');
  const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token  = process.env.NETLIFY_BLOBS_TOKEN
              || process.env.NETLIFY_FUNCTIONS_TOKEN
              || process.env.NETLIFY_AUTH_TOKEN
              || process.env.NETLIFY_API_TOKEN;
  // Tente d'abord la config explicite si on a les credentials
  if (siteID && token) {
    return getStore({ name, siteID, token, consistency: 'strong' });
  }
  // Sinon repli sur auto-context (fonctionne dans la plupart des runtimes Netlify)
  return getStore(name);
}

async function saveParrainageToBlobs(record) {
  try {
    const store = getBlobStore('parrainages');
    await store.setJSON(record.id, record);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// v200 — Cumul par nombre de filleuls confirmés sur l'année (fenêtre 12 mois glissante)
// Règle : 500 €/filleul pour les 2 premiers, puis 1 500 €/filleul dès le 3e
// AVEC RÉTROACTIVITÉ sur les 2 premiers (qui passent rétroactivement à 1 500 €).
// Plafond : 10 filleuls/an = 15 000 €.
// v200t — Règle corrigée (18/06/2026) :
//   1er filleul = 500 €
//   2e filleul = 500 €  (cumul 1000 €)
//   3e filleul = 1500 € + bonus rétroactif de 1000 € réparti sur les 2 premiers
//      → 1er passe de 500 à 1000 (+500), 2e passe de 500 à 1000 (+500)
//      → cumul au 3e = 1000 + 1000 + 1500 = 3500 €
//   4e et suivants = + 1500 € chacun
//   Plafond : 10 filleuls/an = 15 000 € (les 1er et 2e restent à 1000 €)
// v200av-fix — Règle corrigée 20/06/2026 : 500 € pour les 2 premiers, puis le 3e
// déclenche une rétroactivité de 1 000 € CHACUN pour le 1er et le 2e (qui passent
// à 1 500 € chacun) PLUS 1 500 € pour le 3e lui-même → cumul 4 500 € au 3e.
// Ensuite : +1 500 € par filleul jusqu'au 10e. Pas de bonus jackpot, le 10e atteint
// naturellement 15 000 € (= 1500 × 10).
// Formule : cumulAt(n>=3) = 1500 × n. Avec 1er = 500 et 2e = 1000.
function cumulAt(n) {
  if (n <= 0)  return 0;
  if (n === 1) return 500;
  if (n === 2) return 1000;
  if (n >= 3 && n <= 10) return 1500 * n; // 3=4500, 4=6000, 5=7500, ..., 10=15000
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

// v200ao — sendEmail à 3 modes par ordre de priorité :
//   1. BREVO_API_KEY défini       → envoi via Brevo API REST (recommandé)
//   2. SMTP_HOST/USER/PASS défini → envoi via nodemailer SMTP (parisconseils.fr direct)
//   3. RESEND_API_KEY défini      → envoi via Resend (legacy)
// Brevo est prioritaire car validation domaine très simple (1 seul record TXT)
// et 300 mails/jour gratuits — largement assez pour le parrainage.
async function sendEmail({ apiKey, from, to, subject, html, replyTo, bcc, testRedirect }) {
  let realTo = to;
  let realSubject = subject;
  if (testRedirect) {
    realTo = testRedirect;
  }
  // --- MODE BREVO (PRIORITAIRE) ---
  const brevoKey = process.env.BREVO_API_KEY;
  if (brevoKey) {
    try {
      // Parse "Name <email>" ou juste "email"
      const fromMatch = (from || '').match(/^\s*"?(.+?)"?\s*<\s*([^>]+)\s*>\s*$/);
      const sender = fromMatch
        ? { name: fromMatch[1].trim(), email: fromMatch[2].trim() }
        : { email: (from || '').trim() };
      const toList = (Array.isArray(realTo) ? realTo : [realTo])
        .filter(Boolean)
        .map(e => ({ email: e }));
      const body = { sender, to: toList, subject: realSubject, htmlContent: html };
      if (replyTo) {
        const rtMatch = String(replyTo).match(/^\s*"?(.+?)"?\s*<\s*([^>]+)\s*>\s*$/);
        body.replyTo = rtMatch ? { name: rtMatch[1].trim(), email: rtMatch[2].trim() } : { email: String(replyTo).trim() };
      }
      if (bcc) {
        body.bcc = (Array.isArray(bcc) ? bcc : [bcc]).filter(Boolean).map(e => ({ email: e }));
      }
      const r = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': brevoKey,
          'Content-Type': 'application/json',
          'accept': 'application/json'
        },
        body: JSON.stringify(body)
      });
      const j = await r.json().catch(() => ({}));
      return { ok: r.ok, status: r.status, response: j, via: 'brevo' };
    } catch (e) {
      return { ok: false, status: 500, response: { error: e.message }, via: 'brevo' };
    }
  }
  // --- MODE SMTP ---
  const transporter = getSmtpTransporter();
  if (transporter) {
    try {
      const info = await transporter.sendMail({
        from,
        to: Array.isArray(realTo) ? realTo.join(', ') : realTo,
        subject: realSubject,
        html,
        replyTo: replyTo || undefined,
        bcc: bcc ? (Array.isArray(bcc) ? bcc.join(', ') : bcc) : undefined
      });
      return { ok: true, status: 200, response: { id: info.messageId, accepted: info.accepted, rejected: info.rejected }, via: 'smtp' };
    } catch (e) {
      return { ok: false, status: 500, response: { error: e.message }, via: 'smtp' };
    }
  }
  // --- MODE RESEND (fallback / legacy) ---
  if (!apiKey) return { ok: false, status: 500, response: { error: 'no BREVO_API_KEY, no SMTP_HOST and no RESEND_API_KEY configured' } };
  const body = { from, to: Array.isArray(realTo) ? realTo : [realTo], subject: realSubject, html };
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
  return { ok: r.ok, status: r.status, response: j, via: 'resend' };
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

// v200m — Mail de rappel J+45 pour relancer le parrain
function emailRappelParrain({ parrain, conseiller, nbConfirmes, currentTotal, nextTierLabel, nextTierExtra, joursDepuis }) {
  const stars = starsRow(Math.min(nbConfirmes, 10));
  const body = `<p>Bonjour ${escapeHtml(parrain.prenom)},</p>
    <p>Cela fait <strong>${joursDepuis} jours</strong> que votre premier proche est passé chez Paris Conseils via votre recommandation.
    Voici où vous en êtes :</p>
    <div style="background:linear-gradient(135deg,${NAVY} 0%,${NAVY_D} 100%);border-radius:14px;padding:24px 20px;margin:24px 0;text-align:center;">
      <div style="font-family:Georgia,serif;font-size:10px;letter-spacing:4px;color:${GOLD_L};text-transform:uppercase;margin-bottom:4px;">Votre constellation actuelle</div>
      ${stars}
      <div style="font-family:'Playfair Display',Georgia,serif;font-size:16px;color:${GOLD_L};font-style:italic;margin-top:4px;">${nbConfirmes} étoile${nbConfirmes>1?'s':''} sur 10 · ${currentTotal.toLocaleString('fr-FR')} € accumulés</div>
    </div>
    ${nextTierLabel ? `<div style="background:#fdf6e3;border:1px solid ${GOLD};border-left:4px solid ${GOLD};border-radius:10px;padding:18px 22px;margin:22px 0;">
      <div style="font-family:Georgia,serif;font-size:10px;letter-spacing:3px;color:#8a6818;text-transform:uppercase;font-weight:700;margin-bottom:6px;">⭐ Prochain palier</div>
      <div style="font-family:'Playfair Display',Georgia,serif;font-size:18px;color:${NAVY_D};line-height:1.4;">${nextTierLabel} pour atteindre <strong>${nextTierExtra}</strong>.</div>
    </div>` : ''}
    ${blocExplicationPaliers(nbConfirmes)}
    <p>Un proche en tête à qui parler de Paris Conseils ? C'est le bon moment de le partager — quelques minutes suffisent pour ajouter une recommandation.</p>
    <p style="text-align:center;margin:30px 0;">
      <a href="https://paris-conseils-parrain.netlify.app/parrainage.html" style="display:inline-block;background:${GOLD};color:${NAVY_D};padding:14px 30px;text-decoration:none;border-radius:8px;font-family:Georgia,serif;letter-spacing:2px;font-size:12px;text-transform:uppercase;font-weight:700;">★ Recommander un nouveau filleul</a>
    </p>
    <p style="font-style:italic;color:${MUTED};border-left:2px solid ${GOLD};padding:6px 0 6px 16px;margin:24px 0;">« Le savoir est la seule matière qui s'accroît quand on la partage. »<br><span style="font-size:12px;">— Socrate</span></p>
    <p>Au plaisir d'accueillir un nouveau proche,<br>L'équipe Paris Conseils${conseiller ? ` — ${escapeHtml(conseiller)}` : ''}</p>`;
  return baseShell({ title: 'Continuez votre constellation', eyebrow: 'Rappel · vos paliers',
    subtitle: `${nbConfirmes} étoile${nbConfirmes>1?'s':''} déjà allumée${nbConfirmes>1?'s':''} · ${currentTotal.toLocaleString('fr-FR')} € à percevoir`, body });
}

// v200m — Endpoint /rappels : à appeler par un cron externe (ex: cron-job.org) chaque jour
// Logique : pour chaque parrain unique, regarde son DERNIER parrainage. Si createdAt > J+45
// et pas de relance déjà envoyée dans les 45 derniers jours → envoie un mail rappel.
async function handleRappels(event) {
  const token = process.env.PARRAINAGE_ADMIN_TOKEN || '';
  if (!token) return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'PARRAINAGE_ADMIN_TOKEN not configured' }) };
  const auth = event.headers.authorization || event.headers.Authorization || '';
  if (auth !== `Bearer ${token}`) return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'Unauthorized' }) };

  try {
    const store = getBlobStore('parrainages');
    const relanceStore = getBlobStore('parrainages-relances');
    const listing = await store.list();

    // Grouper par email du parrain et trouver le DERNIER parrainage + cumul des filleuls
    const parParrain = {};
    for (const blob of (listing.blobs || [])) {
      const r = await store.get(blob.key, { type: 'json' });
      if (!r || !r.parrain || !r.parrain.email) continue;
      const k = r.parrain.email.toLowerCase();
      if (!parParrain[k]) parParrain[k] = { records: [], totalFilleuls: 0 };
      parParrain[k].records.push(r);
      parParrain[k].totalFilleuls += (r.filleuls || []).length;
    }

    const now = Date.now();
    const ms45j = 45 * 24 * 60 * 60 * 1000;
    const env = process.env;
    const results = [];

    for (const email of Object.keys(parParrain)) {
      const { records, totalFilleuls } = parParrain[email];
      records.sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||''));
      const last = records[0];
      const lastDate = new Date(last.createdAt).getTime();
      const joursDepuis = Math.floor((now - lastDate) / (24*60*60*1000));
      if (joursDepuis < 45) { results.push({ email, joursDepuis, action:'skip-jeune' }); continue; }
      if (totalFilleuls >= 10)  { results.push({ email, joursDepuis, action:'skip-plafond' }); continue; }

      // A-t-on déjà envoyé une relance récemment ?
      const relanceKey = `${email}-${Math.floor(lastDate / ms45j)}`; // 1 relance max par fenêtre 45j
      const dejaEnvoye = await relanceStore.get(relanceKey, { type: 'json' }).catch(() => null);
      if (dejaEnvoye) { results.push({ email, joursDepuis, action:'skip-deja-relance' }); continue; }

      // Préparer le contenu
      const currentTotal = cumulAt(totalFilleuls);
      let nextTierLabel = null, nextTierExtra = null;
      if (totalFilleuls < 3) { nextTierLabel = `Encore ${3 - totalFilleuls} filleul${3-totalFilleuls>1?'s':''}`; nextTierExtra = '4 500 € (cumul après rétroactivité)'; }
      else if (totalFilleuls < 5) { nextTierLabel = `Encore ${5 - totalFilleuls} filleul${5-totalFilleuls>1?'s':''}`; nextTierExtra = '7 500 €'; }
      else if (totalFilleuls < 10){ nextTierLabel = `Encore ${10 - totalFilleuls} filleul${10-totalFilleuls>1?'s':''}`; nextTierExtra = '15 000 € (bonus jackpot 10e filleul)'; }

      const html = emailRappelParrain({
        parrain: last.parrain,
        conseiller: last.conseiller,
        nbConfirmes: totalFilleuls,
        currentTotal,
        nextTierLabel, nextTierExtra,
        joursDepuis
      });

      const conseillerEmail = resolveConseillerEmail(env, last.conseiller);
      const sendRes = await sendEmail({
        apiKey: env.RESEND_API_KEY,
        from: env.MAIL_FROM,
        to: email,
        subject: `${last.parrain.prenom || ''}, continuez votre constellation`,
        html,
        replyTo: conseillerEmail,
        bcc: env.MAIL_CC_OPS,
        testRedirect: env.MAIL_TEST_REDIRECT
      });

      // Marquer comme envoyé pour ne pas redoubler
      if (sendRes.ok) {
        await relanceStore.setJSON(relanceKey, { sentAt: new Date().toISOString(), email, totalFilleuls });
      }
      results.push({ email, joursDepuis, action: sendRes.ok ? 'sent' : 'failed', sendRes });
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, scanned: Object.keys(parParrain).length, results })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
}

// v200l — Endpoint debug pour récupérer le HTML brut généré
async function handleHtmlDebug(event) {
  const html = emailParrain({
    parrain: { prenom: 'Debug', nom: 'CHECK', email: 'x@x.fr', tel: '' },
    conseiller: 'Corentin Curtet',
    filleuls: [{ prenom: 'A', nom: 'B', email: 'a@b.fr', tel: '' }],
    total: 500,
    nbFilleulsConfirmes: 0
  });
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: html
  };
}

// v200h — Dispatcher pour les actions list/delete (au cas où les sous-functions
// ne soient pas détectées par Netlify Drop). On garde le POST sans action
// pour la soumission classique.
async function handleList(event) {
  const token = process.env.PARRAINAGE_ADMIN_TOKEN || '';
  if (!token) return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'PARRAINAGE_ADMIN_TOKEN not configured' }) };
  const auth = event.headers.authorization || event.headers.Authorization || '';
  if (auth !== `Bearer ${token}`) return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'Unauthorized' }) };
  const params = event.queryStringParameters || {};
  const conseillerFilter = (params.conseiller || '').toString().toLowerCase().trim();
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
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ ok: true, count: records.length, records })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
}

// v200x — Mettre à jour le statut d'un filleul (contacté ou non)
async function handleMarkContacted(event) {
  const token = process.env.PARRAINAGE_ADMIN_TOKEN || '';
  if (!token) return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'PARRAINAGE_ADMIN_TOKEN not configured' }) };
  const auth = event.headers.authorization || event.headers.Authorization || '';
  if (auth !== `Bearer ${token}`) return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'Unauthorized' }) };
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return { statusCode: 400, body: 'Invalid JSON' }; }
  if (!body.id) return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Missing id' }) };
  if (typeof body.filleulIndex !== 'number') return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Missing filleulIndex' }) };
  try {
    const store = getBlobStore('parrainages');
    const record = await store.get(body.id, { type: 'json' });
    if (!record) return { statusCode: 404, body: JSON.stringify({ ok: false, error: 'Not found' }) };
    const filleuls = record.filleuls || [];
    if (body.filleulIndex < 0 || body.filleulIndex >= filleuls.length) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Invalid filleulIndex' }) };
    }
    const f = filleuls[body.filleulIndex];
    if (body.contacted) {
      f.contactedAt = new Date().toISOString();
      f.contactedBy = (body.by || '').toString().slice(0, 80) || null;
    } else {
      delete f.contactedAt;
      delete f.contactedBy;
    }
    record.filleuls = filleuls;
    await store.setJSON(record.id, record);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ ok: true, filleul: f })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
}

async function handleDelete(event) {
  const token = process.env.PARRAINAGE_ADMIN_TOKEN || '';
  if (!token) return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'PARRAINAGE_ADMIN_TOKEN not configured' }) };
  const auth = event.headers.authorization || event.headers.Authorization || '';
  if (auth !== `Bearer ${token}`) return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'Unauthorized' }) };
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return { statusCode: 400, body: 'Invalid JSON' }; }
  if (!body.id) return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Missing id' }) };
  const params = event.queryStringParameters || {};
  const conseillerFilter = (params.conseiller || '').toString().toLowerCase().trim();
  const isAdminAction = !conseillerFilter || conseillerFilter === '*' || conseillerFilter === 'admin';
  try {
    const store = getBlobStore('parrainages');
    const existing = await store.get(body.id, { type: 'json' });
    if (!existing) return { statusCode: 404, body: JSON.stringify({ ok: false, error: 'Not found' }) };
    if (!isAdminAction) {
      const c = (existing.conseiller || '').toLowerCase();
      if (!c.includes(conseillerFilter)) return { statusCode: 403, body: JSON.stringify({ ok: false, error: 'Forbidden' }) };
    }
    await store.delete(body.id);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, id: body.id }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
}

// v200af — Wrapper qui ajoute les headers CORS à TOUTES les réponses
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};
function withCors(resp) {
  if (!resp) return resp;
  return {
    ...resp,
    headers: { ...CORS_HEADERS, ...(resp.headers || {}) }
  };
}

const innerHandler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      },
      body: ''
    };
  }
  const params = event.queryStringParameters || {};
  const action = (params.action || '').toLowerCase();
  // GET ?action=list → liste des parrainages
  if (event.httpMethod === 'GET' && action === 'list') return handleList(event);
  // GET ?action=debug-html → renvoie le HTML brut du mail parrain (debug)
  if (event.httpMethod === 'GET' && action === 'debug-html') return handleHtmlDebug(event);
  // GET ?action=env-debug → diagnostiquer ce que Netlify injecte (Bearer requis)
  if (event.httpMethod === 'GET' && action === 'env-debug') {
    const token = process.env.PARRAINAGE_ADMIN_TOKEN || '';
    const auth = event.headers.authorization || event.headers.Authorization || '';
    if (!token || auth !== `Bearer ${token}`) return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'Unauthorized' }) };
    const e = process.env;
    const masked = (v) => v ? `${v.slice(0,4)}…${v.slice(-3)} (len ${v.length})` : null;
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        hasBlobsContext: !!e.NETLIFY_BLOBS_CONTEXT,
        hasSiteID: !!(e.NETLIFY_SITE_ID || e.SITE_ID),
        hasAuthToken: !!(e.NETLIFY_AUTH_TOKEN || e.NETLIFY_API_TOKEN || e.NETLIFY_BLOBS_TOKEN),
        site: e.NETLIFY_SITE_ID || e.SITE_ID || null,
        blobsContextLen: e.NETLIFY_BLOBS_CONTEXT ? e.NETLIFY_BLOBS_CONTEXT.length : 0,
        netlifyKeys: Object.keys(e).filter(k => k.startsWith('NETLIFY') || k === 'SITE_ID' || k === 'DEPLOY_ID' || k === 'CONTEXT'),
        node: process.version
      })
    };
  }
  // POST ?action=rappels → scan parrainages et envoie les mails de relance J+45
  if (event.httpMethod === 'POST' && action === 'rappels') return handleRappels(event);
  // POST ?action=delete → suppression
  if (event.httpMethod === 'POST' && action === 'delete') return handleDelete(event);
  // v200x — Marquer un filleul comme contacté ou décocher
  if (event.httpMethod === 'POST' && action === 'mark-contacted') return handleMarkContacted(event);
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const env = process.env;
  // v200ao — MAIL_FROM toujours requis. Pour l'envoi, on accepte par ordre de priorité :
  //   1. BREVO_API_KEY (recommandé : validation domaine simple, 300 mails/jour gratuits)
  //   2. SMTP_HOST + SMTP_USER + SMTP_PASSWORD (SMTP direct via parisconseils.fr)
  //   3. RESEND_API_KEY (legacy)
  const missing = [];
  if (!env.MAIL_FROM) missing.push('MAIL_FROM');
  const hasBrevo  = !!env.BREVO_API_KEY;
  const hasSmtp   = !!(env.SMTP_HOST && env.SMTP_USER && (env.SMTP_PASSWORD || env.SMTP_PASS));
  const hasResend = !!env.RESEND_API_KEY;
  if (!hasBrevo && !hasSmtp && !hasResend) {
    missing.push('BREVO_API_KEY (recommandé) OR SMTP_HOST+SMTP_USER+SMTP_PASSWORD OR RESEND_API_KEY');
  }
  if (missing.length) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: 'Server not configured', missingEnv: missing })
    };
  }
  const dashboardEnabled = !!(env.PC_DASHBOARD_API_URL && env.PC_DASHBOARD_USER && env.PC_DASHBOARD_PASS);

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Invalid JSON' }) };
  }

  // v405-L99 — Normalisation STRICTE des prénoms/noms : jamais de vide, jamais de "undefined",
  // capitalisation propre (jean-pierre → Jean-Pierre, DUPONT → Dupont pour prénom / DUPONT conservé pour nom)
  function normalizePrenom(s) {
    const t = String(s == null ? '' : s).trim().replace(/\s+/g, ' ');
    if (!t || t.toLowerCase() === 'undefined' || t.toLowerCase() === 'null') return '';
    return t.toLowerCase().replace(/(^|[\s\-'])([a-zà-ÿ])/g, (m, sep, c) => sep + c.toUpperCase());
  }
  function normalizeNom(s) {
    const t = String(s == null ? '' : s).trim().replace(/\s+/g, ' ');
    if (!t || t.toLowerCase() === 'undefined' || t.toLowerCase() === 'null') return '';
    return t.toUpperCase();
  }
  const rawParrain = payload.parrain || {};
  const parrain = {
    ...rawParrain,
    prenom: normalizePrenom(rawParrain.prenom),
    nom: normalizeNom(rawParrain.nom),
    email: String(rawParrain.email || '').trim().toLowerCase(),
    tel: String(rawParrain.tel || '').trim()
  };
  const conseiller = (payload.conseiller || '').toString().trim() || 'Paris Conseils';
  const filleuls   = (Array.isArray(payload.filleuls) ? payload.filleuls.filter(f => f && (f.nom || f.prenom)) : [])
    .map(f => ({
      ...f,
      prenom: normalizePrenom(f.prenom),
      nom: normalizeNom(f.nom),
      email: String(f.email || '').trim().toLowerCase(),
      tel: String(f.tel || '').trim()
    }))
    // Un filleul doit avoir AU MOINS un prénom OU un nom valide après normalisation
    .filter(f => f.prenom || f.nom);

  if (!filleuls.length || !(parrain.email || parrain.nom)) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Données incomplètes (parrain + au moins 1 filleul requis)' }) };
  }

  // 1) Dashboard (best-effort, skip si non configuré)
  const dashboardResults = dashboardEnabled
    ? await postDashboard(env, parrain, conseiller, filleuls)
    : [];

  // 1bis) v200h — Stockage persistant en Netlify Blobs (toujours actif)
  // Génère un ID unique par parrainage et stocke l'enregistrement complet.
  const parrainageId = crypto.randomUUID();
  const record = {
    id: parrainageId,
    createdAt: new Date().toISOString(),
    parrain: {
      prenom: (parrain.prenom || '').trim(),
      nom: (parrain.nom || '').trim(),
      email: (parrain.email || '').trim(),
      tel: (parrain.tel || '').trim()
    },
    conseiller: (conseiller || 'Paris Conseils').trim(),
    filleuls: filleuls.map(f => ({
      prenom: (f.prenom || '').trim(),
      nom: (f.nom || '').trim(),
      email: (f.email || '').trim(),
      tel: (f.tel || '').trim(),
      message: (f.message || '').trim()
    })),
    nbFilleuls: filleuls.length,
    status: 'NOUVEAU',
    cumulPotentiel: cumulAt(filleuls.length)
  };
  const blobResult = await saveParrainageToBlobs(record);

  // 2) Emails
  const conseillerEmail = resolveConseillerEmail(env, conseiller);
  const total = cumulAt(filleuls.length);
  const bcc = env.MAIL_CC_OPS || null;
  const testRedirect = env.MAIL_TEST_REDIRECT || null;

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
      bcc,
      testRedirect
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
    bcc,
    testRedirect
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
        bcc,
        testRedirect
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
      parrainageId,
      blobs: blobResult,
      dashboard: { ok: allDashOk, count: dashboardResults.length, results: dashboardResults },
      mails:     { ok: allMailsOk, count: mailResults.length, results: mailResults }
    })
  };
};

// v200af — Wrap final pour garantir CORS sur TOUTES les réponses
exports.handler = async (event) => {
  try {
    const resp = await innerHandler(event);
    return withCors(resp);
  } catch (err) {
    return withCors({
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: 'Unhandled: ' + err.message })
    });
  }
};
