import { useState } from "react";
import { supabase } from "../supabase";

const styles = {
  app: {
    minHeight: "100vh",
    background: "#1a1a2e",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
  },
  container: {
    maxWidth: 400,
    width: "90%",
    background: "#16213e",
    padding: 30,
    borderRadius: 15,
    boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
    border: "1px solid #0f3460",
    textAlign: "center",
  },
  h1: { color: "#e94560", marginTop: 0, fontSize: "1.8rem" },
  subtitle: { color: "#95a5a6", fontSize: "0.9rem", marginBottom: 24 },
  tabs: { display: "flex", marginBottom: 20, borderRadius: 8, overflow: "hidden" },
  tab: (active) => ({
    flex: 1, padding: "10px 0", border: "none", cursor: "pointer",
    fontWeight: "bold", fontSize: 14,
    background: active ? "#e94560" : "#0f3460",
    color: active ? "white" : "#95a5a6",
    transition: "all 0.2s",
  }),
  field: { marginBottom: 14, textAlign: "left" },
  label: {
    display: "block", fontSize: "0.8rem", color: "#95a5a6",
    textTransform: "uppercase", letterSpacing: 1, marginBottom: 6,
  },
  input: {
    width: "100%", background: "#1a1a2e", border: "1px solid #0f3460",
    color: "white", padding: "10px 12px", borderRadius: 6,
    fontSize: "1rem", boxSizing: "border-box",
    outline: "none",
  },
  btn: {
    width: "100%", background: "#e94560", color: "white",
    border: "none", padding: "12px 0", borderRadius: 8,
    fontWeight: "bold", fontSize: 16, cursor: "pointer",
    marginTop: 8, transition: "opacity 0.2s",
  },
  error: {
    background: "#3a1a1a", border: "1px solid #e94560",
    color: "#e94560", padding: "10px 12px", borderRadius: 6,
    fontSize: "0.85rem", marginBottom: 14,
  },
  success: {
    background: "#1a3a1a", border: "1px solid #4ee44e",
    color: "#4ee44e", padding: "10px 12px", borderRadius: 6,
    fontSize: "0.85rem", marginBottom: 14,
  },
};

export default function Login() {
  const [mode, setMode] = useState("connexion"); // "connexion" ou "inscription"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const handleSubmit = async () => {
    setError(null);
    setSuccess(null);
    setLoading(true);

    if (mode === "inscription") {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) setError(error.message);
      else setSuccess("Inscription réussie ! Vérifiez votre email pour confirmer.");
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError("Email ou mot de passe incorrect.");
      // Si succès, App.jsx détecte le changement de session automatiquement
    }

    setLoading(false);
  };

  return (
    <div style={styles.app}>
      <div style={styles.container}>
        <h1 style={styles.h1}>⚔️ Compagnon JDR</h1>
        <p style={styles.subtitle}>Espace Maître du Jeu</p>

        {/* Tabs */}
        <div style={styles.tabs}>
          <button style={styles.tab(mode === "connexion")} onClick={() => setMode("connexion")}>
            Connexion
          </button>
          <button style={styles.tab(mode === "inscription")} onClick={() => setMode("inscription")}>
            Inscription
          </button>
        </div>

        {error && <div style={styles.error}>⚠️ {error}</div>}
        {success && <div style={styles.success}>✅ {success}</div>}

        <div style={styles.field}>
          <label style={styles.label}>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="mj@exemple.com"
            style={styles.input}
          />
        </div>

        <div style={styles.field}>
          <label style={styles.label}>Mot de passe</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            style={styles.input}
          />
        </div>

        <button
          style={{ ...styles.btn, opacity: loading ? 0.6 : 1 }}
          onClick={handleSubmit}
          disabled={loading}
        >
          {loading ? "Chargement..." : mode === "connexion" ? "Se connecter" : "S'inscrire"}
        </button>
      </div>
    </div>
  );
}