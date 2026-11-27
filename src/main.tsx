import { createRoot } from "react-dom/client";
import { ScreenErrorBoundary } from "./app/components/screen-error-boundary";
import App from "./app/App.tsx";
import "./styles/index.css";

createRoot(document.getElementById("root")!).render(
  <ScreenErrorBoundary><App /></ScreenErrorBoundary>,
);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/service-worker.js").catch((error) => {
    console.warn("[vertlab] Offline app unavailable", error);
  });
}
