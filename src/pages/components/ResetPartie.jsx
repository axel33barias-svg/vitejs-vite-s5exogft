// src/pages/components/ResetPartie.jsx
import { useState } from "react";
import { supabase } from "../../supabase";

export default function ResetPartie({ sessionId, onResetComplete }) {
  const [confirmReset, setConfirmReset] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const genererCode = () => {
    const lettres = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    return Array.from({ length: 4 }, () => lettres[Math.floor(Math.random() * lettres.length)]).join("");
  };

  const handleReset = async () => {
    setIsResetting(true);
  
    try {
      // 1. Récupérer les IDs des personnages de la session
      const { data: personnages, error: fetchError } = await supabase
        .from("personnages")
        .select("id")
        .eq("session_id", sessionId);
  
      if (fetchError) throw new Error(`Impossible de récupérer les personnages : ${fetchError.message}`);
  
      // 2. Supprimer les stats_personnage liées
      if (personnages && personnages.length > 0) {
        const ids = personnages.map(p => p.id);
        const { error } = await supabase
          .from("stats_personnage")
          .delete()
          .in("personnage_id", ids);
        if (error) throw new Error(`Impossible de supprimer stats_personnage : ${error.message}`);
      }
  
      // 3. Supprimer le reste dans l'ordre
      const tables = [
        "lancers",
        "logs_inventaire",
        "offres",
        "objets",
        "inventaire_global",
        "config_stats",
        "personnages",
        "joueurs",
      ];
  
      for (const table of tables) {
        const { error } = await supabase
          .from(table)
          .delete()
          .eq("session_id", sessionId);
        if (error) throw new Error(`Impossible de supprimer ${table} : ${error.message}`);
      }
  
      // 4. Nouveau code
      const nouveauCode = genererCode();
      const { error: updateError } = await supabase
        .from("sessions")
        .update({ code: nouveauCode })
        .eq("id", sessionId);
      if (updateError) throw updateError;
  
      // 5. Config stats vide
      const { error: insertError } = await supabase
        .from("config_stats")
        .insert([{ session_id: sessionId }]);
      if (insertError) throw insertError;
  
      setConfirmReset(false);
      if (onResetComplete) onResetComplete(nouveauCode);
      alert(`✅ Nouvelle partie créée ! Nouveau code : ${nouveauCode}`);
  
    } catch (err) {
      console.error("Erreur reset:", err);
      alert(`❌ Erreur : ${err.message}`);
    } finally {
      setIsResetting(false);
    }
  };
  return (
    <>
      {!confirmReset ? (
        <button
          onClick={() => setConfirmReset(true)}
          disabled={isResetting}
          style={{
            background: "transparent",
            color: "#95a5a6",
            border: "1px solid #555",
            padding: "6px 14px",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 12
          }}
        >
          {isResetting ? "♻️..." : "🔄 Nouvelle session"}
        </button>
      ) : (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "#e94560" }}>Confirmer ?</span>
          <button
            onClick={handleReset}
            disabled={isResetting}
            style={{ background: "#e94560", color: "white", border: "none", padding: "6px 10px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: "bold" }}
          >
            {isResetting ? "..." : "Oui"}
          </button>
          <button
            onClick={() => setConfirmReset(false)}
            style={{ background: "#0f3460", color: "white", border: "none", padding: "6px 10px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}
          >
            Non
          </button>
        </div>
      )}
    </>
  );
}