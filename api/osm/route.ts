import { NextRequest, NextResponse } from "next/server";

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];

export async function POST(req: NextRequest) {
  const body = await req.text();

  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        body,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      return NextResponse.json(data);
    } catch {
      // try next mirror
    }
  }

  return NextResponse.json({ elements: [] }, { status: 503 });
}