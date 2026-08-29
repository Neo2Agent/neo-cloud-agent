import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@neo-cloud-agent/ui";
import { App } from "./App";
import { ErrorScreen } from "./ErrorScreen";
import "@fontsource/nunito/400.css";
import "@fontsource/nunito/500.css";
import "@fontsource/nunito/600.css";
import "@fontsource/nunito/700.css";
import "@fontsource/noto-sans-sc/400.css";
import "@fontsource/noto-sans-sc/500.css";
import "@fontsource/noto-sans-sc/600.css";
import "@fontsource/noto-sans-sc/700.css";
import "@neo-cloud-agent/ui/styles.css";
import "animal-island-ui/style";
import "./styles.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("missing #root");
}
createRoot(root).render(
  <StrictMode>
    <TooltipProvider>
      <ErrorScreen>
        <App />
      </ErrorScreen>
    </TooltipProvider>
  </StrictMode>,
);
