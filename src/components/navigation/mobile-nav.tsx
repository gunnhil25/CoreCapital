"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Receipt,
  PlusCircle,
  Repeat,
  Home,
} from "lucide-react";
import { cn } from "@/lib/utils";

const mobileItems = [
  { name: "Home", href: "/", icon: LayoutDashboard },
  { name: "Ledger", href: "/transactions", icon: Receipt },
  { name: "Add", href: "/transactions?action=new", icon: PlusCircle, isPrimary: true },
  { name: "Subs", href: "/subscriptions", icon: Repeat },
  { name: "Property", href: "/property-goals", icon: Home },
];

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-background/90 backdrop-blur-lg border-t pb-safe">
      <div className="flex items-center justify-around h-16 px-2">
        {mobileItems.map((item) => {
          const isActive = pathname === item.href && !item.isPrimary;
          const Icon = item.icon;

          if (item.isPrimary) {
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex flex-col items-center justify-center -mt-5"
              >
                <div className="h-12 w-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg shadow-primary/30 active:scale-95 transition-transform">
                  <Icon className="h-6 w-6" />
                </div>
                <span className="text-[10px] font-medium mt-1 text-foreground">
                  {item.name}
                </span>
              </Link>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center justify-center py-1 px-3 rounded-lg transition-colors",
                isActive
                  ? "text-primary font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[10px] mt-1">{item.name}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
