"use client";

import { useState, useEffect } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  CartesianGrid,
} from "recharts";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import type {
  CategoryDistributionPoint,
  CategorySubSlice,
} from "@/lib/category-utils";

export type { CategoryDistributionPoint, CategorySubSlice };

export interface MonthlyCashFlowChartPoint {
  month: string;
  income: number;
  expenses: number;
}

const defaultMonthlyCashFlowData: MonthlyCashFlowChartPoint[] = [
  { month: "May 26", income: 7700, expenses: 3420 },
  { month: "Jun 26", income: 7700, expenses: 3890 },
  { month: "Jul 26", income: 9250, expenses: 4120 },
  { month: "Aug 26", income: 7700, expenses: 3510 },
  { month: "Sep 26", income: 7700, expenses: 3680 },
  { month: "Oct 26", income: 9250, expenses: 3840 },
];

const defaultCategoryDistributionData: CategoryDistributionPoint[] = [
  { name: "Housing / Rent", value: 1650, color: "#8b5cf6" },
  { name: "Super (FHSS)", value: 1250, color: "#0284c7" },
  { name: "Groceries", value: 642, color: "#0ea5e9" },
  { name: "Dining Out", value: 385, color: "#f59e0b" },
  { name: "Transport & Fuel", value: 295, color: "#14b8a6" },
  { name: "Utilities & SaaS", value: 288, color: "#ec4899" },
];

interface DashboardChartsProps {
  monthlyData?: MonthlyCashFlowChartPoint[];
  categoryData?: CategoryDistributionPoint[];
}

export function DashboardCharts({ monthlyData, categoryData }: DashboardChartsProps) {
  const [mounted, setMounted] = useState(false);
  const [selectedParentKey, setSelectedParentKey] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const resolvedMonthlyData =
    monthlyData !== undefined ? monthlyData : defaultMonthlyCashFlowData;
  const resolvedCategoryData =
    categoryData !== undefined ? categoryData : defaultCategoryDistributionData;

  const drilledParent = selectedParentKey
    ? resolvedCategoryData.find(
        (c) => (c.id || c.name) === selectedParentKey && c.children && c.children.length > 0
      )
    : undefined;

  const activeSlices = drilledParent?.children ?? resolvedCategoryData;
  const activeTotal = drilledParent
    ? drilledParent.value
    : resolvedCategoryData.reduce((s, item) => s + item.value, 0);
  const hasAnyDrilldown = resolvedCategoryData.some(
    (c) => c.children && c.children.length > 0
  );

  if (!mounted) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 h-72 rounded-xl border bg-card/50 animate-pulse" />
        <div className="h-72 rounded-xl border bg-card/50 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Cash Flow Comparison Bar Chart */}
      <div className="lg:col-span-2 rounded-xl border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Monthly Income vs Outflow</h3>
            <p className="text-xs text-muted-foreground">Historical 6-Month Inflow & Burn</p>
          </div>
          <div className="flex items-center gap-3 text-[11px] font-mono">
            <div className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500 inline-block" />
              <span>Inflow</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm bg-rose-500 inline-block" />
              <span>Outflow</span>
            </div>
          </div>
        </div>

        <div className="h-64 w-full">
          {resolvedMonthlyData.length === 0 ? (
            <div className="h-full w-full rounded-lg border border-dashed flex items-center justify-center text-xs text-muted-foreground text-center px-4">
              No transactions posted yet. Log an entry or import a CSV statement to populate cash flow history.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={resolvedMonthlyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.15} />
                <XAxis dataKey="month" stroke="#888888" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis
                  stroke="#888888"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(val) => `$${val / 1000}k`}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className="rounded-lg border bg-background/95 backdrop-blur-md p-2.5 shadow-lg text-xs space-y-1">
                          <p className="font-semibold">{label}</p>
                          <p className="text-emerald-500 font-mono">
                            Inflow: {formatCurrency(payload[0]?.value as number)}
                          </p>
                          <p className="text-rose-500 font-mono">
                            Outflow: {formatCurrency(payload[1]?.value as number)}
                          </p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar dataKey="income" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={32} isAnimationActive={false} />
                <Bar dataKey="expenses" fill="#f43f5e" radius={[4, 4, 0, 0]} maxBarSize={32} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Spending Breakdown Donut Chart (with Sub-Category Drilldown) */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {drilledParent ? (
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedParentKey(null)}
                    className="h-6 px-1.5 text-[11px] -ml-1.5"
                  >
                    <ChevronLeft className="h-3.5 w-3.5 mr-0.5" />
                    All
                  </Button>
                  <Badge variant="outline" className="text-[11px] font-semibold">
                    <span
                      className="h-2 w-2 rounded-full mr-1.5 inline-block"
                      style={{ backgroundColor: drilledParent.color }}
                    />
                    {drilledParent.name} • {formatCurrency(drilledParent.value)}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Sub-category breakdown ({drilledParent.children!.length} segments)
                </p>
              </div>
            ) : (
              <>
                <h3 className="text-sm font-semibold">Spending Distribution</h3>
                <p className="text-xs text-muted-foreground">
                  {hasAnyDrilldown
                    ? "Click a slice or category with sub-categories to drill down"
                    : "Current Ledger & Budget Allocation"}
                </p>
              </>
            )}
          </div>
        </div>

        <div
          key={drilledParent ? drilledParent.id || drilledParent.name : "top-level"}
          className="h-48 w-full flex items-center justify-center cc-animate-tab"
        >
          {activeSlices.length === 0 ? (
            <div className="h-full w-full rounded-lg border border-dashed flex items-center justify-center text-xs text-muted-foreground text-center px-4">
              No category spending recorded yet.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={activeSlices}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={75}
                  paddingAngle={3}
                  dataKey="value"
                  isAnimationActive={false}
                  className={!drilledParent && hasAnyDrilldown ? "cursor-pointer outline-none" : "outline-none"}
                  onClick={(entry: any) => {
                    if (drilledParent) return;
                    const node = entry?.payload ?? entry;
                    const key = node?.id || node?.name;
                    if (node?.children?.length > 0 && key) {
                      setSelectedParentKey(key);
                    }
                  }}
                >
                  {activeSlices.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={entry.color}
                      fillOpacity={
                        "isDirectParentSpend" in entry && entry.isDirectParentSpend ? 0.65 : 1
                      }
                    />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: any) => {
                    const num = Number(value) || 0;
                    const pct = activeTotal > 0 ? ((num / activeTotal) * 100).toFixed(1) : "0.0";
                    return [`${formatCurrency(num)} (${pct}%)`, drilledParent ? "Sub-Category" : "Amount"];
                  }}
                  contentStyle={{
                    backgroundColor: "hsl(var(--background))",
                    borderColor: "hsl(var(--border))",
                    borderRadius: "0.5rem",
                    fontSize: "12px",
                  }}
                  itemStyle={{ color: "hsl(var(--foreground))" }}
                  labelStyle={{ color: "hsl(var(--foreground))" }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="grid grid-cols-2 gap-1.5 pt-2 border-t text-[11px]">
          {(drilledParent ? activeSlices : activeSlices.slice(0, 6)).map((item) => {
            const pct =
              activeTotal > 0 ? Math.round((item.value / activeTotal) * 100) : 0;
            const childCount =
              !drilledParent && "children" in item && item.children
                ? item.children.length
                : 0;
            const itemKey = ("id" in item && item.id) || item.name;

            if (childCount > 0) {
              return (
                <button
                  key={itemKey}
                  type="button"
                  onClick={() => setSelectedParentKey(itemKey)}
                  className="flex items-center justify-between gap-1 px-1.5 py-1 rounded-md hover:bg-muted/60 text-left transition-colors group"
                  title={`Inspect ${item.name} sub-categories`}
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="truncate font-medium text-foreground group-hover:text-primary">
                      {item.name}
                    </span>
                  </span>
                  <span className="flex items-center gap-0.5 text-[10px] font-mono text-muted-foreground shrink-0">
                    <span>{childCount}</span>
                    <ChevronRight className="h-3 w-3" />
                  </span>
                </button>
              );
            }

            return (
              <div
                key={itemKey}
                className="flex items-center justify-between gap-1 px-1 py-0.5 truncate"
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{
                      backgroundColor: item.color,
                      opacity:
                        "isDirectParentSpend" in item && item.isDirectParentSpend ? 0.65 : 1,
                    }}
                  />
                  <span className="truncate text-muted-foreground">{item.name}</span>
                </span>
                {drilledParent && (
                  <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                    {pct}%
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
