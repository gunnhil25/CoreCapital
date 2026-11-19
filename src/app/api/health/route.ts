import { NextResponse } from "next/server";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const dbReady = await store.isDbReady();

  if (process.env.NODE_ENV === "production" && !dbReady) {
    return NextResponse.json(
      {
        status: "degraded",
        app: "corecapital",
        database: "disconnected",
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }

  return NextResponse.json(
    {
      status: "ok",
      app: "corecapital",
      database: dbReady ? "connected" : "in_memory_fallback",
      timestamp: new Date().toISOString(),
    },
    { status: 200 }
  );
}
