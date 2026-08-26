import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { bindVisualViewport } from "./viewport";
import "@neo-cloud-agent/ui/styles.css";
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
