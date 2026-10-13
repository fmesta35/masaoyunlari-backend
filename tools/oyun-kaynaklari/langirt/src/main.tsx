import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import Online from "./Online";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Online />
  </StrictMode>
);
