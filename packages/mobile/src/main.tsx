import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { sharedWebCredentials } from "./api/credentials";
import { App } from "./web/App";
import "@fontsource/geist-sans/latin-400.css";
import "@fontsource/geist-sans/latin-500.css";
import "@fontsource/geist-sans/latin-600.css";
import "@neo-cloud-agent/ui/styles.css";
import "@neo-cloud-agent/ui/markdown.css";
import "./island.css";

const store = sharedWebCredentials();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App store={store} />
  </StrictMode>,
);
