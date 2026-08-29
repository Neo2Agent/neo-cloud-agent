import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "@neo-cloud-agent/ui/styles.css";
import "@neo-cloud-agent/ui/buddy.css";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
