import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { getAuthStatusAction } from "@/actions/auth";
import { AppShell } from "@/components/navigation/app-shell";

const inter = Inter({ subsets: ["latin"] });

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "CoreCapital | Personal Budget & Financial Analytics Engine",
  description:
    "Self-hosted, immutable financial ledger, cash flow forecasting, Australian FHSS & DHOAS scheme modeling, and automated bank statement categorization.",
  manifest: "/manifest.json",
  icons: {
    icon: "/icon.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0f172a",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { initialized, user } = await getAuthStatusAction();

  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} min-h-screen bg-background text-foreground flex antialiased`}>
        <AppShell initialized={initialized} user={user}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
