// Récepteur Chromecast de Mega Player (page affichée sur la télé pendant une diffusion).
// Le flux HLS est fabriqué et servi par le téléphone ; ici : lecture, habillage, et le canal
// « urn:x-cast:com.megaplayer.cast » par lequel le téléphone demande ce que la télé sait lire.
const CANAL = "urn:x-cast:com.megaplayer.cast";
const contexte = cast.framework.CastReceiverContext.getInstance();
const lecteur = contexte.getPlayerManager();
const attente = document.getElementById("attente");
const message = document.getElementById("message");

function afficherAttente(texte) {
  message.textContent = texte;
  attente.style.display = "flex";
}
function masquerAttente() { attente.style.display = "none"; }

// Ce que cette télé sait lire (HEVC, 10 bits, 4K, AC3 / E-AC3) : le téléphone copie ou convertit en conséquence.
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

contexte.addCustomMessageListener(CANAL, (event) => {
  const demande = typeof event.data === "string" ? (() => { try { return JSON.parse(event.data); } catch (e) { return {}; } })() : (event.data || {});
  if (demande.type === "BONJOUR" || demande.type === "CAPACITES") {
    contexte.sendCustomMessage(CANAL, event.senderId, capacites());
  } else if (demande.type === "ATTENTE") {
    afficherAttente(demande.texte || "Préparation…");
  }
});

lecteur.addEventListener(cast.framework.events.EventType.PLAYER_LOAD_COMPLETE, masquerAttente);
lecteur.addEventListener(cast.framework.events.EventType.PLAYING, masquerAttente);
lecteur.addEventListener(cast.framework.events.EventType.MEDIA_FINISHED, () => afficherAttente("Prêt à diffuser"));
lecteur.addEventListener(cast.framework.events.EventType.ERROR, (e) => {
  afficherAttente("Ce flux n'a pas pu être lu (" + (e && e.detailedErrorCode ? e.detailedErrorCode : "erreur") + ")");
});

// Chargement : lecteur Shaka pour le HLS (segments fMP4 produits par le téléphone), réessais réseau.
const options = new cast.framework.CastReceiverOptions();
options.useShakaForHls = true;
options.disableIdleTimeout = true;
const config = new cast.framework.PlaybackConfig();
config.segmentRequestRetryLimit = 5;
config.manifestRequestHandler = (req) => { req.withCredentials = false; };
options.playbackConfig = config;
afficherAttente("Prêt à diffuser");
contexte.start(options);
