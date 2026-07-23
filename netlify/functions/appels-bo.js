// v215 — Backend "Appels" : système autonome, sans dépendance Render.
// Lit la Google Sheet du conseiller en CSV public, croise avec un état stocké en Netlify Blobs.
//
// Endpoints :
//   GET  ?action=ping
//   GET  ?action=lot&conseiller=DAVID&token=XYZ        → contacts du lot du jour + état
//   POST ?action=update-contact&conseiller=DAVID&token=XYZ
//                                            body: { lot_id, contact_idx, statut_appel, statut_rdv, commentaire }
//   POST ?action=validate-lot&conseiller=DAVID&token=XYZ
//                                            body: { lot_id }
//   GET  ?action=stats-week&conseiller=DAVID&token=XYZ → stats S en cours vs mois précédent
//
// Cloisonnement strict : un conseiller ne peut accéder qu'à SON propre conseiller_code.
// Token vérifié dans une map (env vars MAGIC_APPELS_DAVID / NICOLAS / JORDAN) — défaut hardcodé pour démarrer.

const { getStore } = require('@netlify/blobs');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};
function withCors(resp) { return { ...resp, headers: { ...CORS_HEADERS, ...(resp.headers || {}) } }; }

// ─────────────────────────────────────────────────────────────────────────────
// Conseillers + tokens magic + IDs Google Sheets
// ─────────────────────────────────────────────────────────────────────────────
const CONSEILLERS = {
  CORENTIN: { prenom: 'Corentin', nom: 'CURTET', email: 'curtet@parisconseils.fr',
             sheetId: process.env.SHEET_CORENTIN_ID || '',
             token:   process.env.MAGIC_APPELS_CORENTIN || 'corentin-2026-paris-conseils-v215',
             password: process.env.PWD_CORENTIN || 'PC8094CD@' },
  DAVID:   { prenom: 'David',   nom: 'PEREIRA', email: 'pereira@parisconseils.fr',
             sheetId: process.env.SHEET_DAVID_ID   || '18Jif5zWQZqydexf4Ru5kt013KnTJOwGRbEV2ScfAe4I',
             token:   process.env.MAGIC_APPELS_DAVID   || 'david-2026-paris-conseils-v215',
             password: process.env.PWD_DAVID   || 'PCdp7K9R' },
  NICOLAS: { prenom: 'Nicolas', nom: 'MOREAU',  email: 'moreau@parisconseils.fr',
             sheetId: process.env.SHEET_NICOLAS_ID || '1UOA0ifDW_iVidSrhTFBsmXR9Mrf8K9dRPvO8a6w7hzw',
             token:   process.env.MAGIC_APPELS_NICOLAS || 'nicolas-2026-paris-conseils-v215',
             password: process.env.PWD_NICOLAS || 'PCnm3JX8' }
};
// v218 — Index email → code conseiller pour le login
function findByEmail(email) {
  const e = (email || '').toLowerCase().trim();
  for (const [code, c] of Object.entries(CONSEILLERS)) {
    if (c.email.toLowerCase() === e) return { code, ...c };
  }
  return null;
}

// v218 — 6 résultats d'appel directs (sans 2 étapes)
const STATUTS_APPEL = ['APPELE', 'REPONDEUR', 'MAUVAIS_NUM', 'INJOIGNABLE'];
// v218 — 6 résultats finaux (cohérents avec UI Validé / Échec / Injoignable / À rappeler / Non qualifié / Faux N°)
const STATUTS_RDV   = ['RDV_VALIDE', 'ECHEC', 'INJOIGNABLE_FINAL', 'A_SUIVRE', 'NON_QUALIFIE', 'FAUX_NUMERO', 'TRANSMIS_PC'];

function getDB(name) {
  const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN;
  if (siteID && token) return getStore({ name, siteID, token, consistency: 'strong' });
  return getStore({ name, consistency: 'strong' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — lecture Sheet CSV
// ─────────────────────────────────────────────────────────────────────────────
async function fetchSheetCSV(sheetId, gid = '0') {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error('Sheet status ' + r.status);
  const txt = await r.text();
  if (txt.startsWith('<!DOCTYPE') || txt.includes('<HTML')) throw new Error('Sheet non publique');
  return txt;
}

function parseCSV(csv) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i], n = csv[i + 1];
    if (q) {
      if (c === '"' && n === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else {
      if (c === '"') q = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function isoWeekKey(d) {
  if (!d || isNaN(d)) return null;
  const dt = new Date(d.getTime());
  dt.setUTCHours(0, 0, 0, 0);
  dt.setUTCDate(dt.getUTCDate() + 4 - (dt.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((dt - yearStart) / 86400000) + 1) / 7);
  return `${dt.getUTCFullYear()}-S${String(week).padStart(2, '0')}`;
}

function parseDateFR(s) {
  if (!s) return null;
  const cleaned = String(s).trim();
  let m;
  if ((m = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  if ((m = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)))   return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth helper
// ─────────────────────────────────────────────────────────────────────────────
function auth(params) {
  const code = (params.conseiller || '').toUpperCase();
  const token = params.token || '';
  const c = CONSEILLERS[code];
  if (!c) return { error: 'unknown_conseiller', http: 400 };
  if (token !== c.token) return { error: 'invalid_token', http: 401 };
  return { code, conseiller: c };
}

// ─────────────────────────────────────────────────────────────────────────────
// HANDLERS
// ─────────────────────────────────────────────────────────────────────────────
// GET ?action=lot → renvoie les contacts du lot du jour avec leur état coché
async function handleLot(params) {
  const a = auth(params); if (a.error) return a;
  const today = new Date().toISOString().slice(0, 10);
  // Charge le lot du jour depuis le store de distribution (créé par daily-distributor)
  const distribStore = getDB('daily-distrib');
  let lot = await distribStore.get(`lot_${a.code}_${today}`, { type: 'json' });
  // Si pas de lot aujourd'hui, on prend le plus récent des 7 derniers jours
  if (!lot || !lot.contacts || !lot.contacts.length) {
    for (let day = 1; day <= 7; day++) {
      const past = new Date(Date.now() - day * 86400000).toISOString().slice(0, 10);
      const candidate = await distribStore.get(`lot_${a.code}_${past}`, { type: 'json' });
      if (candidate && candidate.contacts && candidate.contacts.length) { lot = candidate; lot.date_lot = past; break; }
    }
  } else {
    lot.date_lot = today;
  }
  if (!lot) return { ok: true, conseiller: a.code, lot: null, message: 'Pas de lot récent. Le prochain envoi est le prochain jour ouvré (mer/jeu/ven 16h).' };
  // Charge l'état du lot depuis le store appels
  const appelsStore = getDB('appels-bo');
  const stateKey = `etat_${a.code}_${lot.date_lot}`;
  const state = (await appelsStore.get(stateKey, { type: 'json' })) || { lot_id: stateKey, contacts: {}, valide: false };

  // v229f — Enrichissement depuis le Sheet BASE central (https://docs.google.com/spreadsheets/d/12jxEDcsFQzXpgWTrrQYPWx7Ue9vbpsA6Rawqms28-hE)
  //         Colonne L = Commentaire client. Match par tel (E/F/G = Tél 1/2/3)
  const BASE_SHEET_ID = '12jxEDcsFQzXpgWTrrQYPWx7Ue9vbpsA6Rawqms28-hE';
  const baseEnrich = {};  // tel9 → commentaire colonne L
  try {
    const baseCsv = await fetchSheetCSV(BASE_SHEET_ID, '0');
    const baseRows = parseCSV(baseCsv);
    if (baseRows.length >= 2) {
      const bHeader = (baseRows[0] || []).map(h => (h || '').trim().toLowerCase());
      const bIdxTel1 = bHeader.findIndex(h => /^t[eé]l\s*1/.test(h));
      const bIdxTel2 = bHeader.findIndex(h => /^t[eé]l\s*2|^t[eé]l2/.test(h));
      const bIdxTel3 = bHeader.findIndex(h => /^t[eé]l\s*3|^t[eé]l3/.test(h));
      const bIdxComm = bHeader.findIndex(h => /commentaire/.test(h));
      const bIdxProf = bHeader.findIndex(h => /profession/.test(h));
      const bIdxCiv  = bHeader.findIndex(h => /civilit/.test(h));
      const bIdxNom  = bHeader.findIndex(h => /^nom/.test(h));
      const bIdxPrenom = bHeader.findIndex(h => /pr[eé]nom/.test(h));
      const bIdxAdresse = bHeader.findIndex(h => /^adresse/.test(h));
      const bIdxCP    = bHeader.findIndex(h => /code\s*postal|^cp$/.test(h));
      const bIdxVille = bHeader.findIndex(h => /^ville/.test(h));
      const bIdxEmail = bHeader.findIndex(h => /^e?\s*mail|email/.test(h));
      for (let i = 1; i < baseRows.length; i++) {
        const row = baseRows[i] || [];
        const tels = [bIdxTel1, bIdxTel2, bIdxTel3].map(j => j >= 0 ? normalizeTel(row[j] || '') : '').filter(t => t && t.length >= 9);
        if (!tels.length) continue;
        const data = {
          commentaire_base: bIdxComm >= 0 ? (row[bIdxComm] || '').trim() : '',
          profession:       bIdxProf >= 0 ? (row[bIdxProf] || '').trim() : '',
          civilite:         bIdxCiv >= 0 ? (row[bIdxCiv] || '').trim() : '',
          nom:              bIdxNom >= 0 ? (row[bIdxNom] || '').trim() : '',
          prenom:           bIdxPrenom >= 0 ? (row[bIdxPrenom] || '').trim() : '',
          adresse:          bIdxAdresse >= 0 ? (row[bIdxAdresse] || '').trim() : '',
          cp:               bIdxCP >= 0 ? (row[bIdxCP] || '').trim() : '',
          ville:            bIdxVille >= 0 ? (row[bIdxVille] || '').trim() : '',
          email:            bIdxEmail >= 0 ? (row[bIdxEmail] || '').trim() : ''
        };
        for (const t of tels) baseEnrich[t] = data;
      }
    }
  } catch (e) { /* tolerant */ }

  // v226 — Enrichissement depuis le Google Sheet personnel du conseiller (colonnes D/F/G/H/K/L/M/N/O)
  //        Match par téléphone (9 derniers chiffres) sur la colonne H "Tél 1"
  const enrich = {};  // tel9 → { profession, ville, email, commentaire_source, ... }
  try {
    const csv = await fetchSheetCSV(a.conseiller.sheetId, '0');
    const rows = parseCSV(csv);
    if (rows.length >= 2) {
      const header = (rows[0] || []).map(h => (h || '').trim().toLowerCase());
      const idxProfession = header.findIndex(h => /profession/.test(h));
      const idxCivilite   = header.findIndex(h => /civilit/.test(h));
      const idxNom        = header.findIndex(h => /^nom$/.test(h));
      const idxPrenom     = header.findIndex(h => /pr[eé]nom/.test(h));
      const idxTel1       = header.findIndex(h => /^t[eé]l\s*1/.test(h));
      const idxTel2       = header.findIndex(h => /^t[eé]l\s*2/.test(h));
      const idxTel3       = header.findIndex(h => /^t[eé]l\s*3/.test(h));
      const idxAdresse    = header.findIndex(h => /adresse/.test(h));
      const idxCP         = header.findIndex(h => /code\s*postal|^cp$/.test(h));
      const idxVille      = header.findIndex(h => /^ville$/.test(h));
      const idxEmail      = header.findIndex(h => /^e?\s*mail/.test(h));
      const idxCommSource = header.findIndex(h => /commentaire\s*source/.test(h));
      const idxDate       = header.findIndex(h => /date\s*attribut/.test(h));
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i] || [];
        const tels = [idxTel1, idxTel2, idxTel3].map(j => j >= 0 ? normalizeTel(row[j] || '') : '').filter(t => t && t.length >= 9);
        if (!tels.length) continue;
        const data = {
          profession:         idxProfession >= 0 ? (row[idxProfession] || '').trim() : '',
          civilite:           idxCivilite >= 0   ? (row[idxCivilite]   || '').trim() : '',
          nom_perso:          idxNom >= 0        ? (row[idxNom]        || '').trim() : '',
          prenom_perso:       idxPrenom >= 0     ? (row[idxPrenom]     || '').trim() : '',
          adresse:            idxAdresse >= 0    ? (row[idxAdresse]    || '').trim() : '',
          cp:                 idxCP >= 0         ? (row[idxCP]         || '').trim() : '',
          ville:              idxVille >= 0      ? (row[idxVille]      || '').trim() : '',
          email:              idxEmail >= 0      ? (row[idxEmail]      || '').trim() : '',
          commentaire_source: idxCommSource >= 0 ? (row[idxCommSource] || '').trim() : '',
          date_attribution:   idxDate >= 0       ? (row[idxDate]       || '').trim() : ''
        };
        for (const t of tels) enrich[t] = data;
      }
    }
  } catch (e) { /* tolerant : si la sheet n'est pas accessible, on continue sans enrichissement */ }

  // v227 — Compose un commentaire source enrichi à partir du contexte CHOOZE
  function _isValid(v) {
    if (!v) return false;
    const s = String(v).trim();
    if (!s || s === '-' || s === '—') return false;
    if (/^#ERROR/i.test(s) || /^#REF/i.test(s) || /^#VALUE/i.test(s) || /^#N\/A/i.test(s) || /^#DIV/i.test(s) || /^#NAME/i.test(s)) return false;
    return true;
  }
  function _composeContexteCHOOZE(c) {
    const parts = [];
    if (_isValid(c.situation)) parts.push(c.situation);
    if (_isValid(c.age)) parts.push(String(c.age).replace(/^-\s*/, '< ').trim());
    if (_isValid(c.enfants)) parts.push(c.enfants + ' enfant' + (parseInt(c.enfants) > 1 ? 's' : ''));
    if (_isValid(c.rfr)) parts.push('RFR ' + c.rfr);
    if (_isValid(c.departement)) parts.push('Dép. ' + c.departement);
    if (_isValid(c.statut)) parts.push('Statut origine : ' + c.statut);
    return parts.join(' · ');
  }

  // Combine lot + état + enrichissement Google Sheet
  const contacts = (lot.contacts || []).map((c, idx) => {
    const telRaw = c.tel || c.Tel || c.telephone || c.Telephone || '';
    const tel9 = normalizeTel(telRaw);
    const e = enrich[tel9] || {};
    // v229f — Sources possibles (par priorité) du commentaire source :
    //   1. Sheet BASE colonne L (commentaire client riche, 1370 lignes)
    //   2. Sheet personnel conseiller colonne O
    //   3. Colonne commentaire CHOOZE (si présente)
    //   4. Composition automatique à partir du contexte CHOOZE
    const baseData = baseEnrich[tel9] || {};
    const composedCHOOZE = _composeContexteCHOOZE(c);
    const commentaireSource = baseData.commentaire_base || e.commentaire_source || c.commentaire || c.Commentaire || composedCHOOZE;
    return {
      idx,
      nom: baseData.nom || e.nom_perso || c.nom || c.Nom || '',
      prenom: baseData.prenom || e.prenom_perso || c.prenom || c.Prenom || '',
      civilite: baseData.civilite || e.civilite || '',
      tel: telRaw,
      adresse: baseData.adresse || e.adresse || c.adresse || c.Adresse || '',
      cp: baseData.cp || e.cp || c.cp || c.CP || c.code_postal || '',
      ville: baseData.ville || e.ville || c.ville || c.Ville || '',
      email: baseData.email || e.email || c.email || c.Email || c.mail || '',
      profession: baseData.profession || e.profession || c.profession || c.Profession || '',
      // v229f — Commentaire colonne L du sheet base (priorité 1) ou fallback
      commentaire_source: commentaireSource,
      commentaire_base: c.commentaire_base || baseData.commentaire_base || '',  // exposé séparément pour affichage modal
      commentaire_source_composed: composedCHOOZE,
      // v229m — Tag source pour badge visible (ICA / CHOOSE)
      source: c.source || (c.commentaire_base && c.commentaire_base.indexOf('CHOOSE') === 0 ? 'choose' : (baseData.commentaire_base ? 'ica' : '')),
      source_label: c.source_label || '',
      // Contexte CHOOZE détaillé (exposé en plus pour affichage structuré côté front) — filtré des #ERROR!
      situation: _isValid(c.situation) ? c.situation : '',
      age: _isValid(c.age) ? c.age : '',
      enfants: _isValid(c.enfants) ? c.enfants : '',
      rfr: _isValid(c.rfr) ? c.rfr : '',
      departement: _isValid(c.departement) ? c.departement : '',
      statut_origine: _isValid(c.statut) ? c.statut : '',
      date_attribution: e.date_attribution || c.date || '',
      statut_appel: state.contacts[idx]?.statut_appel || null,
      statut_rdv:   state.contacts[idx]?.statut_rdv   || null,
      commentaire_conseiller: state.contacts[idx]?.commentaire_conseiller || '',
      maj: state.contacts[idx]?.maj || null
    };
  });
  // Compteurs
  const total = contacts.length;
  const traites = contacts.filter(c => c.statut_appel).length;
  const rdv = contacts.filter(c => c.statut_rdv === 'RDV_VALIDE').length;
  const transmis = contacts.filter(c => c.statut_rdv === 'TRANSMIS_PC').length;
  const echec = contacts.filter(c => c.statut_rdv === 'ECHEC' || c.statut_rdv === 'NON_QUALIFIE').length;
  const aSuivre = contacts.filter(c => c.statut_rdv === 'A_SUIVRE').length;
  return {
    ok: true,
    conseiller: a.code,
    prenom: a.conseiller.prenom,
    lot_id: stateKey,
    date_lot: lot.date_lot,
    valide: state.valide || false,
    contacts,
    counts: { total, traites, rdv, transmis, echec, aSuivre, restants: total - traites }
  };
}

// POST ?action=update-contact body: { lot_id, contact_idx, statut_appel?, statut_rdv?, commentaire? }
async function handleUpdateContact(params, payload) {
  const a = auth(params); if (a.error) return a;
  const lot_id = payload.lot_id || '';
  const idx = parseInt(payload.contact_idx, 10);
  if (isNaN(idx)) return { error: 'contact_idx requis' };
  const store = getDB('appels-bo');
  const state = (await store.get(lot_id, { type: 'json' })) || { lot_id, contacts: {}, valide: false };
  if (state.valide) return { error: 'Ce lot a déjà été validé. Modifications bloquées.' };
  const cur = state.contacts[idx] || {};
  if (payload.statut_appel !== undefined) {
    if (payload.statut_appel === null) delete cur.statut_appel;
    else if (STATUTS_APPEL.includes(payload.statut_appel)) cur.statut_appel = payload.statut_appel;
  }
  if (payload.statut_rdv !== undefined) {
    if (payload.statut_rdv === null) delete cur.statut_rdv;
    else if (STATUTS_RDV.includes(payload.statut_rdv)) cur.statut_rdv = payload.statut_rdv;
  }
  if (payload.commentaire !== undefined) cur.commentaire_conseiller = String(payload.commentaire || '');
  cur.maj = new Date().toISOString();
  state.contacts[idx] = cur;
  await store.setJSON(lot_id, state);
  return { ok: true, idx, contact: cur };
}

// POST ?action=validate-lot body: { lot_id }
// Valide le lot ET marque comme validé dans daily-distrib pour débloquer la distribution suivante.
async function handleValidateLot(params, payload) {
  const a = auth(params); if (a.error) return a;
  const lot_id = payload.lot_id || '';
  if (!lot_id) return { error: 'lot_id requis' };
  const store = getDB('appels-bo');
  const state = (await store.get(lot_id, { type: 'json' }));
  if (!state) return { error: 'lot inconnu' };
  const distribStore = getDB('daily-distrib');
  const dateMatch = lot_id.match(/_(\d{4}-\d{2}-\d{2})$/);
  const date_lot = dateMatch ? dateMatch[1] : null;
  if (!date_lot) return { error: 'lot_id format invalide' };
  const distribLot = await distribStore.get(`lot_${a.code}_${date_lot}`, { type: 'json' });
  if (!distribLot) return { error: 'lot distribution introuvable' };
  const total = (distribLot.contacts || []).length;
  const contactsState = Object.values(state.contacts || {});

  // v221 — STRICTNESS : (1) tous les contacts ont un statut, (2) commentaire obligatoire SAUF pour Faux N°/Injoignable,
  // (3) durée >= 30 min entre la création du lot (état) et la validation : récompense ou attente.
  const traites = contactsState.filter(c => c.statut_appel).length;
  if (traites < total) {
    return { error: `Il reste ${total - traites} contact(s) à traiter avant validation.`, restants: total - traites, blocant: true };
  }
  // Vérifie commentaires obligatoires
  const missingComments = [];
  for (let i = 0; i < (distribLot.contacts || []).length; i++) {
    const s = (state.contacts || {})[i] || {};
    const stat = (s.statut_rdv || '').toUpperCase();
    const noCommentOK = stat === 'FAUX_NUMERO' || stat === 'INJOIGNABLE_FINAL';
    const hasComment = (s.commentaire_conseiller || '').trim().length > 5;
    if (!noCommentOK && !hasComment) missingComments.push(i + 1);
  }
  if (missingComments.length > 0) {
    return {
      error: `Pour valider, commentaire obligatoire (>5 caractères) sur les contacts ${missingComments.slice(0,5).join(', ')}${missingComments.length>5?'…':''} (sauf Faux N° et Injoignable).`,
      missing: missingComments,
      blocant: true
    };
  }
  // Calcule la durée depuis le début du lot. Source : login_at envoyé par le front OU 1ère MAJ d'un contact, sinon état créé.
  const now = Date.now();
  const startedAt = payload.session_started_at ? new Date(payload.session_started_at).getTime() : null;
  let firstActionAt = null;
  for (const c of contactsState) {
    if (c.maj) { const t = new Date(c.maj).getTime(); if (!firstActionAt || t < firstActionAt) firstActionAt = t; }
  }
  const referenceStart = startedAt || firstActionAt || (state.created_at ? new Date(state.created_at).getTime() : now);
  const durationSec = Math.round((now - referenceStart) / 1000);
  const MIN_QUALITY_SEC = 30 * 60; // 30 minutes
  const isQuality = durationSec >= MIN_QUALITY_SEC;

  state.valide = true;
  state.valide_le = new Date().toISOString();
  state.duree_session_sec = durationSec;
  state.qualite = isQuality ? 'OK' : 'BACLE';
  await store.setJSON(lot_id, state);
  distribLot.valide = true;
  distribLot.valide_le = state.valide_le;
  distribLot.valide_par_appels_bo = true;
  distribLot.duree_session_sec = durationSec;
  distribLot.qualite = isQuality ? 'OK' : 'BACLE';
  await distribStore.setJSON(`lot_${a.code}_${date_lot}`, distribLot);

  // Flag de récompense : si qualité OK → débloque 10 contacts bonus (à puiser à la prochaine vague).
  // Si BACLE → attendra la prochaine vague (mer/jeu/ven 16h) sans bonus.
  if (isQuality) {
    const bonusStore = getDB('appels-bonus');
    await bonusStore.setJSON(`bonus_${a.code}_${date_lot}`, {
      conseiller: a.code,
      date_lot,
      created_at: state.valide_le,
      duree_session_sec: durationSec,
      to_distribute: 10,
      claimed: false
    });
  }
  return {
    ok: true, valide: true, lot_id, date_lot,
    duree_min: Math.round(durationSec / 60),
    qualite: state.qualite,
    bonus: isQuality
      ? { unlocked: true, count: 10, message: '🏆 Travail de qualité : 10 contacts bonus seront ajoutés à ta prochaine vague.' }
      : { unlocked: false, message: `⚠️ Lot bouclé en ${Math.round(durationSec/60)} min : trop rapide. Pas de bonus, prochaine vague aux horaires habituels.` }
  };
}

// v218 — POST ?action=login body: { email, password } → renvoie { code, token, prenom }
async function handleLogin(payload) {
  const c = findByEmail(payload.email);
  if (!c) return { error: 'email inconnu', http: 401 };
  if ((payload.password || '') !== c.password) return { error: 'mot de passe invalide', http: 401 };
  return { ok: true, code: c.code, token: c.token, prenom: c.prenom, nom: c.nom, email: c.email };
}

// v229l — Magic login pour Corentin admin : utilise le token déjà défini sur CONSEILLERS
// pour se connecter en tant que David ou Nicolas sans mdp. URL : appels.html?magic=<token>
async function handleMagicLogin(payload) {
  const tok = String(payload.magic_token || payload.token || '').trim();
  if (!tok) return { error: 'magic_token required', http: 400 };
  for (const [code, c] of Object.entries(CONSEILLERS)) {
    if (c.token === tok) {
      return { ok: true, code, token: c.token, prenom: c.prenom, nom: c.nom, email: c.email };
    }
  }
  return { error: 'invalid magic token', http: 401 };
}

// v218 — GET ?action=stats-conseiller → stats agrégées + courbe par semaine (12 dernières)
//        + comparaison mois en cours vs mois précédent
async function handleStatsConseiller(params) {
  const a = auth(params); if (a.error) return a;
  let csv;
  try { csv = await fetchSheetCSV(a.conseiller.sheetId, '0'); } catch (e) { return { error: e.message }; }
  const rows = parseCSV(csv);
  const header = rows[0] || [];
  const idxDate = header.findIndex(h => /date.attribution|date attribution/i.test(h));
  const idxRdv = header.findIndex(h => /^rdv$/i.test(h));
  const now = new Date();
  const thisMonth = now.toISOString().slice(0, 7);
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 7);
  const parWeek = {};
  let total = 0, totalRdv = 0, totalEchec = 0, totalInjoign = 0, totalRappel = 0, totalNonQualif = 0, totalFauxNum = 0;
  let thisMonthRdv = 0, thisMonthTotal = 0, prevMonthRdv = 0, prevMonthTotal = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const d = idxDate >= 0 ? parseDateFR(r[idxDate]) : null;
    if (!d || isNaN(d)) continue;
    const rdvVal = (idxRdv >= 0 ? r[idxRdv] : '').toString().trim().toLowerCase();
    const week = isoWeekKey(d);
    const ymonth = d.toISOString().slice(0, 7);
    parWeek[week] = parWeek[week] || { week, attribues: 0, rdv: 0, echec: 0, rappel: 0, injoign: 0, faux_num: 0, non_qualif: 0 };
    parWeek[week].attribues++;
    total++;
    if (ymonth === thisMonth) thisMonthTotal++;
    else if (ymonth === prevMonth) prevMonthTotal++;
    // Classification stricte selon les 6 nouveaux statuts (v218)
    if (/^validé|^valide|rdv\s*pris|confirmé|rendez-vous/.test(rdvVal)) {
      parWeek[week].rdv++; totalRdv++;
      if (ymonth === thisMonth) thisMonthRdv++; else if (ymonth === prevMonth) prevMonthRdv++;
    } else if (/echec|échec|refus/.test(rdvVal))             { parWeek[week].echec++; totalEchec++; }
    else if (/non\s*qualif/.test(rdvVal))                    { parWeek[week].non_qualif++; totalNonQualif++; }
    else if (/erron|mauvais|faux/.test(rdvVal))              { parWeek[week].faux_num++; totalFauxNum++; }
    else if (/a\s*suivre|à\s*suivre|rappel/.test(rdvVal))    { parWeek[week].rappel++; totalRappel++; }
    else if (/sans\s*réponse|sans\s*reponse|répondeur|repondeur|injoign|messagerie/.test(rdvVal)) { parWeek[week].injoign++; totalInjoign++; }
  }
  const weeks = Object.values(parWeek).sort((a, b) => a.week.localeCompare(b.week)).slice(-12);
  // v221 — Exclusion des "non-contacts" du calcul du taux et du total qualifié.
  // Faux N° / Injoignables / Non qualifiés ne sont PAS des occasions ratées : on les retire.
  let thisMonthFauxN = 0, thisMonthInjoign = 0, thisMonthNonQualif = 0;
  let prevMonthFauxN = 0, prevMonthInjoign = 0, prevMonthNonQualif = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const d = idxDate >= 0 ? parseDateFR(r[idxDate]) : null;
    if (!d || isNaN(d)) continue;
    const rdvVal = (idxRdv >= 0 ? r[idxRdv] : '').toString().trim().toLowerCase();
    const ymonth = d.toISOString().slice(0, 7);
    if (/erron|mauvais|faux/.test(rdvVal))                          { if (ymonth === thisMonth) thisMonthFauxN++;   else if (ymonth === prevMonth) prevMonthFauxN++; }
    else if (/sans\s*réponse|sans\s*reponse|répondeur|repondeur|injoign|messagerie/.test(rdvVal)) { if (ymonth === thisMonth) thisMonthInjoign++; else if (ymonth === prevMonth) prevMonthInjoign++; }
    else if (/non\s*qualif/.test(rdvVal))                           { if (ymonth === thisMonth) thisMonthNonQualif++; else if (ymonth === prevMonth) prevMonthNonQualif++; }
  }
  const thisMonthQualif = Math.max(0, thisMonthTotal - thisMonthFauxN - thisMonthInjoign - thisMonthNonQualif);
  const prevMonthQualif = Math.max(0, prevMonthTotal - prevMonthFauxN - prevMonthInjoign - prevMonthNonQualif);
  const txMonth = thisMonthQualif ? (thisMonthRdv / thisMonthQualif * 100) : 0;
  const txPrev  = prevMonthQualif ? (prevMonthRdv / prevMonthQualif * 100) : 0;
  return {
    ok: true,
    conseiller: a.code,
    prenom: a.conseiller.prenom,
    totaux: { attribues: total, validés: totalRdv, échec: totalEchec, injoignable: totalInjoign, à_rappeler: totalRappel, non_qualifié: totalNonQualif, faux_numéro: totalFauxNum },
    mois_courant: { ymonth: thisMonth, attribues: thisMonthTotal, attribues_qualif: thisMonthQualif, rdv: thisMonthRdv, taux: Number(txMonth.toFixed(1)),
                    exclusions: { faux_numero: thisMonthFauxN, injoignable: thisMonthInjoign, non_qualifie: thisMonthNonQualif } },
    mois_precedent: { ymonth: prevMonth, attribues: prevMonthTotal, attribues_qualif: prevMonthQualif, rdv: prevMonthRdv, taux: Number(txPrev.toFixed(1)) },
    evolution: { delta_rdv: thisMonthRdv - prevMonthRdv, delta_taux: Number((txMonth - txPrev).toFixed(1)) },
    courbe: weeks
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// v219 — GET ?action=check-dupes → détecte les doublons sur le lot du jour
//   1) intra-lot : 2 contacts avec même nom/tel/email
//   2) base PC  : contact déjà présent comme RESA en cours OU ACTE_REALISE
// ─────────────────────────────────────────────────────────────────────────────
function normalizeName(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '').trim();
}
function normalizeTel(s) {
  const t = String(s || '').replace(/[^0-9]/g, '');
  if (!t) return '';
  // Conserve les 9 derniers chiffres (gère +33 / 0)
  return t.length > 9 ? t.slice(-9) : t;
}
function normalizeEmail(s) {
  return String(s || '').toLowerCase().trim();
}

async function handleCheckDupes(params) {
  const a = auth(params); if (a.error) return a;
  const today = new Date().toISOString().slice(0, 10);
  // 1) Charge le lot du jour (ou le plus récent des 7 derniers jours, comme handleLot)
  const distribStore = getDB('daily-distrib');
  let lot = await distribStore.get(`lot_${a.code}_${today}`, { type: 'json' });
  if (!lot || !lot.contacts || !lot.contacts.length) {
    for (let day = 1; day <= 7; day++) {
      const past = new Date(Date.now() - day * 86400000).toISOString().slice(0, 10);
      const candidate = await distribStore.get(`lot_${a.code}_${past}`, { type: 'json' });
      if (candidate && candidate.contacts && candidate.contacts.length) { lot = candidate; break; }
    }
  }
  if (!lot || !lot.contacts || !lot.contacts.length) {
    return { ok: true, contacts: [], message: 'Pas de lot.' };
  }
  const contacts = (lot.contacts || []).map((c, idx) => ({
    idx,
    nom: c.nom || c.Nom || '',
    prenom: c.prenom || c.Prenom || '',
    tel: c.tel || c.Tel || c.telephone || c.Telephone || '',
    email: c.email || c.Email || c.mail || ''
  }));
  const N = contacts.length;

  // 2) Charge la base dossiers (kind === RESA ou statut === ACTE_REALISE) — partagée toutes équipes
  let dossiers = [];
  try {
    const dossiersDB = getDB('dossiers');
    dossiers = (await dossiersDB.get('list', { type: 'json' })) || [];
  } catch (e) { /* tolérant : si pas de base, on continue avec intra-lot uniquement */ }
  const inDb = dossiers.filter(d => {
    const k = (d.kind || '').toUpperCase();
    const s = (d.statut || '').toUpperCase();
    // RESA en cours : kind=RESA ET statut PAS résilié/annulé
    if (k === 'RESA' && !['ANNULE', 'RESILIE', 'DESISTE'].includes(s)) return true;
    // ACTE signé
    if (s === 'ACTE_REALISE' || k === 'ACTE') return true;
    return false;
  });
  // v229k — Parse client_nom pour séparer NOM (mots en MAJUSCULE) et PRÉNOM (le reste).
  // Évite les faux positifs comme "Jean-Pierre VINCENT" (lead) matché contre "GAIFFIER Vincent" (dossier)
  // simplement parce que "Vincent" apparaît dans les deux (en l'occurrence prénom d'un côté, nom de l'autre).
  const _splitNomPrenom = (raw) => {
    const txt = String(raw||'').normalize('NFD').replace(/[̀-ͯ]/g,'');
    const tokens = txt.split(/[^A-Za-z]+/).filter(t => t.length >= 2);
    const noms = [];   // mots en MAJUSCULE (>= 3 chars)
    const prenoms = []; // mots en TitleCase ou autres
    for (const t of tokens) {
      if (t.length >= 3 && t === t.toUpperCase()) noms.push(t.toLowerCase());
      else if (t[0] === t[0].toUpperCase()) prenoms.push(t.toLowerCase());
    }
    return {
      nom_norm: noms.join(''),
      prenom_norm: prenoms.join(''),
      full_norm: normalizeName(raw)
    };
  };

  // v229m — Charge l'historique des contacts DÉJÀ APPELÉS (tous lots passés, tous conseillers).
  // Si match tel/email/nom/prénom → flag "Déjà appelé".
  const historiqueByTel = new Map();
  const historiqueByEmail = new Map();
  const historiqueByFullName = new Map();
  const historiqueByNomOnly = new Map();
  const historiqueByPrenomOnly = new Map();
  try {
    // Parcourt les 60 derniers jours pour DAVID + NICOLAS (et CORENTIN s'il y a)
    const codes = Object.keys(CONSEILLERS);
    for (const code of codes) {
      for (let dayAgo = 0; dayAgo <= 60; dayAgo++) {
        const day = new Date(Date.now() - dayAgo * 86400000).toISOString().slice(0, 10);
        const oldLot = await distribStore.get(`lot_${code}_${day}`, { type: 'json' });
        if (!oldLot || !oldLot.contacts) continue;
        for (let cidx = 0; cidx < oldLot.contacts.length; cidx++) {
          const oc = oldLot.contacts[cidx] || {};
          // Considéré "déjà appelé" si statut_appel rempli pour cet idx dans l'état du lot
          const ocState = (oldLot.state && oldLot.state.contacts && oldLot.state.contacts[cidx]) || {};
          const wasAppele = !!(ocState.statut_appel || ocState.statut_rdv);
          // Si le contact a été appelé : on l'indexe pour la détection des doublons historiques.
          // (on évite d'auto-matcher avec le lot DU JOUR du conseiller courant)
          const skipSelf = (code === a.code && day === today);
          if (!wasAppele || skipSelf) continue;
          const meta = { conseiller: code, date: day, statut: ocState.statut_rdv || ocState.statut_appel || 'appelé' };
          const ocTel = normalizeTel(oc.tel || '');
          if (ocTel && ocTel.length >= 9 && !historiqueByTel.has(ocTel)) historiqueByTel.set(ocTel, meta);
          const ocEmail = normalizeEmail(oc.email || '');
          if (ocEmail && ocEmail.includes('@') && !historiqueByEmail.has(ocEmail)) historiqueByEmail.set(ocEmail, meta);
          const ocFull = normalizeName((oc.prenom || '') + (oc.nom || ''));
          if (ocFull && ocFull.length > 4 && !historiqueByFullName.has(ocFull)) historiqueByFullName.set(ocFull, meta);
          const ocNom = normalizeName(oc.nom || '');
          if (ocNom && ocNom.length >= 4 && !historiqueByNomOnly.has(ocNom)) historiqueByNomOnly.set(ocNom, meta);
          const ocPrenom = normalizeName(oc.prenom || '');
          if (ocPrenom && ocPrenom.length >= 4 && !historiqueByPrenomOnly.has(ocPrenom)) historiqueByPrenomOnly.set(ocPrenom, meta);
        }
      }
    }
  } catch (e) { /* tolérant */ }

  // Index lookup base avec séparation nom/prénom
  const indexByFull = new Map();
  const indexByNomOnly = new Map(); // pour le warning "à vérifier"
  const indexByTel = new Map();
  const indexByEmail = new Map();
  for (const d of inDb) {
    const parsed = _splitNomPrenom(d.client_nom || d.client || '');
    if (parsed.full_norm && parsed.full_norm.length > 4) {
      if (!indexByFull.has(parsed.full_norm)) indexByFull.set(parsed.full_norm, d);
    }
    if (parsed.nom_norm && parsed.nom_norm.length >= 4) {
      if (!indexByNomOnly.has(parsed.nom_norm)) indexByNomOnly.set(parsed.nom_norm, { dossier: d, parsed });
    }
    const tel = normalizeTel(d.client_tel || d.tel || '');
    if (tel && tel.length >= 9) indexByTel.set(tel, d);
    const email = normalizeEmail(d.client_email || d.email || '');
    if (email && email.includes('@')) indexByEmail.set(email, d);
  }

  // 3) Construit la sortie
  const out = [];
  for (let i = 0; i < N; i++) {
    const c = contacts[i];
    const fullName = normalizeName((c.prenom + c.nom) || '');
    const leadNomOnly = normalizeName(c.nom || '');
    const leadPrenomOnly = normalizeName(c.prenom || '');
    const tel = normalizeTel(c.tel);
    const email = normalizeEmail(c.email);

    // — A. Doublons intra-lot — NOM ET PRÉNOM (pas seulement l'un des deux)
    const reasonsLot = new Set();
    let dupeInLot = null;
    for (let j = 0; j < N; j++) {
      if (j === i) continue;
      const other = contacts[j];
      const otherFull = normalizeName((other.prenom + other.nom));
      const otherTel = normalizeTel(other.tel);
      const otherEmail = normalizeEmail(other.email);
      if (fullName && fullName.length > 4 && fullName === otherFull) { reasonsLot.add('nom+prénom'); dupeInLot = other; }
      if (tel && tel.length >= 9 && tel === otherTel) { reasonsLot.add('téléphone'); dupeInLot = other; }
      if (email && email.includes('@') && email === otherEmail) { reasonsLot.add('email'); dupeInLot = other; }
    }

    // — B. Doublons base PC : 2 niveaux de sévérité
    //   STRICT (in_db_high) : NOM+PRÉNOM identiques OU tel OU email → ⛔ Déjà client (rouge)
    //   WARN   (in_db_warn) : seulement le NOM ressemble → ⚠ À vérifier Paris Conseils (orange)
    let inDbHit = null;
    let inDbSeverity = null;
    const reasonsDb = [];
    if (fullName && fullName.length > 4 && indexByFull.has(fullName)) {
      inDbHit = indexByFull.get(fullName); inDbSeverity = 'high'; reasonsDb.push('nom+prénom');
    }
    if (tel && tel.length >= 9 && indexByTel.has(tel)) {
      inDbHit = indexByTel.get(tel); inDbSeverity = 'high'; reasonsDb.push('téléphone');
    }
    if (email && email.includes('@') && indexByEmail.has(email)) {
      inDbHit = indexByEmail.get(email); inDbSeverity = 'high'; reasonsDb.push('email');
    }
    // Warning soft : nom de famille seul ressemble (prénom différent ou inconnu)
    if (!inDbHit && leadNomOnly && leadNomOnly.length >= 4 && indexByNomOnly.has(leadNomOnly)) {
      const candidate = indexByNomOnly.get(leadNomOnly);
      // Si le prénom du lead diffère du prénom du dossier → on flag uniquement en WARN
      const prenomMatchPartial = leadPrenomOnly && candidate.parsed.prenom_norm
        && (leadPrenomOnly.startsWith(candidate.parsed.prenom_norm.slice(0,3))
            || candidate.parsed.prenom_norm.startsWith(leadPrenomOnly.slice(0,3)));
      if (prenomMatchPartial) {
        inDbHit = candidate.dossier; inDbSeverity = 'high'; reasonsDb.push('nom+prénom approchant');
      } else {
        inDbHit = candidate.dossier; inDbSeverity = 'warn'; reasonsDb.push('nom (prénom à vérifier)');
      }
    }

    // v229m — Déjà appelé dans l'historique (tous lots passés, tous conseillers)
    const histReasons = [];
    let histHit = null;
    if (tel && historiqueByTel.has(tel)) { histHit = historiqueByTel.get(tel); histReasons.push('téléphone'); }
    if (email && historiqueByEmail.has(email)) { histHit = historiqueByEmail.get(email); histReasons.push('email'); }
    if (fullName && fullName.length > 4 && historiqueByFullName.has(fullName)) { histHit = historiqueByFullName.get(fullName); histReasons.push('nom+prénom'); }
    else if (leadNomOnly && leadNomOnly.length >= 4 && historiqueByNomOnly.has(leadNomOnly)) { histHit = historiqueByNomOnly.get(leadNomOnly); histReasons.push('nom'); }
    else if (leadPrenomOnly && leadPrenomOnly.length >= 4 && historiqueByPrenomOnly.has(leadPrenomOnly)) { histHit = historiqueByPrenomOnly.get(leadPrenomOnly); histReasons.push('prénom'); }

    if (reasonsLot.size || inDbHit || histHit) {
      const entry = { idx: i };
      if (reasonsLot.size) {
        entry.in_lot = true;
        entry.in_lot_reasons = Array.from(reasonsLot);
      }
      if (inDbHit) {
        entry.in_db = true;
        entry.in_db_severity = inDbSeverity; // 'high' = ⛔ déjà client / 'warn' = ⚠ à vérifier
        entry.in_db_reasons = reasonsDb;
        entry.in_db_details = {
          client_nom: inDbHit.client_nom || inDbHit.client || '',
          residence: inDbHit.residence || '',
          lot: inDbHit.lot || '',
          kind: inDbHit.kind || '',
          statut: inDbHit.statut || '',
          conseiller: inDbHit.conseiller || ''
        };
      }
      if (histHit) {
        entry.already_called = true;
        entry.already_called_reasons = histReasons;
        entry.already_called_details = histHit;
      }
      out.push(entry);
    }
  }
  return { ok: true, conseiller: a.code, total_contacts: N, total_dupes: out.length, contacts: out };
}

// v217 — GET ?action=mes-rdv → historique complet des RDV pris par le conseiller (depuis sa Sheet)
async function handleMesRdv(params) {
  const a = auth(params); if (a.error) return a;
  let csv;
  try { csv = await fetchSheetCSV(a.conseiller.sheetId, '0'); } catch (e) { return { error: e.message }; }
  const rows = parseCSV(csv);
  if (!rows.length) return { ok: true, rdv: [], total: 0 };
  const header = rows[0] || [];
  const idx = {
    date_attrib: header.findIndex(h => /date.attribution|date attribution/i.test(h)),
    nom: header.findIndex(h => /^nom$/i.test(h)),
    prenom: header.findIndex(h => /^prénom$|^prenom$/i.test(h)),
    tel1: header.findIndex(h => /tél\s*1|tel\s*1|téléphone\s*1/i.test(h)),
    tel2: header.findIndex(h => /tél\s*2|tel\s*2|téléphone\s*2/i.test(h)),
    profession: header.findIndex(h => /profession|métier|metier/i.test(h)),
    adresse: header.findIndex(h => /^adresse/i.test(h)),
    cp: header.findIndex(h => /code postal|^cp/i.test(h)),
    ville: header.findIndex(h => /^ville/i.test(h)),
    statut: header.findIndex(h => /statut\s*appel|^statut$/i.test(h)),
    rdv: header.findIndex(h => /^rdv$/i.test(h)),
    commentaire: header.findIndex(h => /commentaire conseiller/i.test(h)),
    commentaire_src: header.findIndex(h => /commentaire source/i.test(h))
  };
  const rdv = [], transmis_pc = [], a_suivre = [], echec = [], injoignable = [], nonQualifie = [], fauxNumero = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const rdvVal = (idx.rdv >= 0 ? r[idx.rdv] : '').toString().trim();
    const rdvLower = rdvVal.toLowerCase();
    if (!rdvLower) continue;
    const cell = {
      date_attrib: idx.date_attrib >= 0 ? r[idx.date_attrib] : '',
      nom: idx.nom >= 0 ? r[idx.nom] : '',
      prenom: idx.prenom >= 0 ? r[idx.prenom] : '',
      tel: (idx.tel1 >= 0 ? r[idx.tel1] : '') || (idx.tel2 >= 0 ? r[idx.tel2] : ''),
      profession: idx.profession >= 0 ? r[idx.profession] : '',
      adresse: idx.adresse >= 0 ? r[idx.adresse] : '',
      cp: idx.cp >= 0 ? r[idx.cp] : '',
      ville: idx.ville >= 0 ? r[idx.ville] : '',
      statut_appel: idx.statut >= 0 ? r[idx.statut] : '',
      rdv_value: rdvVal,
      commentaire_conseiller: idx.commentaire >= 0 ? r[idx.commentaire] : '',
      commentaire_source: idx.commentaire_src >= 0 ? r[idx.commentaire_src] : ''
    };
    if (/^validé|^valide|rdv\s*pris|confirmé|rendez-vous/.test(rdvLower)) rdv.push(cell);
    else if (/paris\s*conseils|transmis/.test(rdvLower))                    transmis_pc.push(cell);
    else if (/a\s*suivre|à\s*suivre|rappeler/.test(rdvLower))               a_suivre.push(cell);
    else if (/non\s*qualif/.test(rdvLower))                                 nonQualifie.push(cell);
    else if (/erron|faux|mauvais/.test(rdvLower))                           fauxNumero.push(cell);
    else if (/echec|échec|refus/.test(rdvLower))                            echec.push(cell);
    else if (/sans\s*réponse|sans\s*reponse|répondeur|repondeur|injoign|messagerie/.test(rdvLower + ' ' + (cell.statut_appel||'').toLowerCase())) injoignable.push(cell);
  }
  // Tri du plus récent au plus ancien
  const parseFR = (s) => {
    if (!s) return 0;
    const m = String(s).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    return m ? new Date(+m[3], +m[2] - 1, +m[1]).getTime() : 0;
  };
  [rdv, transmis_pc, a_suivre, echec, injoignable, nonQualifie, fauxNumero].forEach(l => l.sort((a, b) => parseFR(b.date_attrib) - parseFR(a.date_attrib)));
  return {
    ok: true,
    conseiller: a.code,
    rdv, transmis_pc, a_suivre,
    echec, injoignable,
    non_qualifie: nonQualifie,
    faux_numero: fauxNumero,
    totaux: { rdv: rdv.length, transmis_pc: transmis_pc.length, a_suivre: a_suivre.length, echec: echec.length, injoignable: injoignable.length, non_qualifie: nonQualifie.length, faux_numero: fauxNumero.length }
  };
}

// GET ?action=stats-week → stats S en cours vs mois précédent (lit la Sheet directement)
async function handleStatsWeek(params) {
  const a = auth(params); if (a.error) return a;
  let csv;
  try { csv = await fetchSheetCSV(a.conseiller.sheetId, '0'); } catch (e) { return { error: e.message }; }
  const rows = parseCSV(csv);
  const header = rows[0] || [];
  const idxDate = header.findIndex(h => /date.attribution|date attribution/i.test(h));
  const idxRdv = header.findIndex(h => /^rdv$/i.test(h));
  const idxStatut = header.findIndex(h => /statut.appel/i.test(h));
  const now = new Date();
  const thisWeek = isoWeekKey(now);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  let weekTotal = 0, weekRdv = 0, weekTransmis = 0, weekEchec = 0, weekInjoign = 0;
  let prevMonthTotal = 0, prevMonthRdv = 0, prevMonthTransmis = 0, prevMonthEchec = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const d = idxDate >= 0 ? parseDateFR(r[idxDate]) : null;
    if (!d || isNaN(d)) continue;
    const rdvVal = (idxRdv >= 0 ? r[idxRdv] : '').toString().trim().toLowerCase();
    const statutVal = (idxStatut >= 0 ? r[idxStatut] : '').toString().trim().toLowerCase();
    const isRdv = /^validé|^valide|rdv\s*pris/.test(rdvVal);
    const isTransmis = /paris\s*conseils|transmis/.test(rdvVal);
    const isEchec = /echec|échec|refus|non\s*qualif|erron/.test(rdvVal);
    const isInjoign = /sans\s*réponse|sans\s*reponse|répondeur|repondeur|injoign|mauvais/.test(rdvVal + ' ' + statutVal);
    if (isoWeekKey(d) === thisWeek) {
      weekTotal++; if (isRdv) weekRdv++; if (isTransmis) weekTransmis++; if (isEchec) weekEchec++; if (isInjoign) weekInjoign++;
    }
    if (d >= prevMonthStart && d <= prevMonthEnd) {
      prevMonthTotal++; if (isRdv) prevMonthRdv++; if (isTransmis) prevMonthTransmis++; if (isEchec) prevMonthEchec++;
    }
  }
  return {
    ok: true,
    conseiller: a.code,
    week: { period: thisWeek, total: weekTotal, rdv: weekRdv, transmis: weekTransmis, echec: weekEchec, injoign: weekInjoign },
    prev_month: { period: prevMonthStart.toISOString().slice(0, 7), total: prevMonthTotal, rdv: prevMonthRdv, transmis: prevMonthTransmis, echec: prevMonthEchec }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// v222 — CONGÉS conseillers (pause de transmission contacts)
// Stockage : Netlify Blobs "conges" → liste globale {id, conseiller, debut, fin, raison, cree}
// Helper isConseillerEnConges(code, dateISO) utilisé par daily-distributor.js
// ─────────────────────────────────────────────────────────────────────────────
async function handleCongesList(params) {
  const code = (params.conseiller || '').toUpperCase();
  if (params.token && params.token !== 'admin' && code !== 'CORENTIN') {
    const a = auth(params); if (a.error) return a;
  }
  const db = getDB('conges');
  const all = (await db.get('list', { type: 'json' })) || [];
  const today = new Date().toISOString().slice(0,10);
  const isAdmin = code === 'CORENTIN';
  const filtered = (isAdmin ? all : all.filter(c => (c.conseiller||'').toUpperCase() === code))
    .filter(c => (c.fin || '9999-12-31') >= today) // ne montre que congés en cours ou à venir
    .sort((a,b) => (a.debut||'').localeCompare(b.debut||''));
  return { ok: true, conges: filtered };
}
async function handleCongesAdd(params, payload) {
  const a = auth(params); if (a.error) return a;
  const p = payload.conge || payload;
  if (!p.debut || !p.fin) return { error: 'date début et fin requises' };
  if (p.debut > p.fin) return { error: 'date début doit être avant date fin' };
  const obj = {
    id: p.id || `conge_${Date.now()}_${Math.random().toString(36).slice(2,5)}`,
    conseiller: a.code,
    debut: p.debut,                                  // YYYY-MM-DD
    fin: p.fin,                                      // YYYY-MM-DD
    raison: (p.raison || '').trim(),
    cree: new Date().toISOString()
  };
  const db = getDB('conges');
  const all = (await db.get('list', { type: 'json' })) || [];
  const idx = all.findIndex(c => c.id === obj.id);
  if (idx >= 0) all[idx] = { ...all[idx], ...obj, cree: all[idx].cree };
  else all.push(obj);
  await db.setJSON('list', all);
  return { ok: true, conge: obj };
}
async function handleCongesDelete(params, payload) {
  const a = auth(params); if (a.error) return a;
  const db = getDB('conges');
  const all = (await db.get('list', { type: 'json' })) || [];
  const item = all.find(c => c.id === payload.id);
  if (!item) return { error: 'congé inconnu' };
  // Sécurité : un conseiller ne peut supprimer que ses propres congés (sauf Corentin)
  if (a.code !== 'CORENTIN' && item.conseiller !== a.code) return { error: 'non autorisé' };
  const next = all.filter(c => c.id !== payload.id);
  await db.setJSON('list', next);
  return { ok: true, removed: all.length - next.length };
}
async function isConseillerEnConges(code, dateISO) {
  try {
    const db = getDB('conges');
    const all = (await db.get('list', { type: 'json' })) || [];
    const d = (dateISO || new Date().toISOString().slice(0,10));
    return all.some(c => (c.conseiller||'').toUpperCase() === code.toUpperCase()
                      && (c.debut <= d) && (c.fin >= d));
  } catch (e) { return false; }
}
module.exports._isConseillerEnConges = isConseillerEnConges; // exposé pour daily-distributor

// ─────────────────────────────────────────────────────────────────────────────
// v225 — OBJECTIF ÉQUIPE Paris Conseils (hebdo : 30 contacts · 6 R2M · 2 RESA)
//        Récompense bonus débloquée à 3 RESA équipe / semaine
// ─────────────────────────────────────────────────────────────────────────────
const TEAM_OBJECTIVE = {
  contacts: 30, // hebdo équipe
  r2m: 6,
  resa: 2,
  bonus_resa: 3, // seuil pour la récompense surprise
  rewards: [
    { id: 'voyage', emoji: '✈️', label: 'Photo voyage surprise — destination tirée au sort' },
    { id: 'iphone', emoji: '📱', label: 'iPhone dernier modèle' },
    { id: 'ordi', emoji: '💻', label: 'Ordinateur portable de ton choix' },
    { id: 'diner', emoji: '🥂', label: 'Dîner gastronomique top — Pierre Gagnaire ou Plaza Athénée' },
    { id: 'poney', emoji: '🦫', label: 'Séjour poney club avec René la Taupe (oui oui)' }
  ]
};
function _weekBounds() {
  const now = new Date();
  const d = new Date(now);
  const dow = (d.getUTCDay() + 6) % 7; // lun=0 ... dim=6
  d.setUTCDate(d.getUTCDate() - dow);
  d.setUTCHours(0,0,0,0);
  const start = d.toISOString().slice(0,10);
  const end = new Date(d.getTime() + 7 * 86400000 - 1).toISOString().slice(0,10);
  return { start, end };
}
async function handleTeamObjective(params) {
  // Pas d'auth strict ici — les chiffres équipe sont visibles par David, Nicolas, Corentin
  const { start, end } = _weekBounds();
  const codes = ['DAVID', 'NICOLAS'];
  const result = {};
  let team_contacts = 0, team_r2m = 0, team_resa = 0;

  // v229f — Contacts TRAITÉS (statut posé), pas distribués + R2M depuis état appels-bo
  const distribStore = getDB('daily-distrib');
  const appelsStore = getDB('appels-bo');
  for (const code of codes) {
    let contacts = 0, r2m = 0;
    for (let d = 0; d < 7; d++) {
      const day = new Date(Date.UTC(...start.split('-').map((s,i) => i===1 ? +s-1 : +s)) + d * 86400000).toISOString().slice(0,10);
      const state = await appelsStore.get(`etat_${code}_${day}`, { type: 'json' });
      if (state && state.contacts) {
        for (const c of Object.values(state.contacts)) {
          if (c.statut_appel || c.statut_rdv) contacts++;
          if ((c.statut_rdv||'').toUpperCase() === 'RDV_VALIDE') r2m++;
        }
      }
    }
    result[code] = { contacts, r2m, resa: 0 };
    team_contacts += contacts;
    team_r2m += r2m;
  }

  // 2) RESA depuis dossiers Blobs (kind=RESA, créés cette semaine)
  try {
    const dossiersStore = getDB('dossiers');
    const all = (await dossiersStore.get('list', { type: 'json' })) || [];
    for (const d of all) {
      const k = (d.kind||'').toUpperCase();
      if (k !== 'RESA') continue;
      const maj = (d.maj || d.date_resa || d.cree || '').slice(0,10);
      if (maj < start || maj > end) continue;
      const cons = (d.conseiller || '').toUpperCase();
      if (result[cons]) result[cons].resa++;
      team_resa++;
    }
  } catch (e) { /* tolerant */ }

  // 3) Construction de la réponse
  const pct = (n, d) => d > 0 ? Math.min(100, Math.round(n / d * 100)) : 0;
  const objAtteint = team_resa >= TEAM_OBJECTIVE.resa && team_r2m >= TEAM_OBJECTIVE.r2m;
  const bonusUnlocked = team_resa >= TEAM_OBJECTIVE.bonus_resa;
  return {
    ok: true,
    periode: { debut: start, fin: end, label: 'Semaine du ' + new Date(start + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) },
    objectif: { contacts: TEAM_OBJECTIVE.contacts, r2m: TEAM_OBJECTIVE.r2m, resa: TEAM_OBJECTIVE.resa, bonus_resa: TEAM_OBJECTIVE.bonus_resa },
    objectif_perso: { contacts: TEAM_OBJECTIVE.contacts / 2, r2m: TEAM_OBJECTIVE.r2m / 2, resa: TEAM_OBJECTIVE.resa / 2 },
    reel: { contacts: team_contacts, r2m: team_r2m, resa: team_resa },
    par_conseiller: result,
    pourcent: { contacts: pct(team_contacts, TEAM_OBJECTIVE.contacts), r2m: pct(team_r2m, TEAM_OBJECTIVE.r2m), resa: pct(team_resa, TEAM_OBJECTIVE.resa) },
    objectif_atteint: objAtteint,
    bonus_unlocked: bonusUnlocked,
    // v225c — Plus de compteur visible, juste un teaser énigmatique
    bonus_message: '🏆 CHALLENGE DU MOMENT — clique ici pour découvrir',
    rewards: TEAM_OBJECTIVE.rewards
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HANDLER
// ─────────────────────────────────────────────────────────────────────────────
const innerHandler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, body: '' };
  const params = event.queryStringParameters || {};
  const action = (params.action || '').toLowerCase();
  let payload = {};
  if (event.body) { try { payload = JSON.parse(event.body); } catch (e) { /* noop */ } }
  if (action === 'ping') return { statusCode: 200, body: JSON.stringify({ ok: true, ts: new Date().toISOString() }) };
  let res;
  if (event.httpMethod === 'GET') {
    if (action === 'lot')         res = await handleLot(params);
    else if (action === 'mes-rdv')    res = await handleMesRdv(params);
    else if (action === 'stats-week') res = await handleStatsWeek(params);
    else if (action === 'stats-conseiller') res = await handleStatsConseiller(params);
    else if (action === 'check-dupes') res = await handleCheckDupes(params);
    else if (action === 'conges-list') res = await handleCongesList(params);
    else if (action === 'team-objective') res = await handleTeamObjective(params);
  }
  if (event.httpMethod === 'POST') {
    if (action === 'update-contact') res = await handleUpdateContact(params, payload);
    else if (action === 'validate-lot') res = await handleValidateLot(params, payload);
    else if (action === 'login')       res = await handleLogin(payload);
    else if (action === 'magic-login') res = await handleMagicLogin(payload);
    else if (action === 'conges-add')  res = await handleCongesAdd(params, payload);
    else if (action === 'conges-delete') res = await handleCongesDelete(params, payload);
  }
  if (!res) return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Unknown action', knownActions: ['ping', 'login', 'lot', 'update-contact', 'validate-lot', 'mes-rdv', 'stats-week', 'stats-conseiller'] }) };
  const http = res.http || (res.error ? 400 : 200);
  delete res.http;
  return { statusCode: http, body: JSON.stringify(res) };
};

exports.handler = async (event) => {
  try { return withCors(await innerHandler(event)); }
  catch (err) { return withCors({ statusCode: 500, body: JSON.stringify({ ok: false, error: 'Unhandled: ' + err.message }) }); }
};
