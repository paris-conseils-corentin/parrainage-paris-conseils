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
// TEMPLATES HTML — palette EXACTE du dashboard rip.parisconseils.fr
// v240 (24/08/2026) : Inter/Helvetica, palette CSS :root du dashboard RIP.
//   --navy #0a1e3f  --navy-2 #142d5a  --gold #b8860b  --gold-soft #d4a94a
//   --gold-tint #faf5e6  --bg #f7f8fb  --ink #0f172a  --ink-2 #334155
//   --muted #64748b  --line #e2e8f0  --success #059669  --success-soft #d1fae5
// Logo :  https://rip.parisconseils.fr/static/logo-blanc.png (fond navy)
// =====================================================================
const RIP_NAVY   = '#0a1e3f';
const RIP_NAVY2  = '#142d5a';
const RIP_GOLD   = '#b8860b';
const RIP_GOLDS  = '#d4a94a';
const RIP_GOLDT  = '#faf5e6';
const RIP_BG     = '#f7f5f0';   // gradient-start du dashboard
const RIP_BG2    = '#f2f4f8';   // gradient-end
const RIP_INK    = '#0f172a';
const RIP_INK2   = '#334155';
const RIP_MUTED  = '#64748b';
const RIP_LINE   = '#e2e8f0';
const RIP_SUCC   = '#059669';
const RIP_SUCCS  = '#d1fae5';
// v265 — Logo inline data URI PNG (5.8 KB, blanc sur fond navy). Zéro dépendance réseau : aucun email client ne bloquera le logo.
const RIP_LOGO   = process.env.MAIL_LOGO_URL || 'data:image/png;base64,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';

const escapeHtml = (s) => String(s||'').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

// Squelette style dashboard rip.parisconseils.fr : header navy avec logo blanc,
// filet doré, cards blanches, footer navy sobre.
function baseShell(opts) {
  const title    = opts && opts.title    ? opts.title    : 'Paris Conseils';
  const eyebrow  = opts && opts.eyebrow  ? opts.eyebrow  : '';
  const subtitle = opts && opts.subtitle ? opts.subtitle : '';
  const body     = opts && opts.body     ? opts.body     : '';
  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only"><title>${escapeHtml(title)}</title>
<!-- v265 — Force couleurs claires (empêche Apple Mail dark mode d'inverser le navy en lavande) -->
<style>
  :root { color-scheme: light only; supported-color-schemes: light only; }
  @media (prefers-color-scheme: dark) {
    .pc-header-navy { background-color: ${RIP_NAVY} !important; }
    .pc-navy-force { background-color: ${RIP_NAVY} !important; color: #ffffff !important; }
    .pc-white-force { color: #ffffff !important; }
  }
  /* Apple Mail (iOS/macOS) dark mode selector */
  [data-ogsc] .pc-header-navy, [data-ogsb] .pc-header-navy { background-color: ${RIP_NAVY} !important; }
</style>
</head>
<body style="margin:0;padding:0;background:${RIP_BG};font-family:Inter,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:${RIP_INK};font-size:15px;line-height:1.55;-webkit-font-smoothing:antialiased;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:${RIP_BG};padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="640" style="max-width:640px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 8px 30px rgba(10,30,63,0.08);border:1px solid ${RIP_LINE};">
        <!-- HEADER NAVY (v265 : classe pc-header-navy pour forcer navy en dark mode) -->
        <tr><td class="pc-header-navy" bgcolor="${RIP_NAVY}" style="background:${RIP_NAVY};background-color:${RIP_NAVY};padding:24px 32px;text-align:center;">
          <img src="${RIP_LOGO}" alt="Paris Conseils — Ingénierie financière & optimisation fiscale" width="260" height="104" style="display:block;height:auto;max-width:260px;width:100%;border:0;outline:none;text-decoration:none;margin:0 auto;">
        </td></tr>
        <!-- Filet doré -->
        <tr><td style="height:3px;background:${RIP_GOLD};line-height:0;font-size:0;">&nbsp;</td></tr>
        ${eyebrow ? `<tr><td style="padding:26px 34px 0 34px;">
          <div style="font-size:11px;letter-spacing:2.5px;color:${RIP_GOLD};font-weight:700;text-transform:uppercase;">${escapeHtml(eyebrow)}</div>
        </td></tr>` : ''}
        <tr><td style="padding:${eyebrow?'8':'26'}px 34px 0 34px;">
          <h1 style="font-family:'Cormorant Garamond',Georgia,serif;font-size:30px;font-weight:500;color:${RIP_NAVY};line-height:1.2;margin:0;">${escapeHtml(title)}</h1>
        </td></tr>
        ${subtitle ? `<tr><td style="padding:6px 34px 0 34px;">
          <div style="font-size:14px;color:${RIP_MUTED};">${escapeHtml(subtitle)}</div>
        </td></tr>` : ''}
        <tr><td style="padding:22px 34px 30px 34px;font-size:15px;line-height:1.6;color:${RIP_INK};">${body}</td></tr>
        <tr><td style="background:${RIP_NAVY};padding:22px 34px;text-align:center;font-size:12px;color:#c9d0dc;">
          <div style="margin-bottom:6px;color:${RIP_GOLDS};letter-spacing:1.5px;">Paris Conseils &middot; Ingénierie financière & optimisation fiscale</div>
          <div style="color:#94a0b8;">Confidentialité absolue &middot; Secret professionnel</div>
        </td></tr>
      </table>
      <div style="max-width:640px;padding:16px 12px 0;color:${RIP_MUTED};font-family:Inter,Helvetica,Arial,sans-serif;font-size:11px;text-align:center;">
        <a href="https://parrainage.parisconseils.fr" style="color:${RIP_MUTED};text-decoration:none;">parrainage.parisconseils.fr</a>
        &nbsp;&middot;&nbsp;
        <a href="mailto:contact@parisconseils.fr" style="color:${RIP_MUTED};text-decoration:none;">contact@parisconseils.fr</a>
      </div>
    </td></tr>
  </table>
</body></html>`;
}

// starsRow : ligne d'étoiles Euromillions (dorées / grises) style dashboard.
function starsRow(nLit) {
  const n = Math.max(0, Math.min(10, nLit|0));
  let html = '<div style="text-align:center;font-size:22px;letter-spacing:6px;line-height:1;margin:12px 0;">';
  for (let i = 0; i < 10; i++) {
    const color = i < n ? RIP_GOLD : '#cbd5e1';
    html += '<span style="color:'+color+';">'+(i < n ? '&#9733;' : '&#9734;')+'</span>';
  }
  return html + '</div>';
}

// v240 — Bloc explicatif des paliers, style card dashboard (fond doré très clair)
function blocExplicationPaliers(nbFilleulsApres) {
  const n = Math.max(0, Math.min(10, nbFilleulsApres|0));
  let titreEtape, corps;
  if (n === 0) {
    titreEtape = 'Bienvenue dans le programme';
    corps = `Vous n'avez encore transmis <b>aucun filleul</b>. Voici comment ça fonctionne :
      <ul style="margin:8px 0 4px 0;padding-left:20px;line-height:1.7;">
        <li><b>1<sup>er</sup> filleul</b> qui valide : <b>500 EUR</b></li>
        <li><b>2<sup>e</sup> filleul</b> qui valide : <b>+500 EUR</b> (1 000 EUR cumulés)</li>
        <li><b>3<sup>e</sup> filleul</b> qui valide : <b>1 500 EUR</b> + <b>rétroactivité de 1 000 EUR chacun</b> sur vos 2 premiers, soit <b>4 500 EUR</b> de cumul</li>
        <li>Du <b>4<sup>e</sup> au 10<sup>e</sup></b> : <b>+ 1 500 EUR</b> par filleul supplémentaire</li>
        <li><b>Plafond annuel</b> : 10 filleuls = <b>15 000 EUR</b></li>
      </ul>`;
  } else if (n === 1) {
    titreEtape = `Vous avez transmis 1 filleul`;
    corps = `Si ce filleul valide, vous recevez <b>500 EUR</b>. La suite :
      <ul style="margin:8px 0 4px 0;padding-left:20px;line-height:1.7;">
        <li><b>2<sup>e</sup> filleul</b> : <b>+500 EUR</b> (1 000 EUR cumulés)</li>
        <li><b>3<sup>e</sup> filleul</b> : <b>1 500 EUR</b> + rétroactivité 1 000 EUR chacun, soit <b>4 500 EUR</b> d'un coup</li>
        <li>Du <b>4<sup>e</sup> au 10<sup>e</sup></b> : <b>+ 1 500 EUR</b> par filleul</li>
        <li><b>Plafond annuel</b> : 15 000 EUR</li>
      </ul>`;
  } else if (n === 2) {
    titreEtape = `Vous avez transmis 2 filleuls`;
    corps = `Si ces 2 filleuls valident, vous touchez déjà <b>1 000 EUR</b>. Un 3<sup>e</sup> filleul change la donne :
      <ul style="margin:8px 0 4px 0;padding-left:20px;line-height:1.7;">
        <li>Vous touchez <b>1 500 EUR</b> sur le 3<sup>e</sup></li>
        <li>+ rétroactivité de <b>1 000 EUR chacun</b> sur vos 2 premiers (qui passent à 1 500 EUR chacun)</li>
        <li>Soit <b>4 500 EUR</b> au 3<sup>e</sup> filleul validé</li>
        <li>Puis <b>+ 1 500 EUR</b> par filleul supplémentaire (plafond 15 000 EUR)</li>
      </ul>`;
  } else {
    const totalActuel = 1500 * n;
    titreEtape = `Vous avez transmis ${n} filleuls`;
    corps = `Avec ${n} filleuls validés, vous êtes à <b>${totalActuel.toLocaleString('fr-FR')} EUR</b> (rétroactivité appliquée : vos 2 premiers sont à 1 500 EUR chacun, puis 1 500 EUR par filleul dès le 3<sup>e</sup>).
      <ul style="margin:8px 0 4px 0;padding-left:20px;line-height:1.7;">
        ${n < 10
          ? `<li>Chaque filleul supplémentaire qui valide : <b>+ 1 500 EUR</b></li><li><b>Plafond annuel</b> : 15 000 EUR (il vous reste ${10 - n} filleul${10-n>1?'s':''} possible${10-n>1?'s':''})</li>`
          : `<li>Vous avez atteint le <b>plafond annuel de 15 000 EUR</b>. Bravo !</li>`}
      </ul>`;
  }
  return `<div style="background:${RIP_GOLDT};border:1px solid ${RIP_GOLDS};border-radius:12px;padding:18px 22px;margin:20px 0;">
    <div style="font-size:11px;letter-spacing:2.5px;color:${RIP_GOLD};font-weight:700;text-transform:uppercase;margin-bottom:8px;">Où en êtes-vous ? · ${escapeHtml(titreEtape)}</div>
    <div style="font-size:14px;color:${RIP_INK2};">${corps}</div>
    <div style="margin-top:12px;padding-top:10px;border-top:1px dashed ${RIP_GOLDS};font-size:12px;color:${RIP_MUTED};text-align:center;">
      Programme valable jusqu'au <b style="color:${RIP_NAVY};">31 décembre 2026</b> — chaque année repart à zéro le 1<sup>er</sup> janvier.
    </div>
  </div>`;
}

function emailParrain({ parrain, conseiller, filleuls, total, nbFilleulsConfirmes }) {
  const nbConfirmes = (typeof nbFilleulsConfirmes === 'number') ? nbFilleulsConfirmes : 0;
  const nbApresAjout = nbConfirmes + filleuls.length;
  const triggersRetro = nbConfirmes < 3 && nbApresAjout >= 3;
  const conseillerNom = conseillerComplet(conseiller);
  const nb = filleuls.length;

  const filleulsAutorises = filleuls.map(f =>
    `  <li style="margin:4px 0;"><b>${escapeHtml(f.prenom)} ${escapeHtml(f.nom)}</b></li>`
  ).join('\n');

  const filleulsDetails = filleuls.map((f, i) => {
    const details = [];
    if (f.email) details.push(escapeHtml(f.email));
    if (f.tel)   details.push(escapeHtml(f.tel));
    const suffix = details.length ? `<div style="font-size:13px;color:${RIP_MUTED};margin-top:2px;">${details.join(' &middot; ')}</div>` : '';
    return `<tr><td style="padding:12px 0;border-bottom:1px solid ${RIP_LINE};">
      <div style="font-weight:600;color:${RIP_NAVY};font-size:15px;">${i+1}. ${escapeHtml(f.prenom)} ${escapeHtml(f.nom)}</div>${suffix}
    </td></tr>`;
  }).join('');

  const retroBlock = triggersRetro
    ? `<div style="background:${RIP_GOLDT};border:1px solid ${RIP_GOLDS};border-left:4px solid ${RIP_GOLD};border-radius:10px;padding:16px 20px;margin:20px 0;">
        <div style="font-size:11px;letter-spacing:2px;color:${RIP_GOLD};font-weight:700;text-transform:uppercase;margin-bottom:6px;">Effet rétroactif déclenché</div>
        <div style="font-size:15px;color:${RIP_NAVY};line-height:1.5;">Avec ce 3<sup>e</sup> filleul, vos 2 premières recommandations passent rétroactivement à <b>1&nbsp;500&nbsp;EUR chacune</b> (complément de 2&nbsp;000&nbsp;EUR).</div>
      </div>`
    : '';

  const body = `
<p style="margin:0 0 14px;">Bonjour ${escapeHtml(parrain.prenom)},</p>
<p style="margin:0 0 18px;">Nous avons bien reçu votre recommandation. <b>${nb} proche${nb>1?'s ont':' a'} été transmis</b> à votre conseiller <b>${escapeHtml(conseillerNom)}</b>, qui prendra contact avec chacun sous <b>48 heures</b>.</p>

<div style="background:${RIP_BG};border:1px solid ${RIP_LINE};border-radius:12px;padding:18px 22px;margin:18px 0;">
  <div style="font-size:11px;letter-spacing:2.5px;color:${RIP_GOLD};font-weight:700;text-transform:uppercase;margin-bottom:10px;">Personnes recommandées</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${filleulsDetails}</table>
</div>

<div style="background:${RIP_GOLDT};border:1px solid ${RIP_GOLDS};border-radius:12px;padding:18px 22px;margin:18px 0;">
  <div style="font-size:11px;letter-spacing:2.5px;color:${RIP_GOLD};font-weight:700;text-transform:uppercase;margin-bottom:8px;">Autorisation RGPD</div>
  <div style="font-size:14px;color:${RIP_INK2};line-height:1.5;">En soumettant ce formulaire, vous avez donné votre autorisation explicite à Paris Conseils pour contacter :
    <ul style="margin:8px 0 4px 0;padding-left:20px;">${filleulsAutorises}</ul>
  </div>
  <div style="font-size:12px;color:${RIP_MUTED};margin-top:10px;">Conforme RGPD. Retrait possible à tout moment à <a href="mailto:contact@parisconseils.fr" style="color:${RIP_NAVY};text-decoration:none;">contact@parisconseils.fr</a>.</div>
</div>

<div style="background:${RIP_NAVY};border-radius:12px;padding:20px 22px;margin:20px 0;text-align:center;">
  <div style="font-size:11px;letter-spacing:2.5px;color:${RIP_GOLDS};font-weight:700;text-transform:uppercase;margin-bottom:4px;">Votre progression</div>
  ${starsRow(Math.min(nbApresAjout,10))}
  <div style="font-family:'Cormorant Garamond',Georgia,serif;font-size:18px;color:${RIP_GOLDS};margin-top:4px;">${Math.min(nbApresAjout,10)} filleul${nbApresAjout>1?'s':''} sur 10</div>
</div>
${retroBlock}
${blocExplicationPaliers(nbApresAjout)}

<div style="background:${RIP_NAVY};border-radius:12px;padding:22px 24px;margin:20px 0;text-align:center;">
  <div style="font-size:11px;letter-spacing:2.5px;color:${RIP_GOLDS};font-weight:700;text-transform:uppercase;margin-bottom:6px;">Votre potentiel total</div>
  <div style="font-family:'Cormorant Garamond',Georgia,serif;font-size:34px;font-weight:600;color:${RIP_GOLDS};line-height:1;">${total.toLocaleString('fr-FR')}&nbsp;EUR</div>
  <div style="font-size:12px;color:#cdd5e5;margin-top:6px;font-style:italic;">selon les filleuls qui souscrivent · plafond 15 000 EUR / an</div>
</div>

<p style="text-align:center;margin:26px 0;">
  <a href="https://parrainage.parisconseils.fr/parrainage.html" style="display:inline-block;background:${RIP_NAVY};color:#fff;padding:14px 30px;text-decoration:none;border-radius:10px;font-weight:600;font-size:14px;letter-spacing:1px;">Recommander un nouveau filleul</a>
</p>

<p style="margin:20px 0 0;">Merci de votre confiance,<br><b style="color:${RIP_NAVY};">L'équipe Paris Conseils</b></p>`;

  return baseShell({
    title: `Recommandation bien reçue, merci ${escapeHtml(parrain.prenom)}`,
    eyebrow: `Parrainage · ${nb} filleul${nb>1?'s':''} transmis à ${escapeHtml(conseillerNom)}`,
    subtitle: `Conseiller ${escapeHtml(conseillerNom)} · contact sous 48 h`,
    body
  });
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
  const nb = filleuls.length;
  const contactBits = [];
  if (parrain.email) contactBits.push(`<a href="mailto:${escapeHtml(parrain.email)}" style="color:${RIP_NAVY};">${escapeHtml(parrain.email)}</a>`);
  if (parrain.tel)   contactBits.push(`<a href="tel:${escapeHtml(parrain.tel)}" style="color:${RIP_NAVY};">${escapeHtml(parrain.tel)}</a>`);
  const contactSuffix = contactBits.length ? ` (${contactBits.join(' &middot; ')})` : '';

  const body = `
<p style="margin:0 0 14px;">Bonjour <b>${escapeHtml(prenomCons)}</b>,</p>
<p style="margin:0 0 18px;">Nouvelle recommandation de <b>${escapeHtml(parrain.prenom)} ${escapeHtml(parrain.nom)}</b>${contactSuffix}.</p>

<div style="background:${RIP_GOLDT};border:1px solid ${RIP_GOLDS};border-left:4px solid ${RIP_GOLD};border-radius:12px;padding:18px 22px;margin:18px 0;">
  <div style="font-size:11px;letter-spacing:2.5px;color:${RIP_GOLD};font-weight:700;text-transform:uppercase;margin-bottom:8px;">À traiter sous 48 h</div>
  <div style="font-family:'Cormorant Garamond',Georgia,serif;font-size:26px;font-weight:600;color:${RIP_NAVY};line-height:1.25;">${nb} nouveau${nb>1?'x':''} filleul${nb>1?'s':''} à contacter</div>
  <div style="font-size:13px;color:${RIP_MUTED};margin-top:10px;line-height:1.55;">Pour des raisons de confidentialité (RGPD), les coordonnées des filleuls ne sont pas dans cet email. Connectez-vous au dashboard équipe pour consulter les détails complets et marquer chaque filleul comme contacté.</div>
</div>

<p style="text-align:center;margin:24px 0;">
  <a href="https://paris-conseils-dashboard.netlify.app/equipe.html" style="display:inline-block;background:${RIP_NAVY};color:#fff;padding:14px 30px;text-decoration:none;border-radius:10px;font-weight:600;font-size:14px;letter-spacing:1px;">Ouvrir le dashboard équipe</a>
</p>

<p style="margin:18px 0 0;font-size:13px;color:${RIP_MUTED};font-style:italic;text-align:center;">Le dashboard vous montre nom, email, téléphone, projet et statut de chaque filleul.</p>

<p style="margin:22px 0 0;">Merci de votre réactivité,<br><b style="color:${RIP_NAVY};">L'équipe Paris Conseils</b></p>`;
  return baseShell({
    title: 'Nouveau parrainage à traiter',
    eyebrow: `Notification conseiller · ${nb} filleul${nb>1?'s':''}`,
    subtitle: 'À traiter sous 48 h via le dashboard équipe',
    body
  });
}

function emailFilleul({ parrain, conseiller, filleul }) {
  const cleanCons = (conseiller || '').toString().trim();
  const lc = cleanCons.toLowerCase();
  const hasSpecific = lc && lc !== 'paris conseils' && lc !== 'paris-conseils';
  const map = { 'pereira':'David Pereira','moreau':'Nicolas Moreau','curtet':'Corentin Curtet',
    'david pereira':'David Pereira','nicolas moreau':'Nicolas Moreau','corentin curtet':'Corentin Curtet' };
  const conseillerDisplay = hasSpecific ? (map[lc] || cleanCons) : 'Un conseiller Paris Conseils';
  const slug = lc.indexOf('pereira')!==-1 || lc.indexOf('david')!==-1 ? 'david'
             : lc.indexOf('moreau')!==-1  || lc.indexOf('nicolas')!==-1 ? 'nicolas'
             : lc.indexOf('curtet')!==-1  || lc.indexOf('corentin')!==-1 ? 'corentin'
             : null;
  const contactPhrase = hasSpecific
    ? `<b>${escapeHtml(conseillerDisplay)}</b> prendra contact avec vous sous 48&nbsp;heures.`
    : `<b>${escapeHtml(conseillerDisplay)}</b> vous contactera dans les meilleurs d&eacute;lais.`;

  const rdvLine = slug
    ? `\n<p><b>Prendre rendez-vous en 1 clic</b> : choisissez le cr&eacute;neau qui vous arrange sur l'agenda de ${escapeHtml(conseillerDisplay)}. RDV t&eacute;l&eacute;phonique ou visio Google Meet, 30&nbsp;min, sans engagement.<br>
&raquo; <a href="https://parrainage.parisconseils.fr/rdv-${slug}.html"><b>Prendre rendez-vous</b></a></p>`
    : '';

  const rdvBlock = slug
    ? `<div style="background:${RIP_NAVY};border-radius:12px;padding:22px 24px;margin:20px 0;text-align:center;">
        <div style="font-size:11px;letter-spacing:2.5px;color:${RIP_GOLDS};font-weight:700;text-transform:uppercase;margin-bottom:10px;">Prenez rendez-vous en 1 clic</div>
        <div style="font-family:'Cormorant Garamond',Georgia,serif;font-size:22px;color:#fff;font-weight:600;line-height:1.3;margin-bottom:8px;">Faites connaissance avec ${escapeHtml(conseillerDisplay)}</div>
        <div style="font-size:14px;color:#cdd5e5;margin-bottom:18px;line-height:1.5;">Choisissez le créneau qui vous arrange sur son agenda.<br>RDV téléphonique ou visio Google Meet · 30 min · sans engagement.</div>
        <a href="https://parrainage.parisconseils.fr/rdv-${slug}.html" style="display:inline-block;background:${RIP_GOLDS};color:${RIP_NAVY};padding:14px 30px;text-decoration:none;border-radius:10px;font-weight:700;font-size:14px;letter-spacing:1px;">Prendre rendez-vous</a>
      </div>`
    : '';

  const body = `
<p style="margin:0 0 14px;">Bonjour ${escapeHtml(filleul.prenom)},</p>
<p style="margin:0 0 14px;"><b>${escapeHtml(parrain.prenom)} ${escapeHtml(parrain.nom)}</b> vous a recommandé auprès de Paris Conseils, cabinet d'<i>ingénierie financière et d'optimisation fiscale</i>.</p>
<p style="margin:0 0 18px;">Un proche qui prend le temps de vous recommander, c'est rarement anodin. Notre rôle est d'apporter à chacun de nos clients un <b>accompagnement sur-mesure</b>, dans la plus stricte confidentialité.</p>

<div style="background:${RIP_BG};border:1px solid ${RIP_LINE};border-radius:12px;padding:20px 24px;margin:18px 0;text-align:center;">
  <div style="font-size:11px;letter-spacing:2.5px;color:${RIP_GOLD};font-weight:700;text-transform:uppercase;margin-bottom:8px;">Votre interlocuteur</div>
  <div style="font-family:'Cormorant Garamond',Georgia,serif;font-size:26px;color:${RIP_NAVY};font-weight:600;">${escapeHtml(conseillerDisplay)}</div>
  <div style="font-size:13px;color:${RIP_MUTED};margin-top:6px;font-style:italic;">${hasSpecific ? 'prendra contact avec vous sous 48 heures' : 'vous contactera dans les meilleurs délais'}</div>
</div>

${rdvBlock}

<p style="margin:20px 0 14px;">${contactPhrase} Cette première conversation est <b>sans engagement</b> et strictement confidentielle. Elle sert à comprendre votre situation, vos objectifs, et à voir de quelle manière nous pouvons vous être utile.</p>

<p style="margin:20px 0 0;font-size:13px;color:${RIP_MUTED};">Si vous préférez ne pas être contacté, répondez simplement à cet email — nous respecterons votre choix immédiatement.</p>

<p style="margin:16px 0 0;">À très bientôt,<br><b style="color:${RIP_NAVY};">L'équipe Paris Conseils</b></p>`;
  return baseShell({
    title: `${escapeHtml(parrain.prenom)} vous recommande Paris Conseils`,
    eyebrow: 'Une recommandation pour vous',
    subtitle: 'Accompagnement confidentiel · ingénierie patrimoniale',
    body
  });
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
  const nextBlock = nextTierLabel
    ? `<div style="background:${RIP_GOLDT};border:1px solid ${RIP_GOLDS};border-left:4px solid ${RIP_GOLD};border-radius:12px;padding:16px 20px;margin:18px 0;">
        <div style="font-size:11px;letter-spacing:2.5px;color:${RIP_GOLD};font-weight:700;text-transform:uppercase;margin-bottom:6px;">Prochain palier</div>
        <div style="font-size:15px;color:${RIP_NAVY};line-height:1.5;">${nextTierLabel} pour atteindre <b>${nextTierExtra}</b>.</div>
      </div>`
    : '';
  const body = `
<p style="margin:0 0 14px;">Bonjour ${escapeHtml(parrain.prenom)},</p>
<p style="margin:0 0 18px;">Cela fait <b>${joursDepuis} jours</b> que votre premier proche est passé chez Paris Conseils via votre recommandation. Voici où vous en êtes :</p>

<div style="background:${RIP_NAVY};border-radius:12px;padding:20px 22px;margin:18px 0;text-align:center;">
  <div style="font-size:11px;letter-spacing:2.5px;color:${RIP_GOLDS};font-weight:700;text-transform:uppercase;margin-bottom:4px;">Votre progression actuelle</div>
  ${starsRow(Math.min(nbConfirmes,10))}
  <div style="font-family:'Cormorant Garamond',Georgia,serif;font-size:18px;color:${RIP_GOLDS};margin-top:4px;">${nbConfirmes} filleul${nbConfirmes>1?'s':''} sur 10 · ${currentTotal.toLocaleString('fr-FR')} EUR accumulés</div>
</div>
${nextBlock}
${blocExplicationPaliers(nbConfirmes)}

<p style="margin:18px 0;">Un proche en tête à qui parler de Paris Conseils ? C'est le bon moment de le partager — quelques minutes suffisent pour ajouter une recommandation.</p>

<p style="text-align:center;margin:24px 0;">
  <a href="https://parrainage.parisconseils.fr/parrainage.html" style="display:inline-block;background:${RIP_NAVY};color:#fff;padding:14px 30px;text-decoration:none;border-radius:10px;font-weight:600;font-size:14px;letter-spacing:1px;">Recommander un nouveau filleul</a>
</p>

<p style="margin:20px 0 0;">Au plaisir d'accueillir un nouveau proche,<br><b style="color:${RIP_NAVY};">L'équipe Paris Conseils${conseiller ? ` — ${escapeHtml(conseiller)}` : ''}</b></p>`;
  return baseShell({
    title: 'Continuez votre constellation',
    eyebrow: 'Rappel · vos paliers',
    subtitle: `${nbConfirmes} étoile${nbConfirmes>1?'s':''} déjà allumée${nbConfirmes>1?'s':''} · ${currentTotal.toLocaleString('fr-FR')} EUR`,
    body
  });
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

// v263 - Update filleul status (admin only via JWT ou admin token).
async function handleSetStatus(event) {
  const adminToken = process.env.PARRAINAGE_ADMIN_TOKEN || '';
  const proSecret  = process.env.PRO_JWT_SECRET || '';
  const authHdr = event.headers.authorization || event.headers.Authorization || '';
  const bearer = authHdr.startsWith('Bearer ') ? authHdr.slice(7) : '';
  let authOk = false, isAdmin = false;
  if (adminToken && bearer === adminToken) { authOk = true; isAdmin = true; }
  if (!authOk && proSecret && bearer) {
    try {
      const { verifyToken } = require('./pro-login');
      const payload = verifyToken(bearer, proSecret);
      if (payload && payload.r === 'admin') { authOk = true; isAdmin = true; }
    } catch (_e) {}
  }
  if (!authOk || !isAdmin) return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'Unauthorized (admin only)' }) };
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return { statusCode: 400, body: 'Invalid JSON' }; }
  const { id, filleulIndex, status, note } = body;
  if (!id) return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Missing id' }) };
  if (typeof filleulIndex !== 'number') return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Missing filleulIndex' }) };
  const ALLOWED = ['nouveau', 'contacte', 'signe', 'non-fructueux'];
  if (!ALLOWED.includes(status)) return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'invalid status. Allowed: ' + ALLOWED.join(', ') }) };
  try {
    const store = getBlobStore('parrainages');
    const record = await store.get(id, { type: 'json' });
    if (!record) return { statusCode: 404, body: JSON.stringify({ ok: false, error: 'Not found' }) };
    const filleuls = record.filleuls || [];
    if (filleulIndex < 0 || filleulIndex >= filleuls.length) return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Invalid filleulIndex' }) };
    const f = filleuls[filleulIndex];
    f.status = status;
    f.status_updated_at = new Date().toISOString();
    if (note !== undefined) f.status_note = String(note || '').slice(0, 500);
    if ((status === 'contacte' || status === 'signe' || status === 'non-fructueux') && !f.contactedAt) {
      f.contactedAt = new Date().toISOString();
    }
    record.filleuls = filleuls;
    await store.setJSON(record.id, record);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ ok: true, filleul: f }) };
  } catch (err) { return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) }; }
}

async function handleDelete(event) {
  // v250l - Accepte 2 auths : PARRAINAGE_ADMIN_TOKEN OU JWT pro role=admin.
  const adminToken = process.env.PARRAINAGE_ADMIN_TOKEN || '';
  const proSecret  = process.env.PRO_JWT_SECRET || '';
  const authHdr = event.headers.authorization || event.headers.Authorization || '';
  const bearer = authHdr.startsWith('Bearer ') ? authHdr.slice(7) : '';
  let authOk = false;
  let isAdmin = false;
  if (adminToken && bearer === adminToken) { authOk = true; isAdmin = true; }
  if (!authOk && proSecret && bearer) {
    try {
      const { verifyToken } = require('./pro-login');
      const payload = verifyToken(bearer, proSecret);
      if (payload && payload.r === 'admin') { authOk = true; isAdmin = true; }
    } catch (_e) {}
  }
  if (!authOk || !isAdmin) return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'Unauthorized (admin only)' }) };
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return { statusCode: 400, body: 'Invalid JSON' }; }
  if (!body.id) return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Missing id' }) };
  try {
    const store = getBlobStore('parrainages');
    const existing = await store.get(body.id, { type: 'json' });
    if (!existing) return { statusCode: 404, body: JSON.stringify({ ok: false, error: 'Not found' }) };
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
  // v263 - update filleul status
  if (event.httpMethod === 'POST' && action === 'set-status') return handleSetStatus(event);
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

  // v250l — ANTI-SPAM / ANTI-FRAUDE (rejette bots + fake data typique).
  const spamReasons = [];
  const KNOWN_CONSEILLERS = ['paris conseils','corentin','curtet','david','pereira','nicolas','moreau'];
  const RISK_TLD = /\.(ru|tk|ml|ga|cf)$/i;
  const FAKE_PHONE = /\(?\s*(202|555|800)\s*\)?\s*[-\s]?\s*555\s*[-\s]?\s*\d{4}/;
  const conLc = conseiller.toLowerCase().trim();
  if (!KNOWN_CONSEILLERS.some(c => conLc.includes(c) || c.includes(conLc))) spamReasons.push('conseiller inconnu');
  if (parrain.prenom && parrain.nom && parrain.prenom.toLowerCase() === parrain.nom.toLowerCase()) spamReasons.push('parrain prenom=nom');
  if (parrain.email && RISK_TLD.test(parrain.email)) spamReasons.push('parrain tld risque');
  if (parrain.tel && FAKE_PHONE.test(parrain.tel)) spamReasons.push('parrain tel factice');
  for (const f of filleuls) {
    if (parrain.email && f.email && parrain.email === f.email) { spamReasons.push('email parrain=filleul'); break; }
    if (parrain.prenom && parrain.nom && f.prenom && f.nom && parrain.prenom.toLowerCase() === f.prenom.toLowerCase() && parrain.nom.toLowerCase() === f.nom.toLowerCase()) { spamReasons.push('nom complet parrain=filleul'); break; }
    if (f.prenom && f.nom && f.prenom.toLowerCase() === f.nom.toLowerCase()) { spamReasons.push('filleul prenom=nom'); break; }
    if (f.email && RISK_TLD.test(f.email)) { spamReasons.push('filleul tld risque'); break; }
    if (f.tel && FAKE_PHONE.test(f.tel)) { spamReasons.push('filleul tel factice'); break; }
  }
  if (spamReasons.length) {
    try {
      const spamStore = getBlobStore('parrainages-spam');
      await spamStore.setJSON(crypto.randomUUID(), {
        rejectedAt: new Date().toISOString(),
        ip: event.headers['x-forwarded-for'] || event.headers['client-ip'] || null,
        userAgent: event.headers['user-agent'] || null,
        reasons: spamReasons,
        parrain, conseiller, filleuls
      });
    } catch (_e) {}
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Soumission refusee. Contactez contact@parisconseils.fr si besoin.' }) };
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

  // v264 — Mode d'envoi mail (admin manual add uniquement) :
  //   'both'         (défaut historique) → parrain + conseiller + filleul(s)
  //   'parrain-only' → parrain + conseiller SEULEMENT (filleul déjà contacté hors programme)
  //   'none'         → conseiller seulement (silencieux côté client)
  const rawMode = (payload && payload.emailMode) || 'both';
  const emailMode = ['both','parrain-only','none'].includes(rawMode) ? rawMode : 'both';
  const sendToParrain = emailMode === 'both' || emailMode === 'parrain-only';
  const sendToFilleul = emailMode === 'both';
  // Note : le conseiller reçoit toujours sa notif interne, quel que soit le mode.

  // Email parrain
  if (parrain.email && sendToParrain) {
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

  // Email conseiller (toujours)
  mailJobs.push(sendEmail({
    apiKey: env.RESEND_API_KEY,
    from: env.MAIL_FROM,
    to: conseillerEmail,
    subject: `Nouveau parrainage — ${parrain.prenom || ''} ${parrain.nom || ''} (${filleuls.length} filleul${filleuls.length>1?'s':''}) [mode: ${emailMode}]`,
    html: emailConseiller({ parrain, conseiller, filleuls }),
    replyTo: parrain.email || undefined,
    bcc,
    testRedirect
  }).then(r => ({ kind:'conseiller', to: conseillerEmail, ...r })));

  // Email filleul (un par filleul ayant un email) — désactivé si mode ≠ 'both'
  if (sendToFilleul) {
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
