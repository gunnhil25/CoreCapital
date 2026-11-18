"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Plus, Upload, Sparkles, Calendar, Settings, LogOut, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { logoutAction, SafeUser } from "@/actions/auth";

export function Header({ user }: { user: SafeUser }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const today = new Intl.DateTimeFormat("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date());

  const handleLogout = () => {
    startTransition(async () => {
      await logoutAction();
      router.push("/login");
      router.refresh();
    });
  };

  return (
    <header className="h-16 border-b bg-card/40 backdrop-blur-md px-4 sm:px-6 flex items-center justify-between sticky top-0 z-40">
      {/* Mobile Branding / Desktop Breadcrumb */}
      <div className="flex items-center gap-3">
        <div className="lg:hidden flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-tr from-sky-600 to-indigo-600 flex items-center justify-center text-white shadow-sm">
            <Sparkles className="h-4 w-4" />
          </div>
          <span className="font-bold text-base bg-gradient-to-r from-sky-600 to-indigo-600 bg-clip-text text-transparent">
            CoreCapital
          </span>
        </div>
        <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground font-mono bg-muted/50 px-2.5 py-1 rounded-md">
          <Calendar className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
          <span>{today}</span>
        </div>
      </div>

      {/* Global Action Bar & Profile Controls */}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" asChild className="hidden md:inline-flex">
          <Link href="/ingest">
            <Upload className="h-3.5 w-3.5 mr-1.5" />
            Import CSV
          </Link>
        </Button>
        <Button size="sm" asChild className="shadow-sm hidden sm:inline-flex">
          <Link href="/transactions?action=new">
            <Plus className="h-4 w-4 mr-1" />
            New Entry
          </Link>
        </Button>

        <div className="h-5 w-px bg-border mx-1 hidden sm:block" />

        <Link
          href="/settings"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border bg-background/60 hover:bg-muted/60 transition-colors text-xs"
          title="Settings & User Management"
        >
          <UserCheck className="h-3.5 w-3.5 text-sky-500 shrink-0" />
          <span className="hidden sm:inline font-medium max-w-[110px] truncate">
            {user.name}
          </span>
          <Badge
            variant={user.role === "admin" ? "info" : "outline"}
            className="text-[9px] px-1 py-0 font-mono uppercase hidden md:inline-flex"
          >
            {user.role}
          </Badge>
          <Settings className="h-3.5 w-3.5 text-muted-foreground ml-0.5 lg:hidden" />
        </Link>

        <Button
          variant="ghost"
          size="icon"
          onClick={handleLogout}
          disabled={isPending}
          title="Sign Out"
          aria-label="Sign Out"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
