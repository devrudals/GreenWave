import { INTERSECTIONS } from "@/constants/intersections";
import type { Direction, DirectionPhases, DirectionTimes, SignalPhase, SignalTiming } from "./types";

/**
 * API 키가 없거나 T-Data 응답이 실패할 때 쓰는 신호 시뮬레이터.
 * 교차로마다 itstId로부터 결정되는 고정 주기를 갖기 때문에 같은 시각에는 항상 같은 값을 반환하고,
 * 폴링 사이의 클라이언트 보간과도 자연스럽게 이어진다.
 */

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// 남북(nt/st)과 동서(et/wt)가 주기의 절반씩 번갈아 녹색을 받는 2현시 모델
const GROUP_OFFSET: Partial<Record<Direction, 0 | 1>> = { nt: 0, st: 0, et: 1, wt: 1 };

type Segment = [SignalPhase, number];

/** 주기 위치 tau(1/10초)가 속한 구간의 상태와 그 구간이 끝날 때까지 남은 시간 */
function locate(tau: number, segments: Segment[]): { phase: SignalPhase; remaining: number } {
  let end = 0;
  for (const [phase, length] of segments) {
    end += length;
    if (tau < end) return { phase, remaining: end - tau };
  }
  return { phase: segments.at(-1)![0], remaining: 0 };
}

export function simulateSignal(itstId: string, now: number): SignalTiming {
  const h = hash(itstId);
  const cycle = (100 + (h % 61)) * 10; // 100~160초
  const half = cycle / 2;
  const vehGreen = Math.round(half * 0.85) - 30;
  const pedGreen = Math.round(half * 0.6) - 80;
  const vehicleCycle: Segment[] = [["go", vehGreen], ["clear", 30], ["stop", cycle - vehGreen - 30]];
  const pedestrianCycle: Segment[] = [["go", pedGreen], ["clear", 80], ["stop", cycle - pedGreen - 80]];
  const offset = (h >>> 8) % cycle;
  // 일부 교차로는 삼거리로 만들어 한 방향 신호를 비운다
  const missing: Direction | null = h % 5 === 0 ? (["nt", "et", "st", "wt"] as const)[(h >>> 4) % 4] : null;

  const t = Math.floor(now / 100) + offset;
  const pedestrian: DirectionTimes = {};
  const vehicle: DirectionTimes = {};
  const pedestrianPhase: DirectionPhases = {};
  const vehiclePhase: DirectionPhases = {};

  for (const [dir, group] of Object.entries(GROUP_OFFSET) as [Direction, 0 | 1][]) {
    if (dir === missing) continue;
    const veh = locate((t + group * half) % cycle, vehicleCycle);
    vehicle[dir] = veh.remaining;
    vehiclePhase[dir] = veh.phase;
    // 보행신호는 반대 그룹 차량 녹색 구간에 맞춰 켜진다
    const ped = locate((t + (1 - group) * half) % cycle, pedestrianCycle);
    pedestrian[dir] = ped.remaining;
    pedestrianPhase[dir] = ped.phase;
  }

  return { itstId, pedestrian, vehicle, pedestrianPhase, vehiclePhase };
}

export function simulateAll(now: number, ids?: string[]): SignalTiming[] {
  const targets = ids ?? INTERSECTIONS.map((i) => i.itstId);
  return targets.map((id) => simulateSignal(id, now));
}
