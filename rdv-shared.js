// Paris Conseils — page « Prendre rendez-vous » (v285)
// Autonome : le visiteur propose jusqu'à 3 créneaux (jours ouvrés, 9h–18h30, heure de Paris),
// le conseiller reçoit un e-mail avec les créneaux (+ lien agenda) et confirme. Aucune API agenda requise.
(function () {
  var CONS = window.PC_CONSEILLER || 'corentin';
  var NOMS = { corentin: 'Corentin Curtet', david: 'David Pereira', nicolas: 'Nicolas Moreau' };
  var NOM = window.PC_CONSEILLER_NOM || NOMS[CONS] || 'Paris Conseils';
  var PRENOM = NOM.split(' ')[0];
  var INITIALES = NOM.split(' ').map(function (s) { return s.charAt(0); }).join('').toUpperCase();
  var API = '/.netlify/functions/parrainage-relay';
  var MAX = 3;
  var app = document.getElementById('pc-app');
  var $ = function (id) { return document.getElementById(id); };

  // Pré-remplissage éventuel depuis le lien du mail (?email=…&prenom=…&nom=…)
  var qs = new URLSearchParams(location.search);
  var state = { format: 'tel', dayIdx: 0, picked: [], days: [] };

  // ---------- Jours ouvrés (10) à partir de demain ----------
  var JOURS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
  var MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  var MOIS_L = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  var HEURES = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30', '18:00', '18:30'];
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function buildDays() {
    var out = []; var d = new Date(); d.setHours(0, 0, 0, 0);
    // on démarre à demain si après 17h, sinon aujourd'hui reste proposé (créneaux futurs uniquement)
    var startToday = new Date().getHours() < 17;
    if (!startToday) d.setDate(d.getDate() + 1);
    while (out.length < 10) {
      var dow = d.getDay();
      if (dow !== 0 && dow !== 6) out.push({ key: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()), dow: JOURS[dow], num: d.getDate(), month: MOIS[d.getMonth()], monthL: MOIS_L[d.getMonth()], year: d.getFullYear() });
      d.setDate(d.getDate() + 1);
    }
    return out;
  }
  function slotLabel(key, h) { var day = state.days.filter(function (x) { return x.key === key; })[0]; return (day ? day.dow + ' ' + day.num + ' ' + day.month : key) + ' · ' + h; }
  function slotIsPast(key, h) { var now = new Date(); var dt = new Date(key + 'T' + h + ':00'); return dt.getTime() < now.getTime() + 60 * 60 * 1000; }

  function render() {
    app.innerHTML =
      '<div class="card">' +
        '<div class="eyebrow">Rendez-vous découverte · sans engagement</div>' +
        '<h1>Prenez rendez-vous avec ' + PRENOM + '</h1>' +
        '<div class="who"><div class="av">' + INITIALES + '</div><div><div class="nm">' + NOM + '</div><div class="rl">Ingénierie financière &amp; optimisation fiscale · Paris Conseils</div></div></div>' +
        '<p style="margin-top:14px">Choisissez <b>jusqu\'à trois créneaux</b> qui vous conviennent : ' + PRENOM + ' vous confirme rapidement celui qu\'il retient et vous envoie l\'invitation (téléphone ou visioconférence, une trentaine de minutes).</p>' +
      '</div>' +
      '<div class="card">' +
        '<h2>1 · Comment souhaitez-vous échanger ?</h2>' +
        '<div class="opts">' +
          '<div class="opt ' + (state.format === 'tel' ? 'on' : '') + '" data-fmt="tel"><div class="l">📞 Par téléphone</div><div class="s">' + PRENOM + ' vous appelle au créneau retenu</div></div>' +
          '<div class="opt ' + (state.format === 'visio' ? 'on' : '') + '" data-fmt="visio"><div class="l">🎥 En visioconférence</div><div class="s">Lien Google Meet envoyé avec la confirmation</div></div>' +
        '</div>' +
      '</div>' +
      '<div class="card">' +
        '<h2>2 · Vos créneaux préférés <span class="hint">(jusqu\'à 3)</span></h2>' +
        '<div class="days" id="days"></div>' +
        '<div class="slots" id="slots"></div>' +
        '<div class="picked" id="picked"></div>' +
      '</div>' +
      '<div class="card">' +
        '<h2>3 · Vos coordonnées</h2>' +
        '<div class="grid2">' +
          '<div><label for="prenom">Prénom</label><input type="text" id="prenom" autocomplete="given-name"></div>' +
          '<div><label for="nom">Nom</label><input type="text" id="nom" autocomplete="family-name"></div>' +
          '<div><label for="email">E-mail</label><input type="email" id="email" autocomplete="email"></div>' +
          '<div><label for="tel">Téléphone</label><input type="tel" id="tel" autocomplete="tel" placeholder="06 …"></div>' +
        '</div>' +
        '<label for="message">Un mot sur votre situation ou votre projet <span class="hint" style="text-transform:none;letter-spacing:0">(facultatif)</span></label>' +
        '<textarea id="message" rows="3" placeholder="Ex : je souhaite comprendre ce qu\'il est possible de faire sans apport…"></textarea>' +
        '<button type="button" class="btn" id="submit">Demander ce rendez-vous</button>' +
        '<div id="flash" class="flash"></div>' +
        '<p class="hint" style="margin-top:12px">Vos coordonnées servent uniquement à organiser cet échange. Confidentialité absolue · secret professionnel.</p>' +
      '</div>';
    $('prenom').value = qs.get('prenom') || ''; $('nom').value = qs.get('nom') || ''; $('email').value = qs.get('email') || '';
    Array.prototype.forEach.call(app.querySelectorAll('.opt'), function (o) { o.addEventListener('click', function () { state.format = o.getAttribute('data-fmt'); Array.prototype.forEach.call(app.querySelectorAll('.opt'), function (x) { x.classList.toggle('on', x === o); }); }); });
    renderDays(); renderSlots(); renderPicked();
    $('submit').addEventListener('click', submit);
  }
  function renderDays() {
    var el = $('days'); el.innerHTML = '';
    state.days.forEach(function (d, i) {
      var b = document.createElement('div'); b.className = 'day' + (i === state.dayIdx ? ' on' : '');
      b.innerHTML = '<div class="d">' + d.dow + '</div><div class="n">' + d.num + '</div><div class="m">' + d.month + '</div>';
      b.addEventListener('click', function () { state.dayIdx = i; renderDays(); renderSlots(); });
      el.appendChild(b);
    });
  }
  function renderSlots() {
    var el = $('slots'); el.innerHTML = ''; var day = state.days[state.dayIdx];
    HEURES.forEach(function (h) {
      var key = day.key + 'T' + h; var past = slotIsPast(day.key, h); var on = state.picked.indexOf(key) >= 0;
      var s = document.createElement('div'); s.className = 'slot' + (on ? ' on' : '') + (past ? ' off' : ''); s.textContent = h.replace(':', 'h');
      if (!past) s.addEventListener('click', function () { toggle(key); });
      el.appendChild(s);
    });
  }
  function toggle(key) {
    var i = state.picked.indexOf(key);
    if (i >= 0) state.picked.splice(i, 1);
    else { if (state.picked.length >= MAX) { flash('info', 'Trois créneaux maximum — retirez-en un pour en choisir un autre.'); return; } state.picked.push(key); }
    state.picked.sort(); renderSlots(); renderPicked();
  }
  function renderPicked() {
    var el = $('picked'); el.innerHTML = '';
    if (!state.picked.length) { el.innerHTML = '<span class="hint">Aucun créneau choisi pour l\'instant.</span>'; return; }
    state.picked.forEach(function (key) {
      var parts = key.split('T'); var c = document.createElement('span'); c.className = 'chip'; c.innerHTML = slotLabel(parts[0], parts[1].replace(':', 'h')) + ' <b title="Retirer">✕</b>';
      c.querySelector('b').addEventListener('click', function () { toggle(key); }); el.appendChild(c);
    });
  }
  function flash(cls, msg) { var f = $('flash'); f.className = 'flash ' + cls; f.innerHTML = msg; try { f.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {} }

  function submit() {
    var missing = [];
    if (!state.picked.length) missing.push('au moins un créneau');
    if ($('prenom').value.trim().length < 2) missing.push('prénom');
    if ($('nom').value.trim().length < 2) missing.push('nom');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test($('email').value.trim())) missing.push('e-mail valide');
    if ($('tel').value.replace(/\D/g, '').length < 9) missing.push('numéro de téléphone');
    if (missing.length) { flash('error', 'Merci de compléter : <b>' + missing.join(', ') + '</b>.'); return; }
    var btn = $('submit'); btn.disabled = true; btn.textContent = 'Envoi…';
    var labels = state.picked.map(function (k) { var p = k.split('T'); return slotLabel(p[0], p[1].replace(':', 'h')); });
    fetch(API + '?action=rdv', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      conseiller: CONS, format: state.format, creneaux: state.picked, creneauxLabels: labels,
      prenom: $('prenom').value.trim(), nom: $('nom').value.trim(), email: $('email').value.trim(), tel: $('tel').value.trim(), message: $('message').value.trim(),
      source: location.href.split('?')[0]
    }) }).then(function (r) { return r.json().then(function (j) { if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; }); })
    .then(function () {
      app.innerHTML = '<div class="card"><div class="eyebrow">C\'est noté</div><h1>Merci, ' + escapeHtml($('prenom').value.trim() || '') + '.</h1>' +
        '<p>' + PRENOM + ' a reçu vos créneaux (' + labels.map(escapeHtml).join(' · ') + ') et vous confirme rapidement celui qu\'il retient' + (state.format === 'visio' ? ', avec le lien de visioconférence' : '') + '.</p>' +
        '<p class="hint">Un empêchement ? Écrivez à <a href="mailto:contact@parisconseils.fr">contact@parisconseils.fr</a>.</p></div>';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    })
    .catch(function (err) { btn.disabled = false; btn.textContent = 'Demander ce rendez-vous'; flash('error', 'Envoi impossible (' + escapeHtml(err.message || 'inconnu') + '). Réessayez, ou écrivez à <a href="mailto:contact@parisconseils.fr">contact@parisconseils.fr</a>.'); });
  }
  function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  state.days = buildDays();
  render();
})();
