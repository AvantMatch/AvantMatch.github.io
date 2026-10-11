// ============================================================
//  LES PRONOSTICS
// ------------------------------------------------------------
//  Des règles fixes, appliquées à toutes les données du site :
//  forme, face-à-face, fatigue, absents importants, domicile.
//  Même données = même prono : rien n'est laissé au hasard.
//
//  Chaque prono est enregistré avant le match, puis vérifié
//  après coup. Le site affiche le vrai taux de réussite.
//
//  Les réglages sont juste en dessous.
// ============================================================

// ---------- RÉGLAGES ----------
const NB_FORME = 5;                 // matchs pris en compte pour la forme
const MIN_MATCHS = 3;               // en dessous, pas de prono sur le vainqueur
const BONUS_DOMICILE = 1;           // avantage de la glace
const POIDS_FACE_A_FACE = 0.75;     // par victoire d'écart dans les face-à-face
const PLAFOND_FACE_A_FACE = 2.25;
const MALUS_FATIGUE = 1.5;          // l'équipe a joué la veille, pas l'autre
const MALUS_JOUEUR_CLE = 1;         // un des 3 meilleurs joueurs est absent
const MALUS_GARDIEN = 1.5;          // le gardien le plus utilisé est absent
const SEUIL_VAINQUEUR = 4;          // écart minimum pour donner un vainqueur
const SEUIL_CONFIANCE_ELEVEE = 7;
const LIGNE_BUTS = 5.5;
const SEUIL_PLUS = 6.2;             // moyenne de buts au-dessus : « plus de 5,5 »
const SEUIL_MOINS = 5.0;            // moyenne en dessous : « moins de 5,5 »
const MIN_POINTS_JOUEUR = 4;        // points sur les 5 derniers pour être « à suivre »
const JOURS_GARDES = 30;            // détail des pronos gardé 30 jours
// ------------------------------

const un = (x) => x.toFixed(1).replace(".", ",");
const plur = (n, mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;
const absent = (b) => /Absent|Liste|Suspendu/.test(b.statut || "");
// « C. Keller » (NHL) et « Clayton Keller » (ESPN) désignent le même joueur
export const cleJoueur = (nom) => {
  const p = String(nom || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\./g, "").trim().split(/\s+/);
  return p.length > 1 ? p[0][0] + " " + p.slice(1).join(" ") : p[0] || "";
};

function forme(equipe) {
  const matchs = (equipe?.historique || []).slice(0, NB_FORME);
  let points = 0, bp = 0, bc = 0, v = 0, auDessus = 0;
  for (const m of matchs) {
    bp += m.butsPour; bc += m.butsContre;
    if (m.victoire) { points += 2; v++; } else if (m.prolongation) points += 1;
    if (m.butsPour + m.butsContre > LIGNE_BUTS) auDessus++;
  }
  const n = matchs.length;
  return { n, v, points, diff: bp - bc, total: n ? (bp + bc) / n : null, auDessus, score: n ? ((points + (bp - bc) * 0.5) / n) * NB_FORME : 0 };
}

function joursRepos(equipe, dateDuMatch) {
  const dernier = equipe?.historique?.[0];
  if (!dernier || !dateDuMatch) return null;
  return Math.round((Date.parse(dateDuMatch) - Date.parse(dernier.date)) / 864e5) - 1;
}

// Les absents qui comptent : un des 3 meilleurs joueurs du moment, ou le gardien le plus utilisé
function absentsCles(abbrev, equipe, blesses) {
  const liste = (blesses?.[abbrev] || []).filter(absent);
  const cles = new Set(liste.map((b) => cleJoueur(b.nom)));
  const joueurs = (equipe?.joueurs || []).slice(0, 3).filter((j) => cles.has(cleJoueur(j.nom))).map((j) => j.nom);
  const g = equipe?.compo?.gardiens?.[0];
  const gardien = g && cles.has(cleJoueur(g.nom)) ? g.nom : null;
  return { joueurs, gardien };
}

// ---------- LE PRONO D'UN MATCH ----------
export function pronostiquerMatch(m, D) {
  const dom = m.domicile, ext = m.exterieur;
  const eDom = D.equipes?.[dom.abbrev], eExt = D.equipes?.[ext.abbrev];
  const fDom = forme(eDom), fExt = forme(eExt);
  const nomDom = dom.surnom || dom.nom, nomExt = ext.surnom || ext.nom;
  const pronos = [];

  // ----- 1. Le vainqueur -----
  if (fDom.n >= MIN_MATCHS && fExt.n >= MIN_MATCHS) {
    let total = 0;
    const raisons = []; // [points en faveur du domicile, phrase]

    const ecartForme = fDom.score + BONUS_DOMICILE - fExt.score;
    total += ecartForme;
    raisons.push([ecartForme, `Forme : ${nomExt} ${fExt.v}/${fExt.n} victoires, ${nomDom} ${fDom.v}/${fDom.n} (avec l'avantage de jouer à domicile)`]);

    const faf = m.faceAFace || [];
    if (faf.length) {
      const gDom = faf.filter((r) => (r.domicile === dom.abbrev ? r.scoreDom > r.scoreExt : r.scoreExt > r.scoreDom)).length;
      const gExt = faf.length - gDom;
      const p = Math.max(-PLAFOND_FACE_A_FACE, Math.min(PLAFOND_FACE_A_FACE, (gDom - gExt) * POIDS_FACE_A_FACE));
      if (p) { total += p; raisons.push([p, `Face-à-face : ${gDom > gExt ? nomDom : nomExt} a gagné ${Math.max(gDom, gExt)} des ${faf.length} derniers`]); }
    }

    const rDom = joursRepos(eDom, D.dateDesMatchs), rExt = joursRepos(eExt, D.dateDesMatchs);
    if (rExt === 0 && rDom !== 0) { total += MALUS_FATIGUE; raisons.push([MALUS_FATIGUE, `Fatigue : ${nomExt} a joué hier`]); }
    if (rDom === 0 && rExt !== 0) { total -= MALUS_FATIGUE; raisons.push([-MALUS_FATIGUE, `Fatigue : ${nomDom} a joué hier`]); }

    for (const [abbrev, equipe, nom, sens] of [[dom.abbrev, eDom, nomDom, -1], [ext.abbrev, eExt, nomExt, 1]]) {
      const a = absentsCles(abbrev, equipe, D.blesses);
      const p = sens * (a.joueurs.length * MALUS_JOUEUR_CLE + (a.gardien ? MALUS_GARDIEN : 0));
      if (p) {
        total += p;
        raisons.push([p, `Absent${a.joueurs.length + (a.gardien ? 1 : 0) > 1 ? "s" : ""} chez ${nom} : ${[...a.joueurs, ...(a.gardien ? [a.gardien + " (gardien)"] : [])].join(", ")}`]);
      }
    }

    if (Math.abs(total) >= SEUIL_VAINQUEUR) {
      const favori = total > 0 ? dom : ext;
      pronos.push({
        type: "vainqueur",
        choix: favori.abbrev,
        texte: `Victoire ${favori.surnom || favori.nom}`,
        detail: "prolongation et tirs au but compris",
        confiance: Math.abs(total) >= SEUIL_CONFIANCE_ELEVEE ? "élevée" : "moyenne",
        score: Math.round(Math.abs(total) * 10) / 10,
        // on ne garde que les raisons qui vont dans le sens du prono, de la plus forte à la plus faible
        raisons: raisons.filter(([p]) => Math.sign(p) === Math.sign(total)).sort((a, b) => Math.abs(b[0]) - Math.abs(a[0])).map(([, t]) => t),
        contre: raisons.filter(([p]) => p && Math.sign(p) !== Math.sign(total)).map(([, t]) => t),
      });
    }
  }

  // ----- 2. Le nombre de buts -----
  if (fDom.n >= MIN_MATCHS && fExt.n >= MIN_MATCHS) {
    const moy = (fDom.total + fExt.total) / 2;
    const part = (fDom.auDessus + fExt.auDessus) / (fDom.n + fExt.n);
    const raisonsButs = [
      `${nomExt} : ${un(fExt.total)} buts par match en moyenne (${fExt.auDessus}/${fExt.n} matchs au-dessus de 5,5)`,
      `${nomDom} : ${un(fDom.total)} buts par match en moyenne (${fDom.auDessus}/${fDom.n} matchs au-dessus de 5,5)`,
    ];
    const gardiensAbsents = [absentsCles(dom.abbrev, eDom, D.blesses).gardien, absentsCles(ext.abbrev, eExt, D.blesses).gardien].filter(Boolean);
    if (moy >= SEUIL_PLUS && part >= 0.6) {
      pronos.push({ type: "buts", choix: "plus", texte: "Plus de 5,5 buts", detail: "prolongation comprise", confiance: moy >= 6.8 ? "élevée" : "moyenne", score: Math.round(moy * 10) / 10,
        raisons: [...raisonsButs, ...(gardiensAbsents.length ? [`Gardien titulaire absent : ${gardiensAbsents.join(", ")}`] : [])], contre: [] });
    } else if (moy <= SEUIL_MOINS && part <= 0.4 && !gardiensAbsents.length) {
      pronos.push({ type: "buts", choix: "moins", texte: "Moins de 5,5 buts", detail: "prolongation comprise", confiance: moy <= 4.4 ? "élevée" : "moyenne", score: Math.round(moy * 10) / 10,
        raisons: raisonsButs, contre: [] });
    }
  }

  // ----- 3. Le joueur à suivre -----
  const blessesCles = new Set([...(D.blesses?.[dom.abbrev] || []), ...(D.blesses?.[ext.abbrev] || [])].map((b) => cleJoueur(b.nom)));
  const candidats = [...(eDom?.joueurs || []).map((j) => ({ ...j, eq: dom })), ...(eExt?.joueurs || []).map((j) => ({ ...j, eq: ext }))]
    .filter((j) => !blessesCles.has(cleJoueur(j.nom)) && j.points >= MIN_POINTS_JOUEUR && j.matchs >= MIN_MATCHS)
    .sort((a, b) => b.points / b.matchs - a.points / a.matchs || b.points - a.points);
  if (candidats.length) {
    const j = candidats[0];
    pronos.push({ type: "joueur", choix: j.nom, equipe: j.eq.abbrev, texte: `${j.nom} marque ou fait une passe`, detail: "au moins 1 point dans le match",
      confiance: j.points / j.matchs >= 1.6 ? "élevée" : "moyenne", score: j.points,
      raisons: [`${plur(j.points, "point")} sur ses ${j.matchs > 1 ? `${j.matchs} derniers matchs` : "dernier match"} (${plur(j.buts, "but")}, ${plur(j.passes, "passe")})`], contre: [] });
  }

  return pronos;
}

// ---------- VÉRIFIER UN PRONO APRÈS LE MATCH ----------
// partie = un match terminé du site (format du récap : scores, buts avec buteurs et passeurs)
export function verifier(prono, partie) {
  const sd = partie.domicile.score, se = partie.exterieur.score;
  if (sd == null || se == null) return null;
  if (prono.type === "vainqueur") return (sd > se ? partie.domicile.abbrev : partie.exterieur.abbrev) === prono.choix;
  if (prono.type === "buts") return prono.choix === "plus" ? sd + se > LIGNE_BUTS : sd + se < LIGNE_BUTS;
  if (prono.type === "joueur") {
    const cle = cleJoueur(prono.choix);
    return (partie.buts || []).some((b) => b.typePeriode !== "SO" && (cleJoueur(b.buteur) === cle || (b.passes || []).some((p) => cleJoueur(p.nom) === cle)));
  }
  return null;
}

// ---------- TENIR LE CARNET DES PRONOS ----------
// ancien = le carnet publié au passage précédent ; renvoie le carnet à jour
export function mettreAJourCarnet(ancien, D, pronosDuSoir, partiesTerminees) {
  const carnet = { entrees: [...(ancien?.entrees || [])], cumul: { ...(ancien?.cumul || {}) } };
  const index = new Map(carnet.entrees.map((e, i) => [`${e.match}|${e.type}`, i]));

  // 1. Les pronos du soir, figés dès que le match commence
  for (const m of D.matchs || []) {
    if (m.etat && !["FUT", "PRE"].includes(m.etat)) continue; // déjà commencé : on ne touche plus
    // on retire les anciens pronos de ce match (ils peuvent changer jusqu'au coup d'envoi)
    for (const type of ["vainqueur", "buts", "joueur"]) {
      const i = index.get(`${m.id}|${type}`);
      if (i != null && carnet.entrees[i].resultat == null) carnet.entrees[i] = null;
    }
    for (const p of pronosDuSoir[m.id] || []) {
      carnet.entrees.push({ match: m.id, date: D.dateDesMatchs, affiche: `${m.exterieur.abbrev} @ ${m.domicile.abbrev}`, type: p.type, texte: p.texte, choix: p.choix, confiance: p.confiance, resultat: null });
    }
  }
  carnet.entrees = carnet.entrees.filter(Boolean);

  // 2. Vérifier les pronos dont le match est terminé
  for (const e of carnet.entrees) {
    if (e.resultat != null) continue;
    const partie = partiesTerminees.get(e.match);
    if (!partie) continue;
    const ok = verifier(e, partie);
    if (ok == null) continue;
    e.resultat = ok ? "gagné" : "perdu";
    e.score = `${partie.exterieur.score}-${partie.domicile.score}`;
    const c = carnet.cumul[e.type] || { gagnes: 0, total: 0 };
    c.total += 1; if (ok) c.gagnes += 1;
    carnet.cumul[e.type] = c;
  }

  // 3. On ne garde le détail que des 30 derniers jours (le cumul, lui, reste)
  const limite = new Date(Date.now() - JOURS_GARDES * 864e5).toISOString().slice(0, 10);
  carnet.entrees = carnet.entrees.filter((e) => e.resultat == null || e.date >= limite);
  return carnet;
}
