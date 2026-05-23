import { useState, useEffect } from "react";
import { supabase } from "../../supabase";
import { logAction } from "./InventaireJoueur";

const ICONS = ["📦", "⚔️", "🛡️", "🧪", "💰", "🗝️", "📜", "🏹", "🔮", "💎", "🍖", "🧲"];

export default function EnvoiObjetMJ({ sessionId, joueur }) {
  const [showForm, setShowForm] = useState(false);
  const [nom, setNom] = useState("");
  const [desc, setDesc] = useState("");
  const [qte, setQte] = useState(1);
  const [icon, setIcon] = useState("📦");
  const [loading, setLoading] = useState(false);
  const [offresEnvoyees, setOffresEnvoyees] = useState([]);

  // ✅ Polling statut des offres envoyées
  useEffect(() => {
    if (offresEnvoyees.length === 0) return;
    const interval = setInterval(async () => {
      const ids = offresEnvoyees.map((o) => o.id);
      const { data } = await supabase
        .from("offres")
        .select("id, statut")
        .in("id", ids);
      if (data) {
        setOffresEnvoyees((prev) =>
          prev.map((o) => {
            const updated = data.find((d) => d.id === o.id);
            return updated ? { ...o, statut: updated.statut } : o;
          })
        );
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [offresEnvoyees]);

  const envoyer = async () => {
    if (!nom.trim()) return;
    setLoading(true);

    const { data: offre } = await supabase
      .from("offres")
      .insert([{
        session_id: sessionId,
        joueur_id: joueur.id,
        nom: nom.trim(),
        description: desc.trim(),
        quantite: parseInt(qte) || 1,
        icon,
        statut: "en_attente",
      }])
      .select()
      .single();

    if (offre) {
      await logAction(sessionId, "add", "MJ", nom.trim(), `Le MJ a proposé "${nom.trim()}" à ${joueur.nom}`, false);
      setOffresEnvoyees((prev) => [...prev, offre]);
      setNom(""); setDesc(""); setQte(1); setIcon("📦");
      setShowForm(false);
    }
    setLoading(false);
  };

  return (
    <div style={{ marginTop: 8 }}>
      <button onClick={() => setShowForm(!showForm)} style={{
        background: showForm ? "#555" : "#0f3460", color: "white",
        border: "1px solid #f1c40f", padding: "4px 10px",
        borderRadius: 6, cursor: "pointer", fontSize: 11, width: "100%",
      }}>
        {showForm ? "Annuler" : "🎁 Envoyer un objet"}
      </button>

      {showForm && (
        <div style={{ background: "#0f3460", borderRadius: 8, padding: 12, marginTop: 8 }}>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
            {ICONS.map((ic) => (
              <button key={ic} onClick={() => setIcon(ic)} style={{
                fontSize: 16, background: icon === ic ? "#e94560" : "#16213e",
                border: "none", borderRadius: 5, padding: "3px 6px", cursor: "pointer",
              }}>{ic}</button>
            ))}
          </div>
          <input value={nom} onChange={(e) => setNom(e.target.value)}
            placeholder="Nom de l'objet *"
            style={{ width: "100%", background: "#1a1a2e", border: "1px solid #e94560", color: "white", padding: "7px 10px", borderRadius: 6, fontSize: 12, boxSizing: "border-box", marginBottom: 6, outline: "none" }}
          />
          <input value={desc} onChange={(e) => setDesc(e.target.value)}
            placeholder="Description (optionnel)"
            style={{ width: "100%", background: "#1a1a2e", border: "1px solid #0f3460", color: "white", padding: "7px 10px", borderRadius: 6, fontSize: 12, boxSizing: "border-box", marginBottom: 6, outline: "none" }}
          />
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <label style={{ fontSize: 11, color: "#95a5a6" }}>Qté :</label>
            <input type="number" value={qte} min={1} onChange={(e) => setQte(e.target.value)}
              style={{ width: 50, background: "#1a1a2e", border: "1px solid #0f3460", color: "white", padding: "5px", borderRadius: 5, fontSize: 12, textAlign: "center", outline: "none" }}
            />
          </div>
          <button onClick={envoyer} disabled={!nom.trim() || loading}
            style={{ width: "100%", background: nom.trim() ? "#f1c40f" : "#333", color: "#1a1a2e", border: "none", padding: "8px", borderRadius: 6, fontWeight: "bold", fontSize: 13, cursor: nom.trim() ? "pointer" : "not-allowed" }}
          >
            {loading ? "Envoi…" : `🎁 Envoyer à ${joueur.nom}`}
          </button>
        </div>
      )}

      {/* Statut des offres envoyées */}
      {offresEnvoyees.length > 0 && (
        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
          {offresEnvoyees.map((o) => (
            <div key={o.id} style={{
              fontSize: 11,
              color: o.statut === "accepte" ? "#4ee44e" : o.statut === "refuse" ? "#e94560" : "#f1c40f",
              padding: "4px 8px",
              background: "#16213e",
              borderRadius: 5,
              border: `1px solid ${o.statut === "accepte" ? "#4ee44e" : o.statut === "refuse" ? "#e94560" : "#f1c40f"}`,
            }}>
              {o.icon} {o.nom} — {o.statut === "en_attente" ? "⏳ En attente…" : o.statut === "accepte" ? "✅ Accepté !" : "❌ Refusé"}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}