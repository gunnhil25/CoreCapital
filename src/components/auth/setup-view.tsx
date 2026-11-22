"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  ShieldCheck,
  Database,
  Layers,
  AlertCircle,
  ArrowRight,
  Lock,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { setupInitialAdminAction } from "@/actions/auth";

export function SetupView() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [baseCurrency, setBaseCurrency] = useState("AUD");
  const [seedMode, setSeedMode] = useState<"clean" | "demo">("clean");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    startTransition(async () => {
      const res = await setupInitialAdminAction({
        name,
        email,
        password,
        baseCurrency,
        seedMode,
      });

      if (!res.success) {
        setError(res.error || "Failed to create initial administrator account.");
        return;
      }

      router.replace("/");
      router.refresh();
    });
  };

  return (
    <div className="w-full max-w-xl space-y-6 py-8">
      {/* Brand Banner */}
      <div className="text-center space-y-2">
        <div className="mx-auto h-14 w-14 rounded-2xl bg-gradient-to-tr from-sky-600 via-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-sky-500/20">
          <Sparkles className="h-7 w-7" />
        </div>
        <div className="flex items-center justify-center gap-2">
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight bg-gradient-to-r from-sky-500 to-indigo-500 bg-clip-text text-transparent">
            CoreCapital Setup
          </h1>
          <Badge variant="info" className="font-mono text-[10px]">
            First-Run Wizard
          </Badge>
        </div>
        <p className="text-xs sm:text-sm text-muted-foreground max-w-md mx-auto">
          Create your primary administrator account to lock setup and initialize your immutable financial ledger.
        </p>
      </div>

      <Card className="border-border/60 shadow-2xl">
        <CardHeader className="border-b bg-muted/20 pb-4">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-sky-500" />
            Administrator Account & Workspace
          </CardTitle>
          <CardDescription className="text-xs">
            This setup endpoint locks permanently as soon as the first admin is created.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-5 sm:p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 rounded-lg border bg-destructive/10 border-destructive/30 text-destructive text-xs flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="setup-name">Full Name</Label>
                <Input
                  id="setup-name"
                  placeholder="Alex Mercer"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="setup-currency">Base Currency</Label>
                <select
                  id="setup-currency"
                  value={baseCurrency}
                  onChange={(e) => setBaseCurrency(e.target.value)}
                  className="w-full h-9 rounded-lg border border-input bg-background px-3 text-xs font-mono"
                >
                  <option value="AUD">AUD ($)</option>
                  <option value="USD">USD ($)</option>
                  <option value="NZD">NZD ($)</option>
                  <option value="GBP">GBP (£)</option>
                  <option value="EUR">EUR (€)</option>
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="setup-email">Administrator Email</Label>
              <Input
                id="setup-email"
                type="email"
                placeholder="you@domain.local"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="setup-password">Password (min 8 chars)</Label>
                <Input
                  id="setup-password"
                  type="password"
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={8}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="setup-confirm">Confirm Password</Label>
                <Input
                  id="setup-confirm"
                  type="password"
                  placeholder="••••••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  minLength={8}
                  required
                />
              </div>
            </div>

            {/* Ledger Initialization Mode */}
            <div className="space-y-2 pt-2">
              <Label>Initial Ledger Data</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setSeedMode("clean")}
                  className={`p-3.5 rounded-xl border text-left transition-all space-y-1 ${
                    seedMode === "clean"
                      ? "border-sky-500 bg-sky-500/10 ring-1 ring-sky-500/40"
                      : "border-border hover:bg-muted/40"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold flex items-center gap-1.5">
                      <Layers className="h-3.5 w-3.5 text-sky-500" />
                      Start Clean
                    </span>
                    <Badge variant="info" className="text-[9px] py-0">
                      Recommended
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Creates standard Australian categories & rules with an empty $0.00 ledger ready for your CSV statements.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setSeedMode("demo")}
                  className={`p-3.5 rounded-xl border text-left transition-all space-y-1 ${
                    seedMode === "demo"
                      ? "border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500/40"
                      : "border-border hover:bg-muted/40"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold flex items-center gap-1.5">
                      <Database className="h-3.5 w-3.5 text-indigo-500" />
                      Load Demo Data
                    </span>
                    <Badge variant="outline" className="text-[9px] py-0">
                      Preview
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Seeds sample CommBank, Macquarie, ADF Super, budgets, subscriptions, and sample property/FHSS/DHOAS scenarios.
                  </p>
                </button>
              </div>
            </div>

            <div className="pt-3 border-t flex items-center justify-between gap-4">
              <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Lock className="h-3 w-3 text-emerald-500" />
                scrypt salted hash
              </span>
              <Button type="submit" disabled={isPending} className="gap-1.5">
                {isPending ? "Creating Admin..." : "Complete Setup & Enter Cockpit"}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
