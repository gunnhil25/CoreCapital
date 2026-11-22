"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Receipt,
  UploadCloud,
  Repeat,
  TrendingUp,
  Home,
  SlidersHorizontal,
  PieChart,
  ShieldCheck,
  Server,
  Sparkles,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import type { SafeUser } from "@/actions/auth";

const navItems = [
  {
    title: "Overview",
    items: [
      { name: "Dashboard", href: "/", icon: LayoutDashboard },
      { name: "Transactions & Ledger", href: "/transactions", icon: Receipt },
      { name: "Statements & Ingestion", href: "/ingest", icon: UploadCloud },
    ],
  },
  {
    title: "Planning & Tracking",
    items: [
      { name: "Subscriptions Monitor", href: "/subscriptions", icon: Repeat },
      { name: "Cash Flow Projections", href: "/cash-flow", icon: TrendingUp },
      { name: "Property Goal", href: "/property-goals", icon: Home },
      { name: "Budgets & Caps", href: "/budgets", icon: PieChart },
    ],
  },
  {
    title: "Automation & Rules",
    items: [
      { name: "Classification Rules", href: "/rules", icon: SlidersHorizontal },
    ],
  },
  {
    title: "System & Administration",
    items: [
      { name: "Settings & Users", href: "/settings", icon: Settings },
    ],
  },
];

export function Sidebar({ user }: { user: SafeUser }) {
  const pathname = usePathname();

  return (
    <aside className="hidden lg:flex w-64 flex-col border-r bg-card/60 backdrop-blur-xl h-screen sticky top-0 shrink-0 select-none">
      {/* Brand Header */}
      <div className="h-16 shrink-0 flex items-center px-6 border-b justify-between">
        <Link href="/" className="flex items-center gap-2.5 font-bold text-lg tracking-tight">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-sky-600 via-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-sky-500/20">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <span className="bg-gradient-to-r from-sky-600 to-indigo-600 bg-clip-text text-transparent font-extrabold">
              CoreCapital
            </span>
            <span className="block text-[10px] uppercase font-mono tracking-widest text-muted-foreground -mt-1">
              Ledger Engine
            </span>
          </div>
        </Link>
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 border-sky-500/30 text-sky-600 dark:text-sky-400 font-mono">
          v1.0
        </Badge>
      </div>

      {/* Navigation Sections */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
        {navItems.map((section) => (
          <div key={section.title} className="space-y-1.5">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70 px-3">
              {section.title}
            </h4>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const isActive = pathname === item.href;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all group",
                      isActive
                        ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20 font-semibold"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                    )}
                  >
                    <Icon
                      className={cn(
                        "h-4 w-4 shrink-0 transition-transform group-hover:scale-105",
                        isActive ? "text-primary-foreground" : "text-muted-foreground group-hover:text-foreground"
                      )}
                    />
                    <span>{item.name}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Theme Switcher & Active User Node Status */}
      <div className="p-4 border-t bg-muted/20 space-y-2.5 shrink-0">
        <ThemeToggle variant="sidebar" />

        <div className="rounded-lg border bg-background/60 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <Server className="h-3.5 w-3.5 text-emerald-500 animate-pulse shrink-0" />
              <span className="text-xs font-semibold truncate">{user.name}</span>
            </div>
            <Badge
              variant={user.role === "admin" ? "info" : "outline"}
              className="text-[9px] px-1.5 py-0 font-mono uppercase shrink-0"
            >
              {user.role}
            </Badge>
          </div>
          <div className="text-[11px] text-muted-foreground flex items-center justify-between">
            <span>Proxmox • Docker</span>
            <span className="font-mono text-emerald-600 dark:text-emerald-400 font-medium">ONLINE</span>
          </div>
          <div className="pt-1 border-t text-[10px] text-muted-foreground flex items-center gap-1.5">
            <ShieldCheck className="h-3 w-3 text-sky-500" />
            <span>Immutable Ledger Active</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
