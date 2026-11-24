import { useEffect, useState } from "react";
import type { ChatSeed, Tab, Theme } from "./types";
import Chat from "./components/Chat";
import Dashboard from "./components/Dashboard";
import Header from "./components/Header";
import Toast from "./components/Toast";

interface ToastData {
  id: number;
  title: string;
  detail?: string;
}

export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = window.localStorage.getItem("mp-theme");
      if (saved === "dark" || saved === "light") return saved;
    } catch {
      // localStorage is optional in the demo
    }
    return "light";
  });
  const [seed, setSeed] = useState<ChatSeed | null>(null);
  const [toast, setToast] = useState<ToastData | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem("mp-theme", theme);
    } catch {
      // ignore
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute("content", theme === "light" ? "#f4f2ed" : "#0d0d0d");
    }
  }, [theme]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(t);
  }, [toast]);

  const showToast = (title: string, detail?: string) => {
    setToast({ id: Date.now(), title, detail });
  };

  const askAssistant = (query: string) => {
    setSeed({ id: Date.now(), query });
    setTab("chat");
  };

  return (
    <>
      <Header
        tab={tab}
        onTab={setTab}
        theme={theme}
        onToggleTheme={() =>
          setTheme((t) => (t === "light" ? "dark" : "light"))
        }
      />

      <main className="app-main">
        <div className={`view${tab === "dashboard" ? " is-active" : ""}`}>
          <Dashboard
            onAsk={askAssistant}
            onOpenChat={() => setTab("chat")}
            onToast={showToast}
          />
        </div>
        <div className={`view${tab === "chat" ? " is-active" : ""}`}>
          <Chat seed={seed} onToast={showToast} />
        </div>
      </main>

      {toast && (
        <Toast key={toast.id} title={toast.title} detail={toast.detail} />
      )}
    </>
  );
}
