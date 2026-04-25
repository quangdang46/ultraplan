import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

function renderFatalBootError(message: string) {
  const fallbackRoot = document.body;
  fallbackRoot.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f5f1ea;color:#3a3128;padding:24px;font-family:Inter,system-ui,sans-serif;">
      <div style="max-width:720px;background:#fff;border:1px solid #e7ddd1;border-radius:16px;padding:24px;box-shadow:0 10px 30px rgba(0,0,0,0.08);">
        <h1 style="margin:0 0 12px;font-size:20px;font-weight:700;">RCS Web UI failed to start</h1>
        <p style="margin:0 0 12px;line-height:1.6;">The application hit a startup error before React finished rendering. Open the browser console for the detailed stack trace.</p>
        <pre style="margin:0;white-space:pre-wrap;word-break:break-word;background:#f8f5ef;border-radius:12px;padding:12px;font-size:13px;line-height:1.5;">${message}</pre>
      </div>
    </div>
  `;
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing #root element in RCS Web UI HTML shell");
}

try {
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
} catch (error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error("Failed to bootstrap RCS Web UI", error);
  renderFatalBootError(message);
}
