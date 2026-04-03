// app/api/osm/route.ts
import { NextRequest, NextResponse } from "next/server";

const SKIP_OSM = process.env.SKIP_OSM === "true";

const MIRRORS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];

// ─── 3-layer cache ────────────────────────────────────────────────────────────
// L1 FRESH  — expires 10 min  — instant return, no network
// L2 WARM   — expires 60 min  — instant return + silent background revalidation
// L3 STALE  — never expires   — last resort when mirrors are all dead

const freshCache = new Map<string, { data: unknown; expires: number }>();
const warmCache  = new Map<string, { data: unknown; expires: number }>();
const staleCache = new Map<string, unknown>();

const FRESH_TTL = 10 * 60 * 1000;
const WARM_TTL  = 60 * 60 * 1000;

// In-flight dedup — prevents hammering mirrors with identical concurrent requests
const inFlight = new Map<string, Promise<unknown>>();

// ─── Mirror health tracking ───────────────────────────────────────────────────

const mirrorCooldown = new Map<string, number>();
const mirrorStats    = new Map<string, { success: number; fail: number }>();
const COOLDOWN_MS    = 90_000;

function getMirrorScore(mirror: string): number {
  const s = mirrorStats.get(mirror) ?? { success: 0, fail: 0 };
  return s.success / (s.success + s.fail + 1);
}

function recordSuccess(mirror: string) {
  const s = mirrorStats.get(mirror) ?? { success: 0, fail: 0 };
  mirrorStats.set(mirror, { success: s.success + 1, fail: s.fail });
  mirrorCooldown.delete(mirror);
}

function recordFail(mirror: string) {
  const s = mirrorStats.get(mirror) ?? { success: 0, fail: 0 };
  mirrorStats.set(mirror, { success: s.success, fail: s.fail + 1 });
  mirrorCooldown.set(mirror, Date.now() + COOLDOWN_MS);
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number
): { promise: Promise<Response>; abort: () => void } {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  const promise = fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(id));
  return { promise, abort: () => controller.abort() };
}

function handleResponse(mirror: string) {
  return async (res: Response): Promise<{ data: unknown; mirror: string }> => {
    if (!res.ok) {
      recordFail(mirror);
      throw new Error(`${mirror} → HTTP ${res.status}`);
    }
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) {
      recordFail(mirror);
      throw new Error(`${mirror} → non-JSON`);
    }
    const data = await res.json();
    return { data, mirror };
  };
}

// ─── Core OSM fetch — races all mirrors, best gets 400ms head start ───────────

async function fetchFromOSM(body: string, timeoutMs: number): Promise<unknown | null> {
  const now = Date.now();

  const active = MIRRORS
    .filter(m => { const b = mirrorCooldown.get(m); return !b || b < now; })
    .sort((a, b) => getMirrorScore(b) - getMirrorScore(a));

  if (active.length === 0) {
    console.warn("[OSM] All mirrors in cooldown");
    return null;
  }

  const opts: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  };

  const [best, ...rest] = active;
  const bestFetcher = fetchWithTimeout(best, opts, timeoutMs);
  const restFetchers: ReturnType<typeof fetchWithTimeout>[] = [];

  const bestPromise = bestFetcher.promise.then(handleResponse(best));

  const restPromise = new Promise<never>((_, rej) =>
    setTimeout(rej, 400, new Error("head-start"))
  ).catch(() => {
    if (rest.length === 0) return Promise.reject(new Error("no-rest"));
    rest.forEach(m => restFetchers.push(fetchWithTimeout(m, opts, timeoutMs)));
    return Promise.any(
      restFetchers.map(({ promise }, i) => promise.then(handleResponse(rest[i])))
    );
  });

  try {
    const result = await Promise.any([bestPromise, restPromise]);
    bestFetcher.abort();
    restFetchers.forEach(f => f.abort());
    recordSuccess(result.mirror);
    return result.data;
  } catch (err: any) {
    bestFetcher.abort();
    restFetchers.forEach(f => f.abort());
    if (err instanceof AggregateError) {
      const real = err.errors.filter((e: any) => e?.name !== "AbortError");
      if (real.length) console.error("[OSM] All mirrors failed:", real.map((e: any) => e?.message));
    } else if (!["AbortError", "head-start", "no-rest"].includes(err?.message ?? "")) {
      console.error("[OSM] Unexpected:", err?.message);
    }
    return null;
  }
}

// ─── Background revalidation ──────────────────────────────────────────────────

function revalidateInBackground(cacheKey: string, body: string) {
  if (inFlight.has(cacheKey)) return; // already revalidating
  const p = (async () => {
    const data = await fetchFromOSM(body, 8_000);
    if (data !== null) {
      freshCache.set(cacheKey, { data, expires: Date.now() + FRESH_TTL });
      warmCache.set(cacheKey,  { data, expires: Date.now() + WARM_TTL });
      staleCache.set(cacheKey, data);
      console.log("[OSM] Background revalidation complete for", cacheKey.slice(0, 40));
    }
  })();
  inFlight.set(cacheKey, p);
  p.finally(() => inFlight.delete(cacheKey));
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (SKIP_OSM) {
    return NextResponse.json(
      { elements: [], error: "OSM_SKIPPED" },
      { headers: { "X-Cache": "SKIP" } }
    );
  }

  const body = await req.text();
  // NOTE: cache key is body (lat/lon/radius) — does NOT include sort order.
  // Sorting is done client-side so changing sort never triggers a re-fetch.
  const cacheKey = body.trim();
  const now = Date.now();

  // ── L1: Fresh cache — instant, no network ─────────────────────────────────
  const fresh = freshCache.get(cacheKey);
  if (fresh && fresh.expires > now) {
    return NextResponse.json(fresh.data, { headers: { "X-Cache": "FRESH" } });
  }

  // ── L2: Warm cache — instant return + revalidate silently in background ───
  const warm = warmCache.get(cacheKey);
  if (warm && warm.expires > now) {
    revalidateInBackground(cacheKey, body);
    return NextResponse.json(warm.data, { headers: { "X-Cache": "WARM" } });
  }

  // ── In-flight dedup ───────────────────────────────────────────────────────
  if (inFlight.has(cacheKey)) {
    const data = await inFlight.get(cacheKey)!;
    return NextResponse.json(data, { headers: { "X-Cache": "IN-FLIGHT" } });
  }

  // ── L3: Full network fetch ────────────────────────────────────────────────
  const fetchPromise = (async (): Promise<unknown> => {
    // First attempt — 6s timeout
    let data = await fetchFromOSM(body, 6_000);

    if (data === null && staleCache.has(cacheKey)) {
      // We have stale data — return it immediately and revalidate in background
      // User sees something instantly instead of waiting another 8s
      console.warn("[OSM] First attempt failed — serving stale instantly, retrying in background");
      const stale = staleCache.get(cacheKey)!;
      setTimeout(async () => {
        const fresh = await fetchFromOSM(body, 8_000);
        if (fresh !== null) {
          freshCache.set(cacheKey, { data: fresh, expires: Date.now() + FRESH_TTL });
          warmCache.set(cacheKey,  { data: fresh, expires: Date.now() + WARM_TTL });
          staleCache.set(cacheKey, fresh);
        }
      }, 0);
      return stale;
    }

    if (data === null) {
      // No stale data — single retry, user waits
      console.warn("[OSM] First attempt failed, no stale cache — retrying...");
      await new Promise(r => setTimeout(r, 300));
      data = await fetchFromOSM(body, 8_000);
    }

    if (data !== null) {
      freshCache.set(cacheKey, { data, expires: Date.now() + FRESH_TTL });
      warmCache.set(cacheKey,  { data, expires: Date.now() + WARM_TTL });
      staleCache.set(cacheKey, data);
      return data;
    }

    // Absolute last resort
    if (staleCache.has(cacheKey)) {
      console.warn("[OSM] All attempts failed — serving stale cache");
      return staleCache.get(cacheKey)!;
    }

    console.error("[OSM] Total failure — no data available");
    return { elements: [], error: "OSM_UNAVAILABLE" };
  })();

  inFlight.set(cacheKey, fetchPromise);
  try {
    const data = await fetchPromise;
    return NextResponse.json(data, { headers: { "X-Cache": "MISS" } });
  } finally {
    inFlight.delete(cacheKey);
  }
}