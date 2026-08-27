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
// v268 — VRAI logo Paris Conseils (PDF officiel) qualité HD 400x283 JPEG blanc sur navy inline.
const RIP_LOGO   = process.env.MAIL_LOGO_URL || 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQIAnQCdAAD/2wBDAAQDAwMDAgQDAwMEBAQFBgoGBgUFBgwICQcKDgwPDg4MDQ0PERYTDxAVEQ0NExoTFRcYGRkZDxIbHRsYHRYYGRj/2wBDAQQEBAYFBgsGBgsYEA0QGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBj/wAARCAEbAZADAREAAhEBAxEB/8QAHAABAAICAwEAAAAAAAAAAAAAAAUGBAcCAwgB/8QASRAAAQQBAgQDBQUEBwUGBwAAAQACAwQFBhEHEiExCBNBFCJRYXEVMoGRoRYjUtEXM0JicrHBdIKSs9IJJENTsuE2NzhkhcLx/8QAGgEBAAMBAQEAAAAAAAAAAAAAAAMEBQIBBv/EADQRAQACAgEDAQUHAwQDAQAAAAABAgMRBBIhMQUTFEFRcSIyM2GBkaEVQlIjwdHwJDSx4f/aAAwDAQACEQMRAD8A1ivtnyIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgyqWNyOSl8rH0LNp/8MEZef0C5tetfvTp1WlrfdjazVeFev7bA+LTdlrT6yuaz9Cd1Xnm4Y/uTxw80/2uvIcMtd4yu6e1pu2Y2jcuh2l2/BpJXteZht2izy3Ey17zVVHNc1xa4EEHYg9wrKu+ICAgICAgICAgICAgICAgICAgICAg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W+rdNaut5At1pLBRsBjmUzgmc7Sxo2BmB5ju4dz8VFx8GTFEfY7x8d/7Jc2amTcdfafyanqt98uWjZn0hk25eSsIweru/wBFxSO+0l51GkepUIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIMmt6rizuhd385o9OVMfgv5Yy7cCAgIOccUkpIjYXbd9vT6ryZiPL2ImfA9gZ05w4+vL2/NInZMacF68EBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBBk1vVcWd0ZU1U2IwWEB47b+q4rbSS1OrwxHUbbT1rvP0G6ki9fmimlvk+sx96Q7MqSn/dK8nJWPi9jHafgyhhLTGc9uSGqz4yvG/wCQXPtonx3dRhn+7s63HF1ukYkuP/id7jPy7n9F7HXPns8+xX82NNammHK4hrB2jYOVo/BdRWIczaZdK6ciAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOyOUxntuF5MbexOmbFkWMHWN34FRzjlLGWHf9u8g2jr7/AOJy59j85e+214h0y5zISAhkgiB/gGx/NdRhrDmc1pR75JJXl8j3PcfVx3KkiIjwjmZny4r14ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICD/9k=';

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
