"use client";

import { useState, useEffect } from "react";
import {
  TrendingUp,
  Calendar,
  AlertCircle,
  ArrowUpRight,
  ArrowDownRight,
  ShieldCheck,
  Clock,
  Layers,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import { CashFlowDataPoint } from "@/actions/cash-flow";

interface CashFlowViewProps {
  initial30Day: {
    startingBalance: number;
    endingBalance: number;
    lowestBalance: number;
    netChange: number;
    points: CashFlowDataPoint[];
  };
  initial90Day: {
    startingBalance: number;
    endingBalance: number;
    lowestBalance: number;
    netChange: number;
    points: CashFlowDataPoint[];
  };
}

export function CashFlowView({ initial30Day, initial90Day }: CashFlowViewProps) {
  const [horizon, setHorizon] = useState<30 | 90>(30);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const activeData = horizon === 30 ? initial30Day : initial90Day;

  // Major scheduled events
  const majorEvents = activeData.points.filter((p) => p.eventDescription);

  return (
    <div className="space-y-6">
      {/* Header and Horizon Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Cash Flow Forecasting
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Forward-looking liquidity curve • Scheduled ADF payroll & recurring expense projection
          </p>
        </div>
        <div className="flex items-center gap-1.5 p-1 bg-muted rounded-lg border">
          <Button
            variant={horizon === 30 ? "default" : "ghost"}
            size="sm"
            onClick={() => setHorizon(30)}
            className="text-xs h-8 px-3"
          >
            30-Day Outlook
          </Button>
          <Button
            variant={horizon === 90 ? "default" : "ghost"}
            size="sm"
            onClick={() => setHorizon(90)}
            className="text-xs h-8 px-3"
          >
            90-Day Outlook
          </Button>
        </div>
      </div>

      {/* KPI Overview Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Card className="border-border/60">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs">Current Liquid Capital</CardDescription>
            <CardTitle className="text-xl sm:text-2xl font-bold font-mono">
              {formatCurrency(activeData.startingBalance)}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <span className="text-[11px] text-muted-foreground">Active Checking & Offset</span>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs">Projected End Balance ({horizon}d)</CardDescription>
            <CardTitle className="text-xl sm:text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
              {formatCurrency(activeData.endingBalance)}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="flex items-center text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
              <ArrowUpRight className="h-3.5 w-3.5 mr-0.5" />
              <span>+{formatCurrency(activeData.netChange)} net growth</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs">Lowest Projected Point</CardDescription>
            <CardTitle className="text-xl sm:text-2xl font-bold font-mono text-sky-500">
              {formatCurrency(activeData.lowestBalance)}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <Badge variant="success" className="text-[10px] px-1.5 py-0 mt-0.5">
              Liquidity Safe
            </Badge>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs">Scheduled Income Cycles</CardDescription>
            <CardTitle className="text-xl sm:text-2xl font-bold font-mono">
              {horizon === 30 ? "2" : "6"} Fortnights
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <span className="text-[11px] text-muted-foreground font-mono">
              {formatCurrency((horizon === 30 ? 2 : 6) * 3850)} gross salary
            </span>
          </CardContent>
        </Card>
      </div>

      {/* Interactive Projection Chart */}
      <Card className="border-border/60 overflow-hidden">
        <CardHeader className="p-5 pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-semibold">
                Projected Bank Balance Trajectory
              </CardTitle>
              <CardDescription className="text-xs">
                Simulated balance over the next {horizon} calendar days
              </CardDescription>
            </div>
            <Badge variant="outline" className="text-xs font-mono">
              {horizon} Days Horizon
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-5 pt-3">
          {mounted ? (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={activeData.points}
                  margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="balanceGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.15} />
                  <XAxis
                    dataKey="formattedDate"
                    stroke="#888888"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    interval={horizon === 30 ? 4 : 12}
                  />
                  <YAxis
                    stroke="#888888"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(val) => `$${val / 1000}k`}
                    domain={["auto", "auto"]}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const pt = payload[0].payload as CashFlowDataPoint;
                        return (
                          <div className="rounded-lg border bg-background/95 backdrop-blur-md p-3 shadow-xl text-xs space-y-1">
                            <p className="font-semibold">{pt.formattedDate}</p>
                            <p className="font-mono text-sky-500 font-bold text-sm">
                              Balance: {formatCurrency(pt.projectedBalance)}
                            </p>
                            {pt.eventDescription && (
                              <p className="text-[11px] text-emerald-500 pt-1 border-t">
                                ★ {pt.eventDescription}
                              </p>
                            )}
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="projectedBalance"
                    stroke="#0ea5e9"
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#balanceGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-72 w-full rounded-xl bg-muted/20 animate-pulse" />
          )}
        </CardContent>
      </Card>

      {/* Major Scheduled Inflows and Outflows */}
      <Card className="border-border/60">
        <CardHeader className="p-4 pb-2 border-b bg-muted/20">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Clock className="h-4 w-4 text-sky-500" />
            Scheduled Cash Flow Events ({horizon}d)
          </CardTitle>
          <CardDescription className="text-xs">
            Major scheduled payroll inflows and fixed commitments
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y text-xs">
            {majorEvents.map((evt, idx) => (
              <div
                key={idx}
                className="p-3.5 flex items-center justify-between hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 ${
                      evt.inflow > 0
                        ? "bg-emerald-500/10 text-emerald-500"
                        : "bg-rose-500/10 text-rose-500"
                    }`}
                  >
                    {evt.inflow > 0 ? (
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    ) : (
                      <ArrowDownRight className="h-3.5 w-3.5" />
                    )}
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">{evt.eventDescription}</p>
                    <p className="text-[11px] text-muted-foreground font-mono">
                      {evt.formattedDate}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p
                    className={`font-mono font-bold ${
                      evt.inflow > 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-foreground"
                    }`}
                  >
                    {evt.inflow > 0
                      ? `+${formatCurrency(evt.inflow)}`
                      : `-${formatCurrency(evt.outflow)}`}
                  </p>
                  <p className="text-[10px] text-muted-foreground font-mono">
                    Projected: {formatCurrency(evt.projectedBalance)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
