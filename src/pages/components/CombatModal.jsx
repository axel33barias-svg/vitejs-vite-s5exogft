import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../supabase";

export default function CombatModal({ sessionId, joueurs, joueurId, joueurNom, onClose, isMJ = false }) {

  // ============================================================
  // 🎯 ÉTATS
  // ============================================================
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

  // ============================================================
  // 🔥 CHARGEMENT + CRÉATION AUTOMATIQUE DU COMBAT (MJ)
  // ============================================================
  const chargerCombat = useCallback(async () => {
    if (!sessionId || loading) return;
    setLoading(true);

    try {
      // Vérifier si un combat est déjà en cours
      let { data: combatExistant } = await supabase
        .from("combats")
        .select("*, participants(*), logs_combat(*), effets_passifs(*)")
        .eq("session_id", sessionId)
        .eq("status", "en_cours")
        .maybeSingle();

      // Si le MJ est connecté ET qu'aucun combat n'existe, on en crée un automatiquement
      if (!combatExistant && isMJ) {
        console.log("🔥 Aucun combat trouvé, le MJ en crée un automatiquement...");
        
        const { data: newCombat, error } = await supabase
          .from("combats")
          .insert([{ 
            session_id: sessionId, 
            status: "en_cours", 
            round: 1 
          }])
          .select()
          .single();

        if (error) {
          console.error("❌ Erreur création combat:", error);
          setLoading(false);
          return;
        }

        combatExistant = newCombat;
        setCombat(newCombat);

        // Ajouter tous les joueurs approuvés comme participants
        const joueursApprouves = joueurs.filter(j => j.statut === "approuve");
        
        for (const joueur of joueursApprouves) {
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

        // Ajouter un log de début
        await supabase.from("logs_combat").insert([{
          combat_id: newCombat.id,
          message: `⚔️ Le combat commence ! ${joueursApprouves.length} aventuriers prêts au combat !`,
          auteur: "Système",
          type: "info",
        }]);

        // Recharger le combat fraîchement créé
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
        return;
      }

      // Si un combat existe déjà, on le charge
      if (combatExistant) {
        setCombat(combatExistant);
        setParticipants(combatExistant.participants || []);
        setLogs(combatExistant.logs_combat || []);
        setEffets(combatExistant.effets_passifs || []);
      }
    } catch (err) {
      console.error("❌ Erreur dans chargerCombat:", err);
    }
    
    setLoading(false);
  }, [sessionId, joueurs, isMJ, loading]);

  // ============================================================
  // 🔥 CHARGEMENT INITIAL + WEBSOCKET
  // ============================================================
  useEffect(() => {
    chargerCombat();

    const channel = supabase
      .channel(`combat-${sessionId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "combats", filter: `session_id=eq.${sessionId}` },
        () => {
          // Recharger seulement si le combat change
          chargerCombat();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId]); // 🔥 SEULEMENT sessionId en dépendance

  // ============================================================
  // 🔥 FONCTIONS UTILITAIRES
  // ============================================================
  const ajouterLog = async (message, auteur = "Système", type = "info") => {
    if (!combat) return;
    await supabase.from("logs_combat").insert([{
      combat_id: combat.id,
      message,
      auteur,
      type,
    }]);
    setLogs((prev) => [...prev, { message, auteur, type, created_at: new Date() }]);
  };

  const getNomParticipant = (p) => {
    if (p.type === "joueur") {
      return joueurs.find(j => j.id === p.joueur_id)?.nom || "Joueur";
    } else {
      return monstres.find(m => m.id === p.monstre_id)?.nom || "Monstre";
    }
  };

  const getIconeParticipant = (p) => {
    if (p.type === "joueur") return "⚔️";
    return monstres.find(m => m.id === p.monstre_id)?.icone || "👹";
  };

  // ============================================================
  // 🔥 ACTIONS MJ
  // ============================================================
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
    await chargerCombat();
  };

  const lancerInitiative = async () => {
    const participantsAvecJoueurs = await Promise.all(
      participants.map(async (p) => {
        if (p.type === "joueur") {
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

    const tries = [...participantsAvecJoueurs].sort((a, b) => b.initiative - a.initiative);
    
    for (let i = 0; i < tries.length; i++) {
      await supabase
        .from("participants")
        .update({ position: i })
        .eq("id", tries[i].id);
    }

    await chargerCombat();
    await ajouterLog("⚔️ Les dés d'initiative sont lancés !");
  };

  const passerTour = async () => {
    await supabase
      .from("participants")
      .update({ a_joue: false })
      .eq("combat_id", combat.id);

    const nouveauRound = (combat.round || 1) + 1;
    await supabase
      .from("combats")
      .update({ round: nouveauRound })
      .eq("id", combat.id);

    await chargerCombat();
    await ajouterLog(`🔄 Round ${nouveauRound} - Nouveau tour !`);
  };

  // ============================================================
  // 🔥 ACTIONS DE COMBAT (partagées MJ + Joueurs)
  // ============================================================
  const attaquer = async (attaquant, cible, typeAttaque = "physique") => {
    setLoading(true);
    
    let attaquantNom = getNomParticipant(attaquant);
    let attaquantBonus = 0;
    let degatsDes = "1d6";
    
    if (attaquant.type === "joueur") {
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
      attaquantBonus = monstre?.attaque_bonus || 2;
      degatsDes = monstre?.degats_des || "1d6";
    }

    let cibleNom = getNomParticipant(cible);
    let cibleArmure = 10;
    if (cible.type === "monstre") {
      const monstre = monstres.find(m => m.id === cible.monstre_id);
      cibleArmure = monstre?.armure || 10;
    }

    const jet = Math.floor(Math.random() * 20) + 1;
    const totalAttaque = jet + attaquantBonus;
    const touche = totalAttaque >= cibleArmure;

    let message = "";
    let degats = 0;

    if (touche) {
      const des = degatsDes.split('d');
      const nbDes = parseInt(des[0]) || 1;
      const facesDes = parseInt(des[1]) || 6;
      
      degats = 0;
      for (let i = 0; i < nbDes; i++) {
        degats += Math.floor(Math.random() * facesDes) + 1;
      }
      degats += Math.floor(attaquantBonus / 2);

      let degatsFinals = degats;
      for (const effet of effets) {
        if (effet.actif && effet.type_effet === "resistance_glace" && typeAttaque === "glace") {
          degatsFinals = Math.floor(degatsFinals / 2);
          message += `🧊 Résistance à la glace active ! `;
        }
      }

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

    await supabase
      .from("participants")
      .update({ a_joue: true })
      .eq("id", attaquant.id);

    await ajouterLog(message, attaquantNom, "attaque");
    setSelectedAction(null);
    setSelectedCible(null);
    setLoading(false);
    await chargerCombat();
  };

  const esquiver = async (participant) => {
    await supabase
      .from("participants")
      .update({ a_joue: true })
      .eq("id", participant.id);

    const nom = getNomParticipant(participant);
    await ajouterLog(`🛡️ ${nom} se prépare à esquiver / se défend !`, nom, "defense");
    setSelectedAction(null);
    await chargerCombat();
  };

  const fuir = async (participant) => {
    let bonus = 0;
    let nom = getNomParticipant(participant);
    
    if (participant.type === "joueur") {
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
      bonus = monstre?.agilite || 0;
    }

    const jet = Math.floor(Math.random() * 20) + 1;
    const total = jet + bonus;
    const reussite = total >= 15;

    if (reussite) {
      await ajouterLog(`🏃 ${nom} s'enfuit du combat !`, nom, "info");
      await supabase
        .from("participants")
        .update({ statut: "fui" })
        .eq("id", participant.id);
    } else {
      await ajouterLog(`❌ ${nom} tente de fuir mais échoue ! Jet: ${jet} + ${bonus} = ${total} (besoin de 15)`, nom, "info");
    }

    setSelectedAction(null);
    await chargerCombat();
  };

  // ============================================================
  // 🔥 EXÉCUTION DES ACTIONS DES JOUEURS (MJ uniquement)
  // ============================================================
  useEffect(() => {
    if (!combat || !isMJ) return;

    const channelActions = supabase
      .channel(`actions-combat-${combat.id}`)
      .on("postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "actions_combat",
          filter: `combat_id=eq.${combat.id} AND statut=eq.en_attente`,
        },
        async (payload) => {
          const action = payload.new;
          const participant = participants.find(p => p.id === action.participant_id);
          if (!participant) return;

          if (action.type === "attaque_physique" || action.type === "attaque_magique") {
            const cible = participants.find(p => p.id === action.cible_id);
            if (cible) {
              await attaquer(participant, cible, action.type === "attaque_magique" ? "magie" : "physique");
            }
          } else if (action.type === "esquiver") {
            await esquiver(participant);
          } else if (action.type === "fuir") {
            await fuir(participant);
          }

          await supabase
            .from("actions_combat")
            .update({ statut: "traite" })
            .eq("id", action.id);
        }
      )
      .subscribe();

    return () => supabase.removeChannel(channelActions);
  }, [combat, participants, isMJ]);

  // ============================================================
  // 🔥 ACTION JOUEUR (envoyer une requête au MJ)
  // ============================================================
  const actionJoueur = async (type, cibleId = null) => {
    if (!monJoueur || monJoueur.a_joue) return;

    await supabase.from("actions_combat").insert([{
      combat_id: combat.id,
      participant_id: monJoueur.id,
      type: type,
      cible_id: cibleId,
      statut: "en_attente",
    }]);

    setSelectedAction(null);
    setSelectedCible(null);
  };

  // ============================================================
  // 📊 DONNÉES POUR L'AFFICHAGE
  // ============================================================
  const participantsTries = [...participants]
    .filter(p => p.statut === "vivant" || p.statut === "inconscient")
    .sort((a, b) => b.initiative - a.initiative);

  const participantsVivants = participants.filter(p => p.statut === "vivant");
  
  // Trouver le joueur connecté (pour la vue joueur)
  const monJoueur = !isMJ && joueurId 
    ? participants.find(p => p.joueur_id === joueurId) 
    : null;
  const monTour = monJoueur && !monJoueur.a_joue && monJoueur.statut === "vivant";

  // ============================================================
  // 🖥️ RENDU - CHARGEMENT
  // ============================================================
  if (loading) {
    return (
      <div style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(20, 0, 0, 0.95)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        color: "#ff4444",
        fontSize: 20,
      }}>
        Chargement du combat...
      </div>
    );
  }

  // ============================================================
  // 🖥️ RENDU - AUCUN COMBAT (pour les joueurs uniquement)
  // ============================================================
  if (!combat) {
    return (
      <div style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(20, 0, 0, 0.95)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        flexDirection: "column",
        gap: 16,
      }}>
        <div style={{ color: "#ff4444", fontSize: 48 }}>⚔️</div>
        <div style={{ color: "#ff8888", fontSize: 18 }}>
          {isMJ ? "Création du combat en cours..." : "Aucun combat en cours"}
        </div>
        {!isMJ && (
          <button
            onClick={onClose}
            style={{
              background: "#333",
              color: "#888",
              border: "1px solid #555",
              padding: "10px 30px",
              borderRadius: 8,
              cursor: "pointer",
              fontSize: 14,
              fontWeight: "bold",
            }}
          >
            Fermer
          </button>
        )}
      </div>
    );
  }

  // ============================================================
  // 🖥️ RENDU - COMBAT EN COURS
  // ============================================================
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
          font-size: ${isMJ ? '2rem' : '1.5rem'};
          font-weight: bold;
          text-align: center;
          margin: 0 0 4px 0;
          letter-spacing: 4px;
          text-transform: uppercase;
        }
        .combat-subtitle {
          color: #ff4444;
          text-align: center;
          font-size: 0.9rem;
          margin-bottom: 12px;
          opacity: 0.8;
        }
        .combat-box {
          background: #1a0a0a;
          border: 2px solid #e94560;
          border-radius: 16px;
          max-width: ${isMJ ? '1100px' : '900px'};
          width: 100%;
          max-height: 90vh;
          display: flex;
          flex-direction: column;
          padding: ${isMJ ? '20px 24px' : '16px 20px'};
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
          padding: ${isMJ ? '12px 16px' : '10px 14px'};
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
          padding: ${isMJ ? '12px 16px' : '10px 14px'};
          animation: pulseRed 2s infinite;
        }
        .mon-tour {
          border: 2px solid #ffaa00 !important;
          box-shadow: 0 0 20px rgba(255, 170, 0, 0.3) !important;
        }
        .barre-vie {
          height: ${isMJ ? '8px' : '6px'};
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
          padding: ${isMJ ? '8px 16px' : '6px 14px'};
          border-radius: 6px;
          cursor: pointer;
          font-weight: bold;
          font-size: ${isMJ ? '13px' : '12px'};
          transition: all 0.2s;
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
          padding: ${isMJ ? '8px 16px' : '6px 14px'};
          border-radius: 6px;
          cursor: pointer;
          font-weight: bold;
          font-size: ${isMJ ? '13px' : '12px'};
        }
        .btn-combat-danger:hover {
          background: #ff0000;
          transform: scale(1.05);
        }
        .btn-combat-disabled {
          background: #333;
          color: #666;
          border: 1px solid #444;
          padding: ${isMJ ? '8px 16px' : '6px 14px'};
          border-radius: 6px;
          cursor: not-allowed;
          font-weight: bold;
          font-size: ${isMJ ? '13px' : '12px'};
        }
        .log-entry {
          padding: ${isMJ ? '6px 12px' : '4px 10px'};
          border-bottom: 1px solid #2a0a0a;
          font-size: ${isMJ ? '13px' : '12px'};
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: isMJ ? 12 : 10 }}>
          <div>
            <div className="combat-title">⚔️ {isMJ ? "MODE COMBAT" : "COMBAT"}</div>
            <div className="combat-subtitle">
              {isMJ ? `Round ${combat?.round || 1} • ${participantsVivants.length} combattants` : `Round ${combat?.round || 1}`}
              {!isMJ && monJoueur && ` • ${monJoueur.pv_actuels} PV`}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "1px solid #e94560",
              color: "#e94560",
              fontSize: isMJ ? 16 : 14,
              padding: isMJ ? "6px 14px" : "4px 12px",
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
        <div style={{ display: "grid", gridTemplateColumns: isMJ ? "1fr 1fr" : "1fr 1fr", gap: isMJ ? 16 : 12, flex: 1, overflow: "hidden" }}>

          {/* Colonne gauche : Participants */}
          <div style={{ display: "flex", flexDirection: "column", gap: isMJ ? 10 : 8, overflowY: "auto", paddingRight: 4 }}>
            
            {/* Boutons MJ (uniquement si isMJ) */}
            {isMJ && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                <button onClick={lancerInitiative} className="btn-combat-danger" style={{ padding: "6px 14px", fontSize: 12 }}>
                  🎲 Initiative
                </button>
                <button onClick={passerTour} className="btn-combat-danger" style={{ padding: "6px 14px", fontSize: 12, background: "#ff6b6b" }}>
                  🔄 Nouveau round
                </button>
                <button onClick={() => setShowNewMonstre(!showNewMonstre)} className="btn-combat-danger" style={{ padding: "6px 14px", fontSize: 12, background: "#8b0000" }}>
                  👹 Ajouter un monstre
                </button>
              </div>
            )}

            {/* Formulaire nouveau monstre (MJ uniquement) */}
            {isMJ && showNewMonstre && (
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

            {/* Statut du joueur (vue joueur uniquement) */}
            {!isMJ && monJoueur && (
              <div style={{
                background: monTour ? "#3a2a0a" : "#1a0a0a",
                border: monTour ? "2px solid #ffaa00" : "1px solid #333",
                borderRadius: 8,
                padding: "8px 12px",
                textAlign: "center",
                marginBottom: 4,
              }}>
                <span style={{ color: monTour ? "#ffaa00" : "#666", fontWeight: "bold", fontSize: 13 }}>
                  {monTour ? "🎯 À ton tour !" : "⏳ En attente..."}
                </span>
              </div>
            )}

            {/* Liste des participants */}
            <div style={{ display: "flex", flexDirection: "column", gap: isMJ ? 6 : 4 }}>
              {participantsTries.map((p) => {
                const estJoueur = p.type === "joueur";
                const estMoi = !isMJ && p.joueur_id === joueurId;
                const estVivant = p.statut === "vivant";
                const estMort = p.statut === "mort";
                const estFui = p.statut === "fui";
                const nom = getNomParticipant(p);
                const icone = getIconeParticipant(p);
                const pvRatio = p.pv_actuels / p.pv_max * 100;

                let borderColor = estJoueur ? "#e94560" : "#ff0000";
                if (estMoi) borderColor = "#ffaa00";
                if (estMort) borderColor = "#660000";
                if (estFui) borderColor = "#444";

                return (
                  <div 
                    key={p.id} 
                    className={estJoueur ? "joueur-card" : "monstre-card"} 
                    style={{
                      opacity: estFui ? 0.4 : 1,
                      borderColor: borderColor,
                      ...(estMoi ? { borderWidth: "2px", borderColor: "#ffaa00" } : {}),
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontWeight: "bold", color: estMoi ? "#ffaa00" : estJoueur ? "#ff6666" : "#ff0000" }}>
                        {icone} {nom}
                        {estFui && " 🏃"}
                        {estMort && " 💀"}
                        {!estVivant && !estMort && !estFui && " ⚰️"}
                        {estMoi && " 👈"}
                      </span>
                      <span style={{ fontSize: isMJ ? 13 : 12, color: "#ff8888" }}>
                        {p.pv_actuels} / {p.pv_max} PV
                        {isMJ && p.type === "joueur" && <span style={{ marginLeft: 8, color: "#ffaa44", fontSize: 11 }}>Init: {p.initiative}</span>}
                      </span>
                    </div>
                    <div className="barre-vie">
                      <div className="barre-vie-remplie" style={{ width: `${Math.max(0, pvRatio)}%` }} />
                    </div>

                    {/* Actions (MJ) */}
                    {isMJ && estVivant && p.type === "joueur" && !p.a_joue && (
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

                    {isMJ && p.a_joue && (
                      <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>✅ A déjà joué ce tour</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Colonne droite : Logs */}
          <div style={{ display: "flex", flexDirection: "column", gap: isMJ ? 8 : 6 }}>
            
            {/* Actions du joueur (vue joueur uniquement) */}
            {!isMJ && monJoueur && monTour && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                <button
                  onClick={() => {
                    const cibles = participantsTries.filter(p => p.id !== monJoueur.id && p.statut === "vivant");
                    if (cibles.length > 0) {
                      setSelectedAction({ type: "attaque_physique" });
                      setSelectedCible(cibles[0]);
                    }
                  }}
                  className="btn-combat-danger"
                  style={{ fontSize: 11, padding: "4px 10px" }}
                >
                  ⚔️ Attaquer
                </button>
                <button
                  onClick={() => {
                    const cibles = participantsTries.filter(p => p.id !== monJoueur.id && p.statut === "vivant");
                    if (cibles.length > 0) {
                      setSelectedAction({ type: "attaque_magique" });
                      setSelectedCible(cibles[0]);
                    }
                  }}
                  className="btn-combat"
                  style={{ fontSize: 11, padding: "4px 10px" }}
                >
                  🔮 Magie
                </button>
                <button
                  onClick={() => actionJoueur("esquiver")}
                  className="btn-combat"
                  style={{ fontSize: 11, padding: "4px 10px" }}
                >
                  🛡️ Esquiver
                </button>
                <button
                  onClick={() => actionJoueur("fuir")}
                  className="btn-combat"
                  style={{ fontSize: 11, padding: "4px 10px", borderColor: "#ffaa44", color: "#ffaa44" }}
                >
                  🏃 Fuir
                </button>
              </div>
            )}

            {!isMJ && monJoueur && monJoueur.a_joue && (
              <div style={{ fontSize: 12, color: "#666", textAlign: "center" }}>
                ✅ Tu as déjà joué ce tour
              </div>
            )}

            {/* Sélection de cible */}
            {selectedAction && selectedCible && (
              <div style={{ background: "#2a0a0a", border: "1px solid #e94560", borderRadius: 8, padding: isMJ ? 12 : 10 }}>
                <div style={{ color: "#ff4444", fontSize: isMJ ? 13 : 12, marginBottom: isMJ ? 8 : 6 }}>
                  🎯 Choisissez une cible :
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {participantsTries
                    .filter(p => p.id !== (isMJ ? selectedAction.participant?.id : monJoueur.id) && p.statut === "vivant")
                    .map((cible) => {
                      const nomCible = getNomParticipant(cible);
                      return (
                        <button
                          key={cible.id}
                          onClick={() => {
                            if (isMJ) {
                              attaquer(selectedAction.participant, cible, selectedAction.type === "attaque_magique" ? "magie" : "physique");
                            } else {
                              const typeAction = selectedAction.type === "attaque_magique" ? "attaque_magique" : "attaque_physique";
                              actionJoueur(typeAction, cible.id);
                            }
                          }}
                          style={{
                            background: "#1a0a0a",
                            border: "1px solid #e94560",
                            color: "#ff6666",
                            padding: isMJ ? "6px 12px" : "4px 10px",
                            borderRadius: 6,
                            cursor: "pointer",
                            fontSize: isMJ ? 12 : 11,
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
                    marginTop: isMJ ? 8 : 6,
                    background: "transparent",
                    border: "1px solid #555",
                    color: "#888",
                    padding: isMJ ? "4px 12px" : "2px 10px",
                    borderRadius: 4,
                    cursor: "pointer",
                    fontSize: isMJ ? 11 : 10,
                  }}
                >
                  Annuler
                </button>
              </div>
            )}

            {/* Logs */}
            <div style={{
              flex: 1,
              overflowY: "auto",
              background: "#0a0000",
              border: "1px solid #2a0a0a",
              borderRadius: 8,
              padding: "4px 0",
              maxHeight: isMJ ? 400 : 250,
            }}>
              {logs.length === 0 ? (
                <div style={{ color: "#555", textAlign: "center", padding: isMJ ? 20 : 16, fontSize: isMJ ? 13 : 12 }}>
                  Le combat commence...
                </div>
              ) : (
                (isMJ ? logs : logs.slice(-20)).map((log, index) => (
                  <div key={index} className="log-entry">
                    <span className="auteur">{log.auteur || "Système"}</span>
                    <span className={log.type || "info"}> {log.message}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}