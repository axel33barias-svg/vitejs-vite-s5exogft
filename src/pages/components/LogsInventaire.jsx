import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../supabase";

// ============================================================
// 📜 LOGS INVENTAIRE
// Props :
//   sessionId   — ID de la session
//   isMJ        — true = voit tous les logs
//               — false = voit seulement visible_joueurs = true
// ============================================================

const ACTION_STYLES = {
  add:    { icon: "✅", color: "#4ee44e", label: "Obtenu" },
  remove: { icon: "🗑️", color: "#e94560", label: "Perdu" },
  drop:   { icon: "⬇️", color: "#f1c40f", label: "Déposé" },
  take:   { icon: "⬆️", color: "#3498db", label: "Pris" },
  steal:  { icon: "🎭", color: "#8e44ad", label: "Vol" },
};

export default function LogsInventaire({ sessionId, isMJ = false }) {
  const [logs, setLogs] = useState([]);
  const [filtre, setFiltre] = useState("tous"); // tous | add | remove | drop | take | steal

  const charger = useCallback(async () => {
    // ✅ GARDE : Ne pas exécuter la requête si sessionId est invalide
    if (!sessionId) return;

    const query = supabase
      .from("logs_inventaire")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(50);

    // Les joueurs ne voient que les logs publics
    if (!isMJ) query.eq("visible_joueurs", true);

    const { data } = await query;
    if (data) setLogs(data);
  }, [sessionId, isMJ]);

  useEffect(() => {
    charger();
    const interval = setInterval(charger, 2000);
    return () => clearInterval(interval);
  }, [charger]);

  const logsFiltres = filtre === "tous" ? logs : logs.filter((l) => l.action === filtre);

  const formaterDate = (ts) => {
    const d = new Date(ts);
    return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  return (
    <div style={{ fontFamily: "'Segoe UI', sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: "0.85rem", color: "#95a5a6", textTransform: "uppercase", letterSpacing: 1 }}>
          📜 Journal des actions
          {isMJ && <span style={{ color: "#f1c40f", fontSize: 10, marginLeft: 6 }}>MJ — vue complète</span>}
        </h3>
      </div>

      {/* Filtres */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {["tous", "add", "remove", "drop", "take", "steal"].map((f) => (
          <button key={f} onClick={() => setFiltre(f)} style={{
            padding: "4px 10px", borderRadius: 20, border: "none", cursor: "pointer",
            fontSize: 11, fontWeight: "bold",
            background: filtre === f ? (ACTION_STYLES[f]?.color || "#e94560") : "#0f3460",
            color: filtre === f ? "#1a1a2e" : "#95a5a6",
          }}>
            {ACTION_STYLES[f]?.icon || "📋"} {f === "tous" ? "Tout" : ACTION_STYLES[f]?.label}
          </button>
        ))}
      </div>

      {/* Liste des logs */}
      <div style={{ background: "#16213e", border: "1px solid #0f3460", borderRadius: 10, maxHeight: 300, overflowY: "auto" }}>
        {logsFiltres.length === 0 ? (
          <p style={{ color: "#555", textAlign: "center", padding: 16, fontSize: 13 }}>
            Aucune action enregistrée
          </p>
        ) : (
          logsFiltres.map((log) => {
            const style = ACTION_STYLES[log.action] || { icon: "📋", color: "#95a5a6" };
            return (
              <div key={log.id} style={{
                display: "flex", alignItems: "flex-start", gap: 10,
                padding: "10px 14px", borderBottom: "1px solid #0f3460",
                opacity: !log.visible_joueurs && isMJ ? 0.6 : 1,
              }}>
                <span style={{ fontSize: 16, flexShrink: 0 }}>{style.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: "white" }}>{log.details}</div>
                  <div style={{ display: "flex", gap: 8, marginTop: 3 }}>
                    <span style={{ fontSize: 10, color: "#555" }}>{formaterDate(log.created_at)}</span>
                    {isMJ && !log.visible_joueurs && (
                      <span style={{ fontSize: 10, color: "#8e44ad" }}>👁 MJ seulement</span>
                    )}
                    <span style={{ fontSize: 10, color: style.color }}>{style.label}</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}