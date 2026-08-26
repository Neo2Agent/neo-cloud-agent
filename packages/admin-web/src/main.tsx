import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "@neo-cloud-agent/ui/styles.css";
import "./styles.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("missing #root");
}
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
