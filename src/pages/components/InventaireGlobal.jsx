import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../supabase";
import { logAction } from "./InventaireJoueur";

// ============================================================
// 🌍 INVENTAIRE GLOBAL
// Props :
//   sessionId     — ID de la session
//   joueurId      — ID du joueur (null si MJ)
//   joueurNom     — Nom du joueur
//   isMJ          — true si MJ
//   actif         — inventaire global activé ou non
//   onToggle      — callback MJ pour activer/désactiver
// ============================================================

export default function InventaireGlobal({ sessionId, joueurId, joueurNom, isMJ = false, actif = false, onToggle }) {
  const [objets, setObjets] = useState([]);
  const [confirmerVol, setConfirmerVol] = useState(null); // objet en cours de vol
  const [confirmerPrise, setConfirmerPrise] = useState(null); // objet en cours de prise

  // Charge l'inventaire global
  const charger = useCallback(async () => {
    const { data } = await supabase
      .from("inventaire_global")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });
    if (data) setObjets(data);
  }, [sessionId]);

  useEffect(() => {
    if (!actif && !isMJ) return;
    charger();
    const interval = setInterval(charger, 2000);
    return () => clearInterval(interval);
  }, [charger, actif, isMJ]);

  // MJ — ajouter un objet directement dans le global
  const [showForm, setShowForm] = useState(false);
  const [newNom, setNewNom] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newQte, setNewQte] = useState(1);
  const [newIcon, setNewIcon] = useState("📦");
  const ICONS = ["📦", "⚔️", "🛡️", "🧪", "💰", "🗝️", "📜", "🏹", "🔮", "💎", "🍖", "🧲"];

  const ajouterObjetMJ = async () => {
    if (!newNom.trim()) return;
    const { data } = await supabase
      .from("inventaire_global")
      .insert([{ session_id: sessionId, nom: newNom.trim(), description: newDesc.trim(), quantite: parseInt(newQte) || 1, icon: newIcon, depose_par: "MJ" }])
      .select().single();
    if (data) {
      await logAction(sessionId, "add", "MJ", newNom.trim(), `Le MJ a ajouté "${newNom.trim()}" au butin commun`, true);
      setObjets((prev) => [...prev, data]);
      setNewNom(""); setNewDesc(""); setNewQte(1); setNewIcon("📦");
      setShowForm(false);
    }
  };

  // Supprimer un objet (MJ seulement)
  const supprimerObjet = async (objet) => {
    await supabase.from("inventaire_global").delete().eq("id", objet.id);
    await logAction(sessionId, "remove", "MJ", objet.nom, `Le MJ a retiré "${objet.nom}" du butin commun`, true);
    setObjets((prev) => prev.filter((o) => o.id !== objet.id));
  };

  // Prendre un objet (joueur → son inventaire)
  const prendreObjet = async (objet) => {
    await supabase.from("inventaire_global").delete().eq("id", objet.id);
    await supabase.from("objets").insert([{
      session_id: sessionId,
      joueur_id: joueurId,
      nom: objet.nom,
      description: objet.description,
      quantite: objet.quantite,
      icon: objet.icon,
    }]);
    await logAction(sessionId, "take", joueurNom, objet.nom, `${joueurNom} a pris "${objet.nom}" dans le butin commun`, true);
    setObjets((prev) => prev.filter((o) => o.id !== objet.id));
    setConfirmerPrise(null);
  };

  // Vol — résultat du mini-jeu de dés
  const tenterVol = async (objet, resultat) => {
    setConfirmerVol(null);

    if (resultat === "critique_succes") {
      // Transfert silencieux
      await supabase.from("inventaire_global").delete().eq("id", objet.id);
      await supabase.from("objets").insert([{
        session_id: sessionId, joueur_id: joueurId,
        nom: objet.nom, description: objet.description,
        quantite: objet.quantite, icon: objet.icon,
      }]);
      await logAction(sessionId, "steal", joueurNom, objet.nom,
        `${joueurNom} a volé "${objet.nom}" (réussite critique — discret)`,
        false // invisible pour les autres joueurs
      );
      setObjets((prev) => prev.filter((o) => o.id !== objet.id));

    } else if (resultat === "succes") {
      await supabase.from("inventaire_global").delete().eq("id", objet.id);
      await supabase.from("objets").insert([{
        session_id: sessionId, joueur_id: joueurId,
        nom: objet.nom, description: objet.description,
        quantite: objet.quantite, icon: objet.icon,
      }]);
      await logAction(sessionId, "steal", joueurNom, objet.nom,
        `Un objet a mystérieusement disparu du butin commun...`,
        true
      );
      setObjets((prev) => prev.filter((o) => o.id !== objet.id));

    } else if (resultat === "echec_critique") {
      // Rien ne bouge — notification publique
      await logAction(sessionId, "steal", joueurNom, objet.nom,
        `🚨 ${joueurNom} a tenté de voler "${objet.nom}" et s'est fait prendre !`,
        true
      );
    }
  };

  if (!actif && !isMJ) return (
    <div style={{ background: "#16213e", border: "1px solid #0f3460", borderRadius: 8, padding: 16, textAlign: "center", color: "#555", fontSize: 13 }}>
      L'inventaire commun n'est pas encore activé par le MJ
    </div>
  );

  return (
    <div style={{ fontFamily: "'Segoe UI', sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: "0.85rem", color: "#95a5a6", textTransform: "uppercase", letterSpacing: 1 }}>
          🌍 Butin commun {actif ? <span style={{ color: "#4ee44e", fontSize: 10 }}>● Actif</span> : <span style={{ color: "#e94560", fontSize: 10 }}>● Inactif</span>}
        </h3>
        <div style={{ display: "flex", gap: 8 }}>
          {isMJ && (
            <>
              <button onClick={() => setShowForm(!showForm)} style={{
                background: showForm ? "#555" : "#0f3460", color: "white",
                border: "1px solid #e94560", padding: "5px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11
              }}>
                {showForm ? "Annuler" : "+ Loot"}
              </button>
              <button onClick={onToggle} style={{
                background: actif ? "#c0392b" : "#27ae60", color: "white",
                border: "none", padding: "5px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: "bold"
              }}>
                {actif ? "Désactiver" : "Activer"}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Formulaire MJ */}
      {isMJ && showForm && (
        <div style={{ background: "#0f3460", borderRadius: 10, padding: 14, marginBottom: 10 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {ICONS.map((ic) => (
              <button key={ic} onClick={() => setNewIcon(ic)} style={{
                fontSize: 18, background: newIcon === ic ? "#e94560" : "#16213e",
                border: "none", borderRadius: 6, padding: "4px 8px", cursor: "pointer",
              }}>{ic}</button>
            ))}
          </div>
          <input value={newNom} onChange={(e) => setNewNom(e.target.value)} placeholder="Nom du loot *"
            style={{ width: "100%", background: "#1a1a2e", border: "1px solid #e94560", color: "white", padding: "8px 10px", borderRadius: 6, fontSize: 13, boxSizing: "border-box", marginBottom: 6, outline: "none" }}
          />
          <input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="Description (optionnel)"
            style={{ width: "100%", background: "#1a1a2e", border: "1px solid #0f3460", color: "white", padding: "8px 10px", borderRadius: 6, fontSize: 13, boxSizing: "border-box", marginBottom: 6, outline: "none" }}
          />
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
            <label style={{ fontSize: 12, color: "#95a5a6" }}>Quantité :</label>
            <input type="number" value={newQte} min={1} onChange={(e) => setNewQte(e.target.value)}
              style={{ width: 60, background: "#1a1a2e", border: "1px solid #0f3460", color: "white", padding: "6px", borderRadius: 6, fontSize: 13, textAlign: "center", outline: "none" }}
            />
          </div>
          <button onClick={ajouterObjetMJ} disabled={!newNom.trim()}
            style={{ width: "100%", background: newNom.trim() ? "#e94560" : "#333", color: "white", border: "none", padding: "10px", borderRadius: 8, fontWeight: "bold", fontSize: 14, cursor: newNom.trim() ? "pointer" : "not-allowed" }}
          >
            ✅ Ajouter au butin
          </button>
        </div>
      )}

      {/* Confirmation prise */}
      {confirmerPrise && (
        <div style={{ background: "#16213e", border: "1px solid #4ee44e", borderRadius: 10, padding: 14, marginBottom: 10, textAlign: "center" }}>
          <p style={{ color: "white", margin: "0 0 10px", fontSize: 14 }}>
            Prendre <strong>{confirmerPrise.icon} {confirmerPrise.nom}</strong> ?
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            <button onClick={() => prendreObjet(confirmerPrise)} style={{ background: "#4ee44e", color: "#1a1a2e", border: "none", padding: "8px 16px", borderRadius: 6, fontWeight: "bold", cursor: "pointer" }}>✅ Oui</button>
            <button onClick={() => setConfirmerPrise(null)} style={{ background: "#0f3460", color: "white", border: "none", padding: "8px 16px", borderRadius: 6, cursor: "pointer" }}>Annuler</button>
          </div>
        </div>
      )}

      {/* Confirmation vol */}
      {confirmerVol && (
        <div style={{ background: "#16213e", border: "1px solid #f1c40f", borderRadius: 10, padding: 14, marginBottom: 10, textAlign: "center" }}>
          <p style={{ color: "#f1c40f", margin: "0 0 6px", fontSize: 13, fontWeight: "bold" }}>🎭 Tentative de vol — résultat ?</p>
          <p style={{ color: "#95a5a6", margin: "0 0 12px", fontSize: 12 }}>{confirmerVol.icon} {confirmerVol.nom}</p>
          <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
            <button onClick={() => tenterVol(confirmerVol, "critique_succes")} style={{ background: "#8e44ad", color: "white", border: "none", padding: "7px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: "bold" }}>🟣 Critique</button>
            <button onClick={() => tenterVol(confirmerVol, "succes")} style={{ background: "#27ae60", color: "white", border: "none", padding: "7px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: "bold" }}>🟢 Réussite</button>
            <button onClick={() => tenterVol(confirmerVol, "echec_critique")} style={{ background: "#c0392b", color: "white", border: "none", padding: "7px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: "bold" }}>🔴 Échec</button>
            <button onClick={() => setConfirmerVol(null)} style={{ background: "#0f3460", color: "#95a5a6", border: "none", padding: "7px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11 }}>Annuler</button>
          </div>
        </div>
      )}

      {/* Liste */}
      {objets.length === 0 ? (
        <div style={{ background: "#16213e", border: "1px solid #0f3460", borderRadius: 8, padding: 16, textAlign: "center", color: "#555", fontSize: 13 }}>
          Aucun objet dans le butin commun
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
                <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>Déposé par {o.depose_par}</div>
              </div>
              {!isMJ && joueurId && (
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => setConfirmerPrise(o)} style={{ background: "#0f3460", color: "#4ee44e", border: "1px solid #4ee44e", padding: "4px 8px", borderRadius: 5, cursor: "pointer", fontSize: 11 }}>
                    ⬆ Prendre
                  </button>
                  <button onClick={() => setConfirmerVol(o)} style={{ background: "#0f3460", color: "#f1c40f", border: "1px solid #f1c40f", padding: "4px 8px", borderRadius: 5, cursor: "pointer", fontSize: 11 }}>
                    🎭 Voler
                  </button>
                </div>
              )}
              {isMJ && (
                <button onClick={() => supprimerObjet(o)} style={{ background: "transparent", color: "#e94560", border: "1px solid #e94560", padding: "4px 8px", borderRadius: 5, cursor: "pointer", fontSize: 11 }}>✕</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}