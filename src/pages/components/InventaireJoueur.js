import { useState, useEffect, useCallback } from "react";
import { supabase } from "../supabase";

// ============================================================
// 🎒 INVENTAIRE JOUEUR
// Props :
//   sessionId   — ID de la session
//   joueurId    — ID du joueur (null si MJ qui consulte)
//   joueurNom   — Nom du joueur
//   isMJ        — true si c'est le MJ qui consulte
//   inventaireGlobalActif — pour activer le bouton "déposer"
// ============================================================

export default function InventaireJoueur({ sessionId, joueurId, joueurNom, isMJ = false, inventaireGlobalActif = false }) {
  const [objets, setObjets] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);

  // Formulaire nouvel objet
  const [newNom, setNewNom] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newQte, setNewQte] = useState(1);
  const [newIcon, setNewIcon] = useState("📦");

  const ICONS = ["📦", "⚔️", "🛡️", "🧪", "💰", "🗝️", "📜", "🏹", "🔮", "💎", "🍖", "🧲"];

  // Charge les objets du joueur
  const charger = useCallback(async () => {
    if (!joueurId && !isMJ) return;
    const query = supabase
      .from("objets")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });

    if (!isMJ && joueurId) query.eq("joueur_id", joueurId);

    const { data } = await query;
    if (data) setObjets(data);
  }, [sessionId, joueurId, isMJ]);

  useEffect(() => {
    charger();
    const interval = setInterval(charger, 2000);
    return () => clearInterval(interval);
  }, [charger]);

  // Ajouter un objet
  const ajouterObjet = async () => {
    if (!newNom.trim()) return;
    setLoading(true);

    const { data: objet } = await supabase
      .from("objets")
      .insert([{
        session_id: sessionId,
        joueur_id: joueurId,
        nom: newNom.trim(),
        description: newDesc.trim(),
        quantite: parseInt(newQte) || 1,
        icon: newIcon,
      }])
      .select()
      .single();

    if (objet) {
      // Log
      await logAction(sessionId, "add", joueurNom, newNom.trim(), `${joueurNom} a obtenu "${newNom.trim()}"`, true);
      setObjets((prev) => [...prev, objet]);
      setNewNom(""); setNewDesc(""); setNewQte(1); setNewIcon("📦");
      setShowForm(false);
    }
    setLoading(false);
  };

  // Supprimer un objet
  const supprimerObjet = async (objet) => {
    await supabase.from("objets").delete().eq("id", objet.id);
    await logAction(sessionId, "remove", joueurNom, objet.nom, `${joueurNom} a perdu "${objet.nom}"`, true);
    setObjets((prev) => prev.filter((o) => o.id !== objet.id));
  };

  // Déposer dans l'inventaire global
  const deposerObjet = async (objet) => {
    // Supprime de l'inventaire joueur
    await supabase.from("objets").delete().eq("id", objet.id);

    // Ajoute à l'inventaire global
    await supabase.from("inventaire_global").insert([{
      session_id: sessionId,
      nom: objet.nom,
      description: objet.description,
      quantite: objet.quantite,
      icon: objet.icon,
      depose_par: joueurNom,
    }]);

    await logAction(sessionId, "drop", joueurNom, objet.nom, `${joueurNom} a déposé "${objet.nom}" dans l'inventaire commun`, true);
    setObjets((prev) => prev.filter((o) => o.id !== objet.id));
  };

  return (
    <div style={{ fontFamily: "'Segoe UI', sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: "0.85rem", color: "#95a5a6", textTransform: "uppercase", letterSpacing: 1 }}>
          🎒 {isMJ ? "Inventaires joueurs" : "Mon inventaire"}
        </h3>
        {!isMJ && (
          <button onClick={() => setShowForm(!showForm)} style={{
            background: showForm ? "#555" : "#e94560", color: "white", border: "none",
            padding: "5px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: "bold"
          }}>
            {showForm ? "Annuler" : "+ Objet"}
          </button>
        )}
      </div>

      {/* Formulaire ajout */}
      {showForm && (
        <div style={{ background: "#0f3460", borderRadius: 10, padding: 14, marginBottom: 10 }}>
          {/* Icônes */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {ICONS.map((ic) => (
              <button key={ic} onClick={() => setNewIcon(ic)} style={{
                fontSize: 18, background: newIcon === ic ? "#e94560" : "#16213e",
                border: "none", borderRadius: 6, padding: "4px 8px", cursor: "pointer",
              }}>{ic}</button>
            ))}
          </div>
          <input value={newNom} onChange={(e) => setNewNom(e.target.value)}
            placeholder="Nom de l'objet *"
            style={{ width: "100%", background: "#1a1a2e", border: "1px solid #e94560", color: "white", padding: "8px 10px", borderRadius: 6, fontSize: 13, boxSizing: "border-box", marginBottom: 6, outline: "none" }}
          />
          <input value={newDesc} onChange={(e) => setNewDesc(e.target.value)}
            placeholder="Description (optionnel)"
            style={{ width: "100%", background: "#1a1a2e", border: "1px solid #0f3460", color: "white", padding: "8px 10px", borderRadius: 6, fontSize: 13, boxSizing: "border-box", marginBottom: 6, outline: "none" }}
          />
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
            <label style={{ fontSize: 12, color: "#95a5a6" }}>Quantité :</label>
            <input type="number" value={newQte} min={1} onChange={(e) => setNewQte(e.target.value)}
              style={{ width: 60, background: "#1a1a2e", border: "1px solid #0f3460", color: "white", padding: "6px", borderRadius: 6, fontSize: 13, textAlign: "center", outline: "none" }}
            />
          </div>
          <button onClick={ajouterObjet} disabled={!newNom.trim() || loading}
            style={{ width: "100%", background: newNom.trim() ? "#e94560" : "#333", color: "white", border: "none", padding: "10px", borderRadius: 8, fontWeight: "bold", fontSize: 14, cursor: newNom.trim() ? "pointer" : "not-allowed" }}
          >
            {loading ? "Ajout…" : "✅ Ajouter l'objet"}
          </button>
        </div>
      )}

      {/* Liste des objets */}
      {objets.length === 0 ? (
        <div style={{ background: "#16213e", border: "1px solid #0f3460", borderRadius: 8, padding: 16, textAlign: "center", color: "#555", fontSize: 13 }}>
          Inventaire vide
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {objets.map((o) => (
            <div key={o.id} style={{ background: "#16213e", border: "1px solid #0f3460", borderRadius: 8, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 20 }}>{o.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: "bold", fontSize: 13, color: "white" }}>
                  {o.nom} {o.quantite > 1 && <span style={{ color: "#95a5a6", fontSize: 11 }}>×{o.quantite}</span>}
                </div>
                {o.description && <div style={{ fontSize: 11, color: "#95a5a6", marginTop: 2 }}>{o.description}</div>}
                {isMJ && <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>joueur_id: {o.joueur_id?.slice(0, 8)}…</div>}
              </div>
              {!isMJ && (
                <div style={{ display: "flex", gap: 6 }}>
                  {inventaireGlobalActif && (
                    <button onClick={() => deposerObjet(o)} title="Déposer dans l'inventaire commun"
                      style={{ background: "#0f3460", color: "#f1c40f", border: "1px solid #f1c40f", padding: "4px 8px", borderRadius: 5, cursor: "pointer", fontSize: 11 }}>
                      ⬇ Déposer
                    </button>
                  )}
                  <button onClick={() => supprimerObjet(o)} title="Supprimer"
                    style={{ background: "transparent", color: "#e94560", border: "1px solid #e94560", padding: "4px 8px", borderRadius: 5, cursor: "pointer", fontSize: 11 }}>
                    ✕
                  </button>
                </div>
              )}
              {isMJ && (
                <button onClick={() => supprimerObjet(o)} title="Supprimer (MJ)"
                  style={{ background: "transparent", color: "#e94560", border: "1px solid #e94560", padding: "4px 8px", borderRadius: 5, cursor: "pointer", fontSize: 11 }}>
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Fonction utilitaire partagée pour les logs
export async function logAction(sessionId, action, joueurNom, objetNom, details, visibleJoueurs = true) {
  await supabase.from("logs_inventaire").insert([{
    session_id: sessionId,
    action,
    joueur_nom: joueurNom,
    objet_nom: objetNom,
    details,
    visible_joueurs: visibleJoueurs,
  }]);
}