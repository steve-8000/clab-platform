import { NextResponse } from "next/server";

const API_GATEWAY = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export async function GET() {
  try {
    const res = await fetch(`${API_GATEWAY}/v1/insights`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return NextResponse.json({ error: `Upstream: ${res.status}` }, { status: res.status });
    return NextResponse.json(await res.json());
  } catch (err) {
    return NextResponse.json({ error: "API gateway unreachable", detail: String(err) }, { status: 502 });
  }
}
