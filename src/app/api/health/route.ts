import { NextResponse } from "next/server";
import { checkDbConnection } from "@/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const dbConnected = await checkDbConnection();

  return NextResponse.json(
    {
      status: "ok",
      app: "corecapital",
      database: dbConnected ? "connected" : "in_memory_fallback",
      timestamp: new Date().toISOString(),
    },
    { status: 200 }
  );
}
