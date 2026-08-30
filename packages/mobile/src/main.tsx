import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { sharedWebCredentials } from "./api/credentials";
import { App } from "./web/App";
import "./island.css";

const store = sharedWebCredentials();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App store={store} />
  </StrictMode>,
);
