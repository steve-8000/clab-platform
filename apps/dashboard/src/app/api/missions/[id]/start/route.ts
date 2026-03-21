import { NextRequest, NextResponse } from "next/server";

const API_GATEWAY = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const res = await fetch(`${API_GATEWAY}/v1/missions/${id}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return NextResponse.json({ error: `Upstream: ${res.status}` }, { status: res.status });
    return NextResponse.json(await res.json());
  } catch (err) {
    return NextResponse.json({ error: "API gateway unreachable", detail: String(err) }, { status: 502 });
  }
}
