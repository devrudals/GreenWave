import { DIRECTIONS, type DirectionPhases, type DirectionTimes, type SignalPhase, type SignalTiming } from "./types";

/** 1/10초 값을 경과시간만큼 차감해 초 단위로 변환한다. 값이 없으면 null. */
export function remainingSeconds(tenths: number | null | undefined, elapsedMs: number): number | null {
  if (tenths == null) return null;
  return Math.max(0, Math.round((tenths - elapsedMs / 100) / 10));
}

export interface Representative {
  tenths: number | null;
  phase: SignalPhase | null;
  kind: "보행" | "직진" | null;
}

function soonest(
  times: DirectionTimes,
  phases: DirectionPhases | undefined,
  kind: Representative["kind"],
): Representative | null {
  let best: Representative | null = null;
  for (const d of DIRECTIONS) {
    const v = times[d];
    if (v != null && v > 0 && (best === null || v < best.tenths!)) {
      best = { tenths: v, phase: phases?.[d] ?? null, kind };
    }
  }
  return best;
}

/** 마커 뱃지에 쓸 대표값: 가장 먼저 바뀌는 보행신호, 없으면 차량신호 */
export function representative(signal: SignalTiming | undefined): Representative {
  const none: Representative = { tenths: null, phase: null, kind: null };
  if (!signal) return none;
  return (
    soonest(signal.pedestrian, signal.pedestrianPhase, "보행") ??
    soonest(signal.vehicle, signal.vehiclePhase, "직진") ??
    none
  );
}

/** 화면 색상 단계. 상태 정보가 없으면 none */
export type Tone = SignalPhase | "none";

export function toneOf(phase: SignalPhase | null | undefined, seconds: number | null): Tone {
  return seconds === null || !phase ? "none" : phase;
}

export const PHASE_LABELS: Record<SignalPhase, string> = {
  go: "진행",
  clear: "정리",
  stop: "정지",
};
