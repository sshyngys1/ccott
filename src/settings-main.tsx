import React from "react";
import ReactDOM from "react-dom/client";
import { SettingsWindow } from "./shell/settings/SettingsWindow";
import "./index.css";
import "./shell/shell.css";
import "./shell/settings/window.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode><SettingsWindow /></React.StrictMode>,
);
