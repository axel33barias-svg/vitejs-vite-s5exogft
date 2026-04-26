import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { supabase } from "./supabase";
import Login from "./pages/Login";
import MJ from "./pages/MJ";
import Joueur from "./pages/Joueur";

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) return (
    <div style={{
      minHeight: "100vh", background: "#1a1a2e",
      display: "flex", alignItems: "center", justifyContent: "center",
      color: "#95a5a6", fontFamily: "sans-serif", fontSize: 18,
    }}>
      Chargement…
    </div>
  );

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/rejoindre/:sessionId" element={<Joueur />} />
        <Route path="/mj" element={session ? <MJ session={session} /> : <Navigate to="/login" />} />
        <Route path="/login" element={session ? <Navigate to="/mj" /> : <Login />} />
        <Route path="*" element={<Navigate to={session ? "/mj" : "/login"} />} />
      </Routes>
    </BrowserRouter>
  );
}