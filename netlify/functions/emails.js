// Templates HTML des 3 emails du parrainage Paris Conseils
// — Email 1 : Parrain     (confirmation soignée : récap, paliers, prime, IBAN masqué)
// — Email 2 : Conseiller  (fiche opérationnelle : parrain + IBAN complet, filleuls cliquables, checklist)
// — Email 3 : Filleul     (annonce élégante et sobre, sans mention d'argent)
//
// Charte : navy #1a2842, or #c9a542, crème #fbf7ec, serif Georgia/Playfair.
// Contraintes email : tables + styles inline uniquement, couleurs pleines
// (les dégradés et polices web sont ignorés par Outlook/Gmail).

const NAVY     = '#1a2842';
const NAVY_D   = '#0c1a35';
const GOLD     = '#c9a542';
const GOLD_L   = '#f0d077';
const GOLD_BG  = '#faf3df';
const CREAM    = '#fbf7ec';
const INK      = '#1f2430';
const MUTED    = '#6b7280';
const LINE     = '#e8e2d2';

const LOGO_URL      = 'https://parrainage.parisconseils.fr/logo-paris-conseils.png';
const SITE_URL      = 'https://parrainage.parisconseils.fr/parrainage.html';
const DASHBOARD_URL = 'https://visionary-croquembouche-672f9b.netlify.app/equipe.html';
const CONTACT_EMAIL = 'contact@parisconseils.fr';

const SERIF   = "Georgia,'Times New Roman',serif";
const TITLE_F = "'Playfair Display',Georgia,'Times New Roman',serif";

const escapeHtml = (s) => String(s || '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// IBAN affiché en clair mais groupé par 4 (lisibilité conseiller)
function formatIban(iban) {
  return String(iban || '').replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim();
}

// IBAN masqué pour le parrain : FR86 ···· ···· 3325
function maskIban(iban) {
  const raw = String(iban || '').replace(/\s+/g, '');
  if (raw.length < 8) return '';
  return raw.slice(0, 4) + ' ···· ···· ' + raw.slice(-4);
}

// Bouton compatible tous clients (table, pas de <button>)
function button(href, label, { bg = GOLD, color = NAVY_D } = {}) {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:28px auto;">
    <tr>
      <td bgcolor="${bg}" style="border-radius:8px;">
        <a href="${href}" target="_blank"
           style="display:inline-block;padding:15px 34px;font-family:${SERIF};font-size:12px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:${color};text-decoration:none;border-radius:8px;">
          ${label}
        </a>
      </td>
    </tr>
  </table>`;
}

// Coquille commune : préheader caché, en-tête navy + logo, filet or, corps, pied de page
function baseShell({ title, preheader, eyebrow, heading, subtitle, body }) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:${CREAM};font-family:${SERIF};color:${INK};">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader || '')}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>

  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" bgcolor="${CREAM}" style="background:${CREAM};padding:36px 12px;">
    <tr><td align="center">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="width:600px;max-width:100%;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 6px 30px rgba(12,26,53,0.10);">

        <!-- En-tete navy + logo -->
        <tr>
          <td bgcolor="${NAVY}" style="background:${NAVY};padding:28px 40px;text-align:center;">
            <img src="${LOGO_URL}" alt="Paris Conseils" width="190" style="display:inline-block;max-width:190px;height:auto;border:0;">
          </td>
        </tr>
        <tr><td bgcolor="${GOLD}" style="height:3px;line-height:3px;font-size:0;background:${GOLD};">&nbsp;</td></tr>

        <!-- Eyebrow + titre -->
        <tr>
          <td style="padding:32px 44px 0 44px;text-align:center;">
            <div style="font-family:${SERIF};font-size:11px;letter-spacing:4px;color:${GOLD};text-transform:uppercase;font-weight:700;">${eyebrow}</div>
            <h1 style="font-family:${TITLE_F};font-size:27px;font-weight:400;color:${NAVY_D};margin:12px 0 0 0;line-height:1.25;">${heading}</h1>
            ${subtitle ? `<div style="font-family:${SERIF};font-style:italic;font-size:14px;color:${MUTED};margin-top:10px;">${subtitle}</div>` : ''}
          </td>
        </tr>

        <!-- Corps -->
        <tr>
          <td style="padding:22px 44px 34px 44px;font-family:${SERIF};font-size:15px;line-height:1.75;color:${INK};">
            ${body}
          </td>
        </tr>

        <!-- Pied de page -->
        <tr>
          <td bgcolor="${NAVY_D}" style="background:${NAVY_D};padding:26px 40px;text-align:center;">
            <div style="font-family:${TITLE_F};font-size:15px;color:#ffffff;letter-spacing:1px;">Paris Conseils</div>
            <div style="font-family:${SERIF};font-size:11px;color:#8b97b3;margin-top:6px;letter-spacing:1px;">Ingénierie financière &amp; optimisation fiscale</div>
            <div style="font-family:${SERIF};font-size:11px;color:#8b97b3;margin-top:2px;">Confidentialité absolue · Secret professionnel</div>
            <div style="margin-top:14px;font-size:12px;">
              <a href="${SITE_URL}" style="color:${GOLD_L};text-decoration:none;">parrainage.parisconseils.fr</a>
              <span style="color:#4a5872;">&nbsp;·&nbsp;</span>
              <a href="mailto:${CONTACT_EMAIL}" style="color:${GOLD_L};text-decoration:none;">${CONTACT_EMAIL}</a>
            </div>
          </td>
        </tr>

      </table>

      <div style="max-width:600px;margin:16px auto 0 auto;font-family:${SERIF};font-size:11px;color:#9aa0ab;text-align:center;line-height:1.6;">
        Vous recevez cet email dans le cadre du programme de parrainage Paris Conseils.<br>
        Pour toute question ou suppression de vos données : <a href="mailto:${CONTACT_EMAIL}" style="color:#9aa0ab;">${CONTACT_EMAIL}</a>
      </div>
    </td></tr>
  </table>
</body></html>`;
}

// Carte listant les filleuls (partagée parrain/conseiller, densité différente)
function filleulsCard(filleuls, { withActions = false } = {}) {
  const rows = filleuls.map((f, i) => `
    <tr>
      <td width="44" valign="top" style="padding:16px 0 16px 20px;">
        <div style="width:28px;height:28px;line-height:28px;border-radius:50%;background:${NAVY};color:${GOLD_L};font-family:${SERIF};font-size:13px;font-weight:700;text-align:center;">${i + 1}</div>
      </td>
      <td valign="top" style="padding:14px 20px 16px 10px;${i < filleuls.length - 1 ? `border-bottom:1px solid ${LINE};` : ''}">
        <div style="font-family:${TITLE_F};font-size:17px;color:${NAVY_D};">${escapeHtml(f.prenom)} ${escapeHtml(f.nom)}</div>
        <div style="font-size:13px;color:${MUTED};margin-top:5px;line-height:1.9;">
          ${f.email ? (withActions
            ? `✉&nbsp; <a href="mailto:${escapeHtml(f.email)}" style="color:${NAVY};text-decoration:none;border-bottom:1px solid ${GOLD};">${escapeHtml(f.email)}</a><br>`
            : `✉&nbsp; ${escapeHtml(f.email)}<br>`) : ''}
          ${f.tel ? (withActions
            ? `☎&nbsp; <a href="tel:${escapeHtml(String(f.tel).replace(/\s+/g, ''))}" style="color:${NAVY};text-decoration:none;border-bottom:1px solid ${GOLD};">${escapeHtml(f.tel)}</a>`
            : `☎&nbsp; ${escapeHtml(f.tel)}`) : ''}
          ${f.message ? `<div style="margin-top:6px;font-style:italic;color:${INK};">« ${escapeHtml(f.message)} »</div>` : ''}
        </div>
      </td>
    </tr>`).join('');

  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${CREAM}" style="background:${CREAM};border-radius:12px;border:1px solid ${LINE};margin:6px 0 24px 0;">
    ${rows}
  </table>`;
}

// ============================================================================
// EMAIL 1 — PARRAIN (confirmation)
// ============================================================================
function emailParrain({ parrain, conseiller, filleuls, total, iban }) {
  const n = filleuls.length;
  const masked = maskIban(iban);

  const body = `
    <p style="margin:0 0 16px 0;">Bonjour ${escapeHtml(parrain.prenom)},</p>

    <p style="margin:0 0 16px 0;">Merci pour votre confiance. Votre recommandation de
    <strong>${n} proche${n > 1 ? 's' : ''}</strong> est bien enregistrée et transmise à
    <strong>${escapeHtml(conseiller)}</strong>, qui contactera ${n > 1 ? 'chacun d’eux' : 'votre filleul'}
    personnellement <strong>sous 48&nbsp;heures</strong>.</p>

    <div style="font-family:${SERIF};font-size:11px;letter-spacing:3px;color:${GOLD};text-transform:uppercase;font-weight:700;margin:26px 0 10px 0;">Votre recommandation</div>
    ${filleulsCard(filleuls)}

    <!-- Etapes -->
    <div style="font-family:${SERIF};font-size:11px;letter-spacing:3px;color:${GOLD};text-transform:uppercase;font-weight:700;margin:26px 0 10px 0;">Les prochaines étapes</div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 8px 0;">
      <tr>
        <td width="30" valign="top" style="padding:6px 0;font-family:${TITLE_F};font-size:18px;color:${GOLD};">1.</td>
        <td style="padding:6px 0;font-size:14px;">${escapeHtml(conseiller)} appelle ${n > 1 ? 'vos filleuls' : 'votre filleul'} sous 48&nbsp;h pour un premier échange, <strong>sans aucun engagement</strong>.</td>
      </tr>
      <tr>
        <td valign="top" style="padding:6px 0;font-family:${TITLE_F};font-size:18px;color:${GOLD};">2.</td>
        <td style="padding:6px 0;font-size:14px;">Vous êtes tenu informé de l'avancement à chaque étape clé.</td>
      </tr>
      <tr>
        <td valign="top" style="padding:6px 0;font-family:${TITLE_F};font-size:18px;color:${GOLD};">3.</td>
        <td style="padding:6px 0;font-size:14px;">Dès la première souscription d'un filleul, <strong>votre prime est versée</strong>${masked ? ' sur votre compte' : ''}.</td>
      </tr>
    </table>

    <!-- Prime -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${NAVY}" style="background:${NAVY};border-radius:12px;margin:26px 0;">
      <tr>
        <td style="padding:26px 28px;text-align:center;">
          <div style="font-family:${SERIF};font-size:11px;letter-spacing:3px;color:${GOLD_L};text-transform:uppercase;">Prime potentielle de cette recommandation</div>
          <div style="font-family:${TITLE_F};font-size:40px;color:${GOLD_L};margin-top:8px;">${Number(total || 0).toLocaleString('fr-FR')}&nbsp;€</div>
          <div style="font-size:12px;color:#aebad2;font-style:italic;margin-top:8px;">versée pour chaque filleul qui devient client</div>
          ${masked ? `<div style="font-size:12px;color:#aebad2;margin-top:14px;padding-top:14px;border-top:1px solid #33415e;">Versement sur votre compte <span style="font-family:'Courier New',monospace;color:#ffffff;">${escapeHtml(masked)}</span></div>` : ''}
        </td>
      </tr>
    </table>

    <!-- Paliers -->
    <div style="font-family:${SERIF};font-size:11px;letter-spacing:3px;color:${GOLD};text-transform:uppercase;font-weight:700;margin:26px 0 10px 0;">Le barème du programme</div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid ${LINE};border-radius:10px;background:#ffffff;">
      <tr>
        <td style="padding:13px 20px;border-bottom:1px solid ${LINE};font-size:14px;">Filleuls 1 et 2</td>
        <td align="right" style="padding:13px 20px;border-bottom:1px solid ${LINE};font-family:${TITLE_F};font-size:16px;color:${NAVY_D};white-space:nowrap;"><strong>500&nbsp;€</strong> chacun</td>
      </tr>
      <tr>
        <td bgcolor="${GOLD_BG}" style="padding:13px 20px;border-bottom:1px solid ${LINE};font-size:14px;background:${GOLD_BG};">Dès le 3<sup>e</sup> filleul <span style="color:${MUTED};font-style:italic;">(effet rétroactif sur les deux premiers)</span></td>
        <td bgcolor="${GOLD_BG}" align="right" style="padding:13px 20px;border-bottom:1px solid ${LINE};font-family:${TITLE_F};font-size:16px;color:${NAVY_D};background:${GOLD_BG};white-space:nowrap;"><strong>1&nbsp;500&nbsp;€</strong> chacun</td>
      </tr>
      <tr>
        <td style="padding:13px 20px;font-size:14px;">Plafond annuel <span style="color:${MUTED};font-style:italic;">(10 filleuls)</span></td>
        <td align="right" style="padding:13px 20px;font-family:${TITLE_F};font-size:16px;color:${NAVY_D};white-space:nowrap;"><strong>15&nbsp;000&nbsp;€</strong></td>
      </tr>
    </table>

    ${button(SITE_URL, 'Recommander un autre proche')}

    <p style="margin:24px 0 0 0;">Bien cordialement,<br>
    <strong>${escapeHtml(conseiller)}</strong><br>
    <span style="color:${MUTED};font-size:13px;">Paris Conseils — Ingénierie financière &amp; optimisation fiscale</span></p>`;

  return baseShell({
    title: 'Votre recommandation est bien enregistrée',
    preheader: `${n} filleul${n > 1 ? 's' : ''} transmis à ${conseiller} — premier contact sous 48 h.`,
    eyebrow: 'Confirmation de parrainage',
    heading: 'Votre recommandation est bien enregistrée',
    subtitle: `${n} filleul${n > 1 ? 's' : ''} · suivi par ${escapeHtml(conseiller)}`,
    body
  });
}

// ============================================================================
// EMAIL 2 — CONSEILLER (fiche opérationnelle)
// ============================================================================
function emailConseiller({ parrain, conseiller, filleuls, iban }) {
  const n = filleuls.length;
  const telRaw = String(parrain.tel || '').replace(/\s+/g, '');

  const body = `
    <p style="margin:0 0 16px 0;">Bonjour ${escapeHtml(conseiller)},</p>

    <p style="margin:0 0 16px 0;">Un nouveau parrainage vient d'arriver&nbsp;: <strong>${n} filleul${n > 1 ? 's' : ''}</strong> à contacter
    <strong>sous 48&nbsp;heures</strong>. La fiche complète est ci-dessous — tout est cliquable.</p>

    <!-- Fiche parrain -->
    <div style="font-family:${SERIF};font-size:11px;letter-spacing:3px;color:${GOLD};text-transform:uppercase;font-weight:700;margin:26px 0 10px 0;">Le parrain</div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${NAVY}" style="background:${NAVY};border-radius:12px;">
      <tr>
        <td style="padding:22px 26px;">
          <div style="font-family:${TITLE_F};font-size:20px;color:#ffffff;">${escapeHtml(parrain.prenom)} ${escapeHtml(parrain.nom)}</div>
          <div style="font-size:13px;line-height:2;margin-top:8px;">
            <span style="color:#8b97b3;">✉&nbsp;</span><a href="mailto:${escapeHtml(parrain.email)}" style="color:${GOLD_L};text-decoration:none;">${escapeHtml(parrain.email)}</a><br>
            ${parrain.tel ? `<span style="color:#8b97b3;">☎&nbsp;</span><a href="tel:${escapeHtml(telRaw)}" style="color:${GOLD_L};text-decoration:none;">${escapeHtml(parrain.tel)}</a><br>` : ''}
            ${iban
              ? `<span style="color:#8b97b3;">IBAN prime&nbsp;:&nbsp;</span><span style="font-family:'Courier New',monospace;color:#ffffff;font-size:13px;">${escapeHtml(formatIban(iban))}</span>`
              : `<span style="color:#8b97b3;font-style:italic;">IBAN non fourni — à demander avant le versement de la prime.</span>`}
          </div>
        </td>
      </tr>
    </table>

    <!-- Filleuls -->
    <div style="font-family:${SERIF};font-size:11px;letter-spacing:3px;color:${GOLD};text-transform:uppercase;font-weight:700;margin:28px 0 10px 0;">Filleul${n > 1 ? 's' : ''} à contacter</div>
    ${filleulsCard(filleuls, { withActions: true })}

    <!-- Checklist -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${GOLD_BG}" style="background:${GOLD_BG};border-left:4px solid ${GOLD};border-radius:8px;margin:4px 0 8px 0;">
      <tr>
        <td style="padding:18px 22px;font-size:14px;line-height:2;">
          <strong style="color:${NAVY_D};">À faire</strong><br>
          ☐&nbsp; Appeler chaque filleul <strong>sous 48&nbsp;h</strong> (mentionner ${escapeHtml(parrain.prenom)} ${escapeHtml(parrain.nom)})<br>
          ☐&nbsp; Mettre à jour le statut dans le dashboard, onglet <em>Parrainage</em><br>
          ☐&nbsp; Déclencher la prime du parrain dès la première souscription
        </td>
      </tr>
    </table>

    ${button(DASHBOARD_URL, 'Ouvrir le dashboard', { bg: NAVY, color: '#ffffff' })}

    <p style="margin:0;color:${MUTED};font-size:13px;font-style:italic;text-align:center;">Répondre à cet email écrit directement au parrain.</p>`;

  const filleulNames = filleuls.map(f => `${f.prenom} ${f.nom}`.trim()).join(', ');
  return baseShell({
    title: 'Nouveau parrainage à traiter',
    preheader: `${parrain.prenom} ${parrain.nom} recommande ${filleulNames} — premier contact sous 48 h.`,
    eyebrow: 'Action requise · sous 48 h',
    heading: 'Nouveau parrainage à traiter',
    subtitle: `${escapeHtml(parrain.prenom)} ${escapeHtml(parrain.nom)} → ${n} filleul${n > 1 ? 's' : ''}`,
    body
  });
}

// ============================================================================
// EMAIL 3 — FILLEUL (annonce élégante, aucune mention d'argent)
// ============================================================================
function emailFilleul({ parrain, conseiller, filleul }) {
  const cleanCons = (conseiller || '').toString().trim();
  const key = cleanCons.toLowerCase();
  const hasSpecific = key && key !== 'paris conseils' && key !== 'paris-conseils';
  const map = {
    'pereira': 'David Pereira',   'david pereira': 'David Pereira',
    'moreau': 'Nicolas Moreau',   'nicolas moreau': 'Nicolas Moreau',
    'curtet': 'Corentin Curtet',  'corentin curtet': 'Corentin Curtet', 'curtet corentin': 'Corentin Curtet'
  };
  const conseillerDisplay = hasSpecific ? (map[key] || cleanCons) : 'Un conseiller Paris Conseils';
  const initials = conseillerDisplay.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

  const body = `
    <p style="margin:0 0 16px 0;">Bonjour ${escapeHtml(filleul.prenom)},</p>

    <p style="margin:0 0 16px 0;"><strong>${escapeHtml(parrain.prenom)} ${escapeHtml(parrain.nom)}</strong> a souhaité vous
    recommander auprès de Paris Conseils, cabinet d'<em>ingénierie financière et d'optimisation fiscale</em>.</p>

    <p style="margin:0 0 16px 0;">Quand un proche prend le temps de vous recommander, c'est rarement anodin. Notre métier est
    d'apporter à chacun de nos clients un <strong>accompagnement sur-mesure</strong> — retraite, fiscalité, immobilier,
    transmission — dans la plus stricte confidentialité.</p>

    <!-- Interlocuteur -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${CREAM}" style="background:${CREAM};border:1px solid ${LINE};border-radius:12px;margin:28px 0;">
      <tr>
        <td style="padding:26px;text-align:center;">
          <div style="font-family:${SERIF};font-size:10px;letter-spacing:4px;color:${GOLD};text-transform:uppercase;font-weight:700;">Votre interlocuteur</div>
          <div style="width:52px;height:52px;line-height:52px;border-radius:50%;background:${NAVY};color:${GOLD_L};font-family:${TITLE_F};font-size:20px;text-align:center;margin:14px auto 10px auto;">${escapeHtml(initials)}</div>
          <div style="font-family:${TITLE_F};font-size:22px;color:${NAVY_D};">${escapeHtml(conseillerDisplay)}</div>
          <div style="font-size:13px;color:${MUTED};font-style:italic;margin-top:6px;">${hasSpecific ? 'prendra contact avec vous sous 48 heures' : 'vous contactera dans les meilleurs délais'}</div>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 16px 0;">Cette première conversation est <strong>sans engagement</strong> et n'a qu'un objectif&nbsp;:
    comprendre votre situation et vos objectifs, puis voir — en toute transparence — si nous pouvons vous être utile.</p>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:26px 0;">
      <tr>
        <td width="3" bgcolor="${GOLD}" style="background:${GOLD};border-radius:2px;font-size:0;">&nbsp;</td>
        <td style="padding:4px 0 4px 18px;font-style:italic;color:${MUTED};font-size:14px;line-height:1.7;">
          « Le savoir est la seule matière qui s'accroît quand on la partage. »<br>
          <span style="font-size:12px;">— Socrate</span>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 16px 0;color:${MUTED};font-size:13px;">Si vous préférez ne pas être contacté, répondez simplement à
    cet email — nous respecterons votre choix immédiatement.</p>

    <p style="margin:24px 0 0 0;">À très bientôt,<br>
    <strong>L'équipe Paris Conseils</strong></p>`;

  return baseShell({
    title: `${parrain.prenom} vous recommande Paris Conseils`,
    preheader: `${parrain.prenom} ${parrain.nom} vous recommande auprès de notre cabinet — premier échange sans engagement.`,
    eyebrow: 'Une recommandation pour vous',
    heading: `${escapeHtml(parrain.prenom)} vous recommande<br>Paris Conseils`,
    subtitle: 'Accompagnement confidentiel · ingénierie patrimoniale',
    body
  });
}

module.exports = { emailParrain, emailConseiller, emailFilleul, maskIban, formatIban };
