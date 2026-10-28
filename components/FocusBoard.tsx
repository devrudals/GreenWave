"use client";

import { Footprints, X } from "lucide-react";
import { PHASE_LABELS, remainingSeconds, representative, toneOf, type Tone } from "@/lib/signal";
import { DIRECTIONS, DIRECTION_LABELS, type CustomRoute, type SignalTiming } from "@/lib/types";

const TONE_STYLE: Record<Tone, string> = {
  none: "bg-zinc-100 text-zinc-400",
  go: "bg-emerald-50 text-emerald-700",
  clear: "bg-amber-50 text-amber-700 animate-pulse",
  stop: "bg-rose-50 text-rose-700",
};

export function FocusBoard({
  route,
  signals,
  simulatedIds,
  elapsedMs,
  onClose,
}: {
  route: CustomRoute;
  signals: Map<string, SignalTiming>;
  simulatedIds: Set<string>;
  elapsedMs: number;
  onClose: () => void;
}) {
  return (
    <section
      aria-label="집중 모니터링 보드"
      className="pointer-events-auto rounded-2xl border border-zinc-200 bg-white/95 p-3 shadow-xl backdrop-blur"
    >
      <header className="mb-2 flex items-center justify-between gap-2 px-1">
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-emerald-700">집중 모니터링</p>
          <h2 className="truncate text-base font-bold text-zinc-900">{route.route_name}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100"
          aria-label="집중 모니터링 닫기"
        >
          <X className="size-4" />
        </button>
      </header>

      <ol className="flex gap-2 overflow-x-auto pb-1">
        {route.intersections.map((itst, idx) => {
          const signal = signals.get(itst.itstId);
          const rep = representative(signal);
          const sec = remainingSeconds(rep.tenths, elapsedMs);
          return (
            <li
              key={itst.itstId}
              className={`flex w-40 shrink-0 flex-col rounded-xl p-3 ${TONE_STYLE[toneOf(rep.phase, sec)]}`}
            >
              <p className="truncate text-xs font-semibold text-zinc-700">
                <span className="mr-1 text-zinc-400">{idx + 1}</span>
                {itst.itstNm}
              </p>
              <p className="mt-1 text-[11px] font-semibold">
                {rep.phase && sec !== null ? `${rep.kind} ${PHASE_LABELS[rep.phase]}` : "\u00a0"}
                {simulatedIds.has(itst.itstId) && " · 시뮬레이션"}
              </p>
              <p className="mb-1 text-5xl font-black tabular-nums leading-none">
                {sec ?? "--"}
                {sec !== null && <span className="ml-0.5 text-lg font-bold">초</span>}
              </p>
              <div className="mt-auto flex flex-wrap gap-1 text-[11px] text-zinc-600">
                <Footprints className="size-3.5" aria-label="보행신호" />
                {DIRECTIONS.filter((d) => signal?.pedestrian[d] != null).map((d) => (
                  <span key={d} className="tabular-nums">
                    {DIRECTION_LABELS[d]} {remainingSeconds(signal!.pedestrian[d], elapsedMs)}
                  </span>
                ))}
                {!signal && <span>신호 없음</span>}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
