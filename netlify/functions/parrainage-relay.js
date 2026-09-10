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
// build-stamp: 2026-09-10-v286-SIGNATURE-OTP
const BUILD_STAMP = '2026-09-10-v286-SIGNATURE-OTP';
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
// v269 — Retour au logo hébergé sur rip.parisconseils.fr (celui qui fonctionne parfaitement dans les mails RIP existants).
const RIP_LOGO   = process.env.MAIL_LOGO_URL || 'https://rip.parisconseils.fr/static/logo-blanc.png';

const escapeHtml = (s) => String(s||'').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

// Squelette style dashboard rip.parisconseils.fr : header navy avec logo blanc,
// filet doré, cards blanches, footer navy sobre.
// ═══════════════════════════════════════════════════════════════════════════
// v277 — Templates mails parrainage alignés sur les mails RIP (rip.parisconseils.fr)
// Tailles calées sur le mail "C'est confirmé" : H1 Cormorant 700 30px · hero 26px ·
// corps 14.5px #1a1a1a · eyebrow 11.5px · CTA 15px. Dark-mode Apple Mail : PNG bg.
// Parrain : historique année + paliers + rétroactivité + 31 décembre.
// Filleul : planning conseiller + frise couleur A+→G− (moyenne nationale / vous) + RIP.
// ═══════════════════════════════════════════════════════════════════════════
const PX_NAVY_PNG  = "url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQI12PgkrP/DwACBAFndrNaSAAAAABJRU5ErkJggg==')";
const PX_GOLD_PNG  = "url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQI12O4wbnyPwAFTQKC2LnHrgAAAABJRU5ErkJggg==')";
const PX_WHITE_PNG = "url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQI12P4//8/AwAI/AL+XJ/PMAAAAABJRU5ErkJggg==')";
const PX_NAVY_ATTR  = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQI12PgkrP/DwACBAFndrNaSAAAAABJRU5ErkJggg==';
const PX_WHITE_ATTR = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQI12P4//8/AwAI/AL+XJ/PMAAAAABJRU5ErkJggg==';
const RIP_CREAM      = '#faf5e6';
const RIP_CREAM_LINE = '#e8d9b5';
const RIP_TEXT       = '#1a1a1a';
const RIP_TEXT_SOFT  = '#4a5568';
const FONT_BODY  = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const FONT_SERIF = "'Cormorant Garamond',Georgia,'Times New Roman',serif";
// Note moyenne nationale affichée sur la frise (lettre A..G). Variable Netlify RIP_NOTE_MOYENNE.
const RIP_NOTE_MOYENNE_LABEL = (process.env.RIP_NOTE_MOYENNE || 'D+').toString().trim().toUpperCase();
const RIP_NOTE_MOYENNE = RIP_NOTE_MOYENNE_LABEL.charAt(0);

function baseShell(opts) {
  const title    = opts && opts.title    ? opts.title    : 'Paris Conseils';
  const eyebrow  = opts && opts.eyebrow  ? opts.eyebrow  : '';
  const body     = opts && opts.body     ? opts.body     : '';
  const whiteTd = `class="pc-white-card" bgcolor="#ffffff" background="${PX_WHITE_ATTR}"`;
  const whiteStyle = `background:#ffffff;background-color:#ffffff;background-image:${PX_WHITE_PNG};background-repeat:repeat;`;
  return `<!DOCTYPE html>
<html lang="fr"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(title)}</title>
<style type="text/css">
  :root { color-scheme: light; supported-color-schemes: light; }
  a { color:${RIP_GOLD}; }
  @media (prefers-color-scheme: dark) {
    .pc-navy-bg { background-color:${RIP_NAVY} !important; background-image:${PX_NAVY_PNG} !important; }
    .pc-white-card { background-color:#ffffff !important; background-image:${PX_WHITE_PNG} !important; }
    .pc-cream { background-color:${RIP_CREAM} !important; }
    .pc-navy-text { color:${RIP_NAVY} !important; }
    .pc-text { color:${RIP_TEXT} !important; }
    .pc-gold-text { color:${RIP_GOLD} !important; }
    .pc-white-text { color:#ffffff !important; }
  }
  [data-ogsc] .pc-navy-bg { background-color:${RIP_NAVY} !important; }
  [data-ogsc] .pc-white-card { background-color:#ffffff !important; }
  [data-ogsc] .pc-navy-text { color:${RIP_NAVY} !important; }
  [data-ogsc] .pc-text { color:${RIP_TEXT} !important; }
</style>
</head>
<body class="pc-text" style="margin:0;padding:0;background:${RIP_BG};font-family:${FONT_BODY};color:${RIP_TEXT};font-size:14.5px;line-height:1.6;-webkit-font-smoothing:antialiased;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:${RIP_BG};padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="620" ${whiteTd} style="max-width:620px;${whiteStyle}border-radius:14px;overflow:hidden;border:1px solid ${RIP_LINE};">
        <tr><td class="pc-navy-bg" bgcolor="${RIP_NAVY}" background="${PX_NAVY_ATTR}" style="background:${RIP_NAVY};background-color:${RIP_NAVY};background-image:${PX_NAVY_PNG};background-repeat:repeat;padding:28px 32px;text-align:center;">
          <img src="${RIP_LOGO}" alt="Paris Conseils — Ingénierie financière & optimisation fiscale" width="240" height="96" style="display:block;height:auto;max-width:240px;width:100%;border:0;outline:none;text-decoration:none;margin:0 auto;">
        </td></tr>
        <tr><td bgcolor="${RIP_GOLD}" style="height:3px;background:${RIP_GOLD};background-color:${RIP_GOLD};background-image:${PX_GOLD_PNG};line-height:0;font-size:0;">&nbsp;</td></tr>
        <tr><td ${whiteTd} style="${whiteStyle}padding:30px 38px 0 38px;">
          ${eyebrow ? `<div class="pc-gold-text" style="font-family:${FONT_BODY};font-size:11.5px;letter-spacing:2px;color:${RIP_GOLD};font-weight:700;text-transform:uppercase;margin:0 0 8px;">${eyebrow}</div>` : ''}
          <h1 class="pc-navy-text" style="font-family:${FONT_SERIF};font-size:30px;font-weight:700;color:${RIP_NAVY};line-height:1.15;margin:0 0 20px;">${title}</h1>
        </td></tr>
        <tr><td ${whiteTd} class="pc-white-card pc-text" style="${whiteStyle}padding:0 38px 32px 38px;font-family:${FONT_BODY};font-size:14.5px;line-height:1.65;color:${RIP_TEXT};">${body}</td></tr>
        <tr><td class="pc-navy-bg" bgcolor="${RIP_NAVY}" background="${PX_NAVY_ATTR}" style="background:${RIP_NAVY};background-color:${RIP_NAVY};background-image:${PX_NAVY_PNG};background-repeat:repeat;padding:20px 32px;text-align:center;font-family:${FONT_BODY};font-size:11.5px;">
          <div style="color:${RIP_GOLDS};letter-spacing:1.5px;margin-bottom:5px;">Paris Conseils &middot; Ingénierie financière & optimisation fiscale</div>
          <div style="color:#94a0b8;">Confidentialité absolue &middot; Secret professionnel</div>
        </td></tr>
      </table>
      <div style="max-width:620px;padding:14px 12px 0;color:${RIP_MUTED};font-family:${FONT_BODY};font-size:11px;text-align:center;">
        <a href="https://parrainage.parisconseils.fr" style="color:${RIP_MUTED};text-decoration:none;">parrainage.parisconseils.fr</a>
        &nbsp;&middot;&nbsp;
        <a href="mailto:contact@parisconseils.fr" style="color:${RIP_MUTED};text-decoration:none;">contact@parisconseils.fr</a>
      </div>
    </td></tr>
  </table>
</body></html>`;
}

// ── Briques RIP ──────────────────────────────────────────────────────────────
function p(html, extra) {
  return `<p style="margin:0 0 14px;font-family:${FONT_BODY};font-size:14.5px;line-height:1.65;color:${RIP_TEXT};${extra||''}">${html}</p>`;
}
function pSoft(html, extra) {
  return `<p style="margin:0 0 14px;font-family:${FONT_BODY};font-size:13.5px;line-height:1.6;color:${RIP_TEXT_SOFT};${extra||''}">${html}</p>`;
}
function heroCream(eyebrow, headline, note) {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:4px 0 20px;">
    <tr><td class="pc-cream" bgcolor="${RIP_CREAM}" style="background:${RIP_CREAM};background-color:${RIP_CREAM};border:1px solid ${RIP_CREAM_LINE};border-radius:12px;padding:20px 24px;text-align:center;">
      <div class="pc-gold-text" style="font-family:${FONT_BODY};font-size:11.5px;letter-spacing:2px;color:${RIP_GOLD};font-weight:700;text-transform:uppercase;margin-bottom:10px;">${eyebrow}</div>
      <div class="pc-navy-text" style="font-family:${FONT_SERIF};font-size:26px;line-height:1.2;color:${RIP_NAVY};font-weight:700;">${headline}</div>
      ${note ? `<div style="font-family:${FONT_BODY};font-size:13.5px;color:${RIP_TEXT_SOFT};margin-top:8px;line-height:1.5;">${note}</div>` : ''}
    </td></tr>
  </table>`;
}
function goldBadge(label) {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:22px auto 12px;">
    <tr><td class="pc-cream" bgcolor="${RIP_CREAM}" style="background:${RIP_CREAM};border:1px solid ${RIP_GOLDS};border-radius:999px;padding:8px 18px;font-family:${FONT_BODY};font-size:11px;letter-spacing:2px;color:${RIP_GOLD};font-weight:700;text-transform:uppercase;white-space:nowrap;">${label}</td></tr>
  </table>`;
}
function h2Serif(text) {
  return `<div class="pc-navy-text" style="font-family:${FONT_SERIF};font-size:24px;font-weight:700;color:${RIP_NAVY};line-height:1.2;text-align:center;margin:0 0 12px;">${text}</div>`;
}
function ctaNavy(href, label) {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:4px 0 20px;">
    <tr><td align="center">
      <a href="${href}" class="pc-white-text" style="display:inline-block;background:${RIP_NAVY};background-color:${RIP_NAVY};color:#ffffff;padding:14px 36px;text-decoration:none;border-radius:10px;font-family:${FONT_BODY};font-weight:700;font-size:15px;line-height:1.2;">${label}</a>
    </td></tr>
  </table>`;
}
function infoBeige(html) {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:6px 0 0;">
    <tr><td class="pc-cream" bgcolor="${RIP_CREAM}" style="background:${RIP_CREAM};background-color:${RIP_CREAM};border:1px solid ${RIP_CREAM_LINE};border-radius:10px;padding:16px 20px;font-family:${FONT_BODY};font-size:13.5px;color:${RIP_TEXT};line-height:1.65;">${html}</td></tr>
  </table>`;
}
function signature(closing) {
  return `<p style="margin:24px 0 0;font-family:${FONT_BODY};font-size:14.5px;line-height:1.6;color:${RIP_TEXT};">${closing || 'À très bientôt'},<br><b class="pc-navy-text" style="color:${RIP_NAVY};">L'équipe Paris Conseils</b></p>`;
}

// Frise A+ → G− (7 cases colorées) avec marqueurs "Moyenne nationale" et "Vous ?"
function noteScale(avgLetter) {
  const scale = [
    { l:'A', c:'#1f7a4d' }, { l:'B', c:'#3a9a5a' }, { l:'C', c:'#8fbf3f' },
    { l:'D', c:'#e2b93b' }, { l:'E', c:'#e78f2e' }, { l:'F', c:'#d9562b' }, { l:'G', c:'#b3261e' }
  ];
  const avg = scale.findIndex(s => s.l === avgLetter);
  const cells = scale.map(s => `<td align="center" style="padding:0 2px;"><div style="background:${s.c};color:#ffffff;font-family:${FONT_BODY};font-weight:700;font-size:13px;line-height:30px;height:30px;border-radius:6px;">${s.l}</div></td>`).join('');
  const marks = scale.map((s,i) => {
    if (i === avg) return `<td align="center" style="padding:6px 2px 0;font-family:${FONT_BODY};font-size:10px;letter-spacing:1px;color:${RIP_TEXT_SOFT};text-transform:uppercase;line-height:1.3;">▲<br>Moyenne<br>nationale<br><b class="pc-navy-text" style="color:${RIP_NAVY};font-size:12px;">${escapeHtml(RIP_NOTE_MOYENNE_LABEL)}</b></td>`;
    return `<td style="padding:6px 2px 0;"></td>`;
  }).join('');
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:14px 0 6px;">
    <tr><td style="font-family:${FONT_BODY};font-size:11px;letter-spacing:1.5px;color:${RIP_TEXT_SOFT};text-transform:uppercase;padding-bottom:6px;">A+ profil exceptionnel</td><td align="right" style="font-family:${FONT_BODY};font-size:11px;letter-spacing:1.5px;color:${RIP_TEXT_SOFT};text-transform:uppercase;padding-bottom:6px;">G− profil très fragile</td></tr>
    <tr><td colspan="2"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>${cells}</tr><tr>${marks}</tr></table></td></tr>
    <tr><td colspan="2" align="center" style="padding-top:10px;font-family:${FONT_SERIF};font-size:20px;font-weight:700;color:${RIP_GOLD};">Et vous&nbsp;? <span class="pc-navy-text" style="color:${RIP_NAVY};">?</span></td></tr>
  </table>`;
}

// ── Helpers conseiller ───────────────────────────────────────────────────────
function conseillerPrenom(value) {
  const v = (value || '').toString().trim().toLowerCase();
  if (v.includes('pereira')) return 'David';
  if (v.includes('moreau'))  return 'Nicolas';
  if (v.includes('curtet'))  return 'Corentin';
  if (!v || v === 'paris conseils' || v === 'paris-conseils') return null;
  const parts = value.toString().trim().split(/\s+/);
  const first = parts[0] || '';
  return first ? (first.charAt(0).toUpperCase() + first.slice(1).toLowerCase()) : null;
}
function conseillerComplet(value) {
  const v = (value || '').toString().trim().toLowerCase();
  if (v.includes('pereira')) return 'David Pereira';
  if (v.includes('moreau'))  return 'Nicolas Moreau';
  if (v.includes('curtet'))  return 'Corentin Curtet';
  if (!v || v === 'paris conseils' || v === 'paris-conseils') return 'Paris Conseils';
  return value;
}
function conseillerSlugs(value) {
  const v = (value || '').toString().trim().toLowerCase();
  if (v.includes('pereira') || v.includes('david'))    return { rip:'david-pereira',   rdv:'david' };
  if (v.includes('moreau')  || v.includes('nicolas'))  return { rip:'nicolas-moreau',  rdv:'nicolas' };
  if (v.includes('curtet')  || v.includes('corentin')) return { rip:'corentin-curtet', rdv:'corentin' };
  return null;
}
const ordinal = (n) => n === 1 ? '1<sup>er</sup>' : `${n}<sup>e</sup>`;
const eur = (n) => `${Number(n).toLocaleString('fr-FR')}&nbsp;€`;

// ═══════════════════════════════════════════════════════════════════════════
// MAIL PARRAIN — accusé + historique + paliers + rétroactivité + 31 décembre
// ═══════════════════════════════════════════════════════════════════════════
function emailParrain({ parrain, conseiller, filleuls, total, nbAvant, nbApres }) {
  const consNom = conseillerComplet(conseiller);
  const nb = filleuls.length;
  const avant = Math.max(0, nbAvant | 0);
  const apres = Math.max(nb, nbApres | 0);
  const filleulsHtml = filleuls.map(f => `${escapeHtml(f.prenom)} ${escapeHtml(f.nom)}`).join('<br>');
  const premierPrenom = escapeHtml(filleuls[0] && filleuls[0].prenom || 'votre filleul');
  const year = new Date().getFullYear();

  // Prime de CE parrainage (marginale) et cumul si tout se concrétise
  const primeCe = cumulAt(apres) - cumulAt(avant);
  const cumulApres = cumulAt(apres);

  // Message d'étape selon le rang atteint
  let etape;
  if (apres === 1) {
    etape = `C'est votre <b>${ordinal(1)} parrainage</b> de l'année&nbsp;: <b>${eur(500)}</b> dès que ${premierPrenom} devient client. Au 2<sup>e</sup>, encore ${eur(500)}. Et au <b>3<sup>e</sup></b>, le programme change de dimension&nbsp;: <b>${eur(1500)}</b> pour le 3<sup>e</sup> <i>et</i> vos deux premiers sont revalorisés à ${eur(1500)} chacun — soit <b>${eur(4500)}</b> cumulés.`;
  } else if (apres === 2) {
    etape = `C'est votre <b>2<sup>e</sup> parrainage</b> de l'année&nbsp;: <b>${eur(500)}</b> supplémentaires dès que ${premierPrenom} devient client, soit ${eur(1000)} cumulés. <b>Au 3<sup>e</sup>, tout bascule&nbsp;:</b> ${eur(1500)} pour le 3<sup>e</sup> <i>et</i> vos deux premiers sont revalorisés rétroactivement à ${eur(1500)} chacun — <b>${eur(4500)}</b> cumulés d'un coup.`;
  } else if (apres === 3) {
    etape = `C'est votre <b>3<sup>e</sup> parrainage</b> de l'année — le palier qui change tout&nbsp;: <b>${eur(1500)}</b> pour celui-ci, et vos deux premiers sont revalorisés rétroactivement à ${eur(1500)} chacun. Soit <b>${eur(4500)}</b> cumulés si les trois se concrétisent. Ensuite, ${eur(1500)} par filleul supplémentaire.`;
  } else if (apres < 10) {
    etape = `C'est votre <b>${ordinal(apres)} parrainage</b> de l'année&nbsp;: <b>${eur(1500)}</b> de plus dès concrétisation, soit <b>${eur(cumulApres)}</b> cumulés. Il vous reste ${10 - apres} parrainage${10-apres>1?'s':''} possible${10-apres>1?'s':''} avant le plafond de ${eur(15000)}.`;
  } else {
    etape = `C'est votre <b>${ordinal(apres)} parrainage</b> de l'année&nbsp;: vous atteignez le <b>plafond de ${eur(15000)}</b>. Bravo.`;
  }

  const body = `
${p(`Bonjour ${escapeHtml(parrain.prenom)},`)}
${p(`Nous avons bien reçu votre recommandation. <b>${nb > 1 ? 'Vos proches ont' : premierPrenom + ' a'} été transmis</b> à <b>${escapeHtml(consNom)}</b>, qui prendra contact ${nb > 1 ? 'avec chacun' : 'avec lui'} sous <b>48&nbsp;heures</b>.`)}
${heroCream(nb > 1 ? 'Vos filleuls' : 'Votre filleul', filleulsHtml, `transmis à ${escapeHtml(consNom)}`)}
${heroCream(`Votre ${ordinal(apres)} parrainage ${year}`, `${eur(primeCe)} <span style="font-size:15px;font-weight:400;color:${RIP_TEXT_SOFT};">à recevoir</span>`, apres >= 3 ? `${eur(cumulApres)} cumulés si tous vos filleuls se concrétisent` : `${eur(cumulApres)} cumulés si tous vos filleuls se concrétisent · <b>${eur(4500)}</b> dès le 3<sup>e</sup>`)}
${p(etape)}
${pSoft(`Le montant final dépend des projets et des opérations réalisés avec chaque filleul. Le programme court jusqu'au <b>31&nbsp;décembre&nbsp;${year}</b>&nbsp;: le compteur repart à zéro le 1<sup>er</sup>&nbsp;janvier.`)}
${ctaNavy('https://parrainage.parisconseils.fr/parrainage.html', 'Recommander un autre proche')}
${infoBeige(`<b>Votre RIB&nbsp;:</b> pour le versement de votre prime, vous pourrez nous le communiquer à tout moment par simple retour de mail — aucune urgence, cela n'a aucun impact sur l'enregistrement de votre parrainage.<br><br><b>Confidentialité&nbsp;:</b> en soumettant cette recommandation, vous avez autorisé Paris Conseils à contacter ${nb > 1 ? 'les personnes ci-dessus' : premierPrenom}. Vous pouvez retirer cette autorisation à tout moment en écrivant à <a href="mailto:contact@parisconseils.fr" style="color:${RIP_NAVY};font-weight:600;">contact@parisconseils.fr</a>.`)}
${signature('Merci de votre confiance')}`;

  return baseShell({
    title: `Merci, ${escapeHtml(parrain.prenom)}`,
    eyebrow: `Votre ${ordinal(apres)} recommandation est bien reçue`,
    body
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIL CONSEILLER — notification interne + historique parrain
// ═══════════════════════════════════════════════════════════════════════════
function emailConseiller({ parrain, conseiller, filleuls, nbAvant, nbApres }) {
  const consPrenom = conseillerPrenom(conseiller) || 'cher conseiller';
  const nb = filleuls.length;
  const avant = Math.max(0, nbAvant | 0);
  const apres = Math.max(nb, nbApres | 0);
  const year = new Date().getFullYear();
  const filleulsHtml = filleuls.map(f => `${escapeHtml(f.prenom)} ${escapeHtml(f.nom)}`).join('<br>');
  const contact = [];
  if (parrain.email) contact.push(`<a href="mailto:${escapeHtml(parrain.email)}" style="color:${RIP_NAVY};font-weight:600;">${escapeHtml(parrain.email)}</a>`);
  if (parrain.tel)   contact.push(`<a href="tel:${escapeHtml(parrain.tel)}" style="color:${RIP_NAVY};font-weight:600;">${escapeHtml(parrain.tel)}</a>`);
  const histo = avant > 0
    ? `C'est son <b>${ordinal(apres)} parrainage ${year}</b> (${avant} déjà transmis cette année)${apres === 2 ? ' — au prochain, elle passe au palier rétroactif de 4&nbsp;500&nbsp;€' : ''}.`
    : `C'est son <b>premier parrainage ${year}</b>.`;

  const body = `
${p(`Bonjour ${escapeHtml(consPrenom)},`)}
${p(`<b>${escapeHtml(parrain.prenom)} ${escapeHtml(parrain.nom)}</b> vient de vous recommander <b>${nb} nouveau${nb>1?'x':''} filleul${nb>1?'s':''}</b>. ${histo}`)}
${heroCream('À contacter sous 48 heures', filleulsHtml, `recommandé${nb>1?'s':''} par ${escapeHtml(parrain.prenom)} ${escapeHtml(parrain.nom)}`)}
${p(`${nb > 1 ? 'Chaque filleul a' : 'Le filleul a'} reçu un e-mail lui proposant de <b>choisir un créneau sur votre planning</b> ou d'<b>obtenir sa note patrimoniale</b> sur votre lien RIP. Idéalement, appelez-${nb > 1 ? 'les' : 'le'} <b>sous 48&nbsp;heures</b>, même s'il n'a pas encore réagi.`)}
${ctaNavy('https://rip.parisconseils.fr/dashboard', 'Ouvrir mes recommandations')}
${infoBeige(`<b>Confidentialité RGPD&nbsp;:</b> les coordonnées des filleuls ne figurent pas dans cet e-mail. Retrouvez-les dans l'onglet <b>Recommandations</b> de votre dashboard rip.parisconseils.fr (nom, e-mail, téléphone, statut), où vous pouvez marquer chaque filleul comme contacté.${contact.length ? `<br><br><b>Parrain à remercier&nbsp;:</b> ${escapeHtml(parrain.prenom)} ${escapeHtml(parrain.nom)} — ${contact.join(' · ')}` : ''}`)}
${signature('Merci de votre réactivité')}`;

  return baseShell({
    title: `${nb} nouveau${nb>1?'x':''} filleul${nb>1?'s':''} à contacter`,
    eyebrow: `Nouvelle recommandation · ${ordinal(apres)} parrainage de ${escapeHtml(parrain.prenom)}`,
    body
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIL FILLEUL — annonce + planning conseiller + frise note patrimoniale (RIP)
// ═══════════════════════════════════════════════════════════════════════════
function emailFilleul({ parrain, conseiller, filleul }) {
  const consNom = conseillerComplet(conseiller);
  const consPrenom = conseillerPrenom(conseiller);
  const slugs = conseillerSlugs(conseiller);
  const hasCons = !!consPrenom;
  const ripHref = slugs ? `https://rip.parisconseils.fr/${slugs.rip}` : 'https://rip.parisconseils.fr/';
  const rdvHref = slugs ? `https://parrainage.parisconseils.fr/rdv-${slugs.rdv}.html` : null;
  const parrainNom = `${escapeHtml(parrain.prenom)} ${escapeHtml(parrain.nom)}`;
  const parrainPrenom = escapeHtml(parrain.prenom);

  const body = `
${p(`Bonjour ${escapeHtml(filleul.prenom)},`)}
${p(`<b>${parrainNom}</b> vous a recommandé auprès de Paris Conseils, cabinet d'<i>ingénierie financière et d'optimisation fiscale</i>.`)}
${p(`Un proche qui prend le temps de vous recommander, c'est rarement anodin. Notre rôle est d'apporter à chacun de nos clients un <b>accompagnement sur-mesure</b>, dans la plus stricte confidentialité.`)}
${heroCream('Votre interlocuteur', escapeHtml(consNom), hasCons ? 'prendra contact avec vous sous 48&nbsp;heures' : 'vous contactera dans les meilleurs délais')}
${rdvHref ? p(`Si vous souhaitez anticiper, vous pouvez consulter directement le planning de ${escapeHtml(consPrenom)} et choisir le moment où vous préférez être rappelé — en visioconférence ou par téléphone, une trentaine de minutes.`) : ''}
${rdvHref ? ctaNavy(rdvHref, `Consulter le planning de ${escapeHtml(consPrenom)}`) : ''}

${goldBadge('Avant votre rendez-vous')}
${h2Serif('Connaissez-vous votre note patrimoniale&nbsp;?')}
${p(`En <b>six minutes</b>, notre bilan en ligne évalue votre situation — endettement, épargne, patrimoine, protection de vos proches, fiscalité — et vous attribue une note de <b>A+</b> à <b>G−</b>. La moyenne nationale se situe à <b>${escapeHtml(RIP_NOTE_MOYENNE_LABEL)}</b>. Elle situe votre profil sans le juger, et permet à ${escapeHtml(consPrenom || 'votre conseiller')} de préparer votre échange sur du concret&nbsp;: vos points forts, vos leviers, ce qui peut être optimisé.`, 'text-align:center;')}
${noteScale(RIP_NOTE_MOYENNE)}
${ctaNavy(ripHref, 'Obtenir ma note patrimoniale')}
${pSoft(`Gratuit et confidentiel. ${hasCons ? `${escapeHtml(consNom)} est déjà sélectionné comme votre conseiller&nbsp;: vous validez simplement l'engagement de confidentialité par un code reçu par e-mail, puis vous répondez à l'essentiel.` : `Vous validez l'engagement de confidentialité par un code reçu par e-mail, puis vous répondez à l'essentiel.`}`, 'text-align:center;')}

${infoBeige(`<b>Aucun engagement, ni juridique ni financier.</b> Ce premier échange est une étude strictement confidentielle&nbsp;: comprendre votre situation et vos objectifs, et étalonner ce qui peut réellement vous être utile — optimisation fiscale, structuration de votre patrimoine, préparation d'un projet. ${parrainPrenom} a pensé à vous pour vous rendre service, pas pour vous engager. Si vous préférez ne pas être contacté, il vous suffit de répondre à cet e-mail.`)}
${signature()}`;

  return baseShell({
    title: `${parrainPrenom} vous recommande Paris Conseils`,
    eyebrow: 'Une recommandation pour vous',
    body
  });
}

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

// v277 — Compte les filleuls déjà transmis par ce parrain sur l'année civile en cours (blobs).
// Ignore le record courant (excludeId) et les records supprimés/refusés.
// v278 — Webhook vers le dashboard RIP (rip.parisconseils.fr). Best-effort, non bloquant.
// Activé si RIP_WEBHOOK_URL + RIP_WEBHOOK_SECRET sont définis dans Netlify.
// v284 — Le secret peut aussi être stocké dans le store Blobs `parrainages-config` (clé `rip-webhook`)
// via ?action=set-rip-secret : il est copié depuis les Réglages RIP sans jamais transiter en clair ailleurs.
let __ripConfigCache = null;
async function getRipConfig(env) {
  if (__ripConfigCache) return __ripConfigCache;
  let url = env.RIP_WEBHOOK_URL || null, secret = env.RIP_WEBHOOK_SECRET || null;
  if (!secret || !url) {
    try {
      const cfg = await getBlobStore('parrainages-config').get('rip-webhook', { type: 'json' });
      if (cfg) { if (!secret && cfg.secret) secret = cfg.secret; if (!url && cfg.url) url = cfg.url; }
    } catch (_e) { /* store absent : on reste sur l'env */ }
  }
  if (!url) url = 'https://rip.parisconseils.fr/api/parrainage/webhook';
  __ripConfigCache = { url, secret };
  return __ripConfigCache;
}
function ripPayloadFromRecord(record, extra) {
  const ripSlugs = conseillerSlugs(record.conseiller);
  return Object.assign({
    event: 'parrainage.created',
    id: record.id,
    createdAt: record.createdAt,
    conseiller: conseillerComplet(record.conseiller),
    conseillerSlug: ripSlugs ? ripSlugs.rip : null,
    parrain: record.parrain,
    filleuls: record.filleuls,
    nbFilleuls: record.nbFilleuls || (record.filleuls || []).length,
    status: record.status,
    source: 'parrainage.parisconseils.fr'
  }, extra || {});
}
async function notifyRipDashboard(env, payloadObj, eventName) {
  const cfg = await getRipConfig(env);
  if (!cfg.secret) return { skipped: true, reason: 'secret RIP absent (RIP_WEBHOOK_SECRET ou ?action=set-rip-secret)' };
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(cfg.url, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'X-Parrainage-Secret': cfg.secret, 'X-Parrainage-Event': eventName || 'parrainage.created' },
      body: JSON.stringify(payloadObj)
    });
    clearTimeout(t);
    let bodyTxt = ''; try { bodyTxt = (await r.text()).slice(0, 300); } catch (_e) {}
    return { ok: r.ok, status: r.status, body: bodyTxt };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

// v284 — Enregistrer le secret du webhook RIP côté relay (admin). Body { secret, url? }.
// La réponse ne renvoie jamais le secret : seulement sa longueur et une empreinte courte.
async function handleSetRipSecret(event) {
  if (!isAdminEvent(event)) return jsonResp(401, { ok: false, error: 'Unauthorized (admin only)' });
  let body; try { body = JSON.parse(event.body || '{}'); } catch (e) { return jsonResp(400, { ok: false, error: 'Invalid JSON' }); }
  const secret = String(body.secret || '').trim();
  if (secret.length < 16) return jsonResp(400, { ok: false, error: 'Secret trop court (16 caractères minimum).' });
  const url = String(body.url || '').trim() || 'https://rip.parisconseils.fr/api/parrainage/webhook';
  if (!/^https:\/\/rip\.parisconseils\.fr\//.test(url)) return jsonResp(400, { ok: false, error: 'URL webhook non autorisée.' });
  try {
    await getBlobStore('parrainages-config').setJSON('rip-webhook', { secret, url, updatedAt: new Date().toISOString() });
    __ripConfigCache = null;
    const fp = crypto.createHash('sha256').update(secret).digest('hex').slice(0, 8);
    return jsonResp(200, { ok: true, length: secret.length, fingerprint: fp, url });
  } catch (err) { return jsonResp(500, { ok: false, error: err.message }); }
}

// v284 — Re-pousser vers le RIP tous les parrainages (ou un seul : body { id }). Idempotent côté RIP (INSERT OR IGNORE sur id).
async function handleRipResync(event) {
  if (!isAdminEvent(event)) return jsonResp(401, { ok: false, error: 'Unauthorized (admin only)' });
  let body; try { body = JSON.parse(event.body || '{}'); } catch (e) { body = {}; }
  try {
    const env = process.env;
    const cfg = await getRipConfig(env);
    if (!cfg.secret) return jsonResp(400, { ok: false, error: 'Secret RIP absent : utilisez ?action=set-rip-secret d\'abord.' });
    const store = getBlobStore('parrainages');
    const listing = await store.list();
    const results = [];
    for (const blob of (listing.blobs || [])) {
      if (body.id && blob.key !== body.id) continue;
      const r = await store.get(blob.key, { type: 'json' });
      if (!r || !r.parrain) continue;
      const st = String(r.status || '').toUpperCase();
      if (['SUPPRIME', 'REFUSE', 'SPAM', 'DELETED'].includes(st)) continue;
      const res = await notifyRipDashboard(env, ripPayloadFromRecord(r, { histo: r.histo || null, resync: true, historique: true }), 'parrainage.created');
      results.push({ id: r.id.slice(0, 8), parrain: `${r.parrain.prenom || ''} ${r.parrain.nom || ''}`.trim(), ok: !!res.ok, status: res.status, error: res.error, body: res.body });
    }
    return jsonResp(200, { ok: results.every(x => x.ok), count: results.length, url: cfg.url, results });
  } catch (err) { return jsonResp(500, { ok: false, error: err.message }); }
}

// v284 — Auto-diagnostic. GET ?action=ping (public, aucun secret exposé) : version, Blobs, fournisseur mail, config RIP.
async function handlePing() {
  const env = process.env;
  const out = { ok: true, build: BUILD_STAMP, at: new Date().toISOString(), checks: {} };
  try { const st = getBlobStore('parrainages'); const l = await st.list(); out.checks.blobs = { ok: true, records: (l.blobs || []).length }; }
  catch (e) { out.ok = false; out.checks.blobs = { ok: false, error: e.message }; }
  try {
    if (env.RESEND_API_KEY) {
      const r = await fetch('https://api.resend.com/domains', { headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY } });
      const j = await r.json().catch(() => ({}));
      const doms = Array.isArray(j.data) ? j.data.map(d => ({ name: d.name, status: d.status })) : [];
      const okDom = doms.some(d => /parisconseils\.fr$/.test(d.name) && d.status === 'verified');
      out.checks.mail = { ok: r.ok && okDom, provider: 'resend', http: r.status, domains: doms };
      if (!(r.ok && okDom)) out.ok = false;
    } else if (env.BREVO_API_KEY) { out.checks.mail = { ok: true, provider: 'brevo (non vérifié)' }; }
    else { out.ok = false; out.checks.mail = { ok: false, error: 'aucun fournisseur mail configuré' }; }
  } catch (e) { out.ok = false; out.checks.mail = { ok: false, error: e.message }; }
  try { const cfg = await getRipConfig(env); out.checks.rip = { configured: !!cfg.secret, url: cfg.url, source: env.RIP_WEBHOOK_SECRET ? 'env' : (cfg.secret ? 'blobs' : null) }; }
  catch (e) { out.checks.rip = { configured: false, error: e.message }; }
  out.checks.env = { MAIL_FROM: !!env.MAIL_FROM, PARRAINAGE_ADMIN_TOKEN: !!env.PARRAINAGE_ADMIN_TOKEN, PRO_JWT_SECRET: !!env.PRO_JWT_SECRET, MAIL_CC_OPS: !!env.MAIL_CC_OPS };
  if (!env.MAIL_FROM || !env.PARRAINAGE_ADMIN_TOKEN || !env.PRO_JWT_SECRET) out.ok = false;
  return jsonResp(out.ok ? 200 : 503, out);
}

// v284 — Contrôle complet du parcours (admin, lancé chaque jour par parrainage-healthcheck) :
// pages servies + intégrité du script du formulaire + ping. Mail d'alerte à Corentin si quelque chose casse ;
// le lundi, un court « tout va bien » pour prouver que la surveillance tourne.
const SITE_URL = process.env.URL && /^https:\/\/parrainage\./.test(process.env.URL) ? process.env.URL : 'https://parrainage.parisconseils.fr';
async function handleHealthcheck(event) {
  if (!isAdminEvent(event)) return jsonResp(401, { ok: false, error: 'Unauthorized (admin only)' });
  const env = process.env;
  const problems = [];
  const pages = {};
  const checkPage = async (path, opts) => {
    const res = { status: 0, bytes: 0 };
    try {
      const r = await fetch(SITE_URL + path + (path.includes('?') ? '&' : '?') + 'hc=' + Date.now(), { headers: { 'cache-control': 'no-cache' } });
      const html = await r.text();
      res.status = r.status; res.bytes = html.length;
      if (r.status !== 200) problems.push(`${path} : HTTP ${r.status}`);
      if (html.length < (opts.minBytes || 1000)) problems.push(`${path} : page anormalement petite (${html.length} o)`);
      for (const m of (opts.mustContain || [])) if (!html.includes(m)) problems.push(`${path} : marqueur manquant « ${m} »`);
      for (const m of (opts.mustNotContain || [])) if (html.includes(m)) problems.push(`${path} : code cassé détecté « ${m} »`);
      if (opts.checkScripts) {
        const scripts = html.match(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi) || [];
        res.scripts = scripts.length;
        scripts.forEach((s, i) => {
          const code = s.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '');
          try { new Function(code); } catch (e) { problems.push(`${path} : erreur de syntaxe dans le script n°${i + 1} — ${e.message}`); }
        });
        if (scripts.length < (opts.minScripts || 1)) problems.push(`${path} : ${scripts.length} script(s) au lieu de ${opts.minScripts}`);
      }
    } catch (e) { res.error = e.message; problems.push(`${path} : injoignable (${e.message})`); }
    pages[path] = res;
  };
  const formOpts = { minBytes: 60000, minScripts: 3, checkScripts: true, mustContain: ['id="submit-btn"', 'id="filleuls-list"', 'id="conseiller_id"', 'parrainage-relay', 'tierLabels', 'v200u'], mustNotContain: ['var labels = [', 'Uploads are disabled'] };
  await checkPage('/', formOpts);
  await checkPage('/parrainage.html', formOpts);
  await checkPage('/espace-pro.html', { minBytes: 30000, minScripts: 1, checkScripts: true, mustContain: ['pro-login', 'primeStart'] });
  await checkPage('/prime.html', { minBytes: 15000, minScripts: 1, checkScripts: true, mustContain: ['prime-sign', 'prime-otp', 'jspdf'] });
  // v285 — pages de rendez-vous liées depuis les mails filleuls (étaient en 404 → « lien mort » signalé par un client)
  for (const c of ['corentin', 'david', 'nicolas']) await checkPage(`/rdv-${c}.html`, { minBytes: 800, minScripts: 1, checkScripts: true, mustContain: ['rdv-shared.js', `PC_CONSEILLER='${c}'`] });
  await checkPage('/rdv-shared.js', { minBytes: 5000, mustContain: ['action=rdv', 'Demander ce rendez-vous'] });
  // index.html doit être identique à parrainage.html (la racine est la page que tapent les clients)
  if (pages['/'].bytes && pages['/parrainage.html'].bytes && pages['/'].bytes !== pages['/parrainage.html'].bytes) problems.push(`/ et /parrainage.html diffèrent (${pages['/'].bytes} o vs ${pages['/parrainage.html'].bytes} o)`);
  const pingResp = await handlePing();
  const ping = JSON.parse(pingResp.body);
  if (!ping.ok) problems.push('auto-diagnostic KO : ' + JSON.stringify(ping.checks));
  const ok = problems.length === 0;
  const isMonday = new Date().getUTCDay() === 1;
  const forceMail = !!((event.queryStringParameters || {}).mail);
  const alertTo = (env.HEALTH_ALERT_TO || [env.MAIL_CONTACT || 'contact@parisconseils.fr', 'curtet@parisconseils.fr'].join(',')).split(',').map(s => s.trim()).filter(Boolean);
  let mail = null;
  if (!ok || isMonday || forceMail) {
    const title = ok ? 'Parrainage : tout fonctionne' : `Parrainage : ${problems.length} problème${problems.length > 1 ? 's' : ''} détecté${problems.length > 1 ? 's' : ''}`;
    const body = ok
      ? `${p(`Contrôle automatique du ${fmtDateFr(new Date().toISOString())} : formulaire, espace pro, page prime, base et messagerie répondent normalement.`)}${infoBeige(`${ping.checks.blobs && ping.checks.blobs.records} parrainage(s) en base · mail : ${escapeHtml((ping.checks.mail || {}).provider || '?')} · RIP : ${ping.checks.rip && ping.checks.rip.configured ? 'connecté' : '<b>non connecté</b>'}`)}`
      : `${p(`Le contrôle automatique du ${fmtDateFr(new Date().toISOString())} a détecté&nbsp;:`)}${infoBeige(problems.map(x => '• ' + escapeHtml(x)).join('<br>'))}${p(`Le formulaire de recommandation est peut-être <b>inutilisable</b>. À vérifier tout de suite sur <a href="${SITE_URL}" style="color:${RIP_NAVY};">${SITE_URL}</a>.`, 'margin-top:14px;')}`;
    const html = baseShell({ title: escapeHtml(title), eyebrow: ok ? 'Surveillance · OK' : 'Surveillance · ALERTE', body });
    mail = await sendEmail({ apiKey: env.RESEND_API_KEY, from: env.MAIL_FROM, to: alertTo, subject: (ok ? '✅ ' : '🚨 ') + title, html });
    mail = { ok: mail.ok, status: mail.status, to: alertTo };
  }
  return jsonResp(ok ? 200 : 503, { ok, build: BUILD_STAMP, problems, pages, ping: ping.checks, mail });
}

async function countFilleulsAnneeParrain(parrainEmail, excludeId) {
  try {
    const email = (parrainEmail || '').trim().toLowerCase();
    if (!email) return 0;
    const year = new Date().getFullYear();
    const store = getBlobStore('parrainages');
    const listing = await store.list();
    let n = 0;
    for (const blob of (listing.blobs || [])) {
      if (blob.key === excludeId) continue;
      const r = await store.get(blob.key, { type: 'json' });
      if (!r || !r.parrain) continue;
      if ((r.parrain.email || '').trim().toLowerCase() !== email) continue;
      const y = r.createdAt ? new Date(r.createdAt).getFullYear() : null;
      if (y !== year) continue;
      const st = String(r.status || '').toUpperCase();
      if (st === 'SUPPRIME' || st === 'REFUSE' || st === 'SPAM' || st === 'DELETED') continue;
      n += (typeof r.nbFilleuls === 'number' ? r.nbFilleuls : (Array.isArray(r.filleuls) ? r.filleuls.length : 0));
    }
    return n;
  } catch (e) { return 0; }
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
async function sendEmail({ apiKey, from, to, subject, html, replyTo, bcc, testRedirect, attachments }) {
  let realTo = to;
  let realSubject = subject;
  if (testRedirect) {
    realTo = testRedirect;
  }
  // v283 — pièces jointes : [{ filename, contentBase64, contentType }]
  const atts = Array.isArray(attachments) ? attachments.filter(a => a && a.filename && a.contentBase64) : [];
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
      if (atts.length) body.attachment = atts.map(a => ({ name: a.filename, content: a.contentBase64 }));
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
        bcc: bcc ? (Array.isArray(bcc) ? bcc.join(', ') : bcc) : undefined,
        attachments: atts.length ? atts.map(a => ({ filename: a.filename, content: Buffer.from(a.contentBase64, 'base64'), contentType: a.contentType || undefined })) : undefined
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
  if (atts.length) body.attachments = atts.map(a => ({ filename: a.filename, content: a.contentBase64 }));
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
      const name = (conseillerName || '').toLowerCase();
      const key = Object.keys(map).find(k => k.toLowerCase() === name);
      if (key) return map[key];
      // v285 — CONSEILLERS_JSON est indexé par nom de famille ("curtet", "pereira", "moreau") alors que le site
      // envoie "Corentin Curtet" : sans ceci, David et Nicolas ne recevaient jamais leurs notifications (repli MAIL_CONTACT).
      const partial = name.length >= 3 ? Object.keys(map).find(k => k && (name.includes(k.toLowerCase()) || k.toLowerCase().includes(name))) : null;
      if (partial) return map[partial];
      const slugs = conseillerSlugs(conseillerName);
      if (slugs) { const last = slugs.rip.split('-')[1]; const k2 = Object.keys(map).find(k => k.toLowerCase().includes(last)); if (k2) return map[k2]; }
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

  // v281 — Relances J+45 automatiques désactivées par défaut (règle : aucun mail client sans validation).
  // Réactivation : variable d'env PARRAINAGE_RAPPELS_ENABLED=true (après validation du template).
  if (String(process.env.PARRAINAGE_RAPPELS_ENABLED || '').toLowerCase() !== 'true') {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, disabled: true, message: 'Relances J+45 désactivées (PARRAINAGE_RAPPELS_ENABLED != true)' })
    };
  }

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

// v263 — Update filleul status (admin only via JWT ou admin token).
// body: { id, filleulIndex, status: 'nouveau' | 'contacte' | 'signe' | 'non-fructueux', note?: string }
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
    if (filleulIndex < 0 || filleulIndex >= filleuls.length) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Invalid filleulIndex' }) };
    }
    const f = filleuls[filleulIndex];
    f.status = status;
    f.status_updated_at = new Date().toISOString();
    if (note !== undefined) f.status_note = String(note || '').slice(0, 500);
    // Auto-tag contactedAt si status implique contact
    if ((status === 'contacte' || status === 'signe' || status === 'non-fructueux') && !f.contactedAt) {
      f.contactedAt = new Date().toISOString();
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

// v279 — Mise à jour admin des coordonnées d'un enregistrement (aucun mail envoyé).
// body: { id, parrain?: {prenom?,nom?,email?,tel?}, filleuls?: [{ index, prenom?,nom?,email?,tel?, note? }] }
// v281 — + createdAt (date réelle du parrainage, ISO), origine (ex: "Formulaire Netlify 14/06/2026"),
//        note (≤ 1000 car.). L'ancienne date est conservée dans createdAtOriginal.
async function handleUpdate(event) {
  const adminToken = process.env.PARRAINAGE_ADMIN_TOKEN || '';
  const proSecret  = process.env.PRO_JWT_SECRET || '';
  const authHdr = event.headers.authorization || event.headers.Authorization || '';
  const bearer = authHdr.startsWith('Bearer ') ? authHdr.slice(7) : '';
  let isAdmin = false;
  if (adminToken && bearer === adminToken) isAdmin = true;
  if (!isAdmin && proSecret && bearer) {
    try { const { verifyToken } = require('./pro-login'); const p = verifyToken(bearer, proSecret); if (p && p.r === 'admin') isAdmin = true; } catch (_e) {}
  }
  if (!isAdmin) return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'Unauthorized (admin only)' }) };
  let body; try { body = JSON.parse(event.body || '{}'); } catch (e) { return { statusCode: 400, body: 'Invalid JSON' }; }
  if (!body.id) return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Missing id' }) };
  const clean = (v) => String(v == null ? '' : v).trim().slice(0, 200);
  try {
    const store = getBlobStore('parrainages');
    const record = await store.get(body.id, { type: 'json' });
    if (!record) return { statusCode: 404, body: JSON.stringify({ ok: false, error: 'Not found' }) };
    record.parrain = record.parrain || {};
    if (body.parrain && typeof body.parrain === 'object') {
      for (const k of ['prenom','nom','email','tel']) if (body.parrain[k] !== undefined) record.parrain[k] = clean(body.parrain[k]);
    }
    if (Array.isArray(body.filleuls)) {
      record.filleuls = record.filleuls || [];
      for (const upd of body.filleuls) {
        const i = upd && upd.index;
        if (typeof i !== 'number' || i < 0 || i >= record.filleuls.length) continue;
        for (const k of ['prenom','nom','email','tel']) if (upd[k] !== undefined) record.filleuls[i][k] = clean(upd[k]);
        if (upd.note !== undefined) record.filleuls[i].note = String(upd.note == null ? '' : upd.note).trim().slice(0, 500);
      }
    }
    // v281 — date réelle du parrainage (reprise d'historique), origine et note.
    if (body.createdAt !== undefined) {
      const ts = Date.parse(String(body.createdAt));
      const y = isNaN(ts) ? 0 : new Date(ts).getUTCFullYear();
      if (isNaN(ts) || y < 2020 || y > 2100) {
        return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'createdAt invalide (ISO 8601 attendu)' }) };
      }
      if (!record.createdAtOriginal) record.createdAtOriginal = record.createdAt || null;
      record.createdAt = new Date(ts).toISOString();
    }
    if (body.origine !== undefined) record.origine = clean(body.origine);
    if (body.note !== undefined) record.note = String(body.note == null ? '' : body.note).trim().slice(0, 1000);
    record.updatedAt = new Date().toISOString();
    await store.setJSON(record.id, record);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ ok: true, record }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// v283 — PRIME DE PARRAINAGE : notification au parrain (échelon), attestation
// signée en ligne (RIB + pièce d'identité + signature), PDF archivé + envoyé.
//   POST ?action=prime-notify  (admin)  { id, filleulIndex, montant?, echelon?, preview? }
//   GET  ?action=prime-info&t= (public, token signé)
//   POST ?action=prime-sign    (public, token signé) { t, iban, titulaire, adresse, lieu,
//                                signaturePng, attestationPdf:{name,dataBase64}, piece:{name,type,dataBase64} }
//   GET  ?action=prime-doc&id=&fi=&kind=attestation|piece|signature (admin)
//   POST ?action=prime-otp   { t }  → envoie un code à 6 chiffres (15 min) sur la boîte du parrain (v286)
//   prime-sign accepte { signatureMode:'otp', nomSignataire, otp } à la place de signaturePng (v286)
// Aucun mail n'est envoyé sans clic explicite de l'admin dans l'espace pro.
// ═══════════════════════════════════════════════════════════════════════════
const PRIME_TOKEN_TTL_DAYS = 60;
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlDecode = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
function primeSecret() { return process.env.PRIME_TOKEN_SECRET || process.env.PRO_JWT_SECRET || process.env.PARRAINAGE_ADMIN_TOKEN || ''; }
function signPrimeToken(payload) {
  const secret = primeSecret();
  if (!secret) throw new Error('PRIME secret manquant (PRO_JWT_SECRET)');
  const body = b64url(JSON.stringify(payload));
  const sig  = b64url(crypto.createHmac('sha256', secret).update(body).digest());
  return body + '.' + sig;
}
function verifyPrimeToken(token) {
  try {
    const secret = primeSecret();
    const [body, sig] = String(token || '').split('.');
    if (!body || !sig || !secret) return null;
    const expect = b64url(crypto.createHmac('sha256', secret).update(body).digest());
    if (expect.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(sig))) return null;
    const payload = JSON.parse(b64urlDecode(body).toString('utf8'));
    if (!payload || !payload.id || typeof payload.fi !== 'number') return null;
    if (payload.exp && Date.now() > payload.exp) return { expired: true, payload };
    return { payload };
  } catch (_e) { return null; }
}
function isAdminEvent(event) {
  const adminToken = process.env.PARRAINAGE_ADMIN_TOKEN || '';
  const proSecret  = process.env.PRO_JWT_SECRET || '';
  const authHdr = event.headers.authorization || event.headers.Authorization || '';
  const bearer = authHdr.startsWith('Bearer ') ? authHdr.slice(7) : '';
  if (adminToken && bearer === adminToken) return true;
  if (proSecret && bearer) {
    try { const { verifyToken } = require('./pro-login'); const p = verifyToken(bearer, proSecret); if (p && p.r === 'admin') return true; } catch (_e) {}
  }
  return false;
}
const jsonResp = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(obj) });
function normIban(v) { return String(v || '').replace(/\s+/g, '').toUpperCase(); }
function ibanValid(iban) {
  const s = normIban(iban);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  if (s.startsWith('FR') && s.length !== 27) return false;
  const rearr = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of rearr) {
    const v = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}
const maskIban = (iban) => { const s = normIban(iban); return s.length > 8 ? s.slice(0, 4) + ' •••• •••• ' + s.slice(-4) : '••••'; };
const fmtDateFr = (iso) => { try { return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' }); } catch (_e) { return String(iso || ''); } };

// Rang de ce filleul parmi les filleuls SIGNÉS du parrain sur l'année → prime marginale selon le barème.
async function computePrimeDefault(store, record, filleulIndex) {
  const email = ((record.parrain || {}).email || '').toLowerCase();
  const year = new Date(record.createdAt || Date.now()).getUTCFullYear();
  const signed = [];
  const listing = await store.list();
  for (const blob of (listing.blobs || [])) {
    const r = await store.get(blob.key, { type: 'json' });
    if (!r || !r.parrain || (r.parrain.email || '').toLowerCase() !== email) continue;
    if (new Date(r.createdAt || 0).getUTCFullYear() !== year) continue;
    (r.filleuls || []).forEach((f, i) => { if (f && f.status === 'signe') signed.push({ id: r.id, i, at: f.status_updated_at || r.createdAt || '' }); });
  }
  signed.sort((a, b) => a.at.localeCompare(b.at));
  let rank = signed.findIndex(s => s.id === record.id && s.i === filleulIndex) + 1;
  if (rank <= 0) rank = signed.length + 1;
  const montant = cumulAt(rank) - cumulAt(rank - 1);
  return { echelon: rank, montant, nbSignes: signed.length };
}

function emailPrimeParrain({ parrain, filleul, conseiller, montant, echelon, lien }) {
  const consNom = conseillerComplet(conseiller);
  const consPrenom = conseillerPrenom(conseiller) || 'votre conseiller';
  const fNom = `${escapeHtml(filleul.prenom || '')} ${escapeHtml(filleul.nom || '')}`.trim();
  const year = new Date().getFullYear();
  const body = `
${p(`Bonjour ${escapeHtml(parrain.prenom)},`)}
${p(`Bonne nouvelle&nbsp;: <b>${fNom}</b> nous a rejoints grâce à votre recommandation. Votre parrainage est <b>concrétisé</b>, et nous tenions à vous en remercier sincèrement.`)}
${heroCream(`Votre prime de parrainage · échelon ${echelon}`, `${eur(montant)}`, `${ordinal(echelon)} parrainage concrétisé en ${year}`)}
${p(`Pour déclencher le versement, il nous reste une formalité simple, à faire en <b>trois minutes</b> depuis votre téléphone ou votre ordinateur&nbsp;:`)}
${p(`<b>1.</b> Indiquer le RIB sur lequel vous souhaitez recevoir la prime.<br><b>2.</b> Joindre une pièce d'identité en cours de validité.<br><b>3.</b> Valider électroniquement l'attestation de réception de prime — votre nom et un code reçu par e-mail, aucune impression (elle vaut justificatif comptable, vous en recevez une copie).`)}
${ctaNavy(lien, 'Compléter mon dossier de prime')}
${pSoft(`Ce lien vous est personnel et reste valable ${PRIME_TOKEN_TTL_DAYS} jours. Le versement intervient après réception de l'attestation validée.`)}
${infoBeige(`<b>Rappel du programme ${year}</b>&nbsp;: ${eur(500)} pour chacun de vos deux premiers parrainages concrétisés, puis dès le 3<sup>e</sup>, ${eur(1500)} par parrainage avec revalorisation rétroactive des deux premiers (${eur(4500)} cumulés au 3<sup>e</sup>). Le programme court jusqu'au 31&nbsp;décembre.<br><br><b>Confidentialité</b>&nbsp;: vos documents sont stockés de manière chiffrée, réservés à la comptabilité de Paris Conseils, et supprimables sur simple demande à <a href="mailto:contact@parisconseils.fr" style="color:${RIP_NAVY};">contact@parisconseils.fr</a>.`)}
${signature(`Avec toute notre reconnaissance`)}
${pSoft(`${escapeHtml(consNom)} reste votre interlocuteur pour toute question.`, 'margin-top:6px;')}`;
  return baseShell({ title: `Votre prime de ${eur(montant)} vous attend`, eyebrow: 'Parrainage concrétisé', body });
}

function emailPrimeSigneeParrain({ parrain, filleul, montant, echelon, signedAt }) {
  const fNom = `${escapeHtml(filleul.prenom || '')} ${escapeHtml(filleul.nom || '')}`.trim();
  const body = `
${p(`Bonjour ${escapeHtml(parrain.prenom)},`)}
${p(`Nous avons bien reçu votre attestation validée électroniquement le <b>${fmtDateFr(signedAt)}</b> pour le parrainage de <b>${fNom}</b>. Vous en trouverez une copie en pièce jointe.`)}
${heroCream('Versement en préparation', `${eur(montant)}`, `échelon ${echelon} · sur le compte ${escapeHtml(maskIban(parrain.iban))}`)}
${p(`Notre comptabilité procède au virement dans les prochains jours. Vous n'avez plus rien à faire.`)}
${infoBeige(`Un doute, une question sur ce versement&nbsp;? Répondez simplement à cet e-mail ou écrivez à <a href="mailto:contact@parisconseils.fr" style="color:${RIP_NAVY};">contact@parisconseils.fr</a>.`)}
${signature('Merci encore pour votre confiance')}`;
  return baseShell({ title: 'Attestation bien reçue', eyebrow: 'Prime de parrainage', body });
}

function emailPrimeSigneeCompta({ parrain, filleul, record, montant, echelon, signedAt, meta }) {
  const fNom = `${escapeHtml(filleul.prenom || '')} ${escapeHtml(filleul.nom || '')}`.trim();
  const pNom = `${escapeHtml(parrain.prenom || '')} ${escapeHtml(parrain.nom || '')}`.trim();
  const body = `
${p(`Attestation de prime <b>validée électroniquement</b> par le parrain. PDF en pièce jointe (RIB complet dans le PDF). La pièce d'identité est consultable dans l'espace pro (fiche du parrainage), elle n'est pas envoyée par e-mail.`)}
${heroCream('À virer', `${eur(montant)}`, `échelon ${echelon} · ${pNom} → ${fNom}`)}
${infoBeige(`<b>Parrain</b>&nbsp;: ${pNom} · ${escapeHtml(parrain.email || '')} · ${escapeHtml(parrain.tel || '')}<br><b>Titulaire du compte</b>&nbsp;: ${escapeHtml(meta.titulaire || '')}<br><b>IBAN</b>&nbsp;: ${escapeHtml(meta.ibanSpaced || '')}<br><b>Adresse</b>&nbsp;: ${escapeHtml(meta.adresse || '')}<br><b>Signé le</b>&nbsp;: ${fmtDateFr(signedAt)} à ${escapeHtml(meta.lieu || '')} · IP ${escapeHtml(meta.ip || '')}<br><b>Signature</b>&nbsp;: ${escapeHtml(meta.signatureLine || 'tracé manuscrit intégré au PDF')}<br><b>Empreinte SHA-256 du PDF</b>&nbsp;: <span style="font-family:'Courier New',monospace;font-size:12px;">${escapeHtml(meta.pdfSha256 || '')}</span><br><b>Conseiller</b>&nbsp;: ${escapeHtml(record.conseiller || '')} · ID ${escapeHtml(record.id)}`)}
${ctaNavy('https://parrainage.parisconseils.fr/espace-pro.html', 'Ouvrir l\'espace pro')}`;
  return baseShell({ title: `Prime à virer — ${pNom}`, eyebrow: 'Comptabilité · parrainage', body });
}

// ── v286 — Validation électronique de l'attestation : nom saisi + case cochée + code à usage unique reçu par e-mail.
// Le code (6 chiffres, 15 min, 5 essais) est stocké haché dans parrainages-docs/<id>/<fi>/otp.json ; il prouve, au moment
// de la signature, le contrôle de la boîte mail à laquelle le lien personnel a été envoyé (signature électronique simple).
const OTP_TTL_MIN = 15, OTP_MAX_ATTEMPTS = 5, OTP_MIN_INTERVAL_S = 45, OTP_MAX_SENDS_24H = 6;
const maskEmail = (e) => { const s = String(e || ''); const i = s.indexOf('@'); if (i < 1) return '•••'; return s.slice(0, Math.min(2, i)) + '•••' + s.slice(i); };
const otpHash = (code, id, fi) => crypto.createHash('sha256').update(`${code}|${id}|${fi}|${primeSecret()}`).digest('hex');
const normName = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z\s'-]/g, ' ').replace(/\s+/g, ' ').trim();
function nameMatchesParrain(typed, parrain) {
  const t = normName(typed); const nom = normName((parrain || {}).nom); const prenom = normName((parrain || {}).prenom);
  if (t.length < 3 || !nom) return false;
  const tokens = t.split(' ');
  const nomOk = nom.split(' ').every(w => !w || tokens.includes(w));           // tous les mots du nom de famille
  const prenomOk = !prenom || prenom.split(' ').some(w => w && tokens.includes(w)); // au moins un mot du prénom
  return nomOk && prenomOk;
}
function emailPrimeOtp({ parrain, code, filleul, montant }) {
  const fNom = `${escapeHtml((filleul || {}).prenom || '')} ${escapeHtml((filleul || {}).nom || '')}`.trim();
  const pretty = String(code).replace(/(\d{3})(\d{3})/, '$1 $2');
  const body = `
${p(`Bonjour ${escapeHtml(parrain.prenom)},`)}
${p(`Voici votre code de validation pour signer électroniquement l'attestation de réception de votre prime de parrainage${fNom ? ` (${fNom})` : ''}${montant ? ` — ${eur(montant)}` : ''}&nbsp;:`)}
${heroCream('Code de validation', `<span style="letter-spacing:6px;font-family:'Courier New',monospace;">${pretty}</span>`, `valable ${OTP_TTL_MIN} minutes · à saisir sur la page ouverte`)}
${pSoft(`Ce code est à usage unique. Ne le communiquez à personne — Paris Conseils ne vous le demandera jamais par téléphone. Si vous n'êtes pas à l'origine de cette demande, ignorez simplement ce message.`)}
${signature('Bien à vous')}`;
  return baseShell({ title: 'Votre code de validation', eyebrow: 'Prime de parrainage · signature électronique', body });
}
async function handlePrimeOtp(event) {
  let body; try { body = JSON.parse(event.body || '{}'); } catch (e) { return jsonResp(400, { ok: false, error: 'Invalid JSON' }); }
  const v = verifyPrimeToken(body.t);
  if (!v) return jsonResp(401, { ok: false, error: 'Lien invalide.' });
  if (v.expired) return jsonResp(410, { ok: false, error: 'Ce lien a expiré.' });
  try {
    const store = getBlobStore('parrainages');
    const record = await store.get(v.payload.id, { type: 'json' });
    const fi = v.payload.fi;
    const f = record && (record.filleuls || [])[fi];
    if (!record || !f) return jsonResp(404, { ok: false, error: 'Parrainage introuvable.' });
    if (f.prime && f.prime.status === 'signe') return jsonResp(409, { ok: false, error: 'Cette attestation a déjà été validée.' });
    const email = String((record.parrain || {}).email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return jsonResp(400, { ok: false, error: 'Adresse e-mail du parrain absente — écrivez à contact@parisconseils.fr.' });
    const docs = getBlobStore('parrainages-docs');
    const key = `${record.id}/${fi}/otp.json`;
    const now = Date.now();
    const prev = (await docs.get(key, { type: 'json' })) || {};
    const sends = (prev.sends || []).filter(ts => now - ts < 24 * 3600 * 1000);
    if (sends.length && now - sends[sends.length - 1] < OTP_MIN_INTERVAL_S * 1000) return jsonResp(429, { ok: false, error: `Un code vient d'être envoyé à ${maskEmail(email)} — patientez ${OTP_MIN_INTERVAL_S} secondes avant d'en redemander un.` });
    if (sends.length >= OTP_MAX_SENDS_24H) return jsonResp(429, { ok: false, error: 'Trop de codes demandés aujourd\'hui. Réessayez demain ou écrivez à contact@parisconseils.fr.' });
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    sends.push(now);
    await docs.setJSON(key, { hash: otpHash(code, record.id, fi), exp: now + OTP_TTL_MIN * 60 * 1000, attempts: 0, sends, sentTo: maskEmail(email), used: false });
    const env = process.env;
    const montant = (f.prime && f.prime.montant) || v.payload.m;
    const r = await sendEmail({ apiKey: env.RESEND_API_KEY, from: env.MAIL_FROM, to: email,
      subject: `${code.slice(0, 3)} ${code.slice(3)} — votre code de validation Paris Conseils`,
      html: emailPrimeOtp({ parrain: record.parrain, code, filleul: f, montant }), replyTo: resolveConseillerEmail(env, record.conseiller) }); // pas de BCC : le code ne circule qu'entre le parrain et le relay
    if (!r.ok) return jsonResp(502, { ok: false, error: 'Envoi du code impossible pour le moment — réessayez dans un instant.' });
    return jsonResp(200, { ok: true, sentTo: maskEmail(email), ttlMinutes: OTP_TTL_MIN });
  } catch (err) { return jsonResp(500, { ok: false, error: err.message }); }
}
// Vérifie le code saisi ; consomme une tentative à chaque échec, invalide le code après succès.
async function verifyPrimeOtp(docs, id, fi, code) {
  const key = `${id}/${fi}/otp.json`;
  const o = await docs.get(key, { type: 'json' });
  const c = String(code || '').replace(/\D/g, '');
  if (!o || !o.hash) return { ok: false, error: 'Demandez d\'abord votre code de validation par e-mail.' };
  if (o.used) return { ok: false, error: 'Ce code a déjà été utilisé — demandez-en un nouveau.' };
  if (Date.now() > (o.exp || 0)) return { ok: false, error: 'Code expiré (15 minutes) — demandez-en un nouveau.' };
  if ((o.attempts || 0) >= OTP_MAX_ATTEMPTS) return { ok: false, error: 'Trop d\'essais — demandez un nouveau code.' };
  const expect = Buffer.from(o.hash, 'hex'); const got = Buffer.from(c.length === 6 ? otpHash(c, id, fi) : otpHash('x', id, fi), 'hex');
  if (expect.length !== got.length || !crypto.timingSafeEqual(expect, got)) {
    o.attempts = (o.attempts || 0) + 1; await docs.setJSON(key, o);
    const left = OTP_MAX_ATTEMPTS - o.attempts;
    return { ok: false, error: left > 0 ? `Code incorrect (${left} essai${left > 1 ? 's' : ''} restant${left > 1 ? 's' : ''}).` : 'Code incorrect — demandez un nouveau code.' };
  }
  o.used = true; o.usedAt = new Date().toISOString(); await docs.setJSON(key, o);
  return { ok: true, sentTo: o.sentTo || '' };
}

async function handlePrimeNotify(event) {
  if (!isAdminEvent(event)) return jsonResp(401, { ok: false, error: 'Unauthorized (admin only)' });
  let body; try { body = JSON.parse(event.body || '{}'); } catch (e) { return jsonResp(400, { ok: false, error: 'Invalid JSON' }); }
  const { id, filleulIndex } = body;
  if (!id || typeof filleulIndex !== 'number') return jsonResp(400, { ok: false, error: 'id / filleulIndex requis' });
  try {
    const store = getBlobStore('parrainages');
    const record = await store.get(id, { type: 'json' });
    if (!record) return jsonResp(404, { ok: false, error: 'Not found' });
    const f = (record.filleuls || [])[filleulIndex];
    if (!f) return jsonResp(400, { ok: false, error: 'Invalid filleulIndex' });
    if (f.status !== 'signe') return jsonResp(400, { ok: false, error: 'Le filleul doit être au statut « signé » avant de déclencher la prime.' });
    const def = await computePrimeDefault(store, record, filleulIndex);
    const montant = Number(body.montant) > 0 ? Math.round(Number(body.montant)) : def.montant;
    const echelon = Number(body.echelon) > 0 ? Math.round(Number(body.echelon)) : def.echelon;
    const exp = Date.now() + PRIME_TOKEN_TTL_DAYS * 24 * 3600 * 1000;
    const token = signPrimeToken({ id: record.id, fi: filleulIndex, m: montant, e: echelon, exp });
    const lien = `https://parrainage.parisconseils.fr/prime.html?t=${encodeURIComponent(token)}`;
    const html = emailPrimeParrain({ parrain: record.parrain, filleul: f, conseiller: record.conseiller, montant, echelon, lien });
    if (body.preview) return jsonResp(200, { ok: true, preview: true, montant, echelon, defaut: def, html, subject: `Votre prime de parrainage de ${montant.toLocaleString('fr-FR')} € — une formalité à compléter` });
    const env = process.env;
    const sendRes = await sendEmail({
      apiKey: env.RESEND_API_KEY, from: env.MAIL_FROM, to: record.parrain.email,
      subject: `Votre prime de parrainage de ${montant.toLocaleString('fr-FR')} € — une formalité à compléter`,
      html, replyTo: resolveConseillerEmail(env, record.conseiller), bcc: env.MAIL_CC_OPS
    });
    f.prime = Object.assign({}, f.prime || {}, { montant, echelon, status: 'notifie', notifiedAt: new Date().toISOString(), notifiedBy: 'espace-pro', tokenExp: new Date(exp).toISOString(), mail: { ok: !!sendRes.ok, status: sendRes.status, via: sendRes.via } });
    record.filleuls[filleulIndex] = f;
    record.updatedAt = new Date().toISOString();
    await store.setJSON(record.id, record);
    return jsonResp(sendRes.ok ? 200 : 502, { ok: !!sendRes.ok, montant, echelon, filleul: f, mail: sendRes });
  } catch (err) { return jsonResp(500, { ok: false, error: err.message }); }
}

async function handlePrimeInfo(event) {
  const t = (event.queryStringParameters || {}).t || '';
  const v = verifyPrimeToken(t);
  if (!v) return jsonResp(401, { ok: false, error: 'Lien invalide.' });
  if (v.expired) return jsonResp(410, { ok: false, error: 'Ce lien a expiré. Écrivez à contact@parisconseils.fr pour en recevoir un nouveau.' });
  try {
    const store = getBlobStore('parrainages');
    const record = await store.get(v.payload.id, { type: 'json' });
    const f = record && (record.filleuls || [])[v.payload.fi];
    if (!record || !f) return jsonResp(404, { ok: false, error: 'Parrainage introuvable.' });
    const pr = record.parrain || {};
    const prime = f.prime || {};
    return jsonResp(200, { ok: true,
      parrain: { prenom: pr.prenom || '', nom: pr.nom || '', email: pr.email || '', tel: pr.tel || '', ibanMasque: pr.iban ? maskIban(pr.iban) : null, titulaire: pr.titulaire || '', adresse: pr.adresse || '' },
      filleul: { prenom: f.prenom || '', nom: f.nom || '' },
      conseiller: conseillerComplet(record.conseiller),
      montant: prime.montant || v.payload.m, echelon: prime.echelon || v.payload.e,
      dejaSigne: prime.status === 'signe', signedAt: prime.signedAt || null, annee: new Date(record.createdAt || Date.now()).getFullYear()
    });
  } catch (err) { return jsonResp(500, { ok: false, error: err.message }); }
}

const B64_MAX = { signature: 400 * 1024, attestation: 4 * 1024 * 1024, piece: 4 * 1024 * 1024 };
function b64Payload(obj, maxBytes) {
  if (!obj || typeof obj.dataBase64 !== 'string') return null;
  const data = obj.dataBase64.replace(/^data:[^;]+;base64,/, '');
  const bytes = Math.floor(data.length * 3 / 4);
  if (bytes < 200 || bytes > maxBytes) return null;
  return { data, bytes, name: String(obj.name || '').replace(/[^\w.\-]+/g, '_').slice(0, 80), type: String(obj.type || '').slice(0, 60) };
}
async function handlePrimeSign(event) {
  let body; try { body = JSON.parse(event.body || '{}'); } catch (e) { return jsonResp(400, { ok: false, error: 'Invalid JSON' }); }
  const v = verifyPrimeToken(body.t);
  if (!v) return jsonResp(401, { ok: false, error: 'Lien invalide.' });
  if (v.expired) return jsonResp(410, { ok: false, error: 'Ce lien a expiré.' });
  const iban = normIban(body.iban);
  if (!ibanValid(iban)) return jsonResp(400, { ok: false, error: 'IBAN invalide — vérifiez les 27 caractères (FR76 …).' });
  const titulaire = String(body.titulaire || '').trim().slice(0, 120);
  const adresse   = String(body.adresse || '').trim().slice(0, 300);
  const lieu      = String(body.lieu || '').trim().slice(0, 80);
  if (titulaire.length < 3) return jsonResp(400, { ok: false, error: 'Nom du titulaire du compte requis.' });
  if (adresse.length < 8)   return jsonResp(400, { ok: false, error: 'Adresse postale requise.' });
  if (lieu.length < 2)      return jsonResp(400, { ok: false, error: 'Lieu de signature requis.' });
  if (body.consent !== true) return jsonResp(400, { ok: false, error: 'Vous devez certifier l\'exactitude des informations.' });
  // v286 — mode « otp » (nom saisi + code reçu par e-mail) ; le tracé manuscrit (signaturePng) reste accepté pour compatibilité.
  const otpMode = body.signatureMode === 'otp' || (body.otp !== undefined && !body.signaturePng);
  const nomSignataire = String(body.nomSignataire || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  const sig   = otpMode ? null : b64Payload({ dataBase64: body.signaturePng, name: 'signature.png', type: 'image/png' }, B64_MAX.signature);
  const pdf   = b64Payload(body.attestationPdf, B64_MAX.attestation);
  const piece = b64Payload(body.piece, B64_MAX.piece);
  if (!otpMode && !sig) return jsonResp(400, { ok: false, error: 'Signature manuscrite requise.' });
  if (otpMode && nomSignataire.length < 3) return jsonResp(400, { ok: false, error: 'Saisissez votre nom pour valider l\'attestation.' });
  if (otpMode && !/^\d{6}$/.test(String(body.otp || '').replace(/\D/g, ''))) return jsonResp(400, { ok: false, error: 'Saisissez le code de validation à 6 chiffres reçu par e-mail.' });
  if (!pdf)   return jsonResp(400, { ok: false, error: 'Attestation PDF manquante ou trop lourde (max 4 Mo).' });
  if (!piece) return jsonResp(400, { ok: false, error: 'Pièce d\'identité manquante ou trop lourde (max 4 Mo).' });
  if (!/^(image\/(jpeg|png|webp|heic)|application\/pdf)$/.test(piece.type)) return jsonResp(400, { ok: false, error: 'Pièce d\'identité : formats acceptés JPG, PNG, WEBP ou PDF.' });
  try {
    const store = getBlobStore('parrainages');
    const record = await store.get(v.payload.id, { type: 'json' });
    const fi = v.payload.fi;
    const f = record && (record.filleuls || [])[fi];
    if (!record || !f) return jsonResp(404, { ok: false, error: 'Parrainage introuvable.' });
    if (f.prime && f.prime.status === 'signe') return jsonResp(409, { ok: false, error: 'Cette attestation a déjà été validée.' });
    const docs = getBlobStore('parrainages-docs');
    const prefix = `${record.id}/${fi}/`;
    // v286 — signature électronique : le nom saisi doit correspondre au parrain, puis le code e-mail est consommé.
    let otpInfo = null;
    if (otpMode) {
      if (!nameMatchesParrain(nomSignataire, record.parrain)) return jsonResp(400, { ok: false, error: `Le nom saisi doit correspondre au vôtre : ${(record.parrain || {}).prenom || ''} ${(record.parrain || {}).nom || ''}.`.replace(/\s+/g, ' ') });
      const chk = await verifyPrimeOtp(docs, record.id, fi, body.otp);
      if (!chk.ok) return jsonResp(400, { ok: false, error: chk.error, otp: true });
      otpInfo = chk;
    }
    const pdfBuf = Buffer.from(pdf.data, 'base64');
    const pieceBuf = Buffer.from(piece.data, 'base64');
    const sigBuf = sig ? Buffer.from(sig.data, 'base64') : null;
    const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
    const pieceExt = piece.type === 'application/pdf' ? 'pdf' : (piece.type.split('/')[1] || 'bin').replace('jpeg', 'jpg');
    await docs.set(prefix + 'attestation.pdf', pdfBuf, { metadata: { type: 'application/pdf' } });
    await docs.set(prefix + 'piece-identite.' + pieceExt, pieceBuf, { metadata: { type: piece.type, name: piece.name } });
    if (sigBuf) await docs.set(prefix + 'signature.png', sigBuf, { metadata: { type: 'image/png' } });
    const signedAt = new Date().toISOString();
    const ip = event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'] || (event.headers['x-forwarded-for'] || '').split(',')[0].trim() || '';
    const ua = String(event.headers['user-agent'] || '').slice(0, 200);
    const montant = (f.prime && f.prime.montant) || v.payload.m;
    const echelon = (f.prime && f.prime.echelon) || v.payload.e;
    const ibanSpaced = iban.replace(/(.{4})/g, '$1 ').trim();
    const signatureInfo = otpMode
      ? { mode: 'electronique-otp', nom: nomSignataire, otpVerified: true, otpSentTo: otpInfo.sentTo || maskEmail((record.parrain || {}).email) }
      : { mode: 'manuscrite', nom: `${(record.parrain || {}).prenom || ''} ${(record.parrain || {}).nom || ''}`.trim() };
    const signedAtFr = new Date(signedAt).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const signatureLine = otpMode
      ? `électronique — nom saisi « ${nomSignataire} », code à usage unique vérifié (envoyé à ${signatureInfo.otpSentTo}) le ${signedAtFr}`
      : `tracé manuscrit intégré au PDF le ${signedAtFr}`;
    record.parrain = Object.assign({}, record.parrain || {}, { iban, titulaire, adresse });
    const docsMap = { attestation: prefix + 'attestation.pdf', piece: prefix + 'piece-identite.' + pieceExt };
    const shaMap = { attestation: sha(pdfBuf), piece: sha(pieceBuf) };
    if (sigBuf) { docsMap.signature = prefix + 'signature.png'; shaMap.signature = sha(sigBuf); }
    f.prime = Object.assign({}, f.prime || {}, { montant, echelon, status: 'signe', signedAt, lieu, ip, ua, signature: signatureInfo,
      docs: docsMap, sha256: shaMap, pieceType: piece.type, pieceBytes: piece.bytes });
    record.filleuls[fi] = f;
    record.updatedAt = signedAt;
    await store.setJSON(record.id, record);
    await docs.setJSON(prefix + 'meta.json', { id: record.id, fi, signedAt, ip, ua, lieu, titulaire, adresse, montant, echelon, signature: signatureInfo, signatureLine, sha256: f.prime.sha256, ibanMasque: maskIban(iban) });

    const env = process.env;
    const meta = { titulaire, adresse, lieu, ip, ibanSpaced, pdfSha256: f.prime.sha256.attestation, signatureLine };
    const pdfName = `Attestation-prime-parrainage-${(record.parrain.nom || 'parrain').replace(/[^\w\-]+/g, '_')}-${signedAt.slice(0, 10)}.pdf`;
    const compta = env.MAIL_COMPTA || env.MAIL_CONTACT || 'contact@parisconseils.fr';
    const mails = [];
    mails.push(Object.assign({ kind: 'compta', to: compta }, await sendEmail({ apiKey: env.RESEND_API_KEY, from: env.MAIL_FROM, to: compta,
      subject: `Prime à virer — ${record.parrain.prenom} ${record.parrain.nom} (${Number(montant).toLocaleString('fr-FR')} €, attestation signée)`,
      html: emailPrimeSigneeCompta({ parrain: record.parrain, filleul: f, record, montant, echelon, signedAt, meta }),
      replyTo: record.parrain.email, attachments: [{ filename: pdfName, contentBase64: pdf.data, contentType: 'application/pdf' }] })));
    mails.push(Object.assign({ kind: 'parrain', to: record.parrain.email }, await sendEmail({ apiKey: env.RESEND_API_KEY, from: env.MAIL_FROM, to: record.parrain.email,
      subject: `Votre attestation de prime est bien reçue — ${Number(montant).toLocaleString('fr-FR')} €`,
      html: emailPrimeSigneeParrain({ parrain: record.parrain, filleul: f, montant, echelon, signedAt }),
      replyTo: resolveConseillerEmail(env, record.conseiller), bcc: env.MAIL_CC_OPS, attachments: [{ filename: pdfName, contentBase64: pdf.data, contentType: 'application/pdf' }] })));
    return jsonResp(200, { ok: true, signedAt, montant, echelon, signature: signatureInfo.mode, pdfSha256: f.prime.sha256.attestation, mails: mails.map(m => ({ kind: m.kind, ok: m.ok, status: m.status, via: m.via })) });
  } catch (err) { return jsonResp(500, { ok: false, error: err.message }); }
}

async function handlePrimeDoc(event) {
  if (!isAdminEvent(event)) return jsonResp(401, { ok: false, error: 'Unauthorized (admin only)' });
  const q = event.queryStringParameters || {};
  const kind = String(q.kind || 'attestation');
  const fi = parseInt(q.fi, 10);
  if (!q.id || isNaN(fi)) return jsonResp(400, { ok: false, error: 'id / fi requis' });
  try {
    const store = getBlobStore('parrainages');
    const record = await store.get(q.id, { type: 'json' });
    const f = record && (record.filleuls || [])[fi];
    const key = f && f.prime && f.prime.docs && f.prime.docs[kind];
    if (!key) return jsonResp(404, { ok: false, error: 'Document introuvable' });
    const docs = getBlobStore('parrainages-docs');
    const res = await docs.getWithMetadata(key, { type: 'arrayBuffer' });
    if (!res || !res.data) return jsonResp(404, { ok: false, error: 'Document introuvable (blob)' });
    const ctype = (res.metadata && res.metadata.type) || (kind === 'attestation' ? 'application/pdf' : 'application/octet-stream');
    const fname = key.split('/').pop();
    return { statusCode: 200, isBase64Encoded: true,
      headers: { 'Content-Type': ctype, 'Content-Disposition': `inline; filename="${fname}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': '*' },
      body: Buffer.from(res.data).toString('base64') };
  } catch (err) { return jsonResp(500, { ok: false, error: err.message }); }
}

// v285 — Demande de rendez-vous depuis rdv-<conseiller>.html (page autonome : le visiteur propose jusqu'à 3 créneaux,
// le conseiller reçoit un mail avec liens « ajouter à l'agenda » et confirme lui-même). Aucun mail au visiteur : la page confirme.
function gcalLink(iso, minutes, title, details, location) {
  // iso = 'YYYY-MM-DDTHH:MM' en heure de Paris → conversion en UTC (été +2 / hiver +1, approximation par Intl)
  try {
    const [d, t] = iso.split('T'); const [Y, M, D] = d.split('-').map(Number); const [h, m] = t.split(':').map(Number);
    const guess = new Date(Date.UTC(Y, M - 1, D, h, m));
    const parisOffsetMin = (() => { const f = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', timeZoneName: 'shortOffset' }); const p = f.formatToParts(guess).find(x => x.type === 'timeZoneName'); const mm = /GMT([+-]\d+)/.exec(p ? p.value : 'GMT+1'); return (mm ? Number(mm[1]) : 1) * 60; })();
    const start = new Date(guess.getTime() - parisOffsetMin * 60000); const end = new Date(start.getTime() + minutes * 60000);
    const fmt = (x) => x.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${fmt(start)}/${fmt(end)}&details=${encodeURIComponent(details)}&location=${encodeURIComponent(location || '')}`;
  } catch (_e) { return null; }
}
async function handleRdv(event) {
  let body; try { body = JSON.parse(event.body || '{}'); } catch (e) { return jsonResp(400, { ok: false, error: 'Invalid JSON' }); }
  const clean = (v, n) => String(v == null ? '' : v).trim().slice(0, n || 200);
  const consKey = clean(body.conseiller, 20).toLowerCase();
  const slugsRdv = conseillerSlugs(consKey);
  if (!slugsRdv) return jsonResp(400, { ok: false, error: 'Conseiller inconnu.' });
  const consNom = conseillerComplet(slugsRdv.rip.split('-')[1]); // 'corentin' → 'curtet' → 'Corentin Curtet'
  const prenom = clean(body.prenom, 60), nom = clean(body.nom, 60), email = clean(body.email, 120), tel = clean(body.tel, 40), message = clean(body.message, 2000);
  const format = clean(body.format, 10) === 'visio' ? 'visio' : 'tel';
  const creneaux = (Array.isArray(body.creneaux) ? body.creneaux : []).map(x => String(x)).filter(x => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(x)).slice(0, 3);
  if (prenom.length < 2 || nom.length < 2) return jsonResp(400, { ok: false, error: 'Prénom et nom requis.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return jsonResp(400, { ok: false, error: 'E-mail invalide.' });
  if (tel.replace(/\D/g, '').length < 9) return jsonResp(400, { ok: false, error: 'Téléphone requis.' });
  if (!creneaux.length) return jsonResp(400, { ok: false, error: 'Choisissez au moins un créneau.' });
  const env = process.env;
  const id = crypto.randomUUID();
  const rec = { id, createdAt: new Date().toISOString(), conseiller: consNom, conseillerKey: consKey, format, creneaux, prenom, nom, email, tel, message, source: clean(body.source, 200), ip: event.headers['x-nf-client-connection-ip'] || '' };
  try { await getBlobStore('parrainages-rdv').setJSON(id, rec); } catch (e) { console.warn('[rdv] blob', e.message); }
  // Lien parrainage éventuel (le visiteur est-il un filleul connu ?)
  let parrainInfo = '';
  try {
    const store = getBlobStore('parrainages'); const listing = await store.list();
    for (const b of (listing.blobs || [])) { const r = await store.get(b.key, { type: 'json' }); if (!r || !r.filleuls) continue; const f = r.filleuls.find(x => (x.email || '').toLowerCase() === email.toLowerCase()); if (f) { parrainInfo = `Filleul de <b>${escapeHtml(r.parrain.prenom || '')} ${escapeHtml(r.parrain.nom || '')}</b> (parrainage du ${fmtDateFr(r.createdAt)})`; break; } }
  } catch (_e) {}
  const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const labelOf = (iso) => { const [d, t] = iso.split('T'); const [Y, M, D] = d.split('-').map(Number); const dt = new Date(Date.UTC(Y, M - 1, D, 12)); return `${JOURS[dt.getUTCDay()]} ${D} ${MOIS[M - 1]} à ${t.replace(':', 'h')}`; };
  const title = `RDV ${format === 'visio' ? 'visio' : 'tél.'} — ${prenom} ${nom} (Paris Conseils)`;
  const details = `${prenom} ${nom} · ${tel} · ${email}${message ? '\n' + message : ''}`;
  const rows = creneaux.map((c, i) => { const g = gcalLink(c, 30, title, details, format === 'visio' ? 'Visioconférence' : 'Téléphone'); return `<tr><td style="padding:6px 0;font-family:${FONT_BODY};font-size:14.5px;color:${RIP_TEXT};"><b>${i + 1}.</b> ${escapeHtml(labelOf(c))}</td><td align="right" style="padding:6px 0;">${g ? `<a href="${g}" style="color:${RIP_NAVY};font-family:${FONT_BODY};font-size:13px;font-weight:600;">＋ Ajouter à l'agenda</a>` : ''}</td></tr>`; }).join('');
  const html = baseShell({ title: `${escapeHtml(prenom)} ${escapeHtml(nom)} demande un rendez-vous`, eyebrow: 'Demande de rendez-vous · ' + (format === 'visio' ? 'visioconférence' : 'téléphone'), body: `
${p(`Bonjour ${escapeHtml(conseillerPrenom(consKey) || '')},`)}
${p(`<b>${escapeHtml(prenom)} ${escapeHtml(nom)}</b> a choisi ${creneaux.length > 1 ? 'ces créneaux' : 'ce créneau'} depuis votre page de rendez-vous. À vous de confirmer celui que vous retenez (répondez simplement à cet e-mail : il part vers ${escapeHtml(email)}).`)}
${heroCream('Créneaux proposés', `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${rows}</table>`, '')}
${infoBeige(`<b>Contact</b>&nbsp;: <a href="tel:${escapeHtml(tel.replace(/\s/g, ''))}" style="color:${RIP_NAVY};">${escapeHtml(tel)}</a> · <a href="mailto:${escapeHtml(email)}" style="color:${RIP_NAVY};">${escapeHtml(email)}</a><br><b>Format</b>&nbsp;: ${format === 'visio' ? 'visioconférence (pensez à joindre le lien Meet)' : 'appel téléphonique'}${parrainInfo ? '<br>' + parrainInfo : ''}${message ? `<br><b>Message</b>&nbsp;: ${escapeHtml(message).replace(/\n/g, '<br>')}` : ''}`)}
${pSoft('Aucun e-mail automatique n\'a été envoyé au client : la page lui indique que vous confirmez rapidement.', 'margin-top:14px;')}` });
  const to = resolveConseillerEmail(env, consNom);
  const r = await sendEmail({ apiKey: env.RESEND_API_KEY, from: env.MAIL_FROM, to, subject: `📅 ${prenom} ${nom} — ${creneaux.length} créneau${creneaux.length > 1 ? 'x' : ''} proposé${creneaux.length > 1 ? 's' : ''} (${format === 'visio' ? 'visio' : 'tél.'})`, html, replyTo: `${prenom} ${nom} <${email}>`, bcc: env.MAIL_CC_OPS });
  return jsonResp(r.ok ? 200 : 502, { ok: !!r.ok, id, via: r.via, status: r.status });
}

// v283 — Formulaire contact du site (Netlify Forms est désactivé sur ce site → sans ceci, les messages étaient perdus).
async function handleContact(event) {
  let body; try { body = JSON.parse(event.body || '{}'); } catch (e) { return jsonResp(400, { ok: false, error: 'Invalid JSON' }); }
  if (body['bot-field']) return jsonResp(200, { ok: true, skipped: 'bot' });
  const clean = (v, n) => String(v == null ? '' : v).trim().slice(0, n || 200);
  const prenom = clean(body.prenom, 60), nom = clean(body.nom, 60), email = clean(body.email, 120), tel = clean(body.telephone, 40), sujet = clean(body.sujet, 40), message = clean(body.message, 4000);
  if (!prenom || !nom || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || message.length < 5) return jsonResp(400, { ok: false, error: 'Merci de renseigner prénom, nom, e-mail et message.' });
  const env = process.env;
  const to = env.MAIL_CONTACT || 'contact@parisconseils.fr';
  const sujetLabel = { question: 'Question sur le parrainage', suggestion: 'Suggestion', 'rendez-vous': 'Demande de rendez-vous', autre: 'Autre' }[sujet] || (sujet || 'Message');
  const html = baseShell({ title: escapeHtml(sujetLabel), eyebrow: 'Message reçu · parrainage.parisconseils.fr', body: `
${p(`<b>${escapeHtml(prenom)} ${escapeHtml(nom)}</b> · <a href="mailto:${escapeHtml(email)}" style="color:${RIP_NAVY};">${escapeHtml(email)}</a>${tel ? ' · ' + escapeHtml(tel) : ''}`)}
${infoBeige(escapeHtml(message).replace(/\n/g, '<br>'))}
${pSoft(`Répondez directement à cet e-mail pour écrire à ${escapeHtml(prenom)}.`, 'margin-top:14px;')}` });
  const r = await sendEmail({ apiKey: env.RESEND_API_KEY, from: env.MAIL_FROM, to, subject: `[Contact parrainage] ${sujetLabel} — ${prenom} ${nom}`, html, replyTo: `${prenom} ${nom} <${email}>` });
  return jsonResp(r.ok ? 200 : 502, { ok: !!r.ok, via: r.via, status: r.status });
}

async function handleDelete(event) {
  // v250l — Accepte 2 auths : PARRAINAGE_ADMIN_TOKEN (back-office) OU JWT pro role=admin.
  const adminToken = process.env.PARRAINAGE_ADMIN_TOKEN || '';
  const proSecret  = process.env.PRO_JWT_SECRET || '';
  const authHdr = event.headers.authorization || event.headers.Authorization || '';
  const bearer = authHdr.startsWith('Bearer ') ? authHdr.slice(7) : '';

  let authOk = false;
  let isAdmin = false;

  if (adminToken && bearer === adminToken) {
    authOk = true; isAdmin = true;
  }
  if (!authOk && proSecret && bearer) {
    try {
      const { verifyToken } = require('./pro-login');
      const payload = verifyToken(bearer, proSecret);
      if (payload && payload.r === 'admin') { authOk = true; isAdmin = true; }
    } catch (_e) { /* ignore */ }
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
  // v263 — update filleul status
  if (event.httpMethod === 'POST' && action === 'set-status') return handleSetStatus(event);
  if (event.httpMethod === 'POST' && action === 'update') return handleUpdate(event);
  // v283 — prime de parrainage + contact
  if (event.httpMethod === 'POST' && action === 'prime-notify') return handlePrimeNotify(event);
  if (event.httpMethod === 'GET'  && action === 'prime-info')   return handlePrimeInfo(event);
  if (event.httpMethod === 'POST' && action === 'prime-sign')   return handlePrimeSign(event);
  if (event.httpMethod === 'POST' && action === 'prime-otp')    return handlePrimeOtp(event);
  if (event.httpMethod === 'GET'  && action === 'prime-doc')    return handlePrimeDoc(event);
  if (event.httpMethod === 'POST' && action === 'contact')      return handleContact(event);
  if (event.httpMethod === 'POST' && action === 'rdv')          return handleRdv(event);
  // v284 — intégration RIP + surveillance
  if (event.httpMethod === 'POST' && action === 'set-rip-secret') return handleSetRipSecret(event);
  if (event.httpMethod === 'POST' && action === 'rip-resync')     return handleRipResync(event);
  if (event.httpMethod === 'GET'  && action === 'ping')           return handlePing();
  if (action === 'healthcheck')                                   return handleHealthcheck(event);
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

  // v250l — ANTI-SPAM / ANTI-FRAUDE (fix demandé par audit + cas Robert Williams)
  // Rejette les patterns typiques de bots/spam :
  //   1. Même prénom+nom pour parrain et filleul
  //   2. Même email pour parrain et filleul (partout)
  //   3. Numéros de téléphone US format spam ((202) 555-0122 = Google fake number)
  //   4. TLD à haut risque (.ru, .tk, .ml, .ga, .cf, .xyz sur emails suspects)
  //   5. Conseiller inconnu (uniquement Corentin/David/Nicolas/"Paris Conseils")
  //   6. Prénom == Nom (Robert Williams, John Doe, etc.)
  const spamReasons = [];
  const KNOWN_CONSEILLERS = ['paris conseils','corentin','curtet','corentin curtet','david','pereira','david pereira','nicolas','moreau','nicolas moreau'];
  const RISK_TLD = /\.(ru|tk|ml|ga|cf)$/i;
  const FAKE_PHONE = /\(?\s*(202|555|800)\s*\)?\s*[-\s]?\s*555\s*[-\s]?\s*\d{4}/;
  const conLc = conseiller.toLowerCase().trim();
  if (!KNOWN_CONSEILLERS.some(c => conLc.includes(c) || c.includes(conLc))) {
    spamReasons.push('conseiller inconnu');
  }
  if (parrain.prenom && parrain.nom && parrain.prenom.toLowerCase() === parrain.nom.toLowerCase()) {
    spamReasons.push('parrain prenom=nom');
  }
  if (parrain.email && RISK_TLD.test(parrain.email)) spamReasons.push('parrain tld risqué');
  if (parrain.tel && FAKE_PHONE.test(parrain.tel)) spamReasons.push('parrain tel factice');
  for (const f of filleuls) {
    if (parrain.email && f.email && parrain.email === f.email) { spamReasons.push('email parrain=filleul'); break; }
    if (parrain.prenom && parrain.nom && f.prenom && f.nom
        && parrain.prenom.toLowerCase() === f.prenom.toLowerCase()
        && parrain.nom.toLowerCase() === f.nom.toLowerCase()) { spamReasons.push('nom complet parrain=filleul'); break; }
    if (f.prenom && f.nom && f.prenom.toLowerCase() === f.nom.toLowerCase()) { spamReasons.push('filleul prenom=nom'); break; }
    if (f.email && RISK_TLD.test(f.email)) { spamReasons.push('filleul tld risqué'); break; }
    if (f.tel && FAKE_PHONE.test(f.tel)) { spamReasons.push('filleul tel factice'); break; }
  }
  if (spamReasons.length) {
    // Log dans un blob dédié pour audit, ne rien envoyer
    try {
      const spamStore = getBlobStore('parrainages-spam');
      await spamStore.setJSON(crypto.randomUUID(), {
        rejectedAt: new Date().toISOString(),
        ip: event.headers['x-forwarded-for'] || event.headers['client-ip'] || null,
        userAgent: event.headers['user-agent'] || null,
        reasons: spamReasons,
        parrain, conseiller, filleuls
      });
    } catch (_e) { /* silent */ }
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Soumission refusée. Contactez contact@parisconseils.fr si besoin.' }) };
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

  // v277 — Historique du parrain sur l'année civile (pour paliers / rétroactivité dans les mails).
  // nbAvant = filleuls déjà transmis cette année AVANT cette soumission (hors ce record).
  // Override admin possible via payload.nbFilleulsAvant (nombre) si l'historique n'est pas dans les blobs.
  let nbAvant = 0;
  if (typeof payload.nbFilleulsAvant === 'number' && payload.nbFilleulsAvant >= 0) {
    nbAvant = Math.floor(payload.nbFilleulsAvant);
  } else {
    nbAvant = await countFilleulsAnneeParrain(parrain.email, parrainageId);
  }
  const nbApres = nbAvant + filleuls.length;

  // v278 — Notification dashboard RIP (fire-and-forget, résultat renvoyé dans la réponse)
  const ripSlugs = conseillerSlugs(conseiller);
  const ripPromise = notifyRipDashboard(env, {
    event: 'parrainage.created',
    id: parrainageId,
    createdAt: record.createdAt,
    conseiller: conseillerComplet(conseiller),
    conseillerSlug: ripSlugs ? ripSlugs.rip : null,
    parrain: record.parrain,
    filleuls: record.filleuls,
    nbFilleuls: record.nbFilleuls,
    status: record.status,
    histo: { nbAvant, nbApres, cumulPotentiel: cumulAt(nbApres) },
    source: 'parrainage.parisconseils.fr'
  });

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
      html: emailParrain({ parrain, conseiller, filleuls, total, nbAvant, nbApres }),
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
    html: emailConseiller({ parrain, conseiller, filleuls, nbAvant, nbApres }),
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
      rip: await ripPromise,
      histo: { nbAvant, nbApres },
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
