import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import Online from "./Online";

const online = new URLSearchParams(location.search).get("online") === "1";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {online ? <Online /> : <App />}
  </StrictMode>
);
