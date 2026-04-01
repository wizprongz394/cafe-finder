// app/api/osm/route.ts
import { NextRequest, NextResponse } from "next/server";

// Set SKIP_OSM=true in .env.local to bypass OSM entirely during local dev.
// OSM mirrors are often blocked by Indian ISPs — works fine on Vercel in prod.
const SKIP_OSM = process.env.SKIP_OSM === "true";

const MIRRORS = [
  "https://overpass.kumi.systems/api/interpreter",        // Best for Asia
  "https://overpass.private.coffee/api/interpreter",      // Europe, reliable
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];

// Fresh cache: 5 minutes
const cache = new Map<string, { data: unknown; expires: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

// Stale cache: never expires — serves last known good data when all mirrors fail
const staleCache = new Map<string, unknown>();

// Deduplicates concurrent identical requests
const inFlight = new Map<string, Promise<any>>();

// Per-mirror cooldown after failure
const mirrorCooldown = new Map<string, number>();
const COOLDOWN_MS = 60_000; // 60s cooldown per failed mirror

// Per-mirror success/fail tracking for smart sorting
const mirrorStats = new Map<string, { success: number; fail: number }>();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getMirrorSuccessRate(mirror: string): number {
  const s = mirrorStats.get(mirror) ?? { success: 0, fail: 0 };
  return s.success / (s.success + s.fail + 1);
}

function recordMirrorSuccess(mirror: string) {
  const s = mirrorStats.get(mirror) ?? { success: 0, fail: 0 };
  mirrorStats.set(mirror, { success: s.success + 1, fail: s.fail });
}

function recordMirrorFail(mirror: string) {
  const s = mirrorStats.get(mirror) ?? { success: 0, fail: 0 };
  mirrorStats.set(mirror, { success: s.success, fail: s.fail + 1 });
  mirrorCooldown.set(mirror, Date.now() + COOLDOWN_MS);
}

// Each mirror gets its own AbortController — no cross-contamination
function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number
): { promise: Promise<Response>; abort: () => void } {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  const promise = fetch(url, { ...options, signal: controller.signal }).finally(
    () => clearTimeout(id)
  );
  return { promise, abort: () => controller.abort() };
}

// Validates a mirror Response — throws on bad status or non-JSON
function handleMirrorResponse(mirror: string) {
  return async (res: Response): Promise<{ data: unknown; mirror: string }> => {
    if (!res.ok) {
      recordMirrorFail(mirror);
      throw new Error(`${mirror} → HTTP ${res.status}`);
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      recordMirrorFail(mirror);
      throw new Error(`${mirror} → non-JSON response`);
    }
    const data = await res.json();
    return { data, mirror };
  };
}

// One attempt across all active mirrors.
// Best mirror gets a 500ms head start, then all others race.
// Returns null if every mirror fails.
async function tryOSM(body: string, timeoutMs: number): Promise<unknown | null> {
  const now = Date.now();

  const activeMirrors = MIRRORS
    .filter((m) => {
      const blocked = mirrorCooldown.get(m);
      return !blocked || blocked < now;
    })
    .sort((a, b) => getMirrorSuccessRate(b) - getMirrorSuccessRate(a));

  if (activeMirrors.length === 0) {
    console.warn("[OSM] All mirrors in cooldown");
    return null;
  }

  const fetchOptions: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  };

  const [bestMirror, ...restMirrors] = activeMirrors;
  const bestFetcher = fetchWithTimeout(bestMirror, fetchOptions, timeoutMs);
  const restFetchers: ReturnType<typeof fetchWithTimeout>[] = [];

  const bestPromise = bestFetcher.promise.then(handleMirrorResponse(bestMirror));

  // Rest fire after 500ms head start — only if best hasn't resolved yet
  const restRacePromise = new Promise<never>((_, reject) =>
    setTimeout(reject, 500, new Error("head-start-delay"))
  ).catch(() => {
    if (restMirrors.length === 0) return Promise.reject(new Error("no-rest-mirrors"));
    restMirrors.forEach((m) =>
      restFetchers.push(fetchWithTimeout(m, fetchOptions, timeoutMs))
    );
    return Promise.any(
      restFetchers.map(({ promise }, i) =>
        promise.then(handleMirrorResponse(restMirrors[i]))
      )
    );
  });

  try {
    const result = await Promise.any([bestPromise, restRacePromise]);

    // Cancel all losers
    bestFetcher.abort();
    restFetchers.forEach(({ abort }) => abort());

    recordMirrorSuccess(result.mirror);
    return result.data;

  } catch (err: any) {
    bestFetcher.abort();
    restFetchers.forEach(({ abort }) => abort());

    // Only log real errors — ignore AbortError noise from cancellation
    if (err instanceof AggregateError) {
      const real = err.errors.filter((e: any) => e?.name !== "AbortError");
      if (real.length > 0) {
        console.error("[OSM] All mirrors failed:", real.map((e: any) => e?.message));
      }
    } else if (
      err?.name !== "AbortError" &&
      err?.message !== "head-start-delay" &&
      err?.message !== "no-rest-mirrors"
    ) {
      console.error("[OSM] Unexpected error:", err?.message);
    }

    return null;
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // In .env.local: SKIP_OSM=true → return empty immediately so Mapbox fills in
  if (SKIP_OSM) {
    return NextResponse.json(
      { elements: [], error: "OSM_SKIPPED" },
      { headers: { "X-Cache": "SKIP" } }
    );
  }

  const body = await req.text();
  const cacheKey = body.trim();

  // 1. Fresh cache hit
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return NextResponse.json(cached.data, { headers: { "X-Cache": "HIT" } });
  }

  // 2. Deduplicate — wait for in-flight identical request if one exists
  if (inFlight.has(cacheKey)) {
    const data = await inFlight.get(cacheKey)!;
    return NextResponse.json(data, { headers: { "X-Cache": "IN-FLIGHT" } });
  }

  const requestPromise = (async () => {
    // First attempt — fail fast at 6s so the UI doesn't freeze
    let data = await tryOSM(body, 6_000);

    // One retry after 500ms with a slightly longer window
    if (data === null) {
      console.warn("[OSM] First attempt failed, retrying...");
      await new Promise((r) => setTimeout(r, 500));
      data = await tryOSM(body, 8_000);
    }

    if (data !== null) {
      cache.set(cacheKey, { data, expires: Date.now() + CACHE_TTL_MS });
      staleCache.set(cacheKey, data);
      return data;
    }

    // Serve stale cache — better than empty results
    if (staleCache.has(cacheKey)) {
      console.warn("[OSM] Serving stale cache for this query");
      return staleCache.get(cacheKey);
    }

    console.error("[OSM] All mirrors failed, no stale cache available");
    return { elements: [], error: "OSM_UNAVAILABLE" };
  })();

  inFlight.set(cacheKey, requestPromise);
  try {
    const data = await requestPromise;
    return NextResponse.json(data, { headers: { "X-Cache": "MISS" } });
  } finally {
    inFlight.delete(cacheKey);
  }
}