export default function ConfigStats({ sessionId, resetKey, onSave, isPopup = false }) {
  // ... dans le return, adapte le style :
  return (
    <div style={{ 
      fontFamily: "'Segoe UI', sans-serif",
      maxHeight: isPopup ? "calc(90vh - 200px)" : "none",
      overflowY: isPopup ? "auto" : "visible"
    }}>
      {/* ... reste du code ... */}
      
      {isPopup && (
        <button 
          onClick={onSave} 
          style={{ width: "100%", background: "#27ae60", color: "white", border: "none", padding: "12px", borderRadius: 8, fontWeight: "bold", fontSize: 16, cursor: "pointer", marginTop: 16 }}
        >
          💾 Sauvegarder et continuer
        </button>
      )}
    </div>
  );
}