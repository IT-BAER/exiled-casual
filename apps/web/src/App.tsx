import React from "react";

export function App() {
  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
      <canvas
        id="render-canvas"
        style={{ width: "100%", height: "100%", display: "block" }}
      />
      <div id="hud-root" style={{ position: "absolute", top: 0, left: 0 }} />
    </div>
  );
}
