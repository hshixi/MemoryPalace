import type { Tab, Theme } from "../types";
import { IconChat, IconGrid, IconLock, IconMoon, IconSun } from "./Icons";
import { LogoMark } from "./ui";

interface HeaderProps {
  tab: Tab;
  onTab: (tab: Tab) => void;
  theme: Theme;
  onToggleTheme: () => void;
}

export default function Header({
  tab,
  onTab,
  theme,
  onToggleTheme,
}: HeaderProps) {
  return (
    <header className="app-header">
      <div className="brand">
        <LogoMark />
        <span className="brand-name">MemoryPalace</span>
      </div>

      <nav className="tab-switch" role="tablist" aria-label="主导航">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "dashboard"}
          className={`tab-btn${tab === "dashboard" ? " active" : ""}`}
          onClick={() => onTab("dashboard")}
        >
          <IconGrid size={14} />
          总览
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "chat"}
          className={`tab-btn${tab === "chat" ? " active" : ""}`}
          onClick={() => onTab("chat")}
        >
          <IconChat size={14} />
          对话
        </button>
      </nav>

      <div className="header-right">
        <span className="chip local-chip" title="文件与索引都留在本机">
          <IconLock size={12} />
          本地索引
        </span>
        <button
          type="button"
          className="icon-btn"
          aria-label={theme === "light" ? "切换到深色模式" : "切换到浅色模式"}
          onClick={onToggleTheme}
        >
          {theme === "light" ? <IconMoon size={16} /> : <IconSun size={16} />}
        </button>
        <span className="avatar" aria-hidden="true">
          S
        </span>
      </div>
    </header>
  );
}
