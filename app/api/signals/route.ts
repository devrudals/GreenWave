import { connection, type NextRequest } from "next/server";
import { INTERSECTIONS, INTERSECTION_BY_ID } from "@/constants/intersections";
import { simulateAll } from "@/lib/mock";
import { kstDay, msUntilKstMidnight, signalStore, type Snapshot, type Usage } from "@/lib/signalCache";
import { ageTo, fetchDistrict, RateLimitError } from "@/lib/tdata";
import type { SignalsResponse } from "@/lib/types";

/** 하루 1,000회 한도 중 실제로 쓸 양 (로컬 개발·재시도 여유분 제외) */
const DAILY_BUDGET = Number(process.env.TDATA_DAILY_BUDGET) || 900;
/** 남은 한도가 넉넉해도 이보다 자주 호출하지 않는다 */
const MIN_GAP_MS = 15_000;
/** 한 요청에서 갱신 대상으로 받는 구 수 상한 */
const MAX_DISTRICTS = 4;
const READ_CACHE_MS = 2000;

// demo- 예시 ID는 실시간 조회 대상이 아니다
const REAL = INTERSECTIONS.filter((i) => !i.itstId.startsWith("demo-"));
const SEED_DISTRICTS = new Set(REAL.flatMap((i) => (i.sggCd ? [i.sggCd] : [])));

let readCache: { at: number; snapshots: Snapshot[] } | null = null;
let inflight: Promise<void> | null = null;
let lastError: string | null = null;

function mockResponse(fallbackReason?: string): SignalsResponse {
  const now = Date.now();
  return { source: "mock", fetchedAt: now, signals: simulateAll(now), fallbackReason };
}

async function recentSnapshots(): Promise<Snapshot[]> {
  if (readCache && Date.now() - readCache.at < READ_CACHE_MS) return readCache.snapshots;
  const snapshots = await signalStore.recent();
  readCache = { at: Date.now(), snapshots };
  return snapshots;
}

/** 남은 한도를 자정까지 고르게 쓰도록 호출 간격을 정한다 */
function pacingGapMs(usage: Usage, now: number): number {
  const left = DAILY_BUDGET - usage.calls;
  return left <= 0 ? Infinity : Math.max(MIN_GAP_MS, msUntilKstMidnight(now) / left);
}

/** 요청된 구 중 가장 오래된 것 하나를, 한도와 간격이 허락할 때만 갱신한다 */
async function maybeRefresh(apiKey: string, requested: string[], snapshots: Snapshot[], usage: Usage) {
  const now = Date.now();
  if (now < usage.blockedUntil || now - usage.lastCallAt < pacingGapMs(usage, now)) return;

  const fetchedAt = (sgg: string) => snapshots.find((s) => s.sggCd === sgg)?.fetchedAt ?? 0;
  const target = [...requested].sort((a, b) => fetchedAt(a) - fetchedAt(b))[0];
  if (!target || now - fetchedAt(target) < MIN_GAP_MS) return;

  const day = kstDay(now);
  // 인스턴스 간 중복 호출을 줄이려고 호출 전에 먼저 기록한다
  await signalStore.recordCall(day, now);
  try {
    const signals = await fetchDistrict(apiKey, target);
    await signalStore.save({ sggCd: target, fetchedAt: now, signals });
    readCache = null;
    lastError = null;
  } catch (err) {
    if (err instanceof RateLimitError) await signalStore.block(day, err.retryAt);
    lastError = err instanceof Error ? err.message : String(err);
    console.warn("[signals] T-Data 호출 실패:", lastError);
  }
}

export async function GET(request: NextRequest) {
  await connection();
  const params = request.nextUrl.searchParams;
  const apiKey = process.env.TDATA_API_KEY;

  if (params.get("mode") === "mock" || process.env.SIGNAL_MODE === "mock" || !apiKey) {
    return Response.json(mockResponse(apiKey ? undefined : "TDATA_API_KEY 미설정"));
  }
  if (REAL.length === 0) {
    return Response.json(mockResponse("교차로 시드가 예시 데이터임 (npm run build:intersections 로 생성 필요)"));
  }

  const requested = (params.get("sgg")?.split(",") ?? [])
    .filter((s) => SEED_DISTRICTS.has(s))
    .slice(0, MAX_DISTRICTS);

  let snapshots = await recentSnapshots();
  let usage = await signalStore.usage(kstDay());
  if (requested.length > 0) {
    await (inflight ??= maybeRefresh(apiKey, requested, snapshots, usage).finally(() => (inflight = null)));
    snapshots = await recentSnapshots();
    usage = await signalStore.usage(kstDay());
  }

  const now = Date.now();
  const observed = snapshots.flatMap((s) => s.signals).filter((s) => INTERSECTION_BY_ID.has(s.itstId));
  const blocked = now < usage.blockedUntil;
  const gap = pacingGapMs(usage, now);
  const quota = {
    used: usage.calls,
    limit: DAILY_BUDGET,
    intervalSec: Number.isFinite(gap) ? Math.round(gap / 1000) : null,
  };
  const resumeAt = new Date(usage.blockedUntil).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul" });
  const blockedReason = `T-Data 일일 호출 한도 초과 (${resumeAt} 이후 재개)`;

  if (observed.length === 0 && (blocked || lastError)) {
    return Response.json({ ...mockResponse(blocked ? blockedReason : (lastError ?? undefined)), quota });
  }

  const body: SignalsResponse = {
    source: "tdata",
    fetchedAt: now,
    observedAt: observed.length ? Math.min(...observed.map((s) => s.observedAt)) : undefined,
    signals: observed.map((s) => ageTo(s, now)),
    fallbackReason: blocked
      ? `${blockedReason} · 마지막 수신값 표시 중`
      : observed.length === 0
        ? "지도를 확대하거나 구간을 선택하면 해당 구의 실시간 신호를 불러옵니다"
        : (lastError ?? undefined),
    quota,
  };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
