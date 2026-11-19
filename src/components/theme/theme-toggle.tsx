"use client";

import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { DEFAULT_THEME } from "@/lib/theme";
import { useTheme } from "./theme-provider";

interface ThemeToggleProps {
  variant?: "sidebar" | "compact" | "icon";
  className?: string;
}

export function ThemeToggle({ variant = "sidebar", className }: ThemeToggleProps) {
  const { theme, mounted, toggleTheme } = useTheme();
  const effectiveTheme = mounted ? theme : DEFAULT_THEME;
  const isDark = effectiveTheme === "dark";

  const icon = isDark ? (
    <Sun className="h-4 w-4 text-amber-400 shrink-0" />
  ) : (
    <Moon className="h-4 w-4 text-sky-600 shrink-0" />
  );

  const label = isDark ? "Dark" : "Light";
  const title = isDark ? "Switch to Light Mode" : "Switch to Dark Mode";

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={toggleTheme}
        aria-label="Toggle light and dark theme"
        title={title}
        className={cn(
          "h-8 w-8 rounded-lg border bg-background/60 hover:bg-muted/60 transition-colors inline-flex items-center justify-center text-foreground",
          className
        )}
      >
        {icon}
      </button>
    );
  }

  if (variant === "compact") {
    return (
      <button
        type="button"
        onClick={toggleTheme}
        aria-label="Toggle light and dark theme"
        title={title}
        className={cn(
          "inline-flex items-center gap-2 h-9 px-3 rounded-lg border bg-background/80 backdrop-blur-md hover:bg-accent/70 text-foreground transition-colors text-xs font-semibold shadow-sm active:scale-[0.98]",
          className
        )}
      >
        {icon}
        <span>{label}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label="Toggle light and dark theme"
      title={title}
      className={cn(
        "w-full min-h-[42px] px-3.5 py-2 rounded-lg border bg-background/80 hover:bg-accent/70 text-foreground transition-colors flex items-center justify-between text-xs font-semibold shadow-sm active:scale-[0.99]",
        className
      )}
    >
      <span className="inline-flex items-center gap-2.5">
        {icon}
        <span>Theme</span>
      </span>
      <span className="px-2 py-0.5 rounded-full bg-primary/15 text-primary text-[11px] font-semibold tracking-wide">
        {label}
      </span>
    </button>
  );
}
