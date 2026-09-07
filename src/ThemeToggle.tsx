import { useState } from "react";
import { Sun, Moon } from "lucide-react";
type Theme = "dark" | "light";
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.dataset.theme === "light" ? "light" : "dark",
  );
  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", next === "light" ? "#f8f6f5" : "#141316");
    try {
      localStorage.setItem("study-theme", next);
    } catch {
      /* Theme still works when storage is unavailable. */
    }
    setTheme(next);
  }
  const label = theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환";
  return (
    <button
      className="theme-toggle"
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
    >
      {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
      <span>{theme === "dark" ? "라이트 모드" : "다크 모드"}</span>
    </button>
  );
}
