import { connection, type NextRequest } from "next/server";
import { INTERSECTIONS, INTERSECTION_BY_ID } from "@/constants/intersections";
import { simulateAll } from "@/lib/mock";
import { ageTo, fetchTDataSignals, RateLimitError, type ObservedSignal } from "@/lib/tdata";
import type { SignalsResponse } from "@/lib/types";

// 여러 클라이언트가 동시에 폴링해도 T-Data는 짧은 주기로 한 번만 호출한다
const CACHE_TTL_MS = 2000;
let cache: { at: number; signals: ObservedSignal[] } | null = null;
let blockedUntil = 0;
let lastError: string | null = null;
let inflight: Promise<void> | null = null;

// 시드에 구 코드가 있으면 구 단위로 묶어 조회하고, 없는 교차로만 개별 조회한다 (demo- 예시 ID는 제외)
const REAL = INTERSECTIONS.filter((i) => !i.itstId.startsWith("demo-"));
const TARGETS = {
  sggCds: [...new Set(REAL.flatMap((i) => (i.sggCd ? [i.sggCd] : [])))],
  itstIds: REAL.filter((i) => !i.sggCd).map((i) => i.itstId),
};

function mockResponse(ids: string[] | undefined, fallbackReason?: string): SignalsResponse {
  const now = Date.now();
  return { source: "mock", fetchedAt: now, signals: simulateAll(now, ids), fallbackReason };
}

async function refresh(apiKey: string) {
  try {
    cache = { at: Date.now(), signals: await fetchTDataSignals(apiKey, TARGETS) };
    lastError = null;
  } catch (err) {
    if (err instanceof RateLimitError) blockedUntil = err.retryAt;
    lastError = err instanceof Error ? err.message : String(err);
    console.warn("[signals] T-Data 호출 실패:", lastError);
  }
}

async function loadAll(): Promise<SignalsResponse> {
  const apiKey = process.env.TDATA_API_KEY;
  if (process.env.SIGNAL_MODE === "mock" || !apiKey) {
    return mockResponse(undefined, apiKey ? undefined : "TDATA_API_KEY 미설정");
  }
  if (REAL.length === 0) {
    return mockResponse(undefined, "교차로 시드가 예시 데이터임 (npm run build:intersections 로 생성 필요)");
  }

  const now = Date.now();
  const stale = !cache || now - cache.at >= CACHE_TTL_MS;
  if (stale && now >= blockedUntil) {
    await (inflight ??= refresh(apiKey).finally(() => (inflight = null)));
  }
  if (!cache) return mockResponse(undefined, lastError ?? "T-Data 데이터 없음");

  // 지도에 표시할 수 있는(시드에 좌표가 있는) 교차로만 내려준다
  const matched = cache.signals.filter((s) => INTERSECTION_BY_ID.has(s.itstId));
  if (matched.length === 0) {
    return mockResponse(undefined, `수신된 실시간 교차로 ${cache.signals.length}곳 중 시드 좌표와 매칭되는 곳이 없음`);
  }

  const fetchedAt = Date.now();
  return {
    source: "tdata",
    fetchedAt,
    observedAt: Math.min(...matched.map((s) => s.observedAt)),
    signals: matched.map((s) => ageTo(s, fetchedAt)),
    fallbackReason: lastError ?? undefined,
  };
}

export async function GET(request: NextRequest) {
  await connection();
  const params = request.nextUrl.searchParams;
  const ids = params.get("ids")?.split(",").filter(Boolean);

  const data = params.get("mode") === "mock" ? mockResponse(undefined) : await loadAll();
  const body: SignalsResponse = ids
    ? { ...data, signals: data.signals.filter((s) => ids.includes(s.itstId)) }
    : data;

  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
