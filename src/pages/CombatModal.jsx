import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../supabase";

const STATS = ["force", "agilite", "discretion", "intelligence", "perception", "charisme", "mental", "vitalite"];
const STAT_ICONS = { force: "💪", agilite: "🏃", discretion: "🕵️", intelligence: "🧠", perception: "👁️", charisme: "🗣️", mental: "🧘", vitalite: "❤️" };

export default function CombatModal({ sessionId, joueurs, onClose, isMJ = false }) {
  const [combat, setCombat] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [monstres, setMonstres] = useState([]);
  const [logs, setLogs] = useState([]);
  const [effets, setEffets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedAction, setSelectedAction] = useState(null);
  const [selectedCible, setSelectedCible] = useState(null);
  const [showNewMonstre, setShowNewMonstre] = useState(false);
  const [nouveauMonstre, setNouveauMonstre] = useState({
    nom: "",
    pv_max: 30,
    force: 3,
    agilite: 3,
    armure: 10,
    attaque_bonus: 2,
    degats_des: "1d6",
    icone: "👹",
  });

  // 🔥 Créer ou charger un combat
  useEffect(() => {
    const initCombat = async () => {
      setLoading(true);
      
      // Vérifier si un combat est déjà en cours
      const { data: combatExistant } = await supabase
        .from("combats")
        .select("*, participants(*), logs_combat(*), effets_passifs(*)")
        .eq("session_id", sessionId)
        .eq("status", "en_cours")
        .maybeSingle();

      if (combatExistant) {
        setCombat(combatExistant);
        setParticipants(combatExistant.participants || []);
        setLogs(combatExistant.logs_combat || []);
        setEffets(combatExistant.effets_passifs || []);
        setLoading(false);
        return;
      }

      // Créer un nouveau combat
      const { data: newCombat, error } = await supabase
        .from("combats")
        .insert([{ session_id: sessionId, status: "en_cours", round: 1 }])
        .select()
        .single();

      if (error) {
        console.error("Erreur création combat:", error);
        setLoading(false);
        return;
      }

      setCombat(newCombat);
      
      // Ajouter les joueurs comme participants
      for (const joueur of joueurs) {
        if (joueur.statut === "approuve") {
          // Récupérer la fiche du joueur
          const { data: fiche } = await supabase
            .from("personnages")
            .select("stats_personnage(*)")
            .eq("joueur_id", joueur.id)
            .eq("session_id", sessionId)
            .maybeSingle();

          const stats = fiche?.stats_personnage?.[0] || {};
          const pvBase = stats.vitalite ? stats.vitalite * 5 + 10 : 30;

          await supabase.from("participants").insert([{
            combat_id: newCombat.id,
            joueur_id: joueur.id,
            type: "joueur",
            initiative: 0,
            pv_max: pvBase,
            pv_actuels: pvBase,
            statut: "vivant",
            a_joue: false,
          }]);
        }
      }

      // Recharger tout
      const { data: reload } = await supabase
        .from("combats")
        .select("*, participants(*), logs_combat(*), effets_passifs(*)")
        .eq("id", newCombat.id)
        .single();

      if (reload) {
        setCombat(reload);
        setParticipants(reload.participants || []);
        setLogs(reload.logs_combat || []);
        setEffets(reload.effets_passifs || []);
      }
      
      setLoading(false);
    };

    if (sessionId) initCombat();

    // WebSocket pour les mises à jour
    const channel = supabase
      .channel(`combat-${sessionId}`)
      .on("postgres_changes", 
        { event: "*", schema: "public", table: "combats", filter: `session_id=eq.${sessionId}` },
        () => {
          // Recharger le combat
        }
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [sessionId, joueurs]);

  // 🔥 Ajouter un monstre
  const ajouterMonstre = async () => {
    if (!nouveauMonstre.nom.trim()) return;
    
    const { data: monstre, error } = await supabase
      .from("monstres")
      .insert([{
        session_id: sessionId,
        ...nouveauMonstre,
        pv_actuels: nouveauMonstre.pv_max,
      }])
      .select()
      .single();

    if (error) {
      console.error("Erreur création monstre:", error);
      return;
    }

    // Ajouter le monstre au combat
    await supabase.from("participants").insert([{
      combat_id: combat.id,
      monstre_id: monstre.id,
      type: "monstre",
      initiative: 0,
      pv_max: monstre.pv_max,
      pv_actuels: monstre.pv_actuels,
      statut: "vivant",
      a_joue: false,
    }]);

    await ajouterLog(`👹 ${monstre.nom} apparaît dans le combat !`);
    setMonstres((prev) => [...prev, monstre]);
    setShowNewMonstre(false);
    setNouveauMonstre({
      nom: "",
      pv_max: 30,
      force: 3,
      agilite: 3,
      armure: 10,
      attaque_bonus: 2,
      degats_des: "1d6",
      icone: "👹",
    });
  };

  // 🔥 Ajouter un log
  const ajouterLog = async (message, auteur = "Système", type = "info") => {
    await supabase.from("logs_combat").insert([{
      combat_id: combat.id,
      message,
      auteur,
      type,
    }]);
    setLogs((prev) => [...prev, { message, auteur, type, created_at: new Date() }]);
  };

  // 🔥 Lancer l'initiative
  const lancerInitiative = async () => {
    const participantsAvecJoueurs = await Promise.all(
      participants.map(async (p) => {
        if (p.type === "joueur") {
          // Lancer un d20 + agilité
          const joueur = joueurs.find(j => j.id === p.joueur_id);
          const { data: fiche } = await supabase
            .from("personnages")
            .select("stats_personnage(*)")
            .eq("joueur_id", p.joueur_id)
            .eq("session_id", sessionId)
            .maybeSingle();
          
          const stats = fiche?.stats_personnage?.[0] || {};
          const agilite = stats.agilite || 0;
          const jet = Math.floor(Math.random() * 20) + 1;
          const initiative = jet + agilite;
          
          await supabase
            .from("participants")
            .update({ initiative })
            .eq("id", p.id);
          
          return { ...p, initiative, nom: joueur?.nom || "Joueur" };
        } else {
          // Initiative aléatoire pour les monstres
          const initiative = Math.floor(Math.random() * 20) + 1;
          await supabase
            .from("participants")
            .update({ initiative })
            .eq("id", p.id);
          
          const monstre = monstres.find(m => m.id === p.monstre_id);
          return { ...p, initiative, nom: monstre?.nom || "Monstre" };
        }
      })
    );

    // Trier par initiative
    const tries = [...participantsAvecJoueurs].sort((a, b) => b.initiative - a.initiative);
    
    // Mettre à jour l'ordre
    for (let i = 0; i < tries.length; i++) {
      await supabase
        .from("participants")
        .update({ position: i })
        .eq("id", tries[i].id);
    }

    // Recharger
    const { data: reload } = await supabase
      .from("combats")
      .select("*, participants(*), logs_combat(*), effets_passifs(*)")
      .eq("id", combat.id)
      .single();

    if (reload) {
      setParticipants(reload.participants || []);
    }

    await ajouterLog("⚔️ Les dés d'initiative sont lancés !");
  };

  // 🔥 Tour de jeu
  const passerTour = async () => {
    // Réinitialiser a_joue pour tous
    await supabase
      .from("participants")
      .update({ a_joue: false })
      .eq("combat_id", combat.id);

    // Passer au round suivant
    const nouveauRound = (combat.round || 1) + 1;
    await supabase
      .from("combats")
      .update({ round: nouveauRound })
      .eq("id", combat.id);

    setCombat((prev) => ({ ...prev, round: nouveauRound }));
    await ajouterLog(`🔄 Round ${nouveauRound} - Nouveau tour !`);
  };

  // 🔥 Action : Attaquer
  const attaquer = async (attaquant, cible, typeAttaque = "physique") => {
    setLoading(true);
    
    // Récupérer les stats de l'attaquant
    let attaquantNom = "Monstre";
    let attaquantBonus = 0;
    let degatsDes = "1d6";
    
    if (attaquant.type === "joueur") {
      const joueur = joueurs.find(j => j.id === attaquant.joueur_id);
      attaquantNom = joueur?.nom || "Joueur";
      
      const { data: fiche } = await supabase
        .from("personnages")
        .select("stats_personnage(*)")
        .eq("joueur_id", attaquant.joueur_id)
        .eq("session_id", sessionId)
        .maybeSingle();
      
      const stats = fiche?.stats_personnage?.[0] || {};
      const force = stats.force || 0;
      attaquantBonus = force;
      degatsDes = typeAttaque === "physique" ? "1d6" : "1d8";
    } else {
      const monstre = monstres.find(m => m.id === attaquant.monstre_id);
      attaquantNom = monstre?.nom || "Monstre";
      attaquantBonus = monstre?.attaque_bonus || 2;
      degatsDes = monstre?.degats_des || "1d6";
    }

    // Cible
    let cibleNom = "Inconnue";
    let cibleArmure = 10;
    
    if (cible.type === "joueur") {
      const joueur = joueurs.find(j => j.id === cible.joueur_id);
      cibleNom = joueur?.nom || "Joueur";
      cibleArmure = 10; // À définir selon les stats
    } else {
      const monstre = monstres.find(m => m.id === cible.monstre_id);
      cibleNom = monstre?.nom || "Monstre";
      cibleArmure = monstre?.armure || 10;
    }

    // Jet d'attaque
    const jet = Math.floor(Math.random() * 20) + 1;
    const totalAttaque = jet + attaquantBonus;
    const touche = totalAttaque >= cibleArmure;

    let message = "";
    let degats = 0;

    if (touche) {
      // Calcul des dégâts
      const des = degatsDes.split('d');
      const nbDes = parseInt(des[0]) || 1;
      const facesDes = parseInt(des[1]) || 6;
      
      degats = 0;
      for (let i = 0; i < nbDes; i++) {
        degats += Math.floor(Math.random() * facesDes) + 1;
      }
      degats += Math.floor(attaquantBonus / 2); // Bonus de force réduit

      // 🧊 VÉRIFICATION DES EFFETS PASSIFS
      let degatsFinals = degats;
      // Vérifier les effets de résistance
      for (const effet of effets) {
        if (effet.actif && effet.type_effet === "resistance_glace" && typeAttaque === "glace") {
          degatsFinals = Math.floor(degatsFinals / 2);
          message += `🧊 Résistance à la glace active ! Dégâts réduits de moitié. `;
        }
      }

      // Mettre à jour les PV
      const nouveauxPv = cible.pv_actuels - degatsFinals;
      await supabase
        .from("participants")
        .update({ pv_actuels: Math.max(0, nouveauxPv) })
        .eq("id", cible.id);

      if (nouveauxPv <= 0) {
        await supabase
          .from("participants")
          .update({ statut: "mort" })
          .eq("id", cible.id);
      }

      message += `⚔️ ${attaquantNom} attaque ${cibleNom} ! Jet: ${jet} + ${attaquantBonus} = ${totalAttaque} (touché !) Dégâts: ${degatsFinals}`;
      
      if (nouveauxPv <= 0) {
        message += ` 💀 ${cibleNom} est vaincu(e) !`;
      }
    } else {
      message += `⚔️ ${attaquantNom} attaque ${cibleNom} ! Jet: ${jet} + ${attaquantBonus} = ${totalAttaque} (raté !)`;
    }

    // Marquer comme ayant joué
    await supabase
      .from("participants")
      .update({ a_joue: true })
      .eq("id", attaquant.id);

    await ajouterLog(message, attaquantNom, "attaque");
    setSelectedAction(null);
    setSelectedCible(null);
    setLoading(false);

    // Recharger les participants
    const { data: reload } = await supabase
      .from("combats")
      .select("*, participants(*), logs_combat(*), effets_passifs(*)")
      .eq("id", combat.id)
      .single();

    if (reload) {
      setParticipants(reload.participants || []);
      setLogs(reload.logs_combat || []);
    }
  };

  // 🔥 Action : Esquiver / Défendre
  const esquiver = async (participant) => {
    await supabase
      .from("participants")
      .update({ a_joue: true })
      .eq("id", participant.id);

    const nom = participant.type === "joueur" 
      ? joueurs.find(j => j.id === participant.joueur_id)?.nom || "Joueur"
      : monstres.find(m => m.id === participant.monstre_id)?.nom || "Monstre";

    await ajouterLog(`🛡️ ${nom} se prépare à esquiver / se défend !`, nom, "defense");
    setSelectedAction(null);
  };

  // 🔥 Action : Fuir
  const fuir = async (participant) => {
    // Jet de fuite (d20 + agilité)
    let bonus = 0;
    let nom = "";
    
    if (participant.type === "joueur") {
      const joueur = joueurs.find(j => j.id === participant.joueur_id);
      nom = joueur?.nom || "Joueur";
      
      const { data: fiche } = await supabase
        .from("personnages")
        .select("stats_personnage(*)")
        .eq("joueur_id", participant.joueur_id)
        .eq("session_id", sessionId)
        .maybeSingle();
      
      const stats = fiche?.stats_personnage?.[0] || {};
      bonus = stats.agilite || 0;
    } else {
      const monstre = monstres.find(m => m.id === participant.monstre_id);
      nom = monstre?.nom || "Monstre";
      bonus = monstre?.agilite || 0;
    }

    const jet = Math.floor(Math.random() * 20) + 1;
    const total = jet + bonus;
    const reussite = total >= 15;

    if (reussite) {
      await ajouterLog(`🏃 ${nom} s'enfuit du combat !`, nom, "info");
      
      if (participant.type === "joueur") {
        // Le joueur quitte le combat
        await supabase
          .from("participants")
          .update({ statut: "fui" })
          .eq("id", participant.id);
      } else {
        // Le monstre disparaît
        await supabase
          .from("participants")
          .update({ statut: "fui" })
          .eq("id", participant.id);
      }
    } else {
      await ajouterLog(`❌ ${nom} tente de fuir mais échoue ! Jet: ${jet} + ${bonus} = ${total} (besoin de 15)`, nom, "info");
    }

    setSelectedAction(null);
  };

  // 🔥 Ajouter un effet passif
  const ajouterEffet = async (joueurId, typeEffet, nom, description, valeur, duree = 1) => {
    await supabase
      .from("effets_passifs")
      .insert([{
        combat_id: combat.id,
        joueur_id: joueurId,
        nom,
        description,
        type_effet: typeEffet,
        valeur,
        duree,
        actif: true,
      }]);

    const joueur = joueurs.find(j => j.id === joueurId);
    await ajouterLog(`✨ ${nom} appliqué à ${joueur?.nom || "un joueur"} !`, "MJ", "effet");
  };

  // Participants triés par initiative
  const participantsTries = [...participants]
    .filter(p => p.statut === "vivant" || p.statut === "inconscient")
    .sort((a, b) => b.initiative - a.initiative);

  const participantsVivants = participants.filter(p => p.statut === "vivant");

  return (
    <div style={{
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: "rgba(20, 0, 0, 0.95)",
      backdropFilter: "blur(8px)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 9999,
      padding: 20,
      animation: "fadeInCombat 0.3s ease",
      fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
    }}>
      <style>{`
        @keyframes fadeInCombat {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes pulseRed {
          0%, 100% { border-color: #e94560; }
          50% { border-color: #ff6b6b; }
        }
        .combat-title {
          color: #ff0000;
          text-shadow: 0 0 20px #ff000066;
          font-size: 2rem;
          font-weight: bold;
          text-align: center;
          margin: 0 0 8px 0;
          letter-spacing: 4px;
          text-transform: uppercase;
        }
        .combat-subtitle {
          color: #ff4444;
          text-align: center;
          font-size: 0.9rem;
          margin-bottom: 16px;
          opacity: 0.8;
        }
        .combat-box {
          background: #1a0a0a;
          border: 2px solid #e94560;
          border-radius: 16px;
          max-width: 1100px;
          width: 100%;
          max-height: 90vh;
          display: flex;
          flex-direction: column;
          padding: 20px 24px;
          box-shadow: 0 0 60px rgba(233, 69, 96, 0.2);
          position: relative;
        }
        .combat-box::before {
          content: '';
          position: absolute;
          top: -2px;
          left: -2px;
          right: -2px;
          bottom: -2px;
          border-radius: 18px;
          background: linear-gradient(45deg, #e94560, #ff0000, #e94560);
          background-size: 300% 300%;
          animation: gradientBorder 3s ease infinite;
          z-index: -1;
          opacity: 0.3;
        }
        @keyframes gradientBorder {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        .joueur-card {
          background: #2a0a0a;
          border: 1px solid #e94560;
          border-radius: 10px;
          padding: 12px 16px;
          transition: all 0.3s;
        }
        .joueur-card:hover {
          border-color: #ff4444;
          box-shadow: 0 0 20px rgba(233, 69, 96, 0.2);
        }
        .monstre-card {
          background: #1a0505;
          border: 2px solid #ff0000;
          border-radius: 10px;
          padding: 12px 16px;
          animation: pulseRed 2s infinite;
        }
        .barre-vie {
          height: 8px;
          background: #2a0a0a;
          border-radius: 4px;
          overflow: hidden;
          margin-top: 4px;
        }
        .barre-vie-remplie {
          height: 100%;
          border-radius: 4px;
          transition: width 0.5s ease;
          background: linear-gradient(90deg, #ff0000, #ff4444);
        }
        .btn-combat {
          background: #2a0a0a;
          color: #ff4444;
          border: 1px solid #e94560;
          padding: "8px 16px";
          borderRadius: 6;
          cursor: "pointer";
          font-weight: "bold";
          fontSize: 13;
          transition: "all 0.2s";
        }
        .btn-combat:hover {
          background: #e94560;
          color: white;
          transform: scale(1.05);
        }
        .btn-combat-danger {
          background: #e94560;
          color: white;
          border: 1px solid #ff0000;
          padding: "8px 16px";
          borderRadius: 6;
          cursor: "pointer";
          font-weight: "bold";
          fontSize: 13;
        }
        .btn-combat-danger:hover {
          background: #ff0000;
          transform: scale(1.05);
        }
        .log-entry {
          padding: 6px 12px;
          border-bottom: 1px solid #2a0a0a;
          font-size: 13px;
          color: #ff8888;
        }
        .log-entry .auteur {
          color: #ff4444;
          font-weight: bold;
        }
        .log-entry .attaque { color: #ff6666; }
        .log-entry .defense { color: #ffaa44; }
        .log-entry .effet { color: #aa66ff; }
        .log-entry .info { color: #66aaff; }
      `}</style>

      <div className="combat-box">
        {/* En-tête */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div>
            <div className="combat-title">⚔️ MODE COMBAT</div>
            <div className="combat-subtitle">Round {combat?.round || 1} • {participantsVivants.length} combattants</div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "1px solid #e94560",
              color: "#e94560",
              fontSize: 16,
              padding: "6px 14px",
              borderRadius: 6,
              cursor: "pointer",
              fontWeight: "bold",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#e94560"; e.currentTarget.style.color = "white"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#e94560"; }}
          >
            ✕ Fermer
          </button>
        </div>

        {/* Contenu principal */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, flex: 1, overflow: "hidden" }}>

          {/* Colonne gauche : Participants */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10, overflowY: "auto", paddingRight: 4 }}>
            
            {/* Boutons MJ */}
            {isMJ && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                <button
                  onClick={lancerInitiative}
                  style={{ background: "#e94560", color: "white", border: "none", padding: "6px 14px", borderRadius: 6, cursor: "pointer", fontWeight: "bold", fontSize: 12 }}
                >
                  🎲 Initiative
                </button>
                <button
                  onClick={passerTour}
                  style={{ background: "#ff6b6b", color: "white", border: "none", padding: "6px 14px", borderRadius: 6, cursor: "pointer", fontWeight: "bold", fontSize: 12 }}
                >
                  🔄 Nouveau round
                </button>
                <button
                  onClick={() => setShowNewMonstre(!showNewMonstre)}
                  style={{ background: "#8b0000", color: "white", border: "none", padding: "6px 14px", borderRadius: 6, cursor: "pointer", fontWeight: "bold", fontSize: 12 }}
                >
                  👹 Ajouter un monstre
                </button>
              </div>
            )}

            {/* Formulaire nouveau monstre */}
            {showNewMonstre && isMJ && (
              <div style={{ background: "#2a0a0a", border: "1px solid #e94560", borderRadius: 8, padding: 12, marginBottom: 8 }}>
                <input
                  value={nouveauMonstre.nom}
                  onChange={(e) => setNouveauMonstre({ ...nouveauMonstre, nom: e.target.value })}
                  placeholder="Nom du monstre"
                  style={{ width: "100%", background: "#1a0a0a", border: "1px solid #e94560", color: "white", padding: "6px 10px", borderRadius: 4, marginBottom: 6, outline: "none" }}
                />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                  <input
                    type="number"
                    value={nouveauMonstre.pv_max}
                    onChange={(e) => setNouveauMonstre({ ...nouveauMonstre, pv_max: parseInt(e.target.value) || 30 })}
                    placeholder="PV"
                    style={{ background: "#1a0a0a", border: "1px solid #e94560", color: "white", padding: "4px 8px", borderRadius: 4, outline: "none" }}
                  />
                  <input
                    value={nouveauMonstre.icone}
                    onChange={(e) => setNouveauMonstre({ ...nouveauMonstre, icone: e.target.value })}
                    placeholder="Icône"
                    style={{ background: "#1a0a0a", border: "1px solid #e94560", color: "white", padding: "4px 8px", borderRadius: 4, outline: "none" }}
                  />
                </div>
                <button
                  onClick={ajouterMonstre}
                  style={{ width: "100%", background: "#e94560", color: "white", border: "none", padding: "6px", borderRadius: 4, cursor: "pointer", fontWeight: "bold", marginTop: 6 }}
                >
                  ✅ Ajouter
                </button>
              </div>
            )}

            {/* Liste des participants */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {participantsTries.map((p) => {
                const estJoueur = p.type === "joueur";
                const estVivant = p.statut === "vivant";
                const estMort = p.statut === "mort";
                const estFui = p.statut === "fui";
                const nom = estJoueur 
                  ? joueurs.find(j => j.id === p.joueur_id)?.nom || "Joueur"
                  : monstres.find(m => m.id === p.monstre_id)?.nom || "Monstre";
                const icone = estJoueur ? "⚔️" : monstres.find(m => m.id === p.monstre_id)?.icone || "👹";
                const pvRatio = p.pv_actuels / p.pv_max * 100;

                return (
                  <div key={p.id} className={estJoueur ? "joueur-card" : "monstre-card"} style={{
                    opacity: estFui ? 0.4 : 1,
                    borderColor: estMort ? "#660000" : undefined,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontWeight: "bold", color: estJoueur ? "#ff6666" : "#ff0000" }}>
                        {icone} {nom}
                        {estFui && " 🏃"}
                        {estMort && " 💀"}
                        {!estVivant && !estMort && !estFui && " ⚰️"}
                      </span>
                      <span style={{ fontSize: 13, color: "#ff8888" }}>
                        {p.pv_actuels} / {p.pv_max} PV
                        {p.type === "joueur" && <span style={{ marginLeft: 8, color: "#ffaa44", fontSize: 11 }}>Init: {p.initiative}</span>}
                      </span>
                    </div>
                    <div className="barre-vie">
                      <div className="barre-vie-remplie" style={{ width: `${Math.max(0, pvRatio)}%` }} />
                    </div>

                    {/* Actions (si c'est le tour du joueur) */}
                    {estVivant && p.type === "joueur" && !p.a_joue && isMJ && (
                      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                        <button
                          onClick={() => {
                            setSelectedAction({ type: "attaque_physique", participant: p });
                            setSelectedCible(participantsTries.find(c => c.id !== p.id && c.statut === "vivant"));
                          }}
                          className="btn-combat-danger"
                          style={{ fontSize: 11, padding: "4px 10px" }}
                        >
                          ⚔️ Attaquer
                        </button>
                        <button
                          onClick={() => {
                            setSelectedAction({ type: "attaque_magique", participant: p });
                            setSelectedCible(participantsTries.find(c => c.id !== p.id && c.statut === "vivant"));
                          }}
                          className="btn-combat"
                          style={{ fontSize: 11, padding: "4px 10px" }}
                        >
                          🔮 Magie
                        </button>
                        <button
                          onClick={() => esquiver(p)}
                          className="btn-combat"
                          style={{ fontSize: 11, padding: "4px 10px" }}
                        >
                          🛡️ Esquiver
                        </button>
                        <button
                          onClick={() => fuir(p)}
                          className="btn-combat"
                          style={{ fontSize: 11, padding: "4px 10px", borderColor: "#ffaa44", color: "#ffaa44" }}
                        >
                          🏃 Fuir
                        </button>
                      </div>
                    )}

                    {p.a_joue && isMJ && (
                      <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>✅ A déjà joué ce tour</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Colonne droite : Logs */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <h4 style={{ color: "#ff4444", margin: 0, fontSize: 14, textTransform: "uppercase", letterSpacing: 1 }}>
              📜 Journal de combat
            </h4>
            <div style={{
              flex: 1,
              overflowY: "auto",
              background: "#0a0000",
              border: "1px solid #2a0a0a",
              borderRadius: 8,
              padding: "4px 0",
              maxHeight: 400,
            }}>
              {logs.length === 0 ? (
                <div style={{ color: "#555", textAlign: "center", padding: 20, fontSize: 13 }}>
                  Le combat commence...
                </div>
              ) : (
                logs.map((log, index) => (
                  <div key={index} className="log-entry">
                    <span className="auteur">{log.auteur || "Système"}</span>
                    <span className={log.type || "info"}> {log.message}</span>
                  </div>
                ))
              )}
            </div>

            {/* Sélection de cible pour attaque */}
            {selectedAction && selectedCible && (
              <div style={{ background: "#2a0a0a", border: "1px solid #e94560", borderRadius: 8, padding: 12 }}>
                <div style={{ color: "#ff4444", fontSize: 13, marginBottom: 8 }}>
                  🎯 Choisissez une cible pour l'attaque de {selectedAction.participant.type === "joueur" 
                    ? joueurs.find(j => j.id === selectedAction.participant.joueur_id)?.nom || "Joueur"
                    : "Monstre"}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {participantsTries
                    .filter(p => p.id !== selectedAction.participant.id && p.statut === "vivant")
                    .map((cible) => {
                      const nomCible = cible.type === "joueur" 
                        ? joueurs.find(j => j.id === cible.joueur_id)?.nom || "Joueur"
                        : monstres.find(m => m.id === cible.monstre_id)?.nom || "Monstre";
                      return (
                        <button
                          key={cible.id}
                          onClick={() => {
                            attaquer(selectedAction.participant, cible, selectedAction.type === "attaque_magique" ? "magie" : "physique");
                          }}
                          style={{
                            background: "#1a0a0a",
                            border: "1px solid #e94560",
                            color: "#ff6666",
                            padding: "6px 12px",
                            borderRadius: 6,
                            cursor: "pointer",
                            fontSize: 12,
                            fontWeight: "bold",
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = "#e94560"; e.currentTarget.style.color = "white"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = "#1a0a0a"; e.currentTarget.style.color = "#ff6666"; }}
                        >
                          {nomCible} ({cible.pv_actuels} PV)
                        </button>
                      );
                    })}
                </div>
                <button
                  onClick={() => { setSelectedAction(null); setSelectedCible(null); }}
                  style={{
                    marginTop: 8,
                    background: "transparent",
                    border: "1px solid #555",
                    color: "#888",
                    padding: "4px 12px",
                    borderRadius: 4,
                    cursor: "pointer",
                    fontSize: 11,
                  }}
                >
                  Annuler
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}