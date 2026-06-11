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
        if (error) {
          console.error(`Erreur suppression ${table}:`, error);
          throw new Error(`Impossible de supprimer ${table} : ${error.message}`);
        }
      }

      const nouveauCode = genererCode();

      const { error: updateError } = await supabase
        .from("sessions")
        .update({ code: nouveauCode })
        .eq("id", sessionId);

      if (updateError) throw updateError;

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