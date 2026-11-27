import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { directionOf, pickLocale } from "./i18n";
import "./index.css";

const locale = pickLocale(window.ilmways.locale);
document.documentElement.lang = locale;
document.documentElement.dir = directionOf(locale);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App locale={locale} />
  </StrictMode>,
);
