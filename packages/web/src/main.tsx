import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { bindVisualViewport } from "./viewport";
import "./styles.css";

bindVisualViewport(document, window);

const root = document.getElementById("root");
if (!root) {
  throw new Error("missing #root");
}
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
