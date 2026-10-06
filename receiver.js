// Récepteur Chromecast de Mega Player (page affichée sur la télé pendant une diffusion).
// Le flux HLS est fabriqué et servi par le téléphone. Ici : lecture, habillage (fiche au chargement / en pause,
// bandeau au changement de chaîne), sous-titres WebVTT relus pendant la conversion, et le canal
// « urn:x-cast:com.megaplayer.cast » : le téléphone demande ce que la télé sait lire et envoie les infos.
const CANAL = "urn:x-cast:com.megaplayer.cast";
const contexte = cast.framework.CastReceiverContext.getInstance();
const lecteur = contexte.getPlayerManager();
const $ = (id) => document.getElementById(id);

// ── État ──
const etat = { info: null, enLecture: false, cues: [], vtt: null, decalageMs: 0, vttOffset: 0, vttTimer: null, bandeauTimer: null };

// ── Écrans ──
function afficherAttente(texte) { $("message").textContent = texte; $("attente").style.display = "flex"; }
function masquerAttente() { $("attente").style.display = "none"; }

function remplirFiche(libelleEtat) {
  const i = etat.info || {};
  $("ficheEtat").textContent = libelleEtat;
  $("ficheTitre").textContent = i.titre || "";
  $("ficheSous").textContent = i.sousTitre || "";
  $("ficheSynopsis").textContent = i.synopsis || "";
  const aff = $("ficheAffiche");
  if (i.image) { aff.src = i.image; aff.classList.add("visible"); } else { aff.classList.remove("visible"); aff.removeAttribute("src"); }
}
function montrerFiche(libelleEtat) { remplirFiche(libelleEtat); $("fiche").classList.add("visible"); }
function masquerFiche() { $("fiche").classList.remove("visible"); }

function montrerBandeau() {
  const i = etat.info || {};
  if (!i.titre) return;
  $("bandeauTitre").textContent = i.titre;
  $("bandeauSous").textContent = i.sousTitre || "";
  $("bandeau").classList.add("visible");
  clearTimeout(etat.bandeauTimer);
  etat.bandeauTimer = setTimeout(() => $("bandeau").classList.remove("visible"), 4000);
}

// ── Capacités de la télé (HEVC, 10 bits, 4K, AC3 / E-AC3) : le téléphone copie ou convertit en conséquence ──
function capacites() {
  const peut = (type) => { try { return !!contexte.canDisplayType(type); } catch (e) { return false; } };
  return {
    type: "CAPACITES",
    hevc: peut('video/mp4; codecs="hvc1.1.6.L123.B0"'),
    hevc10: peut('video/mp4; codecs="hvc1.2.4.L153.B0"'),
    uhd: peut('video/mp4; codecs="hvc1.1.6.L153.B0"; width=3840; height=2160') || peut('video/mp4; codecs="avc1.640033"; width=3840; height=2160'),
    ac3: peut('audio/mp4; codecs="ac-3"'),
    eac3: peut('audio/mp4; codecs="ec-3"'),
  };
}

// ── Sous-titres : WebVTT servi par le téléphone, relu toutes les 4 s tant que la conversion avance ──
function parserVtt(texte) {
  const cues = [];
  const t = (h) => { const m = /(?:(\d+):)?(\d+):(\d+)[.,](\d+)/.exec(h); if (!m) return null; return ((+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3])) * 1000 + (+m[4].padEnd(3, "0").slice(0, 3)); };
  const blocs = texte.replace(/\r/g, "").split(/\n\n+/);
  for (const b of blocs) {
    const lignes = b.split("\n").filter((l) => l.length);
    const idx = lignes.findIndex((l) => l.includes("-->"));
    if (idx < 0) continue;
    const [d, f] = lignes[idx].split("-->");
    const debut = t(d.trim()), fin = t(f.trim().split(" ")[0]);
    if (debut == null || fin == null) continue;
    const corps = lignes.slice(idx + 1).join("\n").replace(/<[^>]+>/g, "");
    if (corps) cues.push({ debut, fin, texte: corps });
  }
  return cues;
}
async function relireVtt() {
  if (!etat.vtt) return;
  try {
    const r = await fetch(etat.vtt, { cache: "no-store" });
    if (r.ok) { const txt = await r.text(); if (txt.length !== etat.vttOffset) { etat.cues = parserVtt(txt); etat.vttOffset = txt.length; } }
  } catch (e) { /* pas encore produit */ }
}
function definirSousTitres(url, decalageMs) {
  etat.vtt = url || null; etat.decalageMs = decalageMs || 0; etat.cues = []; etat.vttOffset = 0;
  clearInterval(etat.vttTimer); etat.vttTimer = null;
  $("soustitres").innerHTML = "";
  if (etat.vtt) { relireVtt(); etat.vttTimer = setInterval(relireVtt, 4000); }
}
setInterval(() => {
  const zone = $("soustitres");
  if (!etat.vtt || !etat.cues.length) { if (zone.innerHTML) zone.innerHTML = ""; return; }
  const t = lecteur.getCurrentTimeSec() * 1000 + etat.decalageMs;
  const actifs = etat.cues.filter((c) => t >= c.debut && t <= c.fin).map((c) => c.texte);
  const html = actifs.length ? "<span>" + actifs.join("\n").replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</span>" : "";
  if (zone.innerHTML !== html) zone.innerHTML = html;
}, 250);

// ── Messages du téléphone ──
contexte.addCustomMessageListener(CANAL, (event) => {
  let m = event.data;
  if (typeof m === "string") { try { m = JSON.parse(m); } catch (e) { return; } }
  m = m || {};
  switch (m.type) {
    case "BONJOUR":
    case "CAPACITES":
      contexte.sendCustomMessage(CANAL, event.senderId, capacites());
      break;
    case "INFO":
      etat.info = { titre: m.titre || "", sousTitre: m.sousTitre || "", synopsis: m.synopsis || "", image: m.image || null, direct: !!m.direct };
      if ($("fiche").classList.contains("visible")) remplirFiche($("ficheEtat").textContent);
      else if (etat.enLecture && etat.info.direct) montrerBandeau();
      break;
    case "SOUS_TITRES":
      definirSousTitres(m.url, m.decalageMs);
      break;
    case "ATTENTE":
      masquerFiche(); afficherAttente(m.texte || "Préparation…");
      break;
  }
});

// ── Événements de lecture ──
const E = cast.framework.events.EventType;
lecteur.addEventListener(E.REQUEST_LOAD, () => { masquerAttente(); montrerFiche("Chargement"); });
lecteur.addEventListener(E.PLAYER_LOAD_COMPLETE, () => { masquerAttente(); });
lecteur.addEventListener(E.PLAYING, () => { etat.enLecture = true; masquerAttente(); masquerFiche(); if (etat.info && etat.info.direct) montrerBandeau(); });
lecteur.addEventListener(E.PAUSE, () => { etat.enLecture = false; montrerFiche("Pause"); });
lecteur.addEventListener(E.BUFFERING, (e) => { if (e.isBuffering && !etat.enLecture) montrerFiche("Chargement"); });
lecteur.addEventListener(E.MEDIA_FINISHED, () => { etat.enLecture = false; masquerFiche(); definirSousTitres(null, 0); afficherAttente("Prêt à diffuser"); });
lecteur.addEventListener(E.ERROR, (e) => {
  etat.enLecture = false; masquerFiche();
  afficherAttente("Ce flux n'a pas pu être lu (" + (e && e.detailedErrorCode ? e.detailedErrorCode : "erreur") + ")");
});

// ── Démarrage : lecteur Shaka pour le HLS (segments fMP4 du téléphone), réessais réseau ──
const options = new cast.framework.CastReceiverOptions();
options.useShakaForHls = true;
options.disableIdleTimeout = true;
const config = new cast.framework.PlaybackConfig();
config.segmentRequestRetryLimit = 5;
config.manifestRequestHandler = (req) => { req.withCredentials = false; };
options.playbackConfig = config;
afficherAttente("Prêt à diffuser");
contexte.start(options);
