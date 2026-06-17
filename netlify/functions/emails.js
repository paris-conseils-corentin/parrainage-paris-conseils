// Templates HTML des 3 emails du parrainage Paris Conseils
// — Email 1 : Parrain (accusé de réception, ton chaleureux)
// — Email 2 : Conseiller (notification opérationnelle, ton pro)
// — Email 3 : Filleul (annonce élégante, présentation Paris Conseils)
//
// Charte : navy #1a2842, or #c9a542, crème #fbf7ec, serif Playfair pour les titres.

const NAVY     = '#1a2842';
const NAVY_D   = '#0c1a35';
const GOLD     = '#c9a542';
const GOLD_L   = '#f0d077';
const CREAM    = '#fbf7ec';
const INK      = '#1a1a1a';
const MUTED    = '#6b7280';
const LOGO_URL = 'https://parrainage.parisconseils.fr/logo-paris-conseils.png';

const baseShell = (opts) => `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><title>${opts.title}</title></head>
<body style="margin:0;padding:0;background:${CREAM};font-family:Georgia,'Times New Roman',serif;color:${INK};">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:${CREAM};padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 6px 30px rgba(12,26,53,0.08);">

        <!-- En-tête navy + logo -->
        <tr>
          <td style="background:${NAVY};padding:30px 40px;text-align:center;">
            <img src="${LOGO_URL}" alt="Paris Conseils" width="200" height="auto" style="display:inline-block;max-width:200px;height:auto;">
          </td>
        </tr>

        <!-- Filet doré -->
        <tr><td style="height:3px;background:linear-gradient(90deg, ${GOLD} 0%, ${GOLD_L} 50%, ${GOLD} 100%);"></td></tr>

        <!-- Eyebrow -->
        <tr>
          <td style="padding:28px 40px 0 40px;text-align:center;">
            <div style="font-family:Georgia,serif;font-size:10px;letter-spacing:5px;color:${GOLD};text-transform:uppercase;">${opts.eyebrow}</div>
          </td>
        </tr>

        <!-- Titre -->
        <tr>
          <td style="padding:14px 40px 8px 40px;text-align:center;">
            <h1 style="font-family:'Playfair Display',Georgia,serif;font-size:28px;font-weight:400;color:${NAVY_D};margin:0;line-height:1.2;">${opts.title}</h1>
          </td>
        </tr>

        ${opts.subtitle ? `<tr><td style="padding:0 40px 20px 40px;text-align:center;">
          <div style="font-family:Georgia,serif;font-style:italic;font-size:15px;color:${MUTED};">${opts.subtitle}</div>
        </td></tr>` : ''}

        <!-- Corps -->
        <tr><td style="padding:10px 40px 30px 40px;font-family:Georgia,serif;font-size:15px;line-height:1.7;color:${INK};">
          ${opts.body}
        </td></tr>

        <!-- Pied de page -->
        <tr><td style="background:${CREAM};padding:24px 40px;text-align:center;font-family:Georgia,serif;font-size:12px;color:${MUTED};border-top:1px solid #eee;">
          <div style="margin-bottom:8px;">Paris Conseils — Ingénierie financière &amp; optimisation fiscale</div>
          <div>Confidentialité absolue · Secret professionnel</div>
          <div style="margin-top:14px;">
            <a href="https://parrainage.parisconseils.fr" style="color:${NAVY};text-decoration:none;">parrainage.parisconseils.fr</a>
            &nbsp;·&nbsp;
            <a href="mailto:contact@parisconseils.fr" style="color:${NAVY};text-decoration:none;">contact@parisconseils.fr</a>
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`;

const escapeHtml = (s) => String(s||'').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

// v200 — Rangée d'étoiles dorées : N étoiles allumées sur 10
function starsRow(nLit) {
  const goldStar  = '★';
  const dimStar   = '☆';
  let html = '<div style="text-align:center;font-size:28px;letter-spacing:6px;line-height:1;margin:14px 0;">';
  for (let i = 0; i < 10; i++) {
    const color = i < nLit ? GOLD : '#cbd2de';
    html += `<span style="color:${color};">${i < nLit ? goldStar : dimStar}</span>`;
  }
  html += '</div>';
  return html;
}

// ============================================================================
// EMAIL 1 — PARRAIN (accusé de réception)
// ============================================================================
function emailParrain({ parrain, conseiller, filleuls, total, nbFilleulsConfirmes }) {
  const nbConfirmes = (typeof nbFilleulsConfirmes === 'number') ? nbFilleulsConfirmes : 0;
  const nbApresAjout = nbConfirmes + filleuls.length;
  // Bandeau rétro déclenché si on passe à 3+ filleuls grâce à cet envoi
  const triggersRetro = nbConfirmes < 3 && nbApresAjout >= 3;
  const stars = starsRow(Math.min(nbApresAjout, 10));
  const filleulsHtml = filleuls.map((f, i) => `
    <tr>
      <td style="padding:14px 18px;border-bottom:1px solid #f0eee6;font-family:Georgia,serif;">
        <div style="font-family:'Playfair Display',Georgia,serif;font-size:16px;color:${NAVY_D};font-weight:400;">
          ${i+1}. ${escapeHtml(f.prenom)} ${escapeHtml(f.nom)}
        </div>
        ${f.email ? `<div style="font-size:13px;color:${MUTED};margin-top:3px;">✉ ${escapeHtml(f.email)}</div>` : ''}
        ${f.tel   ? `<div style="font-size:13px;color:${MUTED};margin-top:3px;">☎ ${escapeHtml(f.tel)}</div>` : ''}
      </td>
    </tr>`).join('');

  const body = `
    <p>Bonjour ${escapeHtml(parrain.prenom)},</p>

    <p>Nous avons bien reçu votre recommandation. <strong>${filleuls.length} proche${filleuls.length>1?'s ont':' a'} été transmis</strong>
    à votre conseiller <strong>${escapeHtml(conseiller)}</strong>, qui prendra contact avec chacun sous <strong>48 heures</strong>.</p>

    <!-- Étoiles dorées du parrain -->
    <div style="background:linear-gradient(135deg,${NAVY} 0%,${NAVY_D} 100%);border-radius:14px;padding:24px 20px;margin:24px 0;text-align:center;">
      <div style="font-family:Georgia,serif;font-size:10px;letter-spacing:4px;color:${GOLD_L};text-transform:uppercase;margin-bottom:4px;">Votre constellation</div>
      ${stars}
      <div style="font-family:'Playfair Display',Georgia,serif;font-size:16px;color:${GOLD_L};font-style:italic;margin-top:4px;">${Math.min(nbApresAjout,10)} étoile${nbApresAjout>1?'s':''} sur 10</div>
    </div>

    ${triggersRetro ? `<div style="background:linear-gradient(135deg,#fffaf0 0%,#fdf6e3 100%);border:1px solid ${GOLD};border-left:4px solid ${GOLD};border-radius:10px;padding:18px 22px;margin:22px 0;">
      <div style="font-family:Georgia,serif;font-size:10px;letter-spacing:3px;color:#8a6818;text-transform:uppercase;font-weight:700;margin-bottom:6px;">★ ★ ★ Effet rétroactif déclenché</div>
      <div style="font-family:'Playfair Display',Georgia,serif;font-size:18px;color:${NAVY_D};line-height:1.4;">Avec ce 3<sup>e</sup> filleul, vos 2 premiers parrainages passent rétroactivement à <strong>1 500 €</strong>. Vous gagnez un complément de <strong>2 000 €</strong>.</div>
    </div>` : ''}

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:24px 0;background:${CREAM};border-radius:10px;">
      ${filleulsHtml}
    </table>

    <div style="background:${NAVY};color:#fff;padding:20px 24px;border-radius:10px;text-align:center;margin:24px 0;">
      <div style="font-family:Georgia,serif;font-size:11px;letter-spacing:3px;color:${GOLD_L};text-transform:uppercase;margin-bottom:6px;">Votre potentiel total</div>
      <div style="font-family:'Playfair Display',Georgia,serif;font-size:36px;font-weight:700;color:${GOLD_L};">${total.toLocaleString('fr-FR')} €</div>
      <div style="font-size:13px;color:#cfd9ec;margin-top:6px;font-style:italic;">selon les filleuls qui souscrivent — plafond 15 000 € / an</div>
    </div>

    <p style="text-align:center;margin:30px 0;">
      <a href="https://paris-conseils-parrain.netlify.app/parrainage.html"
         style="display:inline-block;background:${GOLD};color:${NAVY_D};padding:14px 30px;text-decoration:none;border-radius:8px;font-family:Georgia,serif;letter-spacing:2px;font-size:12px;text-transform:uppercase;font-weight:700;">
        ★ Recommander un nouveau filleul
      </a>
    </p>

    <p style="font-style:italic;color:${MUTED};border-left:2px solid ${GOLD};padding:6px 0 6px 16px;margin:24px 0;">
      « Le savoir est la seule matière qui s'accroît quand on la partage. »<br>
      <span style="font-size:12px;">— Socrate</span>
    </p>

    <p>Merci de votre confiance,<br>
    L'équipe Paris Conseils</p>`;

  return baseShell({
    title: 'Recommandation bien reçue',
    eyebrow: 'Accusé de réception',
    subtitle: `${filleuls.length} proche${filleuls.length>1?'s recommandés':' recommandé'} · conseiller ${escapeHtml(conseiller)}`,
    body
  });
}

// ============================================================================
// EMAIL 2 — CONSEILLER (notification opérationnelle)
// ============================================================================
function emailConseiller({ parrain, conseiller, filleuls }) {
  const filleulsHtml = filleuls.map((f, i) => `
    <tr><td style="padding:18px 20px;border-bottom:1px solid #f0eee6;font-family:Georgia,serif;">
      <div style="font-family:'Playfair Display',Georgia,serif;font-size:17px;color:${NAVY_D};font-weight:400;">
        Filleul ${i+1} · ${escapeHtml(f.prenom)} ${escapeHtml(f.nom)}
      </div>
      <table cellpadding="2" cellspacing="0" border="0" style="margin-top:8px;font-size:13px;color:${INK};">
        ${f.email   ? `<tr><td style="color:${MUTED};padding-right:14px;">Email</td><td><a href="mailto:${escapeHtml(f.email)}" style="color:${NAVY};">${escapeHtml(f.email)}</a></td></tr>` : ''}
        ${f.tel     ? `<tr><td style="color:${MUTED};padding-right:14px;">Téléphone</td><td><a href="tel:${escapeHtml(f.tel)}" style="color:${NAVY};">${escapeHtml(f.tel)}</a></td></tr>` : ''}
        ${f.message ? `<tr><td style="color:${MUTED};padding-right:14px;vertical-align:top;">Projet</td><td><em>${escapeHtml(f.message)}</em></td></tr>` : ''}
      </table>
    </td></tr>`).join('');

  const body = `
    <p>Bonjour <strong>${escapeHtml(conseiller)}</strong>,</p>

    <p>Vous venez de recevoir un nouveau parrainage de la part de
    <strong>${escapeHtml(parrain.prenom)} ${escapeHtml(parrain.nom)}</strong> &mdash;
    <a href="mailto:${escapeHtml(parrain.email)}" style="color:${NAVY};">${escapeHtml(parrain.email)}</a>
    ${parrain.tel ? `· <a href="tel:${escapeHtml(parrain.tel)}" style="color:${NAVY};">${escapeHtml(parrain.tel)}</a>` : ''}.</p>

    <p>Merci de contacter chacun des filleuls ci-dessous <strong>sous 48 heures</strong> :</p>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:20px 0;background:${CREAM};border-radius:10px;">
      ${filleulsHtml}
    </table>

    <div style="background:#fff8d0;border-left:3px solid ${GOLD};padding:14px 18px;border-radius:6px;margin:24px 0;font-size:14px;">
      <strong style="color:${NAVY_D};">Prochaine étape</strong><br>
      Ouvrir le dashboard ICA &rarr; onglet <em>Parrainage</em> pour suivre, mettre à jour le statut et déclencher la prime du parrain dès souscription.
    </div>

    <p style="margin-top:30px;">
      <a href="https://visionary-croquembouche-672f9b.netlify.app/equipe.html"
         style="display:inline-block;background:${NAVY};color:#fff;padding:14px 28px;text-decoration:none;border-radius:8px;font-family:Georgia,serif;letter-spacing:2px;font-size:12px;text-transform:uppercase;">
        Ouvrir le dashboard
      </a>
    </p>`;

  return baseShell({
    title: 'Nouveau parrainage à traiter',
    eyebrow: 'Notification conseiller',
    subtitle: `${filleuls.length} filleul${filleuls.length>1?'s':''} · à contacter sous 48 h`,
    body
  });
}

// ============================================================================
// EMAIL 3 — FILLEUL (annonce élégante)
// v200 — Conseiller mentionné explicitement : Corentin Curtet / David Pereira /
// Nicolas Moreau ou « un conseiller Paris Conseils » si aucun n'a été choisi.
// ============================================================================
function emailFilleul({ parrain, conseiller, filleul }) {
  // Normalisation : si pas de conseiller spécifique, message générique
  const cleanCons = (conseiller || '').toString().trim();
  const conseillerName = cleanCons.toLowerCase();
  const hasSpecific = conseillerName && conseillerName !== 'paris conseils' && conseillerName !== 'paris-conseils';
  // Mappage des identifiants vers noms affichables
  const map = {
    'pereira':  'David Pereira',
    'moreau':   'Nicolas Moreau',
    'curtet':   'Corentin Curtet',
    'curtet corentin': 'Corentin Curtet',
    'david pereira':   'David Pereira',
    'nicolas moreau':  'Nicolas Moreau',
    'corentin curtet': 'Corentin Curtet'
  };
  const conseillerDisplay = hasSpecific
    ? (map[conseillerName] || cleanCons)
    : 'Un conseiller Paris Conseils';
  const contactPhrase = hasSpecific
    ? `<strong>${escapeHtml(conseillerDisplay)}</strong> prendra contact avec vous sous 48 heures.`
    : `<strong>${escapeHtml(conseillerDisplay)}</strong> vous contactera dans les meilleurs délais.`;

  const body = `
    <p>Bonjour ${escapeHtml(filleul.prenom)},</p>

    <p><strong>${escapeHtml(parrain.prenom)} ${escapeHtml(parrain.nom)}</strong> vous a recommandé auprès de Paris Conseils,
    cabinet d'<em>ingénierie financière et d'optimisation fiscale</em>.</p>

    <p>Un proche qui prend le temps de vous recommander, c'est rarement anodin. Notre rôle est d'apporter à chacun
    de nos clients un <strong>accompagnement sur-mesure</strong>, dans la plus stricte confidentialité.</p>

    <div style="background:${CREAM};border-radius:10px;padding:24px;margin:28px 0;text-align:center;">
      <div style="font-family:Georgia,serif;font-size:10px;letter-spacing:4px;color:${GOLD};text-transform:uppercase;margin-bottom:10px;">Votre interlocuteur</div>
      <div style="font-family:'Playfair Display',Georgia,serif;font-size:22px;color:${NAVY_D};">${escapeHtml(conseillerDisplay)}</div>
      <div style="font-size:13px;color:${MUTED};margin-top:8px;font-style:italic;">${hasSpecific ? 'prendra contact avec vous sous 48 heures' : 'vous contactera dans les meilleurs délais'}</div>
    </div>

    <p>${contactPhrase} Cette première conversation est <strong>sans engagement</strong>. Elle sert avant tout à comprendre votre situation,
    vos objectifs, et à voir comment nous pouvons éventuellement vous être utile.</p>

    <p style="font-style:italic;color:${MUTED};border-left:2px solid ${GOLD};padding:6px 0 6px 16px;margin:24px 0;">
      « Le savoir est la seule matière qui s'accroît quand on la partage. »<br>
      <span style="font-size:12px;">— Socrate</span>
    </p>

    <p>Si vous préférez ne pas être contacté, répondez simplement à cet email — nous respecterons votre choix immédiatement.</p>

    <p>À très bientôt,<br>
    L'équipe Paris Conseils</p>`;

  return baseShell({
    title: `${escapeHtml(parrain.prenom)} vous recommande Paris Conseils`,
    eyebrow: 'Une recommandation pour vous',
    subtitle: `Accompagnement confidentiel · ingénierie patrimoniale`,
    body
  });
}

module.exports = { emailParrain, emailConseiller, emailFilleul };
