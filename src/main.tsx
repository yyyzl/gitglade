import { createRoot } from "react-dom/client";
import App from "./App";
import { migrateLegacyPreferences } from "./brandStorage";
import { ThemeProvider, applyTheme, loadTheme } from "./theme";
import { LanguageProvider } from "./i18n";
import "./themes.css";
import "./styles.css";
migrateLegacyPreferences();
applyTheme(loadTheme());
createRoot(document.getElementById("root")!).render(
  <LanguageProvider>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </LanguageProvider>,
);
