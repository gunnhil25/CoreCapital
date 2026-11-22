import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { getAuthStatusAction } from "@/actions/auth";
import { AppShell } from "@/components/navigation/app-shell";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

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
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f6fb" },
    { media: "(prefers-color-scheme: dark)", color: "#0c1020" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { initialized, user } = await getAuthStatusAction();

  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className={`${inter.className} min-h-screen bg-background text-foreground flex antialiased`}>
        <ThemeProvider>
          <AppShell initialized={initialized} user={user}>
            {children}
          </AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
