import { useState, useEffect } from "react";
import { supabase } from "../../supabase";

// ============================================================
// ⚙️ CONFIG STATS — Panneau MJ
// Permet au MJ de renommer les stats et choisir le dé par stat
// + définir les seuils de difficulté actuels
// ============================================================

const STATS = ["force", "agilite", "discretion", "intelligence", "perception", "charisme", "mental", "vitalite"];
const DEFAUTS = {
  force: "Force", agilite: "Agilité", discretion: "Discrétion",
  intelligence: "Intelligence", perception: "Perception",
  charisme: "Charisme", mental: "Mental", vitalite: "Vitalité"
};
const DES = [4, 6, 8, 10, 12, 20, 100];

export default function ConfigStats({ sessionId }) {
  const [config, setConfig] = useState(null);
  const [seuils, setSeuils] = useState({});
  const [showPanel, setShowPanel] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const charger = async () => {
      // ✅ GARDE : Ne pas exécuter si sessionId est invalide
      if (!sessionId) return;

      // Charge ou crée la config stats
      let { data } = await supabase
        .from("config_stats")
        .select("*")
        .eq("session_id", sessionId)
        .maybeSingle();

      if (!data) {
        const { data: newConfig } = await supabase
          .from("config_stats")
          .insert([{ session_id: sessionId }])
          .select()
          .single();
        data = newConfig;
      }
      if (data) setConfig(data);

      // Charge les seuils depuis sessions
      const { data: sess } = await supabase
        .from("sessions")
        .select("seuils")
        .eq("id", sessionId)
        .single();
      if (sess?.seuils) setSeuils(sess.seuils);
    };
    
    charger();
  }, [sessionId]);

  const updateConfig = (field, value) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
  };

  const updateSeuil = (stat, value) => {
    setSeuils((prev) => ({ ...prev, [stat]: parseInt(value) || 0 }));
  };

  const sauvegarder = async () => {
    if (!sessionId) return;
    
    setSaving(true);
    await supabase.from("config_stats").update(config).eq("session_id", sessionId);
    await supabase.from("sessions").update({ seuils }).eq("id", sessionId);
    setSaving(false);
  };

  if (!config) return null;

  return (
    <div style={{ fontFamily: "'Segoe UI', sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: "0.85rem", color: "#95a5a6", textTransform: "uppercase", letterSpacing: 1 }}>
          ⚙️ Configuration des stats
        </h3>
        <button onClick={() => setShowPanel(!showPanel)} style={{
          background: showPanel ? "#555" : "#0f3460", color: "white",
          border: "1px solid #e94560", padding: "5px 12px", borderRadius: 6,
          cursor: "pointer", fontSize: 11
        }}>
          {showPanel ? "Fermer" : "Configurer"}
        </button>
      </div>

      {showPanel && (
        <div style={{ background: "#0f3460", borderRadius: 10, padding: 14 }}>
          <p style={{ color: "#95a5a6", fontSize: 11, margin: "0 0 12px" }}>
            Personnalisez les noms, dés et seuils pour cette session
          </p>

          {STATS.map((stat) => (
            <div key={stat} style={{ display: "grid", gridTemplateColumns: "1fr 80px 70px", gap: 8, marginBottom: 8, alignItems: "center" }}>
              {/* Nom personnalisé */}
              <input
                value={config[`${stat}_nom`] || DEFAUTS[stat]}
                onChange={(e) => updateConfig(`${stat}_nom`, e.target.value)}
                placeholder={DEFAUTS[stat]}
                style={{ background: "#1a1a2e", border: "1px solid #0f3460", color: "white", padding: "6px 10px", borderRadius: 6, fontSize: 12, outline: "none" }}
              />
              {/* Dé */}
              <select
                value={config[`${stat}_de`] || 20}
                onChange={(e) => updateConfig(`${stat}_de`, parseInt(e.target.value))}
                style={{ background: "#1a1a2e", border: "1px solid #e94560", color: "white", padding: "6px", borderRadius: 6, fontSize: 12, outline: "none" }}
              >
                {DES.map((d) => <option key={d} value={d}>d{d}</option>)}
              </select>
              {/* Seuil */}
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ color: "#95a5a6", fontSize: 10 }}>Seuil</span>
                <input
                  type="number"
                  value={seuils[stat] || 10}
                  onChange={(e) => updateSeuil(stat, e.target.value)}
                  style={{ width: "100%", background: "#1a1a2e", border: "1px solid #0f3460", color: "white", padding: "6px", borderRadius: 6, fontSize: 12, textAlign: "center", outline: "none" }}
                />
              </div>
            </div>
          ))}

          <button onClick={sauvegarder} style={{
            width: "100%", background: "#e94560", color: "white", border: "none",
            padding: "10px", borderRadius: 8, fontWeight: "bold", fontSize: 14,
            cursor: "pointer", marginTop: 8
          }}>
            {saving ? "Sauvegarde…" : "💾 Sauvegarder"}
          </button>
        </div>
      )}
    </div>
  );
}

// Export de la config pour les autres composants
export async function getConfigStats(sessionId) {
  if (!sessionId) return null; // ✅ GARDE
  
  const { data } = await supabase
    .from("config_stats")
    .select("*")
    .eq("session_id", sessionId)
    .maybeSingle();
  return data;
}

export async function getSeuils(sessionId) {
  if (!sessionId) return {}; // ✅ GARDE
  
  const { data } = await supabase
    .from("sessions")
    .select("seuils")
    .eq("id", sessionId)
    .single();
  return data?.seuils || {};
}