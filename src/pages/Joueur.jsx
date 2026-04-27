import { useState, useCallback, useEffect } from "react";
import { supabase } from "../supabase";

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

export default function Joueur() {
  const [etape, setEtape] = useState("accueil");
  const [code, setCode] = useState("");
  const [nom, setNom] = useState("");
  const [erreur, setErreur] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [joueurId, setJoueurId] = useState(null);
  const [bonus, setBonus] = useState(0);
  const [seuil, setSeuil] = useState(0);
  const [modeCritique, setModeCritique] = useState("tous");
  const [rolling, setRolling] = useState(false);
  const [lastRoll, setLastRoll] = useState(null);
  const [history, setHistory] = useState([]);
  const [activeDie, setActiveDie] = useState(null);
  const [popupMJ, setPopupMJ] = useState(null);

  const rejoindre = async () => {
    if (!code.trim() || !nom.trim()) return;
    setLoading(true);
    const { data: session } = await supabase.from("sessions").select("id").eq("code", code.toUpperCase().trim()).maybeSingle();
    if (!session) {
      setErreur("Code invalide !");
      setLoading(false);
      return;
    }
    const { data: joueur } = await supabase.from("joueurs").insert([{ session_id: session.id, nom: nom.trim(), bonus: 0, seuil: 0 }]).select().single();
    if (joueur) {
      setSessionId(session.id);
      setJoueurId(joueur.id);
      setBonus(joueur.bonus);
      setSeuil(joueur.seuil);
      setEtape("jeu");
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!joueurId) return;
    const channel = supabase.channel(`joueur-${joueurId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "joueurs", filter: `id=eq.${joueurId}` },
        (payload) => {
          setBonus(payload.new.bonus);
          setSeuil(payload.new.seuil);
          setModeCritique(payload.new.mode_critique || "tous");
        }
      ).subscribe();
    return () => supabase.removeChannel(channel);
  }, [joueurId]);

  useEffect(() => {
    if (!sessionId) return;
    const channel = supabase.channel(`lancers-joueur-${sessionId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "lancers", filter: `session_id=eq.${sessionId}` },
        (payload) => {
          if (payload.new.auteur !== "MJ") return;
          const status = getStatus(payload.new.valeur, payload.new.bonus, payload.new.total, payload.new.faces, payload.new.seuil, modeCritique);
          const roll = { ...payload.new, status };
          setHistory((prev) => [roll, ...prev].slice(0, 20));
          setPopupMJ(roll);
          setTimeout(() => setPopupMJ(null), 5000);
        }
      ).subscribe();
    return () => supabase.removeChannel(channel);
  }, [sessionId, modeCritique]);

  const lancerDe = useCallback(async (faces) => {
    if (rolling || !joueurId) return;
    setActiveDie(faces);
    setRolling(true);
    setTimeout(async () => {
      const valeur = Math.floor(Math.random() * faces) + 1;
      const b = parseInt(bonus) || 0;
      const s = parseInt(seuil) || 0;
      const total = valeur + b;
      const status = getStatus(valeur, b, total, faces, s, modeCritique);
      const roll = { valeur, bonus: b, total, faces, seuil: s, status, id: Date.now(), auteur: nom };
      setLastRoll(roll);
      setHistory((prev) => [roll, ...prev].slice(0, 20));
      setRolling(false);
      setActiveDie(null);
      await supabase.from("lancers").insert([{ valeur, bonus: b, total, faces, seuil: s, session_id: sessionId, auteur: nom, auteur_type: "joueur" }]);
    }, 400);
  }, [rolling, bonus, seuil, modeCritique, nom, joueurId, sessionId]);

  if (etape === "accueil") return (
    <div style={{ minHeight: "100vh", background: "#1a1a2e", display: "flex", alignItems: "center", justifyContent: "center", color: "white" }}>
      <div style={{ maxWidth: 380, width: "90%", background: "#16213e", padding: 30, borderRadius: 15, textAlign: "center", border: "1px solid #0f3460" }}>
        <h1>Rejoindre</h1>
        {erreur && <div style={{ color: "#e94560", marginBottom: 10 }}>{erreur}</div>}
        <input type="text" placeholder="CODE" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} style={{ width: "100%", padding: 10, marginBottom: 10, borderRadius: 5, border: "none" }} />
        <input type="text" placeholder="Nom Perso" value={nom} onChange={(e) => setNom(e.target.value)} style={{ width: "100%", padding: 10, marginBottom: 20, borderRadius: 5, border: "none" }} />
        <button onClick={rejoindre} style={{ width: "100%", background: "#e94560", color: "white", padding: 10, borderRadius: 5, border: "none", fontWeight: "bold", cursor: "pointer" }}>Entrer</button>
        <button onClick={() => window.location.href = "/mj"} style={{ marginTop: 15, background: "transparent", color: "#e94560", border: "1px solid #e94560", padding: "5px 10px", borderRadius: 5, cursor: "pointer" }}>👑 Mode MJ</button>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#1a1a2e", color: "white", fontFamily: "sans-serif" }}>
      {/* 🎲 POPUP MJ */}
      {popupMJ && (
        <div style={{ position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", background: "#16213e", border: "2px solid #e94560", borderRadius: 16, padding: "15px 25px", textAlign: "center", zIndex: 1000, boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
          <div style={{ fontSize: 10, color: "#95a5a6" }}>LE MJ LANCE...</div>
          <div style={{ fontSize: 40, fontWeight: "bold", color: popupMJ.status ? colors[popupMJ.status.cls] : "white" }}>{popupMJ.total}</div>
        </div>
      )}

      <div style={{ background: "#16213e", padding: "12px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #0f3460" }}>
        <h1 style={{ margin: 0, fontSize: "1.1rem" }}>🎲 Joueur</h1>
        <div>
          <span style={{ background: "#0f3460", padding: "4px 10px", borderRadius: 15, fontSize: 12 }}>⚔️ {nom}</span>
          <button onClick={() => window.location.href = "/mj"} style={{ marginLeft: 10, background: "transparent", color: "#e94560", border: "1px solid #e94560", padding: "3px 8px", borderRadius: 5, fontSize: 10, cursor: "pointer" }}>👑 MJ</button>
        </div>
      </div>

      <div style={{ maxWidth: 450, margin: "0 auto", padding: 20 }}>
        {/* STATS & DÉS */}
        <div style={{ display: "flex", justifyContent: "space-around", marginBottom: 20 }}>
          <div style={{ textAlign: "center" }}><div style={{ fontSize: 10, color: "#95a5a6" }}>BONUS</div><div style={{ fontSize: 20, fontWeight: "bold" }}>{bonus}</div></div>
          <div style={{ textAlign: "center" }}><div style={{ fontSize: 10, color: "#95a5a6" }}>SEUIL</div><div style={{ fontSize: 20, fontWeight: "bold" }}>{seuil}</div></div>
        </div>

        <div style={{ background: "#16213e", padding: 30, borderRadius: 15, textAlign: "center", marginBottom: 20, border: "1px solid #0f3460" }}>
          <div style={{ fontSize: 60, fontWeight: "bold", color: lastRoll?.status ? colors[lastRoll.status.cls] : "white" }}>{rolling ? "..." : lastRoll?.total || "?"}</div>
          {lastRoll && <div style={{ fontSize: 12, color: "#95a5a6" }}>d{lastRoll.faces} ({lastRoll.valeur} + {lastRoll.bonus})</div>}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
          {FACES.map(f => (
            <button key={f} onClick={() => lancerDe(f)} style={{ background: activeDie === f ? "#e94560" : "#0f3460", color: "white", border: "1px solid #e94560", padding: "12px", borderRadius: 8, cursor: "pointer" }}>d{f}</button>
          ))}
        </div>
      </div>
    </div>
  );
}