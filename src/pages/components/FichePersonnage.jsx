import { useState, useEffect } from "react";
import { supabase } from "../../supabase";
import { getConfigStats, getSeuils } from "./ConfigStats";

// ============================================================
// 🧙 FICHE PERSONNAGE
// Props :
//   sessionId   — ID de la session
//   joueurId    — ID du joueur
//   joueurNom   — Nom du joueur
//   isMJ        — true si MJ consulte
//   onRoll      — callback quand joueur clique sur une stat
//                 (stat, nomStat, valeur, de, seuil)
// ============================================================

const CLASSES = [
  { id: "guerrier",  label: "⚔️ Guerrier",  stats: { force: 5, agilite: 3, discretion: 1, intelligence: 2, perception: 2, charisme: 2, mental: 3, vitalite: 5 } },
  { id: "voleur",    label: "🗡️ Voleur",    stats: { force: 2, agilite: 5, discretion: 5, intelligence: 3, perception: 3, charisme: 2, mental: 2, vitalite: 2 } },
  { id: "mage",      label: "🔮 Mage",      stats: { force: 1, agilite: 2, discretion: 2, intelligence: 6, perception: 3, charisme: 2, mental: 5, vitalite: 1 } },
  { id: "archer",    label: "🏹 Archer",    stats: { force: 3, agilite: 5, discretion: 3, intelligence: 2, perception: 5, charisme: 1, mental: 2, vitalite: 3 } },
  { id: "pretre",    label: "✨ Prêtre",    stats: { force: 2, agilite: 2, discretion: 1, intelligence: 4, perception: 3, charisme: 4, mental: 4, vitalite: 4 } },
  { id: "barde",     label: "🎵 Barde",     stats: { force: 2, agilite: 3, discretion: 3, intelligence: 4, perception: 3, charisme: 5, mental: 2, vitalite: 2 } },
];

const STATS = ["force", "agilite", "discretion", "intelligence", "perception", "charisme", "mental", "vitalite"];
const STAT_ICONS = { force: "💪", agilite: "🏃", discretion: "🕵️", intelligence: "🧠", perception: "👁️", charisme: "🗣️", mental: "🧘", vitalite: "❤️" };
const MAX_STAT = 10;
const POINTS_LIBRES_BASE = 15;

export default function FichePersonnage({ sessionId, joueurId, joueurNom, isMJ = false, onRoll }) {
  const [fiche, setFiche] = useState(null); // null = pas encore créée
  const [stats, setStats] = useState(null);
  const [config, setConfig] = useState(null);
  const [seuils, setSeuils] = useState({});
  const [loading, setLoading] = useState(true);

  // Formulaire création
  const [etapeCreation, setEtapeCreation] = useState("infos"); // infos | classe | stats | recap
  const [formNom, setFormNom] = useState(joueurNom || "");
  const [formAge, setFormAge] = useState("");
  const [formEspece, setFormEspece] = useState("");
  const [formClasse, setFormClasse] = useState(null);
  const [formDesc, setFormDesc] = useState("");
  const [formStats, setFormStats] = useState({});
  const [pointsRestants, setPointsRestants] = useState(POINTS_LIBRES_BASE);

  // Popup résultat jet
  const [popupRoll, setPopupRoll] = useState(null);

  useEffect(() => {
    const charger = async () => {
      setLoading(true);
      const cfg = await getConfigStats(sessionId);
      const seuilsData = await getSeuils(sessionId);
      setConfig(cfg);
      setSeuils(seuilsData);

      // Cherche une fiche existante
      const query = supabase
        .from("personnages")
        .select("*, stats_personnage(*)")
        .eq("session_id", sessionId);

      if (!isMJ) query.eq("joueur_id", joueurId);

      const { data } = await query;
      if (data && data.length > 0) {
        setFiche(data[0]);
        setStats(data[0].stats_personnage?.[0] || null);
      }
      setLoading(false);
    };
    if (sessionId && (joueurId || isMJ)) charger();
  }, [sessionId, joueurId, isMJ]);

  // Initialise les stats quand une classe est choisie
  const choisirClasse = (classe) => {
    setFormClasse(classe);
    setFormStats({ ...classe.stats });
    setPointsRestants(POINTS_LIBRES_BASE);
  };

  // Ajouter/retirer un point d'une stat
  const modifierStat = (stat, delta) => {
    const classe = CLASSES.find(c => c.id === formClasse?.id);
    const min = classe?.stats[stat] || 0;
    const current = formStats[stat] || 0;
    const newVal = current + delta;
    if (newVal < min || newVal > MAX_STAT) return;
    if (delta > 0 && pointsRestants <= 0) return;
    setFormStats((prev) => ({ ...prev, [stat]: newVal }));
    setPointsRestants((prev) => prev - delta);
  };

  // Soumettre la fiche
  const soumettreFiche = async () => {
    const { data: nouvelleFiche } = await supabase
      .from("personnages")
      .insert([{
        session_id: sessionId,
        joueur_id: joueurId,
        nom: formNom.trim(),
        age: formAge.trim(),
        espece: formEspece.trim(),
        classe: formClasse.id,
        description: formDesc.trim(),
        statut: "en_attente",
      }])
      .select()
      .single();

    if (nouvelleFiche) {
      await supabase.from("stats_personnage").insert([{
        personnage_id: nouvelleFiche.id,
        ...formStats,
      }]);
      setFiche({ ...nouvelleFiche, stats_personnage: [formStats] });
      setStats(formStats);
    }
  };

  // Approuver / Rejeter (MJ)
  const approuver = async (ficheId) => {
    await supabase.from("personnages").update({ statut: "approuve" }).eq("id", ficheId);
    setFiche((prev) => ({ ...prev, statut: "approuve" }));
  };

  const rejeter = async (ficheId) => {
    await supabase.from("personnages").update({ statut: "rejete" }).eq("id", ficheId);
    setFiche((prev) => ({ ...prev, statut: "rejete" }));
  };

  // Clic sur une stat — lance le dé automatiquement
  const clickStat = async (stat) => {
    if (isMJ || !fiche || fiche.statut !== "approuve") return;
    const nomStat = config?.[`${stat}_nom`] || stat;
    const de = config?.[`${stat}_de`] || 20;
    const seuil = seuils[stat] || 10;
    const valeurStat = stats?.[stat] || 0;

    const jet = Math.floor(Math.random() * de) + 1;
    const total = jet + valeurStat;
    const reussite = total >= seuil;
    const critique = jet === de;
    const echecCritique = jet === 1;

    const resultat = {
      stat, nomStat, de, jet, valeurStat, total, seuil,
      reussite, critique, echecCritique,
      label: critique ? "🌟 RÉUSSITE CRITIQUE !" : echecCritique ? "💀 ÉCHEC CRITIQUE !" : reussite ? "✅ Réussite" : "❌ Échec",
      couleur: critique ? "#f1c40f" : echecCritique ? "#ff4500" : reussite ? "#4ee44e" : "#e94560",
    };

    setPopupRoll(resultat);
    setTimeout(() => setPopupRoll(null), 6000);

    // Envoie dans l'historique Supabase
    await supabase.from("lancers").insert([{
      session_id: sessionId,
      auteur: joueurNom,
      valeur: jet,
      bonus: valeurStat,
      total,
      faces: de,
      seuil,
      action_nom: nomStat,  // ← AJOUT : nom de la compétence
    }]);

    if (onRoll) onRoll(resultat);
  };

  const nomClasse = (id) => CLASSES.find(c => c.id === id)?.label || id;

  if (loading) return <div style={{ color: "#95a5a6", fontSize: 13, padding: 10 }}>Chargement…</div>;

  // ── VUE MJ — liste de toutes les fiches ──
  if (isMJ) return <VueMJ sessionId={sessionId} config={config} approuver={approuver} rejeter={rejeter} />;

  // ── PAS DE FICHE — formulaire de création ──
  if (!fiche) return (
    <FormCreation
      etape={etapeCreation} setEtape={setEtapeCreation}
      formNom={formNom} setFormNom={setFormNom}
      formAge={formAge} setFormAge={setFormAge}
      formEspece={formEspece} setFormEspece={setFormEspece}
      formClasse={formClasse} choisirClasse={choisirClasse}
      formDesc={formDesc} setFormDesc={setFormDesc}
      formStats={formStats} modifierStat={modifierStat}
      pointsRestants={pointsRestants}
      config={config} soumettre={soumettreFiche}
    />
  );

  // ── FICHE EN ATTENTE ──
  if (fiche.statut === "en_attente") return (
    <div style={{ background: "#16213e", border: "1px solid #f1c40f", borderRadius: 10, padding: 20, textAlign: "center" }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>⏳</div>
      <h3 style={{ color: "#f1c40f", margin: "0 0 8px" }}>Fiche en attente</h3>
      <p style={{ color: "#95a5a6", fontSize: 13 }}>Votre fiche a été soumise au MJ pour approbation.</p>
      <FicheResume fiche={fiche} stats={stats} config={config} />
    </div>
  );

  // ── FICHE REJETÉE ──
  if (fiche.statut === "rejete") return (
    <div style={{ background: "#16213e", border: "1px solid #e94560", borderRadius: 10, padding: 20, textAlign: "center" }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>❌</div>
      <h3 style={{ color: "#e94560", margin: "0 0 8px" }}>Fiche refusée</h3>
      <p style={{ color: "#95a5a6", fontSize: 13 }}>Le MJ a refusé votre fiche. Recréez-en une nouvelle.</p>
      <button onClick={() => setFiche(null)} style={{ background: "#e94560", color: "white", border: "none", padding: "10px 20px", borderRadius: 8, cursor: "pointer", fontWeight: "bold", marginTop: 10 }}>
        Recréer ma fiche
      </button>
    </div>
  );

  // ── FICHE APPROUVÉE — vue joueur active ──
  return (
    <div style={{ fontFamily: "'Segoe UI', sans-serif" }}>
      {/* Popup résultat jet */}
      {popupRoll && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)",
          background: "#16213e", border: `2px solid ${popupRoll.couleur}`,
          borderRadius: 12, padding: "16px 28px", textAlign: "center",
          boxShadow: `0 0 30px ${popupRoll.couleur}66`, zIndex: 1000,
          minWidth: 260, animation: "fadeIn 0.3s ease",
        }}>
          <div style={{ fontSize: 11, color: "#95a5a6", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
            {popupRoll.nomStat}
          </div>
          <div style={{ fontSize: 42, fontWeight: "bold", color: popupRoll.couleur, lineHeight: 1 }}>{popupRoll.total}</div>
          <div style={{ fontSize: 12, color: "#95a5a6", marginTop: 6 }}>
            Jet : {popupRoll.jet} · Bonus {popupRoll.nomStat} : +{popupRoll.valeurStat} · Total : {popupRoll.total}
          </div>
          <div style={{ fontSize: 12, color: "#95a5a6" }}>Seuil : {popupRoll.seuil}</div>
          <div style={{ marginTop: 8, fontWeight: "bold", color: popupRoll.couleur, fontSize: 16 }}>{popupRoll.label}</div>
        </div>
      )}

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateX(-50%) translateY(-10px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>

      {/* En-tête fiche */}
      <div style={{ background: "#16213e", border: "1px solid #4ee44e", borderRadius: 10, padding: 14, marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontWeight: "bold", fontSize: 16, color: "white" }}>{fiche.nom}</div>
            <div style={{ fontSize: 12, color: "#95a5a6", marginTop: 2 }}>
              {nomClasse(fiche.classe)}
              {fiche.espece && ` · ${fiche.espece}`}
              {fiche.age && ` · ${fiche.age} ans`}
            </div>
            {fiche.description && <div style={{ fontSize: 11, color: "#555", marginTop: 4, fontStyle: "italic" }}>{fiche.description}</div>}
          </div>
          <span style={{ background: "#4ee44e", color: "#1a1a2e", fontSize: 10, fontWeight: "bold", padding: "3px 8px", borderRadius: 10 }}>✅ Approuvé</span>
        </div>
      </div>

      {/* Stats cliquables */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: "#95a5a6", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
          Statistiques — cliquez pour agir
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {STATS.map((stat) => {
            const nom = config?.[`${stat}_nom`] || stat;
            const de = config?.[`${stat}_de`] || 20;
            const valeur = stats?.[stat] || 0;
            const seuil = seuils[stat] || 10;
            return (
              <button key={stat} onClick={() => clickStat(stat)} style={{
                background: "#16213e", border: "1px solid #0f3460",
                borderRadius: 8, padding: "10px 12px", cursor: "pointer",
                textAlign: "left", transition: "all 0.15s",
                display: "flex", alignItems: "center", gap: 10,
              }}
                onMouseEnter={(e) => e.currentTarget.style.borderColor = "#e94560"}
                onMouseLeave={(e) => e.currentTarget.style.borderColor = "#0f3460"}
              >
                <span style={{ fontSize: 20 }}>{STAT_ICONS[stat]}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: "bold", color: "white" }}>{nom}</div>
                  <div style={{ fontSize: 10, color: "#95a5a6" }}>d{de} · Seuil {seuil}</div>
                </div>
                <div style={{ fontSize: 20, fontWeight: "bold", color: "#e94560" }}>{valeur}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Sous-composant : Vue MJ (toutes les fiches) ──
function VueMJ({ sessionId, config, approuver, rejeter }) {
  const [fiches, setFiches] = useState([]);

  useEffect(() => {
    const charger = async () => {
      const { data } = await supabase
        .from("personnages")
        .select("*, stats_personnage(*), joueurs(nom)")
        .eq("session_id", sessionId);
      if (data) setFiches(data);
    };
    charger();
    const interval = setInterval(charger, 2000);
    return () => clearInterval(interval);
  }, [sessionId]);

  if (fiches.length === 0) return (
    <div style={{ background: "#16213e", border: "1px solid #0f3460", borderRadius: 8, padding: 16, textAlign: "center", color: "#555", fontSize: 13 }}>
      Aucune fiche soumise
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {fiches.map((f) => {
        const s = f.stats_personnage?.[0];
        return (
          <div key={f.id} style={{
            background: "#16213e",
            border: `1px solid ${f.statut === "approuve" ? "#4ee44e" : f.statut === "rejete" ? "#e94560" : "#f1c40f"}`,
            borderRadius: 10, padding: 14,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
              <div>
                <div style={{ fontWeight: "bold", color: "white" }}>{f.nom}</div>
                <div style={{ fontSize: 12, color: "#95a5a6" }}>
                  {CLASSES.find(c => c.id === f.classe)?.label || f.classe}
                  {f.espece && ` · ${f.espece}`}
                  {f.age && ` · ${f.age} ans`}
                </div>
                <div style={{ fontSize: 11, color: "#555" }}>Joueur : {f.joueurs?.nom}</div>
                {f.description && <div style={{ fontSize: 11, color: "#95a5a6", marginTop: 4, fontStyle: "italic" }}>{f.description}</div>}
              </div>
              <span style={{
                fontSize: 10, fontWeight: "bold", padding: "3px 8px", borderRadius: 10,
                background: f.statut === "approuve" ? "#4ee44e" : f.statut === "rejete" ? "#e94560" : "#f1c40f",
                color: "#1a1a2e"
              }}>
                {f.statut === "approuve" ? "✅ Approuvé" : f.statut === "rejete" ? "❌ Refusé" : "⏳ En attente"}
              </span>
            </div>

            {/* Stats */}
            {s && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginBottom: 10 }}>
                {STATS.map((stat) => (
                  <div key={stat} style={{ background: "#0f3460", borderRadius: 6, padding: "6px 8px", textAlign: "center" }}>
                    <div style={{ fontSize: 10, color: "#95a5a6" }}>{config?.[`${stat}_nom`] || stat}</div>
                    <div style={{ fontSize: 16, fontWeight: "bold", color: "#e94560" }}>{s[stat] || 0}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Boutons MJ */}
            {f.statut === "en_attente" && (
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => { approuver(f.id); setFiches(prev => prev.map(x => x.id === f.id ? { ...x, statut: "approuve" } : x)); }}
                  style={{ flex: 1, background: "#4ee44e", color: "#1a1a2e", border: "none", padding: "8px", borderRadius: 6, fontWeight: "bold", cursor: "pointer", fontSize: 12 }}>
                  ✅ Approuver
                </button>
                <button onClick={() => { rejeter(f.id); setFiches(prev => prev.map(x => x.id === f.id ? { ...x, statut: "rejete" } : x)); }}
                  style={{ flex: 1, background: "#e94560", color: "white", border: "none", padding: "8px", borderRadius: 6, fontWeight: "bold", cursor: "pointer", fontSize: 12 }}>
                  ❌ Refuser
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Sous-composant : Résumé fiche ──
function FicheResume({ fiche, stats, config }) {
  return (
    <div style={{ marginTop: 12, textAlign: "left" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
        {STATS.map((stat) => (
          <div key={stat} style={{ background: "#0f3460", borderRadius: 6, padding: "6px 8px", textAlign: "center" }}>
            <div style={{ fontSize: 10, color: "#95a5a6" }}>{config?.[`${stat}_nom`] || stat}</div>
            <div style={{ fontSize: 16, fontWeight: "bold", color: "#e94560" }}>{stats?.[stat] || 0}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Sous-composant : Formulaire création ──
function FormCreation({ etape, setEtape, formNom, setFormNom, formAge, setFormAge, formEspece, setFormEspece, formClasse, choisirClasse, formDesc, setFormDesc, formStats, modifierStat, pointsRestants, config, soumettre }) {
  const inputStyle = { width: "100%", background: "#1a1a2e", border: "1px solid #0f3460", color: "white", padding: "10px 12px", borderRadius: 8, fontSize: 13, boxSizing: "border-box", outline: "none", marginBottom: 10 };

  return (
    <div style={{ background: "#16213e", border: "1px solid #0f3460", borderRadius: 12, padding: 20 }}>
      <h3 style={{ color: "#e94560", marginTop: 0, textAlign: "center" }}>📜 Créer mon personnage</h3>

      {/* Étape : infos */}
      {etape === "infos" && (
        <div>
          <label style={{ fontSize: 11, color: "#95a5a6", textTransform: "uppercase", letterSpacing: 1 }}>Nom du personnage *</label>
          <input value={formNom} onChange={(e) => setFormNom(e.target.value)} placeholder="Ex: Aragorn" style={{ ...inputStyle, border: "1px solid #e94560" }} />

          <label style={{ fontSize: 11, color: "#95a5a6", textTransform: "uppercase", letterSpacing: 1 }}>Âge (optionnel)</label>
          <input value={formAge} onChange={(e) => setFormAge(e.target.value)} placeholder="Ex: 27 ans, inconnu, ancien..." style={inputStyle} />

          <label style={{ fontSize: 11, color: "#95a5a6", textTransform: "uppercase", letterSpacing: 1 }}>Espèce / Race (optionnel)</label>
          <input value={formEspece} onChange={(e) => setFormEspece(e.target.value)} placeholder="Ex: Humain, Elfe, Draconide..." style={inputStyle} />

          <label style={{ fontSize: 11, color: "#95a5a6", textTransform: "uppercase", letterSpacing: 1 }}>Description RP (optionnel)</label>
          <textarea value={formDesc} onChange={(e) => setFormDesc(e.target.value)} placeholder="Décrivez votre personnage..."
            style={{ ...inputStyle, height: 80, resize: "vertical", fontFamily: "inherit" }}
          />

          <button onClick={() => setEtape("classe")} disabled={!formNom.trim()}
            style={{ width: "100%", background: formNom.trim() ? "#e94560" : "#333", color: "white", border: "none", padding: "12px", borderRadius: 8, fontWeight: "bold", fontSize: 14, cursor: formNom.trim() ? "pointer" : "not-allowed" }}>
            Suivant → Choisir ma classe
          </button>
        </div>
      )}

      {/* Étape : classe */}
      {etape === "classe" && (
        <div>
          <p style={{ color: "#95a5a6", fontSize: 13, marginTop: 0 }}>Choisissez votre classe — elle définit vos statistiques de base</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            {CLASSES.map((c) => (
              <button key={c.id} onClick={() => choisirClasse(c)} style={{
                background: formClasse?.id === c.id ? "#e94560" : "#0f3460",
                color: "white", border: `1px solid ${formClasse?.id === c.id ? "#e94560" : "#0f3460"}`,
                padding: "12px 16px", borderRadius: 8, cursor: "pointer", textAlign: "left",
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <span style={{ fontWeight: "bold" }}>{c.label}</span>
                <span style={{ fontSize: 11, color: formClasse?.id === c.id ? "white" : "#95a5a6" }}>
                  {Object.entries(c.stats).map(([k, v]) => `${k.slice(0,3).toUpperCase()}:${v}`).join(" ")}
                </span>
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setEtape("infos")} style={{ flex: 1, background: "#0f3460", color: "white", border: "none", padding: "10px", borderRadius: 8, cursor: "pointer" }}>← Retour</button>
            <button onClick={() => setEtape("stats")} disabled={!formClasse}
              style={{ flex: 2, background: formClasse ? "#e94560" : "#333", color: "white", border: "none", padding: "10px", borderRadius: 8, fontWeight: "bold", cursor: formClasse ? "pointer" : "not-allowed" }}>
              Suivant → Répartir les points
            </button>
          </div>
        </div>
      )}

      {/* Étape : stats */}
      {etape === "stats" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <p style={{ color: "#95a5a6", fontSize: 13, margin: 0 }}>Répartissez vos points libres</p>
            <span style={{ background: pointsRestants > 0 ? "#e94560" : "#4ee44e", color: "white", padding: "4px 12px", borderRadius: 20, fontWeight: "bold", fontSize: 13 }}>
              {pointsRestants} pts restants
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            {STATS.map((stat) => {
              const nom = config?.[`${stat}_nom`] || stat;
              const classe = CLASSES.find(c => c.id === formClasse?.id);
              const min = classe?.stats[stat] || 0;
              const val = formStats[stat] || 0;
              return (
                <div key={stat} style={{ display: "flex", alignItems: "center", gap: 10, background: "#0f3460", borderRadius: 8, padding: "8px 12px" }}>
                  <span style={{ fontSize: 18 }}>{STAT_ICONS[stat]}</span>
                  <span style={{ flex: 1, fontSize: 13, color: "white" }}>{nom}</span>
                  <span style={{ fontSize: 10, color: "#555" }}>min:{min}</span>
                  <button onClick={() => modifierStat(stat, -1)} disabled={val <= min}
                    style={{ background: val <= min ? "#333" : "#1a1a2e", color: "white", border: "1px solid #555", width: 28, height: 28, borderRadius: 4, cursor: val <= min ? "not-allowed" : "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>−</button>
                  <span style={{ fontSize: 18, fontWeight: "bold", color: "#e94560", minWidth: 24, textAlign: "center" }}>{val}</span>
                  <button onClick={() => modifierStat(stat, 1)} disabled={val >= MAX_STAT || pointsRestants <= 0}
                    style={{ background: val >= MAX_STAT || pointsRestants <= 0 ? "#333" : "#1a1a2e", color: "white", border: "1px solid #555", width: 28, height: 28, borderRadius: 4, cursor: val >= MAX_STAT || pointsRestants <= 0 ? "not-allowed" : "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setEtape("classe")} style={{ flex: 1, background: "#0f3460", color: "white", border: "none", padding: "10px", borderRadius: 8, cursor: "pointer" }}>← Retour</button>
            <button onClick={() => setEtape("recap")}
              style={{ flex: 2, background: "#e94560", color: "white", border: "none", padding: "10px", borderRadius: 8, fontWeight: "bold", cursor: "pointer" }}>
              Suivant → Récapitulatif
            </button>
          </div>
        </div>
      )}

      {/* Étape : recap */}
      {etape === "recap" && (
        <div>
          <p style={{ color: "#95a5a6", fontSize: 13, marginTop: 0, textAlign: "center" }}>Vérifiez votre fiche avant de la soumettre au MJ</p>
          <div style={{ background: "#0f3460", borderRadius: 8, padding: 14, marginBottom: 16 }}>
            <div style={{ fontWeight: "bold", fontSize: 16, color: "white", marginBottom: 4 }}>{formNom}</div>
            <div style={{ fontSize: 12, color: "#95a5a6" }}>
              {CLASSES.find(c => c.id === formClasse?.id)?.label}
              {formEspece && ` · ${formEspece}`}
              {formAge && ` · ${formAge}`}
            </div>
            {formDesc && <div style={{ fontSize: 11, color: "#555", marginTop: 6, fontStyle: "italic" }}>{formDesc}</div>}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginTop: 12 }}>
              {STATS.map((stat) => (
                <div key={stat} style={{ background: "#16213e", borderRadius: 6, padding: "6px 8px", textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: "#95a5a6" }}>{config?.[`${stat}_nom`] || stat}</div>
                  <div style={{ fontSize: 16, fontWeight: "bold", color: "#e94560" }}>{formStats[stat] || 0}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setEtape("stats")} style={{ flex: 1, background: "#0f3460", color: "white", border: "none", padding: "10px", borderRadius: 8, cursor: "pointer" }}>← Retour</button>
            <button onClick={soumettre}
              style={{ flex: 2, background: "#4ee44e", color: "#1a1a2e", border: "none", padding: "10px", borderRadius: 8, fontWeight: "bold", cursor: "pointer", fontSize: 14 }}>
              📜 Soumettre au MJ
            </button>
          </div>
        </div>
      )}
    </div>
  );
}