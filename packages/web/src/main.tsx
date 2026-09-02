import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@neo-cloud-agent/ui";
import { App } from "./App";
import { bindVisualViewport } from "./viewport";
import "@neo-cloud-agent/ui/styles.css";
import "@neo-cloud-agent/ui/buddy.css";
import "./styles.css";

bindVisualViewport(document, window);

const root = document.getElementById("root");
if (!root) {
  throw new Error("missing #root");
}
createRoot(root).render(
  <StrictMode>
    <TooltipProvider>
      <App />
    </TooltipProvider>
  </StrictMode>,
);
