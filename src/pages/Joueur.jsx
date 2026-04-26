import { useParams } from "react-router-dom";

export default function Joueur() {
  const { sessionId } = useParams();

  return (
    <div style={{
      minHeight: "100vh", background: "#1a1a2e", color: "white",
      fontFamily: "sans-serif", display: "flex", alignItems: "center",
      justifyContent: "center", flexDirection: "column", gap: 20,
    }}>
      <h1 style={{ color: "#e94560" }}>🎲 Espace Joueur</h1>
      <p style={{ color: "#95a5a6" }}>Session : {sessionId}</p>
      <p style={{ color: "#95a5a6" }}>🚧 Les dés arrivent ici !</p>
    </div>
  );
}