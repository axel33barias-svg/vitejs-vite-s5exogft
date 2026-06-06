import { useState, useCallback, useEffect, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { supabase } from "../supabase";
import InventaireJoueur from "./components/InventaireJoueur";
import InventaireGlobal from "./components/InventaireGlobal";
import LogsInventaire from "./components/LogsInventaire";
import EnvoiObjetMJ from "./components/EnvoiObjetMJ";
import ConfigStats from "./components/ConfigStats";
import FichePersonnage from "./components/FichePersonnage";

const FACES = [4, 6, 8, 10, 12, 20, 100];

function genererCode() {
  const lettres = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  return Array.from({ length: 4 }, () => lettres[Math.floor(Math.random() * lettres.length)]).join("");
}

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

export default function MJ({ session }) {
  const [bonus, setBonus]               = useState(0);
  const [seuil, setSeuil]               = useState(0);
  const [rolling, setRolling]           = useState(false);
  const [lastRoll, setLastRoll]         = useState(null);
  const [history, setHistory]           = useState([]);
  const [activeDie, setActiveDie]       = useState(null);
  const [modeCritique, setModeCritique] = useState("tous");
  const [sessionId, setSessionId]       = useState(null);
  const [codeRoom, setCodeRoom]         = useState(null);
  const [showQR, setShowQR]             = useState(false);
  const [joueurs, setJoueurs]           = useState([]);
  const [confirmReset, setConfirmReset] = useState(false);
  const [inventaireGlobalActif, setInventaireGlobalActif] = useState(false);

  // Refs pour éviter les closures figées
  const modeCritiqueRef = useRef(modeCritique);
  const sessionIdRef    = useRef(null);

  useEffect(() => { modeCritiqueRef.current = modeCritique; }, [modeCritique]);
  useEffect(() => { sessionIdRef.current = sessionId; },      [sessionId]);

  // ─── Init session ─────────────────────────────────────────────────────────

  useEffect(() => {
    const initSession = async () => {
      const { data } = await supabase
        .from("sessions")
        .select("id, code")
        .eq("mj_id", session.user.id)
        .maybeSingle();

      if (data) {
        setSessionId(data.id);
        setCodeRoom(data.code);
      } else {
        creerNouvelleSession();
      }
    };
    initSession();
  }, [session]);

  const creerNouvelleSession = async () => {
    const { data: sessionActuelle } = await supabase
      .from("sessions")
      .select("id")
      .eq("mj_id", session.user.id)
      .maybeSingle();

    if (sessionActuelle) {
      const sid = sessionActuelle.id;
      await Promise.all([
        supabase.from("lancers").delete().eq("session_id", sid),
        supabase.from("joueurs").delete().eq("session_id", sid),
        supabase.from("objets").delete().eq("session_id", sid),
        supabase.from("offres").delete().eq("session_id", sid),
        supabase.from("logs_inventaire").delete().eq("session_id", sid),
        supabase.from("inventaire_global").delete().eq("session_id", sid),
      ]);
      await supabase.from("sessions").delete().eq("id", sid);
    }

    let ok = false;
    while (!ok) {
      const code = genererCode();
      const { data: newSession, error } = await supabase
        .from("sessions")
        .insert([{ mj_id: session.user.id, code }])
        .select()
        .single();
      if (!error && newSession) {
        setSessionId(newSession.id);
        setCodeRoom(newSession.code);
        setJoueurs([]);
        setHistory([]);
        setLastRoll(null);
        ok = true;
      }
    }
    setConfirmReset(false);
  };

  const supprimerJoueur = async (joueurId) => {
    const joueur = joueurs.find(j => j.id === joueurId);
    setJoueurs((prev) => prev.filter((j) => j.id !== joueurId));
    if (joueur) await supabase.from("lancers").delete().eq("session_id", sessionId).eq("auteur", joueur.nom);
    await supabase.from("joueurs").delete().eq("id", joueurId);
  };

  // ─── Historique ───────────────────────────────────────────────────────────

  const chargerHistorique = useCallback(async (sid, mode) => {
    if (!sid) return;
    const { data } = await supabase
      .from("lancers")
      .select("*")
      .eq("session_id", sid)
      .order("created_at", { ascending: false })
      .limit(30);
    if (data) {
      setHistory(data.map((r) => ({
        ...r,
        status: getStatus(r.valeur, r.bonus, r.total, r.faces, r.seuil, mode),
      })));
    }
  }, []);

  // ─── Init joueurs + Realtime arrivées ─────────────────────────────────────

  useEffect(() => {
    if (!sessionId) return;

    supabase.from("joueurs").select("*").eq("session_id", sessionId)
      .then(({ data }) => { if (data) setJoueurs(data); });

    chargerHistorique(sessionId, modeCritiqueRef.current);

    // ✅ Channel unique par session — évite les conflits si plusieurs onglets MJ
    const channel = supabase
      .channel(`joueurs-session-${sessionId}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "joueurs", filter: `session_id=eq.${sessionId}` },
        ({ new: joueur }) => setJoueurs((prev) => [...prev, joueur])
      ).subscribe();

    return () => supabase.removeChannel(channel);
  }, [sessionId, chargerHistorique]);

  // ─── Polling historique 500ms — modeCritique lu via ref ───────────────────

  useEffect(() => {
    if (!sessionId) return;
    const interval = setInterval(() => {
      chargerHistorique(sessionId, modeCritiqueRef.current);
    }, 500);
    return () => clearInterval(interval);
  }, [sessionId, chargerHistorique]); // ✅ modeCritique absent — lu via ref

  // ─── Actions joueurs ──────────────────────────────────────────────────────

  const updateJoueur = async (joueurId, field, value) => {
    const parsed = parseInt(value) || 0;
    setJoueurs((prev) => prev.map((j) => j.id === joueurId ? { ...j, [field]: parsed } : j));
    await supabase.from("joueurs").update({ [field]: parsed }).eq("id", joueurId);
  };

  // ─── Lancer de dé MJ ──────────────────────────────────────────────────────

  const lancerDe = useCallback(async (faces, secret = false) => {
    if (rolling) return;
    setActiveDie(faces);
    setRolling(true);

    setTimeout(async () => {
      const valeur = Math.floor(Math.random() * faces) + 1;
      const b = parseInt(bonus) || 0;
      const s = parseInt(seuil) || 0;
      const total = valeur + b;
      const status = getStatus(valeur, b, total, faces, s, modeCritiqueRef.current);

      const roll = { valeur, bonus: b, total, faces, seuil: s, status, id: `local-${Date.now()}`, secret, auteur: "MJ" };
      setLastRoll(roll);
      if (!secret) setHistory((prev) => [roll, ...prev].slice(0, 30));
      setRolling(false);
      setActiveDie(null);

      if (!secret) {
        await supabase.from("lancers").insert([{
          valeur, bonus: b, total, faces, seuil: s,
          session_id: sessionIdRef.current, auteur: "MJ",
        }]);
      }
    }, 400);
  }, [rolling, bonus, seuil]); // ✅ modeCritique et sessionId lus via ref

  const resultColor = lastRoll?.status ? colors[lastRoll.status.cls] : "#e0e0e0";
  const siteUrl = window.location.origin + "/rejoindre";

  // ─── Rendu ────────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: "100vh", background: "#1a1a2e", fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif", color: "white" }}>
      <div style={{ background: "#16213e", borderBottom: "1px solid #0f3460", padding: "12px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0, color: "#e94560", fontSize: "1.3rem" }}>⚔️ Espace MJ</h1>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ color: "#95a5a6", fontSize: 13 }}>{session.user.email}</span>
          <button onClick={() => setShowQR(!showQR)} style={{ background: "#0f3460", color: "white", border: "1px solid #e94560", padding: "6px 14px", borderRadius: 6, cursor: "pointer", fontWeight: "bold", fontSize: 13 }}>
            {showQR ? "Fermer QR" : "📱 QR Joueurs"}
          </button>
          <button onClick={() => supabase.auth.signOut()} style={{ background: "transparent", color: "#95a5a6", border: "1px solid #0f3460", padding: "6px 14px", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>
            Déconnexion
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "24px 16px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div>
          {/* Code room */}
          <div style={{ background: "#16213e", border: "1px solid #0f3460", borderRadius: 12, padding: 16, marginBottom: 12, textAlign: "center" }}>
            <div style={{ fontSize: 11, color: "#95a5a6", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Code de la room</div>
            <div style={{ fontSize: 42, fontWeight: "bold", color: "#e94560", letterSpacing: 8 }}>{codeRoom || "…"}</div>
            <div style={{ fontSize: 11, color: "#555", marginTop: 4 }}>Les joueurs entrent ce code pour rejoindre</div>

            {showQR && (
              <div style={{ marginTop: 16 }}>
                <div style={{ background: "white", display: "inline-block", padding: 12, borderRadius: 8 }}>
                  <QRCodeSVG value={siteUrl} size={140} />
                </div>
                <p style={{ color: "#95a5a6", fontSize: 11, marginTop: 8 }}>Scanner pour accéder au site</p>
                <a href={siteUrl} target="_blank" rel="noreferrer" style={{ color: "#e94560", fontSize: 12, wordBreak: "break-all" }}>{siteUrl}</a>
              </div>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 10 }}>
              <button onClick={() => setShowQR(!showQR)} style={{ background: "#0f3460", color: "white", border: "1px solid #e94560", padding: "6px 14px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>
                {showQR ? "Masquer QR" : "📱 Afficher QR"}
              </button>
              {!confirmReset ? (
                <button onClick={() => setConfirmReset(true)} style={{ background: "transparent", color: "#95a5a6", border: "1px solid #555", padding: "6px 14px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>
                  🔄 Nouvelle session
                </button>
              ) : (
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: "#e94560" }}>Confirmer ?</span>
                  <button onClick={creerNouvelleSession} style={{ background: "#e94560", color: "white", border: "none", padding: "6px 10px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: "bold" }}>Oui</button>
                  <button onClick={() => setConfirmReset(false)} style={{ background: "#0f3460", color: "white", border: "none", padding: "6px 10px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>Non</button>
                </div>
              )}
            </div>
          </div>

          {/* Bonus / Seuil */}
          <div style={{ display: "flex", justifyContent: "space-around", background: "#16213e", border: "1px solid #0f3460", padding: 15, borderRadius: 10, marginBottom: 12 }}>
            {[{ label: "Mon modificateur", value: bonus, set: setBonus }, { label: "Mon seuil", value: seuil, set: setSeuil }].map(({ label, value, set }) => (
              <div key={label} style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
                <label style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: 1, color: "#95a5a6" }}>{label}</label>
                <input type="number" value={value} onChange={(e) => set(e.target.value)}
                  style={{ background: "#1a1a2e", border: "1px solid #e94560", color: "white", padding: 8, width: 70, borderRadius: 5, textAlign: "center", fontSize: "1rem", fontWeight: "bold" }}
                />
              </div>
            ))}
          </div>

          {/* Mode critique */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, background: "#16213e", border: "1px solid #0f3460", padding: "10px 15px", borderRadius: 10, marginBottom: 12 }}>
            <span style={{ fontSize: "0.75rem", color: "#95a5a6", textTransform: "uppercase", letterSpacing: 1 }}>Critiques :</span>
            {["tous", "d20"].map((mode) => (
              <button key={mode} onClick={() => setModeCritique(mode)}
                style={{ padding: "5px 14px", borderRadius: 20, border: "none", cursor: "pointer", fontWeight: "bold", fontSize: 12, background: modeCritique === mode ? "#e94560" : "#1a1a2e", color: modeCritique === mode ? "white" : "#95a5a6" }}
              >
                {mode === "tous" ? "Tous les dés" : "D20 seulement"}
              </button>
            ))}
          </div>

          {/* Résultat */}
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
                  {lastRoll.secret && <span style={{ color: "#f1c40f", marginLeft: 8 }}>🔒 Secret</span>}
                </div>
                {lastRoll.status && <div style={{ marginTop: 8, fontWeight: "bold", color: resultColor, fontSize: 15 }}>{lastRoll.status.label}</div>}
              </>
            )}
            {!lastRoll && !rolling && <div style={{ color: "#95a5a6", fontSize: 14 }}>Lancez un dé !</div>}
          </div>

          {/* Dés normaux */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 8 }}>
            {FACES.map((f) => (
              <button key={f} onClick={() => lancerDe(f)} disabled={rolling}
                style={{ background: activeDie === f ? "#e94560" : "#0f3460", color: "white", border: "1px solid #e94560", padding: "10px 4px", borderRadius: 6, cursor: "pointer", fontWeight: "bold", fontSize: 13 }}
              >d{f}</button>
            ))}
          </div>

          {/* Dés secrets */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
            {FACES.map((f) => (
              <button key={f} onClick={() => lancerDe(f, true)} disabled={rolling}
                style={{ background: "#1a1a2e", color: "#f1c40f", border: "1px solid #f1c40f", padding: "8px 4px", borderRadius: 6, cursor: "pointer", fontWeight: "bold", fontSize: 11 }}
              >🔒 d{f}</button>
            ))}
          </div>
          <p style={{ color: "#555", fontSize: 11, textAlign: "center", margin: "6px 0 0" }}>Dés secrets — invisibles pour les joueurs</p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Joueurs */}
          <div>
            <h3 style={{ color: "#95a5a6", fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: 1, marginTop: 0 }}>
              Joueurs connectés ({joueurs.length})
            </h3>
            {joueurs.length === 0 ? (
              <div style={{ background: "#16213e", border: "1px solid #0f3460", borderRadius: 10, padding: 20, textAlign: "center", color: "#95a5a6", fontSize: 14 }}>
                En attente de joueurs…
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {joueurs.map((j) => (
                  <div key={j.id} style={{ background: "#16213e", border: "1px solid #0f3460", borderRadius: 10, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontWeight: "bold", flex: 1 }}>⚔️ {j.nom}</span>
                    <button onClick={() => supprimerJoueur(j.id)} style={{ background: "transparent", color: "#e94560", border: "1px solid #e94560", padding: "4px 8px", borderRadius: 4, cursor: "pointer", fontSize: 11 }}>✕</button>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <label style={{ fontSize: 11, color: "#95a5a6" }}>Bonus</label>
                      <input type="number" value={j.bonus} onChange={(e) => updateJoueur(j.id, "bonus", e.target.value)}
                        style={{ width: 52, background: "#1a1a2e", border: "1px solid #e94560", color: "white", padding: "4px 6px", borderRadius: 4, textAlign: "center", fontSize: 13, fontWeight: "bold" }}
                      />
                      <label style={{ fontSize: 11, color: "#95a5a6" }}>Seuil</label>
                      <input type="number" value={j.seuil} onChange={(e) => updateJoueur(j.id, "seuil", e.target.value)}
                        style={{ width: 52, background: "#1a1a2e", border: "1px solid #0f3460", color: "white", padding: "4px 6px", borderRadius: 4, textAlign: "center", fontSize: 13, fontWeight: "bold" }}
                      />
                      <EnvoiObjetMJ sessionId={sessionId} joueur={j} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Historique */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <h3 style={{ color: "#95a5a6", fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: 1, margin: 0 }}>Historique de la session</h3>
              <span style={{ color: "#555", fontSize: 11 }}>↻ auto 500ms</span>
            </div>
            <div style={{ background: "#16213e", border: "1px solid #0f3460", borderRadius: 10, maxHeight: 400, overflowY: "auto" }}>
              {history.length === 0 && <p style={{ color: "#95a5a6", textAlign: "center", padding: 20, fontSize: 14 }}>Les lancers apparaîtront ici…</p>}
              {history.map((r, i) => (
                <div key={r.id ?? i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderBottom: "1px solid #0f3460", opacity: r.secret ? 0.7 : 1 }}>
                  <span style={{ color: r.auteur === "MJ" ? "#e94560" : "#95a5a6", fontSize: 12 }}>
                    {r.auteur === "MJ" ? "⚔️ MJ" : `🎲 ${r.auteur}`} · d{r.faces}{r.secret && " 🔒"}
                  </span>
                  <span style={{ fontWeight: "bold", fontSize: 16 }}>{r.total}</span>
                  {r.status && <span style={{ color: colors[r.status.cls], fontSize: 11 }}>{r.status.label}</span>}
                </div>
              ))}
            </div>
          </div>

          <InventaireGlobal sessionId={sessionId} joueurNom="MJ" isMJ={true} actif={inventaireGlobalActif} onToggle={() => setInventaireGlobalActif(!inventaireGlobalActif)} />
          <LogsInventaire sessionId={sessionId} isMJ={true} />
          <ConfigStats sessionId={sessionId} />
          <FichePersonnage sessionId={sessionId} joueurId={null} joueurNom="MJ" isMJ={true} />
        </div>
      </div>
    </div>
  );
}