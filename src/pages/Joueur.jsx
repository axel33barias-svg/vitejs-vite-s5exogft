import { useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "../supabase";

const FACES = [4, 6, 8, 10, 12, 20, 100];

function getStatus(valeur, bonus, total, faces, seuil, modeCritique) {
  const isCritActive = modeCritique === "tous" || faces === 20;
  if (isCritActive && valeur === faces) return { label: "🌟 RÉUSSITE CRITIQUE", cls: "crit-success" };
  if (isCritActive && valeur === 1)     return { label: "💀 ÉCHEC CRITIQUE",    cls: "crit-fail" };
  if (seuil > 0 && total >= seuil) return { label: "✅ RÉUSSITE", cls: "success" };
  if (seuil > 0 && total < seuil)  return { label: "❌ ÉCHEC",    cls: "fail" };
  return null;
}

const colors = {
  "crit-success": "#f1c40f",
  "crit-fail":    "#ff4500",
  "success":      "#4ee44e",
  "fail":         "#e94560",
};

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

  const lastLancerIdRef = useRef(null);
  const connexionTimeRef = useRef(null); // ✅ AJOUT

  const rejoindre = async () => {
    if (!code.trim() || !nom.trim()) return;
    setLoading(true);
    setErreur(null);

    const { data: session } = await supabase
      .from("sessions")
      .select("id")
      .eq("code", code.toUpperCase().trim())
      .maybeSingle();

    if (!session) {
      setErreur("Code invalide — vérifiez le code donné par votre MJ !");
      setLoading(false);
      return;
    }

    const { data: joueur } = await supabase
      .from("joueurs")
      .insert([{ session_id: session.id, nom: nom.trim(), bonus: 0, seuil: 0 }])
      .select()
      .single();

    if (joueur) {
      setSessionId(session.id);
      setJoueurId(joueur.id);
      setBonus(joueur.bonus);
      setSeuil(joueur.seuil);
      connexionTimeRef.current = new Date().toISOString(); // ✅ AJOUT
      setEtape("jeu");
    }

    setLoading(false);
  };

  // Écoute les modifs du MJ sur le joueur
  useEffect(() => {
    if (!joueurId) return;
    const channel = supabase
      .channel(`joueur-${joueurId}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "joueurs", filter: `id=eq.${joueurId}` },
        (payload) => {
          setBonus(payload.new.bonus);
          setSeuil(payload.new.seuil);
          setModeCritique(payload.new.mode_critique || "tous");
        }
      ).subscribe();
    return () => supabase.removeChannel(channel);
  }, [joueurId]);

  // Charge l'historique complet
  const chargerHistorique = useCallback(async (sid, mode) => {
    if (!sid) return;
    const { data } = await supabase
      .from("lancers")
      .select("*")
      .eq("session_id", sid)
      .order("created_at", { ascending: false })
      .limit(30);
    if (data) {
      const withStatus = data.map((r) => ({
        ...r,
        status: getStatus(r.valeur, r.bonus, r.total, r.faces, r.seuil, mode)
      }));
      setHistory(withStatus);
    }
  }, []);

  // Polling toutes les 500ms
  useEffect(() => {
    if (!sessionId) return;

    chargerHistorique(sessionId, modeCritique);

    const interval = setInterval(async () => {
      const { data } = await supabase
        .from("lancers")
        .select("*")
        .eq("session_id", sessionId)
        .eq("auteur", "MJ")
        .gt("created_at", connexionTimeRef.current) // ✅ MODIFIÉ
        .order("created_at", { ascending: false })
        .limit(1);

      if (data && data.length > 0) {
        const dernier = data[0];
        if (dernier.id !== lastLancerIdRef.current) {
          lastLancerIdRef.current = dernier.id;
          const status = getStatus(dernier.valeur, dernier.bonus, dernier.total, dernier.faces, dernier.seuil, modeCritique);
          setPopupMJ({ ...dernier, status });
          setTimeout(() => setPopupMJ(null), 5000);
          chargerHistorique(sessionId, modeCritique);
        }
      }
    }, 500);

    return () => clearInterval(interval);
  }, [sessionId, modeCritique, chargerHistorique]);

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
      setHistory((prev) => [roll, ...prev].slice(0, 30));
      setRolling(false);
      setActiveDie(null);

      await supabase.from("lancers").insert([{
        valeur, bonus: b, total, faces, seuil: s, session_id: sessionId, auteur: nom
      }]);
    }, 400);
  }, [rolling, bonus, seuil, modeCritique, nom, joueurId, sessionId]);

  const resultColor = lastRoll?.status ? colors[lastRoll.status.cls] : "#e0e0e0";
  const popupColor = popupMJ?.status ? colors[popupMJ.status.cls] : "#e94560";

  if (etape === "accueil") return (
    <div style={{ minHeight: "100vh", background: "#1a1a2e", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif" }}>
      <div style={{ maxWidth: 380, width: "90%", background: "#16213e", padding: 30, borderRadius: 15, border: "1px solid #0f3460", textAlign: "center", boxShadow: "0 10px 30px rgba(0,0,0,0.5)" }}>
        <div style={{ fontSize: 48, marginBottom: 8 }}>🎲</div>
        <h1 style={{ color: "#e94560", marginTop: 0, fontSize: "1.6rem" }}>Rejoindre une partie</h1>
        <p style={{ color: "#95a5a6", fontSize: "0.9rem", marginBottom: 24 }}>Entrez le code donné par votre MJ</p>

        {erreur && (
          <div style={{ background: "#3a1a1a", border: "1px solid #e94560", color: "#e94560", padding: "10px 12px", borderRadius: 6, fontSize: "0.85rem", marginBottom: 14 }}>
            ⚠️ {erreur}
          </div>
        )}

        <div style={{ marginBottom: 12, textAlign: "left" }}>
          <label style={{ display: "block", fontSize: 11, color: "#95a5a6", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Code de la room</label>
          <input type="text" value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="Ex: FEUX"
            maxLength={4}
            style={{ width: "100%", background: "#1a1a2e", border: "1px solid #e94560", color: "white", padding: "12px", borderRadius: 8, fontSize: "1.5rem", fontWeight: "bold", boxSizing: "border-box", outline: "none", textAlign: "center", letterSpacing: 8 }}
          />
        </div>

        <div style={{ marginBottom: 20, textAlign: "left" }}>
          <label style={{ display: "block", fontSize: 11, color: "#95a5a6", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Nom du personnage</label>
          <input type="text" value={nom}
            onChange={(e) => setNom(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && rejoindre()}
            placeholder="Ex: Aragorn, Gandalf..."
            style={{ width: "100%", background: "#1a1a2e", border: "1px solid #0f3460", color: "white", padding: "12px", borderRadius: 8, fontSize: "1rem", boxSizing: "border-box", outline: "none" }}
          />
        </div>

        <button onClick={rejoindre} disabled={!code.trim() || !nom.trim() || loading}
          style={{ width: "100%", background: code.trim() && nom.trim() ? "#e94560" : "#0f3460", color: "white", border: "none", padding: "12px 0", borderRadius: 8, fontWeight: "bold", fontSize: 16, cursor: code.trim() && nom.trim() ? "pointer" : "not-allowed" }}
        >
          {loading ? "Connexion…" : "Entrer dans la partie ⚔️"}
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#1a1a2e", fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif", color: "white" }}>

      {/* 🔔 POPUP MJ */}
      {popupMJ && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)",
          background: "#16213e", border: `2px solid ${popupColor}`,
          borderRadius: 12, padding: "16px 28px", textAlign: "center",
          boxShadow: `0 0 30px ${popupColor}66`, zIndex: 1000,
          minWidth: 220, animation: "fadeIn 0.3s ease",
        }}>
          <div style={{ fontSize: 11, color: "#95a5a6", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
            ⚔️ Le MJ lance un dé !
          </div>
          <div style={{ fontSize: 52, fontWeight: "bold", color: popupColor, lineHeight: 1 }}>
            {popupMJ.total}
          </div>
          <div style={{ fontSize: 12, color: "#95a5a6", marginTop: 4 }}>
            d{popupMJ.faces} · {popupMJ.valeur}
            {popupMJ.bonus !== 0 ? ` ${popupMJ.bonus >= 0 ? "+" : ""}${popupMJ.bonus}` : ""}
            {" = "}{popupMJ.total}
          </div>
          {popupMJ.status && (
            <div style={{ marginTop: 6, fontWeight: "bold", color: popupColor, fontSize: 14 }}>
              {popupMJ.status.label}
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateX(-50%) translateY(-10px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>

      <div style={{ background: "#16213e", borderBottom: "1px solid #0f3460", padding: "12px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0, color: "#e94560", fontSize: "1.2rem" }}>🎲 Espace Joueur</h1>
        <span style={{ background: "#0f3460", color: "#e0e0e0", padding: "5px 14px", borderRadius: 20, fontSize: 13, fontWeight: "bold" }}>⚔️ {nom}</span>
      </div>

      <div style={{ maxWidth: 480, margin: "0 auto", padding: "24px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-around", background: "#16213e", border: "1px solid #0f3460", padding: 15, borderRadius: 10, marginBottom: 12 }}>
          {[{ label: "Modificateur", value: bonus }, { label: "Seuil", value: seuil }].map(({ label, value }) => (
            <div key={label} style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center" }}>
              <label style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: 1, color: "#95a5a6" }}>{label}</label>
              <div style={{ background: "#1a1a2e", border: "1px solid #0f3460", color: "#95a5a6", padding: 8, width: 70, borderRadius: 5, textAlign: "center", fontSize: "1rem", fontWeight: "bold" }}>{value}</div>
              <span style={{ fontSize: 10, color: "#555" }}>défini par le MJ</span>
            </div>
          ))}
        </div>

        <div style={{ background: "#16213e", border: "1px solid #0f3460", borderRadius: 12, padding: "1.5rem", textAlign: "center", marginBottom: 12, minHeight: 120, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div style={{ fontSize: 52, fontWeight: "bold", lineHeight: 1, color: resultColor, opacity: rolling ? 0.3 : 1, transition: "all 0.3s" }}>
            {rolling ? "…" : (lastRoll ? lastRoll.total : "?")}
          </div>
          {lastRoll && !rolling && (
            <>
              <div style={{ fontSize: 12, color: "#95a5a6", marginTop: 6 }}>
                d{lastRoll.faces} · {lastRoll.valeur}
                {lastRoll.bonus !== 0 ? ` ${lastRoll.bonus >= 0 ? "+" : ""}${lastRoll.bonus}` : ""}
                {" = "}{lastRoll.total}
              </div>
              {lastRoll.status && <div style={{ marginTop: 8, fontWeight: "bold", color: resultColor, fontSize: 15 }}>{lastRoll.status.label}</div>}
            </>
          )}
          {!lastRoll && !rolling && <div style={{ color: "#95a5a6", fontSize: 14 }}>Lancez un dé !</div>}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 20 }}>
          {FACES.map((f) => (
            <button key={f} onClick={() => lancerDe(f)} disabled={rolling}
              style={{ background: activeDie === f ? "#e94560" : "#0f3460", color: "white", border: "1px solid #e94560", padding: "12px 4px", borderRadius: 6, cursor: "pointer", fontWeight: "bold", fontSize: 14 }}
            >d{f}</button>
          ))}
        </div>

        {history.length > 0 && (
          <div>
            <h3 style={{ fontSize: "0.9rem", color: "#95a5a6", textTransform: "uppercase", letterSpacing: 1, marginTop: 0 }}>Historique de la session</h3>
            <div style={{ background: "#16213e", border: "1px solid #0f3460", borderRadius: 10, maxHeight: 250, overflowY: "auto" }}>
              {history.map((r) => (
                <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 14px", borderBottom: "1px solid #0f3460" }}>
                  <span style={{ color: r.auteur === "MJ" ? "#e94560" : "#95a5a6", fontSize: 12 }}>
                    {r.auteur === "MJ" ? "⚔️ MJ" : `🎲 ${r.auteur}`} · d{r.faces}
                  </span>
                  <span style={{ fontWeight: "bold", fontSize: 16 }}>{r.total}</span>
                  {r.status && <span style={{ color: colors[r.status.cls], fontSize: 11 }}>{r.status.label}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}