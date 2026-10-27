"use client";

import { Car, Footprints } from "lucide-react";
import { PHASE_LABELS, remainingSeconds, type Tone } from "@/lib/signal";
import {
  DIRECTIONS,
  DIRECTION_LABELS,
  type Intersection,
  type SignalPhase,
  type SignalTiming,
} from "@/lib/types";

const TONE_TEXT: Record<Tone, string> = {
  none: "text-zinc-400",
  go: "text-emerald-600",
  clear: "text-amber-600",
  stop: "text-rose-600",
};

function Cell({
  tenths,
  phase,
  elapsedMs,
}: {
  tenths: number | null | undefined;
  phase: SignalPhase | null | undefined;
  elapsedMs: number;
}) {
  const sec = remainingSeconds(tenths, elapsedMs);
  // 잔여시간을 모르면(J2735 unknown) 상태만 표시한다
  return (
    <span className={`tabular-nums font-semibold ${TONE_TEXT[phase ?? "none"]}`}>
      {phase ? PHASE_LABELS[phase] : ""}
      {sec === null ? (phase ? "" : "--") : `${phase ? " " : ""}${sec}초`}
    </span>
  );
}

export function SignalDetail({
  intersection,
  signal,
  elapsedMs,
}: {
  intersection: Intersection;
  signal: SignalTiming | undefined;
  elapsedMs: number;
}) {
  const directions = DIRECTIONS.filter(
    (d) =>
      signal?.pedestrian[d] != null ||
      signal?.vehicle[d] != null ||
      signal?.pedestrianPhase?.[d] != null ||
      signal?.vehiclePhase?.[d] != null,
  );

  return (
    <div className="w-64 text-zinc-800">
      <div className="mb-2">
        <p className="text-sm font-bold">{intersection.itstNm}</p>
        <p className="text-[11px] text-zinc-500">교차로 ID {intersection.itstId}</p>
      </div>
      {directions.length === 0 ? (
        <p className="py-2 text-xs text-zinc-500">수신된 신호 정보가 없습니다.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-zinc-500">
              <th className="py-1 text-left font-medium">방향</th>
              <th className="py-1 text-right font-medium">
                <Footprints className="inline size-3.5" aria-label="보행신호" /> 보행
              </th>
              <th className="py-1 text-right font-medium">
                <Car className="inline size-3.5" aria-label="차량직진" /> 직진
              </th>
            </tr>
          </thead>
          <tbody>
            {directions.map((d) => (
              <tr key={d} className="border-t border-zinc-100">
                <td className="py-1">{DIRECTION_LABELS[d]}</td>
                <td className="py-1 text-right">
                  <Cell tenths={signal?.pedestrian[d]} phase={signal?.pedestrianPhase?.[d]} elapsedMs={elapsedMs} />
                </td>
                <td className="py-1 text-right">
                  <Cell tenths={signal?.vehicle[d]} phase={signal?.vehiclePhase?.[d]} elapsedMs={elapsedMs} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-2 text-[10px] leading-tight text-zinc-400">
        잔여시간은 현재 신호가 바뀌기까지 남은 시간입니다. 실제 신호등을 우선 확인하세요.
      </p>
    </div>
  );
}
