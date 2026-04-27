import { useState, useEffect, useCallback } from "react";
import { supabase } from "../supabase";
import { QRCodeSVG } from "qrcode.react";

const FACES = [4, 6, 8, 10, 12, 20, 100];

const colors = {
  "crit-success": "#f1c40f",
  "crit-fail":    "#ff4500",
  "success":      "#4ee44e",
  "fail":         "#e94560",
};

function getStatus(valeur, bonus, total, faces, seuil, modeCritique) {
  const isCritActive = modeCritique === "tous" || faces === 20;
  if (isCritActive && valeur === faces) return { label: "🌟 RÉUSSITE CRITIQUE", cls: "crit-success" };
  if (isCritActive && valeur === 1)     return { label: "💀 ÉCHEC CRITIQUE",    cls: "crit-fail" };
  if (seuil > 0 && total >= seuil) return { label: "✅ RÉUSSITE", cls: "success" };
  if (seuil > 0 && total < seuil)  return { label: "❌ ÉCHEC",    cls: "fail" };
  return null;
}

export default function MJ() {
  const [session, setSession] = useState(null);
  const [joueurs, setJoueurs] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showQR, setShowQR] = useState(false);
  
  // États pour les dés
  const [lastRoll, setLastRoll] = useState(null);
  const [rolling, setRolling] = useState(false);
  const [activeDie, setActiveDie] = useState(null);
  const [bonus, setBonus] = useState(0);
  const [seuil, setSeuil] = useState(0);

  // 🧩 LOGIQUE : INITIALISATION
  useEffect(() => {
    async function initMJ() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      let { data: sess } = await supabase.from("sessions").select("*").eq("mj_id", user.id).maybeSingle();

      if (!sess) {
        const code = Math.random().toString(36).substring(2, 6).toUpperCase();
        const { data: newSess } = await supabase.from("sessions").insert([{ mj_id: user.id, code }]).select().single();
        sess = newSess;
      }
      setSession(sess);

      const { data: jrs } = await supabase.from("joueurs").select("*").eq("session_id", sess.id);
      setJoueurs(jrs || []);

      const { data: rolls } = await supabase.from("lancers").select("*").eq("session_id", sess.id).order("created_at", { ascending: false }).limit(20);
      setHistory(rolls || []);
      setLoading(false);
    }
    initMJ();
  }, []);

  // 🧩 LOGIQUE : TEMPS RÉEL
  useEffect(() => {
    if (!session) return;
    const channel = supabase.channel(`session-${session.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "joueurs", filter: `session_id=eq.${session.id}` }, 
        (payload) => {
          if (payload.eventType === "INSERT") setJoueurs(prev => [...prev, payload.new]);
          if (payload.eventType === "UPDATE") setJoueurs(prev => prev.map(j => j.id === payload.new.id ? payload.new : j));
          if (payload.eventType === "DELETE") setJoueurs(prev => prev.filter(j => j.id !== payload.old.id));
        })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "lancers", filter: `session_id=eq.${session.id}` },
        (payload) => { if (payload.new.auteur_type === "joueur") setHistory(prev => [payload.new, ...prev].slice(0, 20)); })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [session]);

  // 🧩 LOGIQUE : ACTIONS
  const updateJoueur = async (id, field, val) => {
    await supabase.from("joueurs").update({ [field]: parseInt(val) || 0 }).eq("id", id);
  };

  const supprimerJoueur = async (joueurId) => {
    if (window.confirm("Supprimer ce joueur ?")) {
      const { error } = await supabase.from("joueurs").delete().eq("id", joueurId);
      if (!error) setJoueurs((prev) => prev.filter((j) => j.id !== joueurId));
    }
  };

  const resetSession = async () => {
    if (window.confirm("⚠️ ATTENTION : Cela va supprimer TOUS les joueurs et TOUS les lancers. Continuer ?")) {
      await supabase.from("lancers").delete().eq("session_id", session.id);
      await supabase.from("joueurs").delete().eq("session_id", session.id);
      setJoueurs([]);
      setHistory([]);
      setLastRoll(null);
    }
  };

  const lancerDe = useCallback(async (faces, secret = false) => {
    if (rolling || !session) return;
    setActiveDie(faces);
    setRolling(true);

    setTimeout(async () => {
      const valeur = Math.floor(Math.random() * faces) + 1;
      const b = parseInt(bonus) || 0;
      const s = parseInt(seuil) || 0;
      const total = valeur + b;
      const status = getStatus(valeur, b, total, faces, s, "tous");

      const roll = { 
        valeur, bonus: b, total, faces, seuil: s, 
        session_id: session.id, auteur: "MJ", auteur_type: "mj",
        secret: secret 
      };

      setLastRoll(roll);
      
      if (!secret) {
        setHistory(prev => [{...roll, status}, ...prev].slice(0, 20));
        await supabase.from("lancers").insert([roll]);
      }
      
      setRolling(false);
      setActiveDie(null);
    }, 400);
  }, [rolling, session, bonus, seuil]);

  if (loading) return <div style={{ color: "white", textAlign: "center", padding: 50 }}>Chargement du donjon...</div>;

  return (
    <div style={{ minHeight: "100vh", background: "#1a1a2e", color: "white", fontFamily: "sans-serif" }}>
      
      {/* 🏗️ HEADER AVEC NAVIGATION */}
      <div style={{ background: "#16213e", padding: "15px 20px", borderBottom: "1px solid #0f3460", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0, color: "#e94560", fontSize: "1.2rem" }}>👑 MJ : {session?.code}</h1>
        <div style={{ display: "flex", gap: "10px" }}>
          <button onClick={() => window.location.href = "/rejoindre"} style={{ background: "#27ae60", color: "white", border: "none", padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontWeight: "bold" }}>🕹️ Mode Joueur</button>
          <button onClick={() => setShowQR(!showQR)} style={{ background: "#0f3460", color: "white", border: "none", padding: "6px 12px", borderRadius: 6, cursor: "pointer" }}>{showQR ? "Fermer QR" : "📱 QR"}</button>
          <button onClick={() => supabase.auth.signOut()} style={{ background: "transparent", color: "#95a5a6", border: "none", cursor: "pointer" }}>Quitter</button>
        </div>
      </div>

      <div style={{ maxWidth: 800, margin: "0 auto", padding: 20 }}>
        {showQR && (
          <div style={{ background: "white", padding: 20, borderRadius: 15, textAlign: "center", marginBottom: 20 }}>
            <QRCodeSVG value={`${window.location.origin}/rejoindre?code=${session.code}`} size={150} />
            <p style={{ color: "black", fontWeight: "bold", marginTop: 10 }}>Code : {session.code}</p>
          </div>
        )}

        {/* 🎲 ZONE DE LANCER MJ */}
        <div style={{ background: "#16213e", padding: 20, borderRadius: 15, marginBottom: 20, textAlign: "center", border: "1px solid #0f3460" }}>
          <div style={{ fontSize: 40, fontWeight: "bold", color: lastRoll?.status ? colors[lastRoll.status.cls] : "#e0e0e0", marginBottom: 10 }}>
            {rolling ? "..." : (lastRoll ? lastRoll.total : "?")}
          </div>
          
          {lastRoll && !rolling && (
            <div style={{ fontSize: 12, color: "#95a5a6", marginBottom: 15 }}>
              d{lastRoll.faces} : {lastRoll.valeur} {lastRoll.bonus !== 0 ? ` + ${lastRoll.bonus}` : ""} = {lastRoll.total}
              {lastRoll.secret && <span style={{ color: "#f1c40f", marginLeft: 8 }}>🔒 Secret</span>}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "center", gap: 20, marginBottom: 20 }}>
            <div>
              <label style={{ fontSize: 10, color: "#95a5a6", display: "block" }}>MODIFICATEUR</label>
              <input type="number" value={bonus} onChange={(e) => setBonus(e.target.value)} style={{ width: 60, background: "#1a1a2e", border: "1px solid #e94560", color: "white", textAlign: "center", borderRadius: 5 }} />
            </div>
            <div>
              <label style={{ fontSize: 10, color: "#95a5a6", display: "block" }}>SEUIL</label>
              <input type="number" value={seuil} onChange={(e) => setSeuil(e.target.value)} style={{ width: 60, background: "#1a1a2e", border: "1px solid #0f3460", color: "white", textAlign: "center", borderRadius: 5 }} />
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginBottom: 10 }}>
            {FACES.map(f => (
              <button key={f} onClick={() => lancerDe(f, false)} style={{ background: activeDie === f ? "#e94560" : "#0f3460", color: "white", border: "1px solid #e94560", padding: "10px", borderRadius: 8, cursor: "pointer", minWidth: 50 }}>d{f}</button>
            ))}
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
            {FACES.map(f => (
              <button key={f} onClick={() => lancerDe(f, true)} style={{ background: "#1a1a2e", color: "#f1c40f", border: "1px solid #f1c40f", padding: "6px", borderRadius: 8, cursor: "pointer", minWidth: 45, fontSize: 11 }}>🔒 d{f}</button>
            ))}
          </div>
        </div>

        {/* ⚔️ JOUEURS */}
        <h2 style={{ fontSize: "0.9rem", color: "#95a5a6" }}>JOUEURS CONNECTÉS</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 30 }}>
          {joueurs.map(j => (
            <div key={j.id} style={{ background: "#16213e", padding: "12px 15px", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "space-between", border: "1px solid #0f3460" }}>
              <span style={{ fontWeight: "bold" }}>⚔️ {j.nom}</span>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <label style={{ fontSize: 10 }}>Bonus</label>
                <input type="number" value={j.bonus} onChange={(e) => updateJoueur(j.id, "bonus", e.target.value)} style={{ width: 45, background: "#1a1a2e", border: "1px solid #e94560", color: "white", textAlign: "center", borderRadius: 4 }} />
                <label style={{ fontSize: 10 }}>Seuil</label>
                <input type="number" value={j.seuil} onChange={(e) => updateJoueur(j.id, "seuil", e.target.value)} style={{ width: 45, background: "#1a1a2e", border: "1px solid #0f3460", color: "white", textAlign: "center", borderRadius: 4 }} />
                <button onClick={() => supprimerJoueur(j.id)} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 16 }}>🗑️</button>
              </div>
            </div>
          ))}
        </div>

        {/* 📜 HISTORIQUE */}
        <h2 style={{ fontSize: "0.9rem", color: "#95a5a6" }}>HISTORIQUE PUBLIC</h2>
        <div style={{ background: "#16213e", borderRadius: 10, overflow: "hidden", border: "1px solid #0f3460" }}>
          {history.map((r, i) => (
            <div key={i} style={{ padding: "10px 15px", borderBottom: "1px solid #0f3460", display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: r.auteur === "MJ" ? "#e94560" : "#95a5a6", fontSize: 13 }}>{r.auteur} (d{r.faces})</span>
              <span style={{ fontWeight: "bold" }}>{r.total}</span>
            </div>
          ))}
        </div>

        {/* 🧨 RESET */}
        <div style={{ textAlign: "center", padding: "40px 0" }}>
          <button onClick={resetSession} style={{ background: "transparent", color: "#555", border: "1px solid #555", padding: "8px 16px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>
            🧨 Réinitialiser la Session (Tout supprimer)
          </button>
        </div>
      </div>
    </div>
  );
}