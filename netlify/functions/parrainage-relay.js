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
// build-stamp: 2026-09-09-v276-RIP-EXACT
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
// v276 — Templates mails parrainage alignés STRICTEMENT sur les mails RIP
// (rip.parisconseils.fr : "C'est confirmé" / "C'est demain").
// Typo : H1 Cormorant Garamond 700 34px navy · corps 15px #1a1a1a · eyebrow or
// uppercase 12px · hero cream (#faf5e6, bord #e8d9b5) · badge or contour ·
// CTA navy 700 16px · info beige 14px. Dark-mode Apple Mail : background-image PNG.
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
const FONT_BODY = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const FONT_SERIF = "'Cormorant Garamond',Georgia,'Times New Roman',serif";

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
<body class="pc-text" style="margin:0;padding:0;background:${RIP_BG};font-family:${FONT_BODY};color:${RIP_TEXT};font-size:15px;line-height:1.6;-webkit-font-smoothing:antialiased;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:${RIP_BG};padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="640" ${whiteTd} style="max-width:640px;${whiteStyle}border-radius:14px;overflow:hidden;border:1px solid ${RIP_LINE};">
        <tr><td class="pc-navy-bg" bgcolor="${RIP_NAVY}" background="${PX_NAVY_ATTR}" style="background:${RIP_NAVY};background-color:${RIP_NAVY};background-image:${PX_NAVY_PNG};background-repeat:repeat;padding:30px 32px;text-align:center;">
          <img src="${RIP_LOGO}" alt="Paris Conseils — Ingénierie financière & optimisation fiscale" width="260" height="104" style="display:block;height:auto;max-width:260px;width:100%;border:0;outline:none;text-decoration:none;margin:0 auto;">
        </td></tr>
        <tr><td bgcolor="${RIP_GOLD}" style="height:3px;background:${RIP_GOLD};background-color:${RIP_GOLD};background-image:${PX_GOLD_PNG};line-height:0;font-size:0;">&nbsp;</td></tr>
        <tr><td ${whiteTd} style="${whiteStyle}padding:34px 40px 0 40px;">
          ${eyebrow ? `<div class="pc-gold-text" style="font-family:${FONT_BODY};font-size:12px;letter-spacing:2px;color:${RIP_GOLD};font-weight:700;text-transform:uppercase;margin:0 0 10px;">${eyebrow}</div>` : ''}
          <h1 class="pc-navy-text" style="font-family:${FONT_SERIF};font-size:34px;font-weight:700;color:${RIP_NAVY};line-height:1.15;margin:0 0 22px;">${title}</h1>
        </td></tr>
        <tr><td ${whiteTd} class="pc-white-card pc-text" style="${whiteStyle}padding:0 40px 36px 40px;font-family:${FONT_BODY};font-size:15px;line-height:1.65;color:${RIP_TEXT};">${body}</td></tr>
        <tr><td class="pc-navy-bg" bgcolor="${RIP_NAVY}" background="${PX_NAVY_ATTR}" style="background:${RIP_NAVY};background-color:${RIP_NAVY};background-image:${PX_NAVY_PNG};background-repeat:repeat;padding:22px 34px;text-align:center;font-family:${FONT_BODY};font-size:12px;">
          <div style="color:${RIP_GOLDS};letter-spacing:1.5px;margin-bottom:6px;">Paris Conseils &middot; Ingénierie financière & optimisation fiscale</div>
          <div style="color:#94a0b8;">Confidentialité absolue &middot; Secret professionnel</div>
        </td></tr>
      </table>
      <div style="max-width:640px;padding:16px 12px 0;color:${RIP_MUTED};font-family:${FONT_BODY};font-size:11px;text-align:center;">
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
  return `<p style="margin:0 0 16px;font-family:${FONT_BODY};font-size:15px;line-height:1.65;color:${RIP_TEXT};${extra||''}">${html}</p>`;
}
function pSoft(html) {
  return `<p style="margin:0 0 16px;font-family:${FONT_BODY};font-size:14px;line-height:1.65;color:${RIP_TEXT_SOFT};">${html}</p>`;
}
function heroCream(eyebrow, headline, note) {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:6px 0 22px;">
    <tr><td class="pc-cream" bgcolor="${RIP_CREAM}" style="background:${RIP_CREAM};background-color:${RIP_CREAM};border:1px solid ${RIP_CREAM_LINE};border-radius:12px;padding:24px 28px;text-align:center;">
      <div class="pc-gold-text" style="font-family:${FONT_BODY};font-size:12px;letter-spacing:2px;color:${RIP_GOLD};font-weight:700;text-transform:uppercase;margin-bottom:12px;">${eyebrow}</div>
      <div class="pc-navy-text" style="font-family:${FONT_SERIF};font-size:30px;line-height:1.2;color:${RIP_NAVY};font-weight:700;">${headline}</div>
      ${note ? `<div style="font-family:${FONT_BODY};font-size:14px;color:${RIP_TEXT_SOFT};margin-top:10px;line-height:1.5;">${note}</div>` : ''}
    </td></tr>
  </table>`;
}
function goldBadge(label) {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:26px auto 14px;">
    <tr><td class="pc-cream" bgcolor="${RIP_CREAM}" style="background:${RIP_CREAM};border:1px solid ${RIP_GOLDS};border-radius:999px;padding:9px 20px;font-family:${FONT_BODY};font-size:11px;letter-spacing:2px;color:${RIP_GOLD};font-weight:700;text-transform:uppercase;white-space:nowrap;">${label}</td></tr>
  </table>`;
}
function h2Serif(text) {
  return `<div class="pc-navy-text" style="font-family:${FONT_SERIF};font-size:26px;font-weight:700;color:${RIP_NAVY};line-height:1.2;text-align:center;margin:0 0 14px;">${text}</div>`;
}
function ctaNavy(href, label) {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:6px 0 22px;">
    <tr><td align="center">
      <a href="${href}" class="pc-white-text" style="display:inline-block;background:${RIP_NAVY};background-color:${RIP_NAVY};color:#ffffff;padding:16px 40px;text-decoration:none;border-radius:10px;font-family:${FONT_BODY};font-weight:700;font-size:16px;line-height:1.2;">${label}</a>
    </td></tr>
  </table>`;
}
function infoBeige(html) {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0 0;">
    <tr><td class="pc-cream" bgcolor="${RIP_CREAM}" style="background:${RIP_CREAM};background-color:${RIP_CREAM};border:1px solid ${RIP_CREAM_LINE};border-radius:10px;padding:18px 22px;font-family:${FONT_BODY};font-size:14px;color:${RIP_TEXT};line-height:1.65;">${html}</td></tr>
  </table>`;
}
function signature() {
  return `<p style="margin:26px 0 0;font-family:${FONT_BODY};font-size:15px;line-height:1.6;color:${RIP_TEXT};">À très bientôt,<br><b class="pc-navy-text" style="color:${RIP_NAVY};">L'équipe Paris Conseils</b></p>`;
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
// Slugs RIP (rip.parisconseils.fr/<slug>) et RDV (parrainage.parisconseils.fr/rdv-<slug>.html)
function conseillerSlugs(value) {
  const v = (value || '').toString().trim().toLowerCase();
  if (v.includes('pereira') || v.includes('david'))    return { rip:'david-pereira',   rdv:'david' };
  if (v.includes('moreau')  || v.includes('nicolas'))  return { rip:'nicolas-moreau',  rdv:'nicolas' };
  if (v.includes('curtet')  || v.includes('corentin')) return { rip:'corentin-curtet', rdv:'corentin' };
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIL PARRAIN — accusé de réception
// ═══════════════════════════════════════════════════════════════════════════
function emailParrain({ parrain, conseiller, filleuls, total }) {
  const consNom = conseillerComplet(conseiller);
  const consPrenom = conseillerPrenom(conseiller) || 'votre conseiller';
  const nb = filleuls.length;
  const filleulsHtml = filleuls.map(f => `${escapeHtml(f.prenom)} ${escapeHtml(f.nom)}`).join('<br>');
  const premierPrenom = escapeHtml(filleuls[0] && filleuls[0].prenom || 'votre filleul');

  const body = `
${p(`Bonjour ${escapeHtml(parrain.prenom)},`)}
${p(`Nous avons bien reçu votre recommandation. <b>${nb > 1 ? 'Vos proches ont' : premierPrenom + ' a'} été transmis</b> à <b>${escapeHtml(consNom)}</b>, qui prendra contact ${nb > 1 ? 'avec chacun' : 'avec lui'} sous <b>48&nbsp;heures</b>.`)}
${heroCream(nb > 1 ? 'Vos filleuls' : 'Votre filleul', filleulsHtml, `transmis à ${escapeHtml(consNom)}`)}
${heroCream('Votre prime potentielle', `${Number(total).toLocaleString('fr-FR')}&nbsp;€`, `versée dès que ${nb > 1 ? 'vos filleuls deviennent clients' : premierPrenom + ' devient client'} · plafond 15&nbsp;000&nbsp;€ par an`)}
${p(`Vous connaissez d'autres proches qui pourraient bénéficier d'un accompagnement patrimonial&nbsp;? Chaque nouvelle recommandation augmente votre prime.`)}
${ctaNavy('https://parrainage.parisconseils.fr/parrainage.html', 'Recommander un autre proche')}
${infoBeige(`<b>Votre RIB&nbsp;:</b> pour le versement de votre prime, vous pourrez nous le communiquer à tout moment par simple retour de mail — aucune urgence, cela n'a aucun impact sur l'enregistrement de votre parrainage.<br><br><b>Confidentialité&nbsp;:</b> en soumettant cette recommandation, vous avez autorisé Paris Conseils à contacter ${nb > 1 ? 'les personnes ci-dessus' : premierPrenom}. Vous pouvez retirer cette autorisation à tout moment en écrivant à <a href="mailto:contact@parisconseils.fr" style="color:${RIP_NAVY};font-weight:600;">contact@parisconseils.fr</a>.`)}
${signature()}`;

  return baseShell({
    title: `Merci, ${escapeHtml(parrain.prenom)}`,
    eyebrow: 'Votre recommandation est bien reçue',
    body
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIL CONSEILLER — notification interne
// ═══════════════════════════════════════════════════════════════════════════
function emailConseiller({ parrain, conseiller, filleuls }) {
  const consPrenom = conseillerPrenom(conseiller) || 'cher conseiller';
  const nb = filleuls.length;
  const filleulsHtml = filleuls.map(f => `${escapeHtml(f.prenom)} ${escapeHtml(f.nom)}`).join('<br>');
  const contact = [];
  if (parrain.email) contact.push(`<a href="mailto:${escapeHtml(parrain.email)}" style="color:${RIP_NAVY};font-weight:600;">${escapeHtml(parrain.email)}</a>`);
  if (parrain.tel)   contact.push(`<a href="tel:${escapeHtml(parrain.tel)}" style="color:${RIP_NAVY};font-weight:600;">${escapeHtml(parrain.tel)}</a>`);

  const body = `
${p(`Bonjour ${escapeHtml(consPrenom)},`)}
${p(`<b>${escapeHtml(parrain.prenom)} ${escapeHtml(parrain.nom)}</b> vient de vous recommander <b>${nb} nouveau${nb>1?'x':''} filleul${nb>1?'s':''}</b>.`)}
${heroCream('À contacter sous 48 heures', filleulsHtml, `recommandé${nb>1?'s':''} par ${escapeHtml(parrain.prenom)} ${escapeHtml(parrain.nom)}`)}
${ctaNavy('https://paris-conseils-dashboard.netlify.app/equipe.html', 'Ouvrir le dashboard équipe')}
${infoBeige(`<b>Confidentialité RGPD&nbsp;:</b> les coordonnées des filleuls ne figurent pas dans cet e-mail. Ouvrez le dashboard pour consulter nom, e-mail, téléphone, projet et statut, et pour marquer chaque filleul comme contacté.${contact.length ? `<br><br><b>Parrain à remercier&nbsp;:</b> ${escapeHtml(parrain.prenom)} ${escapeHtml(parrain.nom)} — ${contact.join(' · ')}` : ''}`)}
<p style="margin:26px 0 0;font-family:${FONT_BODY};font-size:15px;line-height:1.6;color:${RIP_TEXT};">Merci de votre réactivité,<br><b class="pc-navy-text" style="color:${RIP_NAVY};">L'équipe Paris Conseils</b></p>`;

  return baseShell({
    title: `${nb} nouveau${nb>1?'x':''} filleul${nb>1?'s':''} à contacter`,
    eyebrow: 'Nouvelle recommandation · à traiter sous 48 h',
    body
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIL FILLEUL — annonce + planning conseiller + note patrimoniale (RIP)
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
${rdvHref ? p(`Si vous souhaitez anticiper, vous pouvez consulter directement le planning de ${escapeHtml(consPrenom)} et choisir le créneau qui vous convient le mieux — en visioconférence ou par téléphone, une trentaine de minutes.`) : ''}
${rdvHref ? ctaNavy(rdvHref, `Consulter le planning de ${escapeHtml(consPrenom)}`) : ''}

${goldBadge('Avant votre rendez-vous')}
${h2Serif('Connaissez-vous votre note patrimoniale&nbsp;?')}
${p(`En dix minutes, notre bilan patrimonial en ligne évalue votre situation — endettement, épargne, patrimoine, protection de vos proches, fiscalité — et vous attribue une note de <b>A+</b> (profil exceptionnel) à <b>G−</b> (profil très fragile). Elle situe votre profil sans le juger, et permet à ${escapeHtml(consPrenom || 'votre conseiller')} de préparer votre échange sur du concret&nbsp;: vos points forts, vos leviers, ce qui peut être optimisé.`, 'text-align:center;')}
${ctaNavy(ripHref, 'Obtenir ma note patrimoniale')}
${pSoft(`Gratuit et confidentiel. ${hasCons ? `${escapeHtml(consNom)} est déjà sélectionné comme votre conseiller&nbsp;: vous validez simplement l'engagement de confidentialité par un code reçu par e-mail, puis vous répondez à l'essentiel.` : `Vous validez l'engagement de confidentialité par un code reçu par e-mail, puis vous répondez à l'essentiel.`}`)}

${infoBeige(`<b>Aucun engagement, ni juridique ni financier.</b> Cet échange est strictement confidentiel&nbsp;: il sert à comprendre votre situation et vos objectifs, et à voir si un accompagnement sur-mesure — optimisation fiscale, structuration de votre patrimoine, préparation d'un projet — peut vous être utile. ${parrainPrenom} a pensé à vous pour vous rendre service, pas pour vous engager. Si vous préférez ne pas être contacté, il vous suffit de répondre à cet e-mail.`)}
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
