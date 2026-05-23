import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../supabase";

// ============================================================
// 🎒 INVENTAIRE JOUEUR
// Props :
//   sessionId            — ID de la session
//   joueurId             — ID du joueur
//   joueurNom            — Nom du joueur
//   isMJ                 — true si MJ consulte
//   inventaireGlobalActif — pour activer le bouton déposer
//   onPopup              — callback pour afficher popup (type, message)
// ============================================================

export default function InventaireJoueur({ sessionId, joueurId, joueurNom, isMJ = false, inventaireGlobalActif = false, onPopup }) {
  const [objets, setObjets] = useState([]);
  const [offres, setOffres] = useState([]);

  // Charge les objets du joueur
  const chargerObjets = useCallback(async () => {
    if (!joueurId && !isMJ) return;
    let query = supabase
      .from("objets")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });
    if (!isMJ && joueurId) query = query.eq("joueur_id", joueurId);
    const { data } = await query;
    if (data) setObjets(data);
  }, [sessionId, joueurId, isMJ]);

  // Charge les offres en attente pour ce joueur
  const chargerOffres = useCallback(async () => {
    if (!joueurId || isMJ) return;
    const { data } = await supabase
      .from("offres")
      .select("*")
      .eq("session_id", sessionId)
      .eq("joueur_id", joueurId)
      .eq("statut", "en_attente")
      .order("created_at", { ascending: true });
    if (data) setOffres(data);
  }, [sessionId, joueurId, isMJ]);

  useEffect(() => {
    chargerObjets();
    chargerOffres();
    const interval = setInterval(() => {
      chargerObjets();
      chargerOffres();
    }, 1000);
    return () => clearInterval(interval);
  }, [chargerObjets, chargerOffres]);

  // Accepter une offre
  const accepterOffre = async (offre) => {
    await supabase.from("offres").update({ statut: "accepte" }).eq("id", offre.id);
    await supabase.from("objets").insert([{
      session_id: sessionId,
      joueur_id: joueurId,
      nom: offre.nom,
      description: offre.description,
      quantite: offre.quantite,
      icon: offre.icon,
    }]);
    await logAction(sessionId, "add", joueurNom, offre.nom, `${joueurNom} a accepté "${offre.nom}" du MJ`, true);
    setOffres((prev) => prev.filter((o) => o.id !== offre.id));
    chargerObjets();
    if (onPopup) onPopup("succes", `✅ Vous avez reçu "${offre.nom}" !`);
  };

  // Refuser une offre
  const refuserOffre = async (offre) => {
    await supabase.from("offres").update({ statut: "refuse" }).eq("id", offre.id);
    await logAction(sessionId, "remove", joueurNom, offre.nom, `${joueurNom} a refusé "${offre.nom}"`, true);
    setOffres((prev) => prev.filter((o) => o.id !== offre.id));
    if (onPopup) onPopup("info", `❌ Vous avez refusé "${offre.nom}"`);
  };

  // Supprimer un objet
  const supprimerObjet = async (objet) => {
    await supabase.from("objets").delete().eq("id", objet.id);
    await logAction(sessionId, "remove", joueurNom, objet.nom, `${joueurNom} a perdu "${objet.nom}"`, true);
    setObjets((prev) => prev.filter((o) => o.id !== objet.id));
  };

  // Déposer dans l'inventaire global
  const deposerObjet = async (objet) => {
    await supabase.from("objets").delete().eq("id", objet.id);
    await supabase.from("inventaire_global").insert([{
      session_id: sessionId,
      nom: objet.nom,
      description: objet.description,
      quantite: objet.quantite,
      icon: objet.icon,
      depose_par: joueurNom,
    }]);
    await logAction(sessionId, "drop", joueurNom, objet.nom, `${joueurNom} a déposé "${objet.nom}" dans le butin commun`, true);
    setObjets((prev) => prev.filter((o) => o.id !== objet.id));
  };

  return (
    <div style={{ fontFamily: "'Segoe UI', sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: "0.85rem", color: "#95a5a6", textTransform: "uppercase", letterSpacing: 1 }}>
          🎒 {isMJ ? "Inventaires joueurs" : "Mon inventaire"}
        </h3>
      </div>

      {/* 📬 Offres en attente */}
      {!isMJ && offres.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: "#f1c40f", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
            📬 Offres du MJ ({offres.length})
          </div>
          {offres.map((offre) => (
            <div key={offre.id} style={{
              background: "#16213e", border: "1px solid #f1c40f",
              borderRadius: 8, padding: "10px 12px", marginBottom: 6,
              display: "flex", alignItems: "center", gap: 10,
              animation: "pulse 1.5s infinite",
            }}>
              <span style={{ fontSize: 20 }}>{offre.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: "bold", fontSize: 13, color: "white" }}>
                  {offre.nom} {offre.quantite > 1 && <span style={{ color: "#95a5a6", fontSize: 11 }}>×{offre.quantite}</span>}
                </div>
                {offre.description && <div style={{ fontSize: 11, color: "#95a5a6" }}>{offre.description}</div>}
                <div style={{ fontSize: 10, color: "#f1c40f" }}>Le MJ vous offre cet objet</div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => accepterOffre(offre)} style={{
                  background: "#4ee44e", color: "#1a1a2e", border: "none",
                  padding: "5px 10px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: "bold"
                }}>✅</button>
                <button onClick={() => refuserOffre(offre)} style={{
                  background: "#e94560", color: "white", border: "none",
                  padding: "5px 10px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: "bold"
                }}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(241,196,15,0.4); }
          50% { box-shadow: 0 0 0 6px rgba(241,196,15,0); }
        }
      `}</style>

      {/* Liste des objets */}
      {objets.length === 0 && offres.length === 0 ? (
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
              </div>
              {!isMJ && (
                <div style={{ display: "flex", gap: 6 }}>
                  {inventaireGlobalActif && (
                    <button onClick={() => deposerObjet(o)} title="Déposer dans le butin commun"
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