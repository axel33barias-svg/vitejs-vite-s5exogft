import { useState, useCallback, useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";
import { supabase } from "../supabase";
import InventaireJoueur from "./components/InventaireJoueur";
import InventaireGlobal from "./components/InventaireGlobal";
import EnvoiObjetMJ from "./components/EnvoiObjetMJ";
import ConfigStats from "./components/ConfigStats";
import FichePersonnage from "./components/FichePersonnage";
import ResetPartie from "./components/ResetPartie";

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
  const [bonus, setBonus] = useState(0);
  const [seuil, setSeuil] = useState(0);
  const [rolling, setRolling] = useState(false);
  const [lastRoll, setLastRoll] = useState(null);
  const [activeDie, setActiveDie] = useState(null);
  const [modeCritique, setModeCritique] = useState("tous");
  const [sessionId, setSessionId] = useState(null);
  const [codeRoom, setCodeRoom] = useState(null);
  const [showQR, setShowQR] = useState(false);
  const [joueurs, setJoueurs] = useState([]);
  const [inventaireGlobalActif, setInventaireGlobalActif] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  
  // 🆕 États pour la popup ConfigStats
  const [showConfigPopup, setShowConfigPopup] = useState(false);
  const [configDone, setConfigDone] = useState(false);
  
  // 🆕 État pour la fiche perso d'un joueur
  const [selectedJoueur, setSelectedJoueur] = useState(null);

  // 📜 Historique fusionné
  const [activityLog, setActivityLog] = useState([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);

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
        // ✅ Vérifier si la config stats existe déjà
        const { data: configExists } = await supabase
          .from("config_stats")
          .select("id")
          .eq("session_id", data.id)
          .maybeSingle();
        
        if (configExists) {
          setConfigDone(true);
        } else {
          // 🆕 Afficher la popup ConfigStats au démarrage
          setShowConfigPopup(true);
        }
      } else {
        await creerNouvelleSession();
      }
    };
    initSession();
  }, [session]);

  const creerNouvelleSession = async () => {
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
        setActivityLog([]);
        setLastRoll(null);
        setConfigDone(false);
        // 🆕 Afficher la popup ConfigStats
        setShowConfigPopup(true);
        ok = true;
      } else {
        code = genererCode();
      }
    }
  };

  const supprimerJoueur = async (joueurId) => {
    const joueur = joueurs.find(j => j.id === joueurId);
    setJoueurs((prev) => prev.filter((j) => j.id !== joueurId));
    if (joueur) {
      await supabase.from("lancers").delete().eq("session_id", sessionId).eq("auteur", joueur.nom);
    }
    await supabase.from("joueurs").delete().eq("id", joueurId);
  };

  // 📜 Chargement des logs fusionnés
  const chargerLogsFusionnes = useCallback(async () => {
    if (!sessionId) return;
    setIsLoadingLogs(true);
    
    try {
      const [lancersRes, logsRes] = await Promise.all([
        supabase
          .from("lancers")
          .select("*")
          .eq("session_id", sessionId)
          .order("created_at", { ascending: false })
          .limit(30),
        supabase
          .from("logs_inventaire")
          .select("*")
          .eq("session_id", sessionId)
          .order("created_at", { ascending: false })
          .limit(30)
      ]);

      const lancers = lancersRes.data || [];
      const logs = logsRes.data || [];

      const tousLesLogs = [
        ...lancers.map(item => ({
          ...item,
          type: "lancer",
          date: item.created_at,
          affichage: `${item.auteur === "MJ" ? "⚔️ MJ" : `🎲 ${item.auteur}`} · d${item.faces} → ${item.total}`,
          status: getStatus(item.valeur, item.bonus, item.total, item.faces, item.seuil, modeCritique)
        })),
        ...logs.map(item => ({
          ...item,
          type: "inventaire",
          date: item.created_at,
          affichage: item.details,
          status: null
        }))
      ];

      tousLesLogs.sort((a, b) => new Date(b.date) - new Date(a.date));
      setActivityLog(tousLesLogs.slice(0, 50));
    } catch (err) {
      console.error("Erreur chargement logs fusionnés:", err);
    } finally {
      setIsLoadingLogs(false);
    }
  }, [sessionId, modeCritique]);

  // 🔄 Chargement initial + websockets
  useEffect(() => {
    if (!sessionId) return;
    
    chargerLogsFusionnes();
    
    const channelLancers = supabase
      .channel(`lancers-mj-${sessionId}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "lancers",
        filter: `session_id=eq.${sessionId}`,
      }, () => chargerLogsFusionnes())
      .subscribe();

    const channelLogs = supabase
      .channel(`logs-inventaire-mj-${sessionId}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "logs_inventaire",
        filter: `session_id=eq.${sessionId}`,
      }, () => chargerLogsFusionnes())
      .subscribe();

    return () => {
      supabase.removeChannel(channelLancers);
      supabase.removeChannel(channelLogs);
    };
  }, [sessionId, chargerLogsFusionnes]);

  // 👥 Chargement des joueurs
  useEffect(() => {
    if (!sessionId) return;
    supabase.from("joueurs").select("*").eq("session_id", sessionId)
      .then(({ data }) => { if (data) setJoueurs(data); });
    
    const channelJoueurs = supabase
      .channel("joueurs-session")
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "joueurs", filter: `session_id=eq.${sessionId}` },
        (payload) => { setJoueurs((prev) => [...prev, payload.new]); }
      ).subscribe();
    return () => supabase.removeChannel(channelJoueurs);
  }, [sessionId]);

  const updateJoueur = async (joueurId, field, value) => {
    const parsed = parseInt(value) || 0;
    setJoueurs((prev) => prev.map((j) => j.id === joueurId ? { ...j, [field]: parsed } : j));
    await supabase.from("joueurs").update({ [field]: parsed }).eq("id", joueurId);
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

  const handleResetComplete = (nouveauCode) => {
    setResetKey(prev => prev + 1);
    setCodeRoom(nouveauCode);
    setJoueurs([]);
    setActivityLog([]);
    setLastRoll(null);
    setConfigDone(false);
    setShowConfigPopup(true);
  };

  const handleConfigComplete = () => {
    setShowConfigPopup(false);
    setConfigDone(true);
  };

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

      {/* 🆕 POPUP CONFIG STATS */}
      {showConfigPopup && sessionId && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(0,0,0,0.85)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 9999,
          padding: 20,
          backdropFilter: "blur(4px)"
        }}>
          <div style={{
            background: "#16213e",
            border: "2px solid #e94560",
            borderRadius: 20,
            padding: "30px",
            maxWidth: 650,
            width: "100%",
            maxHeight: "90vh",
            overflow: "auto",
            boxShadow: "0 20px 60px rgba(0,0,0,0.8)"
          }}>
            <h2 style={{ color: "#e94560", textAlign: "center", marginTop: 0, marginBottom: 8 }}>
              ⚙️ Configuration de la session
            </h2>
            <p style={{ color: "#95a5a6", textAlign: "center", marginBottom: 20, fontSize: 14 }}>
              Définis les stats, leurs dés et les seuils avant de commencer
            </p>
            <ConfigStats 
              sessionId={sessionId} 
              resetKey={resetKey}
              onSave={handleConfigComplete}
              isPopup={true}
            />
            <div style={{ textAlign: "center", marginTop: 16 }}>
              <button 
                onClick={() => {
                  // Vérifier si la config a été sauvegardée
                  supabase
                    .from("config_stats")
                    .select("id")
                    .eq("session_id", sessionId)
                    .maybeSingle()
                    .then(({ data }) => {
                      if (data) {
                        handleConfigComplete();
                      } else {
                        alert("⚠️ Sauvegarde la configuration avant de continuer !");
                      }
                    });
                }}
                style={{
                  background: "#e94560",
                  color: "white",
                  border: "none",
                  padding: "12px 30px",
                  borderRadius: 8,
                  fontWeight: "bold",
                  fontSize: 16,
                  cursor: "pointer"
                }}
              >
                ✅ Démarrer la session
              </button>
              <button 
                onClick={() => setShowConfigPopup(false)}
                style={{
                  background: "transparent",
                  color: "#95a5a6",
                  border: "1px solid #555",
                  padding: "12px 30px",
                  borderRadius: 8,
                  fontWeight: "bold",
                  fontSize: 14,
                  cursor: "pointer",
                  marginLeft: 10
                }}
              >
                Plus tard
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "24px 16px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>

        {/* ── COLONNE GAUCHE ── */}
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
              <ResetPartie 
                sessionId={sessionId}
                onResetComplete={handleResetComplete}
              />
              {/* 🆕 Bouton pour rouvrir ConfigStats */}
              {configDone && (
                <button 
                  onClick={() => setShowConfigPopup(true)}
                  style={{ background: "#0f3460", color: "#f1c40f", border: "1px solid #f1c40f", padding: "6px 14px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}
                >
                  ⚙️ Config
                </button>
              )}
            </div>
          </div>

          {/* Modificateurs */}
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

          {/* Critiques */}
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

          {/* Dés */}
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

        {/* ── COLONNE DROITE ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* 👥 JOUEURS CONNECTÉS AVEC BOUTON "i" */}
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
                  <div key={j.id} style={{ background: "#16213e", border: "1px solid #0f3460", borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: "bold", flex: 1, color: "#4ee44e" }}>⚔️ {j.nom}</span>
                      
                      {/* 🆕 Bouton "i" pour voir la fiche du joueur */}
                      <button 
                        onClick={() => setSelectedJoueur(selectedJoueur?.id === j.id ? null : j)}
                        style={{ 
                          background: selectedJoueur?.id === j.id ? "#e94560" : "#0f3460",
                          color: "white",
                          border: "1px solid #e94560",
                          padding: "4px 10px",
                          borderRadius: 4,
                          cursor: "pointer",
                          fontSize: 12,
                          fontWeight: "bold"
                        }}
                      >
                        {selectedJoueur?.id === j.id ? "✕" : "ℹ️"}
                      </button>
                      
                      <button onClick={() => supprimerJoueur(j.id)} style={{ background: "transparent", color: "#e94560", border: "1px solid #e94560", padding: "4px 8px", borderRadius: 4, cursor: "pointer", fontSize: 11 }}>✕</button>
                    </div>
                    
                    {/* Stats du joueur */}
                    <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap", background: "#1a1a2e", padding: "6px 10px", borderRadius: 6 }}>
                      <label style={{ fontSize: 11, color: "#95a5a6" }}>Bonus</label>
                      <input type="number" value={j.bonus} onChange={(e) => updateJoueur(j.id, "bonus", e.target.value)}
                        style={{ width: 52, background: "#0f3460", border: "1px solid #e94560", color: "white", padding: "4px 6px", borderRadius: 4, textAlign: "center", fontSize: 13, fontWeight: "bold" }}
                      />
                      <label style={{ fontSize: 11, color: "#95a5a6" }}>Seuil</label>
                      <input type="number" value={j.seuil} onChange={(e) => updateJoueur(j.id, "seuil", e.target.value)}
                        style={{ width: 52, background: "#0f3460", border: "1px solid #e94560", color: "white", padding: "4px 6px", borderRadius: 4, textAlign: "center", fontSize: 13, fontWeight: "bold" }}
                      />
                    </div>
                    
                    {/* 🆕 Fiche personnage du joueur (visible si sélectionné) */}
                    {selectedJoueur?.id === j.id && (
                      <div style={{ marginTop: 10, borderTop: "1px solid #0f3460", paddingTop: 10 }}>
                        <FichePersonnage 
                          sessionId={sessionId} 
                          resetKey={resetKey}
                          joueurId={j.id} 
                          joueurNom={j.nom} 
                          isMJ={true} 
                        />
                      </div>
                    )}
                    
                    {/* Envoi d'objet au joueur */}
                    <EnvoiObjetMJ sessionId={sessionId} joueur={j} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 📜 ACTIVITÉ RÉCENTE */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <h3 style={{ color: "#95a5a6", fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: 1, margin: 0 }}>
                📜 Activité récente
              </h3>
              <span style={{ color: "#555", fontSize: 11 }}>↻ auto</span>
            </div>
            <div style={{ background: "#16213e", border: "1px solid #0f3460", borderRadius: 10, maxHeight: 400, overflowY: "auto" }}>
              {isLoadingLogs && activityLog.length === 0 && (
                <div style={{ padding: 20, textAlign: "center", color: "#555" }}>Chargement...</div>
              )}
              {activityLog.length === 0 && !isLoadingLogs && (
                <p style={{ color: "#95a5a6", textAlign: "center", padding: 20, fontSize: 14 }}>Aucune activité récente</p>
              )}
              {activityLog.map((item) => (
                <div key={`${item.type}-${item.id}`} style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "10px 14px",
                  borderBottom: "1px solid #0f3460",
                  gap: 8,
                  background: item.type === "inventaire" ? "rgba(15, 52, 96, 0.3)" : "transparent"
                }}>
                  <span style={{
                    fontSize: 11,
                    color: item.type === "lancer" ? "#e94560" : "#f1c40f",
                    fontWeight: "bold",
                    minWidth: 70,
                    textTransform: "uppercase"
                  }}>
                    {item.type === "lancer" ? "🎲 DÉ" : "📦 INV"}
                  </span>
                  <span style={{ flex: 1, color: "white", fontSize: 13 }}>
                    {item.affichage}
                  </span>
                  {item.status && (
                    <span style={{
                      color: colors[item.status.cls] || "#95a5a6",
                      fontSize: 10,
                      fontWeight: "bold",
                      background: "rgba(0,0,0,0.3)",
                      padding: "2px 8px",
                      borderRadius: 4
                    }}>
                      {item.status.label}
                    </span>
                  )}
                  <span style={{ color: "#555", fontSize: 10, minWidth: 65, textAlign: "right" }}>
                    {new Date(item.date).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* 🌍 INVENTAIRE GLOBAL */}
          <InventaireGlobal
            sessionId={sessionId}
            resetKey={resetKey}
            joueurNom="MJ"
            isMJ={true}
            actif={inventaireGlobalActif}
            onToggle={() => setInventaireGlobalActif(!inventaireGlobalActif)}
          />

        </div>
      </div>
    </div>
  );
}