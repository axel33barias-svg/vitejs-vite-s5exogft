import { useState, useCallback, useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";
import { supabase } from "../supabase";
import InventaireJoueur from "./components/InventaireJoueur";
import InventaireGlobal from "./components/InventaireGlobal";
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

const ACTION_STYLES = {
  add:    { icon: "✅", color: "#4ee44e", label: "Ajout" },
  remove: { icon: "🗑️", color: "#e94560", label: "Perte" },
  drop:   { icon: "⬇️", color: "#f1c40f", label: "Déposé" },
  take:   { icon: "⬆️", color: "#3498db", label: "Pris" },
  steal:  { icon: "🎭", color: "#8e44ad", label: "Vol" },
};

export default function MJ({ session }) {
  const [bonus, setBonus] = useState(0);
  const [seuil, setSeuil] = useState(0);
  const [rolling, setRolling] = useState(false);
  const [lastRoll, setLastRoll] = useState(null);
  const [history, setHistory] = useState([]);
  const [activeDie, setActiveDie] = useState(null);
  const [modeCritique, setModeCritique] = useState("tous");
  const [sessionId, setSessionId] = useState(null);
  const [codeRoom, setCodeRoom] = useState(null);
  const [showQR, setShowQR] = useState(false);
  const [joueurs, setJoueurs] = useState([]);
  const [confirmReset, setConfirmReset] = useState(false);
  const [inventaireGlobalActif, setInventaireGlobalActif] = useState(false);
  const [historiqueUnifie, setHistoriqueUnifie] = useState([]);
  const [showConfigPopup, setShowConfigPopup] = useState(false);
  const [configAlreadyShown, setConfigAlreadyShown] = useState(false);
  const [joueurInfo, setJoueurInfo] = useState(null);

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

  // 🔥 Popup de config : une seule fois par session (stocké dans localStorage)
  useEffect(() => {
    if (sessionId && !configAlreadyShown) {
      const alreadyShown = localStorage.getItem(`config_shown_${sessionId}`);
      
      if (!alreadyShown) {
        const timer = setTimeout(() => {
          setShowConfigPopup(true);
          setConfigAlreadyShown(true);
          localStorage.setItem(`config_shown_${sessionId}`, 'true');
        }, 500);
        return () => clearTimeout(timer);
      } else {
        setConfigAlreadyShown(true);
      }
    }
  }, [sessionId, configAlreadyShown]);

  const creerNouvelleSession = async () => {
    const { data: sessionActuelle } = await supabase
      .from("sessions")
      .select("id")
      .eq("mj_id", session.user.id)
      .maybeSingle();

    if (sessionActuelle) {
      await supabase.from("lancers").delete().eq("session_id", sessionActuelle.id);
      await supabase.from("joueurs").delete().eq("session_id", sessionActuelle.id);
      await supabase.from("objets").delete().eq("session_id", sessionActuelle.id);
      await supabase.from("offres").delete().eq("session_id", sessionActuelle.id);
      await supabase.from("logs_inventaire").delete().eq("session_id", sessionActuelle.id);
      await supabase.from("inventaire_global").delete().eq("session_id", sessionActuelle.id);
      await supabase.from("sessions").delete().eq("id", sessionActuelle.id);
    }

    let code = genererCode();
    let ok = false;
    while (!ok) {
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
        // 🔥 Réinitialiser le flag localStorage pour la nouvelle session
        localStorage.removeItem(`config_shown_${newSession.id}`);
        setConfigAlreadyShown(false);
        ok = true;
      } else {
        code = genererCode();
      }
    }
    setConfirmReset(false);
  };

  const supprimerJoueur = async (joueurId) => {
    const joueur = joueurs.find(j => j.id === joueurId);
    setJoueurs((prev) => prev.filter((j) => j.id !== joueurId));
    if (joueur) {
      await supabase.from("lancers").delete().eq("session_id", sessionId).eq("auteur", joueur.nom);
    }
    await supabase.from("joueurs").delete().eq("id", joueurId);
  };

  const chargerHistoriqueUnifie = useCallback(async (sid) => {
    if (!sid) return;
  
    const { data: lancers } = await supabase
      .from("lancers")
      .select("*")
      .eq("session_id", sid)
      .order("created_at", { ascending: false })
      .limit(50);
  
    const { data: logs } = await supabase
      .from("logs_inventaire")
      .select("*")
      .eq("session_id", sid)
      .order("created_at", { ascending: false })
      .limit(50);
  
    const tous = [...(lancers || []), ...(logs || [])];
    tous.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const top50 = tous.slice(0, 50);
    const avecType = top50.map(item => ({
      ...item,
      type: item.auteur ? 'lancer' : 'inventaire'
    }));
  
    setHistoriqueUnifie(avecType);
  }, []);

  useEffect(() => {
    if (!sessionId) return;
  
    supabase.from("joueurs").select("*").eq("session_id", sessionId)
      .then(({ data }) => { if (data) setJoueurs(data); });
  
    chargerHistoriqueUnifie(sessionId);
  
    const channelJoueurs = supabase
      .channel("joueurs-session")
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "joueurs", filter: `session_id=eq.${sessionId}` },
        (payload) => { setJoueurs((prev) => [...prev, payload.new]); }
      ).subscribe();
  
    return () => supabase.removeChannel(channelJoueurs);
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;

    const channelLancers = supabase
      .channel(`mj-historique-lancers-${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "lancers",
          filter: `session_id=eq.${sessionId}`,
        },
        () => {
          chargerHistoriqueUnifie(sessionId);
        }
      )
      .subscribe();

    const channelLogs = supabase
      .channel(`mj-historique-logs-${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "logs_inventaire",
          filter: `session_id=eq.${sessionId}`,
        },
        () => {
          chargerHistoriqueUnifie(sessionId);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channelLancers);
      supabase.removeChannel(channelLogs);
    };
  }, [sessionId, chargerHistoriqueUnifie]);

  const updateJoueur = async (joueurId, field, value) => {
    const parsed = parseInt(value) || 0;
    setJoueurs((prev) => prev.map((j) => j.id === joueurId ? { ...j, [field]: parsed } : j));
    await supabase.from("joueurs").update({ [field]: parsed }).eq("id", joueurId);
  };

  const getJoueurInfos = async (joueurId) => {
    const { data: fiche } = await supabase
      .from("personnages")
      .select("*, stats_personnage(*)")
      .eq("joueur_id", joueurId)
      .eq("session_id", sessionId)
      .maybeSingle();

    const { data: inventaire } = await supabase
      .from("objets")
      .select("*")
      .eq("joueur_id", joueurId)
      .eq("session_id", sessionId);

    const { data: configStats } = await supabase
      .from("config_stats")
      .select("*")
      .eq("session_id", sessionId)
      .maybeSingle();

    return {
      fiche: fiche || null,
      inventaire: inventaire || [],
      config: configStats || null,
    };
  };

  const lancerDe = useCallback(async (faces, secret = false) => {
    if (rolling) return;
    setActiveDie(faces);
    setRolling(true);
    setTimeout(async () => {
      const valeur = Math.floor(Math.random() * faces) + 1;
      const b = parseInt(bonus) || 0;
      const s = parseInt(seuil) || 0;
      const total = valeur + b;
      const status = getStatus(valeur, b, total, faces, s, modeCritique);
      const roll = { valeur, bonus: b, total, faces, seuil: s, status, id: Date.now(), secret, auteur: "MJ" };
      setLastRoll(roll);
      if (!secret) setHistory((prev) => [roll, ...prev].slice(0, 30));
      setRolling(false);
      setActiveDie(null);
      if (!secret) {
        await supabase.from("lancers").insert([{
          valeur, bonus: b, total, faces, seuil: s, session_id: sessionId, auteur: "MJ"
        }]);
      }
    }, 400);
  }, [rolling, bonus, seuil, modeCritique, sessionId]);

  const resultColor = lastRoll?.status ? colors[lastRoll.status.cls] : "#e0e0e0";
  const siteUrl = window.location.origin + "/rejoindre";

  return (
    <div style={{ minHeight: "100vh", background: "#1a1a2e", fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif", color: "white" }}>
      <div style={{ background: "#16213e", borderBottom: "1px solid #0f3460", padding: "12px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 style={{ margin: 0, color: "#e94560", fontSize: "1.3rem" }}>⚔️ Espace MJ</h1>
          <button 
            onClick={() => setShowConfigPopup(true)} 
            style={{ 
              background: "#0f3460", 
              color: "#95a5a6", 
              border: "1px solid #e94560", 
              padding: "4px 12px", 
              borderRadius: 6, 
              cursor: "pointer", 
              fontSize: 12,
              fontWeight: "bold",
              transition: "all 0.2s"
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#e94560"; e.currentTarget.style.color = "white"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "#0f3460"; e.currentTarget.style.color = "#95a5a6"; }}
          >
            ⚙️ Réglages
          </button>
        </div>
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

        {/* ── COLONNE GAUCHE ── */}
        <div>
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

          <div style={{ display: "flex", justifyContent: "space-around", background: "#16213e", border: "1px solid #0f3460", padding: 15, borderRadius: 10, marginBottom: 12 }}>
            {[
              { label: "Mon modificateur", value: bonus, set: setBonus },
              { label: "Mon seuil", value: seuil, set: setSeuil },
            ].map(({ label, value, set }) => (
              <div key={label} style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
                <label style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: 1, color: "#95a5a6" }}>{label}</label>
                <input type="number" value={value} onChange={(e) => set(e.target.value)}
                  style={{ background: "#1a1a2e", border: "1px solid #e94560", color: "white", padding: 8, width: 70, borderRadius: 5, textAlign: "center", fontSize: "1rem", fontWeight: "bold" }}
                />
              </div>
            ))}
          </div>

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

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 8 }}>
            {FACES.map((f) => (
              <button key={f} onClick={() => lancerDe(f)} disabled={rolling}
                style={{ background: activeDie === f ? "#e94560" : "#0f3460", color: "white", border: "1px solid #e94560", padding: "10px 4px", borderRadius: 6, cursor: "pointer", fontWeight: "bold", fontSize: 13 }}
              >d{f}</button>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
            {FACES.map((f) => (
              <button key={f} onClick={() => lancerDe(f, true)} disabled={rolling}
                style={{ background: "#1a1a2e", color: "#f1c40f", border: "1px solid #f1c40f", padding: "8px 4px", borderRadius: 6, cursor: "pointer", fontWeight: "bold", fontSize: 11 }}
              >🔒 d{f}</button>
            ))}
          </div>
          <p style={{ color: "#555", fontSize: 11, textAlign: "center", margin: "6px 0 0" }}>Dés secrets — invisibles pour les joueurs</p>
        </div>

        {/* ── COLONNE DROITE ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Joueurs connectés - 🔥 Filtrés pour ne montrer que ceux en attente */}
          <div>
            <h3 style={{ color: "#95a5a6", fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: 1, marginTop: 0 }}>
              Joueurs en attente ({joueurs.filter(j => j.statut !== "approuve").length})
            </h3>
            {joueurs.filter(j => j.statut !== "approuve").length === 0 ? (
              <div style={{ background: "#16213e", border: "1px solid #0f3460", borderRadius: 10, padding: 20, textAlign: "center", color: "#95a5a6", fontSize: 14 }}>
                Aucun joueur en attente
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {joueurs
                  .filter(j => j.statut !== "approuve")
                  .map((j) => (
                    <div key={j.id} style={{ background: "#16213e", border: "1px solid #0f3460", borderRadius: 10, padding: "12px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontWeight: "bold", flex: 1 }}>⚔️ {j.nom}</span>
                        <button 
                          onClick={async (e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            const infos = await getJoueurInfos(j.id);
                            setJoueurInfo({
                              joueurId: j.id,
                              nom: j.nom,
                              x: rect.left,
                              y: rect.bottom + 8,
                              data: infos,
                            });
                          }}
                          style={{ 
                            background: "transparent", 
                            color: "#3498db", 
                            border: "1px solid #3498db", 
                            padding: "2px 6px", 
                            borderRadius: 4, 
                            cursor: "pointer", 
                            fontSize: 11,
                            fontWeight: "bold",
                          }}
                          title="Voir les infos du joueur"
                        >
                          ℹ️
                        </button>
                        <button onClick={() => supprimerJoueur(j.id)} style={{ background: "transparent", color: "#e94560", border: "1px solid #e94560", padding: "4px 8px", borderRadius: 4, cursor: "pointer", fontSize: 11 }}>✕</button>
                        <label style={{ fontSize: 11, color: "#95a5a6" }}>Bonus</label>
                        <input type="number" value={j.bonus} onChange={(e) => updateJoueur(j.id, "bonus", e.target.value)}
                          style={{ width: 52, background: "#1a1a2e", border: "1px solid #e94560", color: "white", padding: "4px 6px", borderRadius: 4, textAlign: "center", fontSize: 13, fontWeight: "bold" }}
                        />
                        <label style={{ fontSize: 11, color: "#95a5a6" }}>Seuil</label>
                        <input type="number" value={j.seuil} onChange={(e) => updateJoueur(j.id, "seuil", e.target.value)}
                          style={{ width: 52, background: "#1a1a2e", border: "1px solid #0f3460", color: "white", padding: "4px 6px", borderRadius: 4, textAlign: "center", fontSize: 13, fontWeight: "bold" }}
                        />
                      </div>
                      <EnvoiObjetMJ sessionId={sessionId} joueur={j} />
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* Historique UNIFIÉ */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <h3 style={{ color: "#95a5a6", fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: 1, margin: 0 }}>
                📜 Historique unifié (lancers + inventaire)
              </h3>
              <span style={{ color: "#555", fontSize: 11 }}>50 derniers événements</span>
            </div>
            <div style={{ background: "#16213e", border: "1px solid #0f3460", borderRadius: 10, maxHeight: 400, overflowY: "auto" }}>
              {historiqueUnifie.length === 0 && (
                <p style={{ color: "#95a5a6", textAlign: "center", padding: 20, fontSize: 14 }}>
                  Aucune activité pour le moment
                </p>
              )}
              {historiqueUnifie.map((item) => {
                if (item.type === 'lancer') {
                  const status = getStatus(item.valeur, item.bonus, item.total, item.faces, item.seuil, modeCritique);
                  return (
                    <div key={item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 14px", borderBottom: "1px solid #0f3460", opacity: item.secret ? 0.5 : 1 }}>
                      <span style={{ color: item.auteur === "MJ" ? "#e94560" : "#95a5a6", fontSize: 12 }}>
                        {item.auteur === "MJ" ? "⚔️ MJ" : `🎲 ${item.auteur}`} · d{item.faces}{item.secret && " 🔒"}
                      </span>
                      <span style={{ fontWeight: "bold", fontSize: 16 }}>{item.total}</span>
                      {status && <span style={{ color: colors[status.cls], fontSize: 11 }}>{status.label}</span>}
                      <span style={{ color: "#555", fontSize: 10 }}>
                        {new Date(item.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  );
                } else {
                  const style = ACTION_STYLES[item.action] || { icon: "📋", color: "#95a5a6" };
                  return (
                    <div key={item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 14px", borderBottom: "1px solid #0f3460" }}>
                      <span style={{ fontSize: 12, color: "#95a5a6" }}>
                        {style.icon} {item.details}
                      </span>
                      <span style={{ color: style.color, fontSize: 11, fontWeight: "bold" }}>
                        {style.label}
                      </span>
                      <span style={{ color: "#555", fontSize: 10 }}>
                        {new Date(item.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  );
                }
              })}
            </div>
          </div>

          <InventaireGlobal
            sessionId={sessionId}
            joueurNom="MJ"
            isMJ={true}
            actif={inventaireGlobalActif}
            onToggle={() => setInventaireGlobalActif(!inventaireGlobalActif)}
          />

          <FichePersonnage sessionId={sessionId} joueurId={null} joueurNom="MJ" isMJ={true} />

        </div>
      </div>

      {/* POPUP CONFIGURATION DES STATS */}
      {showConfigPopup && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(0, 0, 0, 0.85)",
          backdropFilter: "blur(4px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 9999,
          padding: 20,
          animation: "fadeInPopup 0.3s ease",
        }}>
          <div style={{
            background: "#1a1a2e",
            border: "2px solid #e94560",
            borderRadius: 16,
            maxWidth: 700,
            width: "100%",
            maxHeight: "90vh",
            overflowY: "auto",
            padding: 24,
            boxShadow: "0 20px 60px rgba(233, 69, 96, 0.3)",
            position: "relative",
          }}>
            <button
              onClick={() => setShowConfigPopup(false)}
              style={{
                position: "sticky",
                top: 0,
                float: "right",
                background: "transparent",
                border: "none",
                color: "#95a5a6",
                fontSize: 24,
                cursor: "pointer",
                padding: "0 8px",
                zIndex: 10,
              }}
            >
              ✕
            </button>

            <h2 style={{ color: "#e94560", marginTop: 0, fontSize: "1.5rem", textAlign: "center" }}>
              ⚙️ Configuration des stats
            </h2>
            <p style={{ color: "#95a5a6", fontSize: 13, textAlign: "center", marginBottom: 20 }}>
              Personnalisez les noms, dés et seuils pour cette session
            </p>

            <ConfigStats sessionId={sessionId} showHeader={false} />

            <div style={{ textAlign: "center", marginTop: 20 }}>
              <button
                onClick={() => setShowConfigPopup(false)}
                style={{
                  background: "#e94560",
                  color: "white",
                  border: "none",
                  padding: "10px 30px",
                  borderRadius: 8,
                  fontWeight: "bold",
                  fontSize: 14,
                  cursor: "pointer",
                  transition: "all 0.2s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.05)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
              >
                ✅ C'est bon, commencer la partie !
              </button>
            </div>
          </div>
        </div>
      )}

      {/* INFO-BULLE JOUEUR - 🔥 avec filtrage des champs techniques */}
      {joueurInfo && (
        <div
          style={{
            position: "fixed",
            top: joueurInfo.y,
            left: Math.min(joueurInfo.x - 200, window.innerWidth - 370),
            background: "#16213e",
            border: "2px solid #3498db",
            borderRadius: 12,
            padding: 16,
            minWidth: 280,
            maxWidth: 350,
            maxHeight: 400,
            overflowY: "auto",
            boxShadow: "0 10px 40px rgba(0,0,0,0.8)",
            zIndex: 10000,
            animation: "fadeInPopup 0.2s ease",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h4 style={{ margin: 0, color: "#e94560", fontSize: 16 }}>
              ℹ️ {joueurInfo.nom}
            </h4>
            <button
              onClick={() => setJoueurInfo(null)}
              style={{
                background: "transparent",
                border: "none",
                color: "#95a5a6",
                fontSize: 18,
                cursor: "pointer",
                padding: "0 4px",
              }}
            >
              ✕
            </button>
          </div>

          {joueurInfo.data?.fiche ? (
            <>
              <div style={{ fontSize: 12, color: "#95a5a6", marginBottom: 4 }}>
                📜 {joueurInfo.data.fiche.classe}
                {joueurInfo.data.fiche.espece && ` · ${joueurInfo.data.fiche.espece}`}
                {joueurInfo.data.fiche.age && ` · ${joueurInfo.data.fiche.age} ans`}
              </div>
              {joueurInfo.data.fiche.description && (
                <div style={{ fontSize: 11, color: "#95a5a6", fontStyle: "italic", marginBottom: 8 }}>
                  {joueurInfo.data.fiche.description}
                </div>
              )}
              {joueurInfo.data.fiche.stats_personnage && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4, marginBottom: 12 }}>
                  {Object.entries(joueurInfo.data.fiche.stats_personnage[0] || {})
                    .filter(([stat]) => !['id', 'personnage_id', 'session_id'].includes(stat))
                    .map(([stat, valeur]) => {
                      const nomStat = joueurInfo.data.config?.[`${stat}_nom`] || stat;
                      return (
                        <div key={stat} style={{ background: "#0f3460", borderRadius: 4, padding: "4px 6px", textAlign: "center" }}>
                          <div style={{ fontSize: 9, color: "#95a5a6", textTransform: "uppercase" }}>{nomStat}</div>
                          <div style={{ fontSize: 14, fontWeight: "bold", color: "#e94560" }}>{valeur}</div>
                        </div>
                      );
                    })}
                </div>
              )}
            </>
          ) : (
            <div style={{ fontSize: 12, color: "#555", marginBottom: 12 }}>
              Aucune fiche personnage soumise
            </div>
          )}

          <div style={{ borderTop: "1px solid #0f3460", paddingTop: 10 }}>
            <div style={{ fontSize: 11, color: "#95a5a6", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
              🎒 Inventaire ({joueurInfo.data?.inventaire?.length || 0})
            </div>
            {joueurInfo.data?.inventaire?.length === 0 ? (
              <div style={{ fontSize: 11, color: "#555" }}>Inventaire vide</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {joueurInfo.data.inventaire.slice(0, 8).map((item) => (
                  <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                    <span>{item.icon}</span>
                    <span style={{ color: "white" }}>{item.nom}</span>
                    {item.quantite > 1 && <span style={{ color: "#95a5a6", fontSize: 10 }}>×{item.quantite}</span>}
                  </div>
                ))}
                {joueurInfo.data.inventaire.length > 8 && (
                  <div style={{ fontSize: 10, color: "#555" }}>… et {joueurInfo.data.inventaire.length - 8} autres</div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {joueurInfo && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 9999,
            cursor: "default",
          }}
          onClick={() => setJoueurInfo(null)}
        />
      )}

      <style>{`
        @keyframes fadeInPopup {
          from {
            opacity: 0;
            transform: scale(0.95);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>

    </div>
  );
}