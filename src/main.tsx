import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import ThemeToggle from "./ThemeToggle";
import "./styles.css";
import "./theme.css";
import "./brand.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeToggle />
    <App />
  </React.StrictMode>,
);
