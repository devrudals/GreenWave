import { connection, type NextRequest } from "next/server";
import { INTERSECTIONS, INTERSECTION_BY_ID } from "@/constants/intersections";
import { MAX_ROUTE_DISTRICTS, MAX_VIEW_DISTRICTS } from "@/lib/districts";
import { simulateAll } from "@/lib/mock";
import { kstDay, signalStore, type Snapshot, type Usage } from "@/lib/signalCache";
import { ageTo, fetchDistrict, RateLimitError } from "@/lib/tdata";
import type { SignalsResponse } from "@/lib/types";

/** 하루 1,000회 한도 중 실제로 쓸 양 (로컬 개발·재시도 여유분 제외) */
const DAILY_BUDGET = Number(process.env.TDATA_DAILY_BUDGET) || 900;
/** 같은 구는 이 간격보다 자주 다시 받지 않는다 (모든 사용자 공통) */
const REFRESH_MS = 5000;
/** 수동 새로고침은 이 간격까지 앞당길 수 있다 */
const FORCE_MIN_MS = 2000;
/** 남은 한도가 이보다 적으면 등록 구간의 구만 갱신한다 */
const ROUTE_RESERVE = 150;
const READ_CACHE_MS = 1000;

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

function districtParam(value: string | null, max: number): string[] {
  return [...new Set(value?.split(",") ?? [])].filter((s) => SEED_DISTRICTS.has(s)).slice(0, max);
}

async function recentSnapshots(): Promise<Snapshot[]> {
  if (readCache && Date.now() - readCache.at < READ_CACHE_MS) return readCache.snapshots;
  const snapshots = await signalStore.recent();
  readCache = { at: Date.now(), snapshots };
  return snapshots;
}

/**
 * 요청된 구 중 마지막 갱신 후 5초(수동 새로고침은 2초)가 지난 구를 다시 받는다.
 * 한도가 얼마 남지 않으면 등록 구간의 구만 갱신해, 가장 중요한 구간이 끝까지 실시간으로 보이게 한다.
 */
async function refreshDue(
  apiKey: string,
  routeDistricts: string[],
  viewDistricts: string[],
  snapshots: Snapshot[],
  usage: Usage,
  force: boolean,
) {
  const now = Date.now();
  const left = DAILY_BUDGET - usage.calls;
  if (now < usage.blockedUntil || left <= 0) return;

  const candidates = left < ROUTE_RESERVE ? routeDistricts : [...routeDistricts, ...viewDistricts];
  const minAge = force ? FORCE_MIN_MS : REFRESH_MS;
  const fetchedAt = (sgg: string) => snapshots.find((s) => s.sggCd === sgg)?.fetchedAt ?? 0;
  const due = [...new Set(candidates)].filter((sgg) => now - fetchedAt(sgg) >= minAge).slice(0, left);
  if (due.length === 0) return;

  const day = kstDay(now);
  // 인스턴스 간 중복 호출을 줄이려고 호출 전에 먼저 기록한다
  await signalStore.recordCalls(day, due.length, now);
  const results = await Promise.allSettled(
    due.map(async (sggCd) => {
      const signals = await fetchDistrict(apiKey, sggCd);
      await signalStore.save({ sggCd, fetchedAt: now, signals });
    }),
  );
  readCache = null;
  const failure = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  lastError = failure ? (failure.reason instanceof Error ? failure.reason.message : String(failure.reason)) : null;
  if (failure?.reason instanceof RateLimitError) await signalStore.block(day, failure.reason.retryAt);
  if (lastError) console.warn("[signals] T-Data 호출 실패:", lastError);
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

  // route = 등록 구간의 구 (줌과 관계없이 항상), view = 확대한 화면 속 구
  const routeDistricts = districtParam(params.get("route"), MAX_ROUTE_DISTRICTS);
  const viewDistricts = districtParam(params.get("view"), MAX_VIEW_DISTRICTS);
  const requested = new Set([...routeDistricts, ...viewDistricts]);
  const force = params.get("force") === "1";

  let snapshots = await recentSnapshots();
  let usage = await signalStore.usage(kstDay());
  if (requested.size > 0) {
    await (inflight ??= refreshDue(apiKey, routeDistricts, viewDistricts, snapshots, usage, force).finally(
      () => (inflight = null),
    ));
    snapshots = await recentSnapshots();
    usage = await signalStore.usage(kstDay());
  }

  const now = Date.now();
  // 요청한 구의 값만 실시간으로 내려주고, 나머지는 브라우저가 필요하면 시뮬레이션으로 채운다
  const observed = snapshots
    .filter((s) => requested.has(s.sggCd))
    .flatMap((s) => s.signals)
    .filter((s) => INTERSECTION_BY_ID.has(s.itstId));
  const blocked = now < usage.blockedUntil;
  const exhausted = usage.calls >= DAILY_BUDGET;
  const left = DAILY_BUDGET - usage.calls;
  const quota = { used: usage.calls, limit: DAILY_BUDGET, intervalSec: blocked || exhausted ? null : REFRESH_MS / 1000 };
  const resumeAt = new Date(blocked ? usage.blockedUntil : now).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul" });
  const reason = blocked
    ? `T-Data 일일 호출 한도 초과 (${resumeAt} 이후 재개)`
    : exhausted
      ? `오늘 사용할 호출 수(${DAILY_BUDGET}회)를 모두 사용함 (자정에 초기화)`
      : left < ROUTE_RESERVE
        ? "남은 호출 수가 적어 등록 구간만 실시간으로 갱신 중"
        : (lastError ?? undefined);

  if (observed.length === 0 && (blocked || exhausted)) {
    return Response.json({ ...mockResponse(reason), quota });
  }

  const body: SignalsResponse = {
    source: "tdata",
    fetchedAt: now,
    observedAt: observed.length ? Math.min(...observed.map((s) => s.observedAt)) : undefined,
    signals: observed.map((s) => ageTo(s, now)),
    fallbackReason: reason,
    quota,
  };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
