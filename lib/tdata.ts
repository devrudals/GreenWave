import "server-only";
import {
  DIRECTIONS,
  type DirectionPhases,
  type DirectionTimes,
  type SignalPhase,
  type SignalTiming,
} from "./types";

// (실시간) 신호제어기 신호정보 및 잔여시간 현시 정보 서비스. sggCd 또는 itstId가 필수다
const DEFAULT_ENDPOINT =
  "https://t-data.seoul.go.kr/apig/apiman-gateway/tapi/v2xSignalPhaseTimingFusionCurrentInfo/1.0";
const TIMEOUT_MS = 5000;
/** 이보다 오래 전에 송신된 레코드는 장비 통신이 끊긴 것으로 보고 버린다 (실측 시 수십 일 전 레코드도 섞여 있음) */
const STALE_MS = 60_000;

type RawRecord = Record<string, unknown>;

/** 수신 시각(trsmUtcTime)이 붙은 잔여시간. 값은 1/10초 단위 원본 그대로 */
export interface ObservedSignal extends SignalTiming {
  observedAt: number;
}

/** T-Data가 반복 호출 제한(429)으로 거절했을 때 */
export class RateLimitError extends Error {
  constructor(public retryAt: number) {
    super(`T-Data 호출 제한 (${new Date(retryAt).toLocaleTimeString("ko-KR")} 이후 재호출 가능)`);
  }
}

/** J2735 TimeMark: 36000 = 1시간 이상, 36001 = 알 수 없음. 실측 시 약 7%가 36001이었다 */
const TIMEMARK_UNKNOWN = 36000;

function toTenths(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= 0 && n < TIMEMARK_UNKNOWN ? n : null;
}

/** SAE J2735 MovementPhaseState 이름을 화면용 3단계로 줄인다. dark/unavailable은 null */
function toPhase(value: unknown): SignalPhase | null {
  if (typeof value !== "string") return null;
  if (value.endsWith("Movement-Allowed")) return "go";
  if (value.endsWith("clearance")) return "clear";
  if (value.startsWith("stop")) return "stop";
  return null;
}

/** 배열 자체 또는 { response: { body: { items: { item } } } } 형태 모두 처리 */
function extractRecords(json: unknown): RawRecord[] {
  if (Array.isArray(json)) return json as RawRecord[];
  const body = (json as { response?: { body?: { items?: unknown } } })?.response?.body;
  const items = body?.items as { item?: unknown } | unknown[] | undefined;
  if (Array.isArray(items)) return items as RawRecord[];
  if (items && "item" in items) {
    const item = items.item;
    return Array.isArray(item) ? (item as RawRecord[]) : item ? [item as RawRecord] : [];
  }
  return [];
}

function normalize(record: RawRecord): ObservedSignal | null {
  if (record.itstId === undefined || record.itstId === null) return null;
  const observedAt = Number(record.trsmUtcTime);
  const pedestrian: DirectionTimes = {};
  const vehicle: DirectionTimes = {};
  const pedestrianPhase: DirectionPhases = {};
  const vehiclePhase: DirectionPhases = {};
  for (const d of DIRECTIONS) {
    pedestrian[d] = toTenths(record[`${d}PdsgRmdrCs`]);
    vehicle[d] = toTenths(record[`${d}StsgRmdrCs`]);
    pedestrianPhase[d] = toPhase(record[`${d}PdsgStatNm`]);
    vehiclePhase[d] = toPhase(record[`${d}StsgStatNm`]);
  }
  return {
    itstId: String(record.itstId),
    pedestrian,
    vehicle,
    pedestrianPhase,
    vehiclePhase,
    observedAt: Number.isFinite(observedAt) ? observedAt : Date.now(),
  };
}

async function fetchPage(apiKey: string, filter: { sggCd: string } | { itstId: string }): Promise<RawRecord[]> {
  const url = new URL(process.env.TDATA_API_URL || DEFAULT_ENDPOINT);
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("type", "json");
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("numOfRows", "1000");
  for (const [k, v] of Object.entries(filter)) url.searchParams.set(k, v);

  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  const json = await res.json().catch(() => null);

  if (res.status === 429) {
    const retryAfter = Number((json as { retryAfterSeconds?: unknown })?.retryAfterSeconds);
    throw new RateLimitError(Date.now() + (Number.isFinite(retryAfter) ? retryAfter : 300) * 1000);
  }
  if (!res.ok) {
    const message = (json as { message?: unknown })?.message;
    throw new Error(`T-Data HTTP ${res.status}${typeof message === "string" ? ` (${message})` : ""}`);
  }
  return extractRecords(json);
}

/**
 * 구(sggCd) 단위로 한 번에 조회하고, 구 코드를 모르는 교차로만 개별 조회한다.
 * 일부 요청이 실패해도 성공한 결과는 쓰고, 전부 실패하면 첫 오류를 던진다.
 */
export async function fetchTDataSignals(
  apiKey: string,
  targets: { sggCds: string[]; itstIds: string[] },
): Promise<ObservedSignal[]> {
  const filters = [
    ...targets.sggCds.map((sggCd) => ({ sggCd })),
    ...targets.itstIds.map((itstId) => ({ itstId })),
  ];
  const results = await Promise.allSettled(filters.map((f) => fetchPage(apiKey, f)));
  const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failures.length === results.length) throw failures[0]?.reason ?? new Error("조회 대상 없음");

  const now = Date.now();
  const latest = new Map<string, ObservedSignal>();
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const raw of r.value) {
      const s = normalize(raw);
      if (!s || now - s.observedAt > STALE_MS) continue;
      const prev = latest.get(s.itstId);
      if (!prev || s.observedAt >= prev.observedAt) latest.set(s.itstId, s);
    }
  }
  return [...latest.values()];
}

function shift(times: DirectionTimes, phases: DirectionPhases | undefined, elapsedTenths: number) {
  const outTimes: DirectionTimes = {};
  const outPhases: DirectionPhases = {};
  for (const d of DIRECTIONS) {
    const v = times[d];
    // 이미 끝난 신호(1초 이상 지남)는 다음 현시를 알 수 없으므로 비운다
    // 잔여시간을 모르는 방향(null)은 상태만 유지한다
    const expired = v != null && v - elapsedTenths < -10;
    outTimes[d] = v == null || expired ? null : Math.max(0, v - elapsedTenths);
    outPhases[d] = expired ? null : (phases?.[d] ?? null);
  }
  return [outTimes, outPhases] as const;
}

/** 수신 시각 이후 흐른 시간만큼 잔여시간을 차감해 `now` 기준 값으로 맞춘다 */
export function ageTo(signal: ObservedSignal, now: number): SignalTiming {
  const elapsed = Math.max(0, (now - signal.observedAt) / 100);
  const [pedestrian, pedestrianPhase] = shift(signal.pedestrian, signal.pedestrianPhase, elapsed);
  const [vehicle, vehiclePhase] = shift(signal.vehicle, signal.vehiclePhase, elapsed);
  return { itstId: signal.itstId, pedestrian, vehicle, pedestrianPhase, vehiclePhase };
}
