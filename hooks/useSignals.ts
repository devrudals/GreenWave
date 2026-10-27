"use client";

import { useEffect, useMemo, useState } from "react";
import type { SignalTiming, SignalsResponse } from "@/lib/types";

const POLL_MS = 5000;
const TICK_MS = 1000;

interface Snapshot {
  data: SignalsResponse;
  /** 응답을 받은 클라이언트 시각. 서버/클라이언트 시계 차이를 피하려고 로컬 시각을 기준으로 보간한다 */
  receivedAt: number;
}

export function useSignals() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0); // 프리렌더 시점 시각이 고정되지 않도록 첫 tick에서 채운다

  // 5초 폴링: 탭이 숨겨져 있으면 건너뛰고, 다시 보이면 즉시 갱신
  useEffect(() => {
    let cancelled = false;
    let controller: AbortController | null = null;

    async function poll() {
      if (document.hidden) return;
      controller?.abort();
      controller = new AbortController();
      try {
        const res = await fetch("/api/signals", { cache: "no-store", signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: SignalsResponse = await res.json();
        if (!cancelled) {
          const receivedAt = Date.now();
          setSnapshot({ data, receivedAt });
          setNow(receivedAt);
          setError(null);
        }
      } catch (err) {
        if (!cancelled && !(err instanceof DOMException && err.name === "AbortError")) {
          setError(err instanceof Error ? err.message : "신호 정보를 불러오지 못했습니다");
        }
      }
    }

    poll();
    const id = setInterval(poll, POLL_MS);
    document.addEventListener("visibilitychange", poll);
    return () => {
      cancelled = true;
      controller?.abort();
      clearInterval(id);
      document.removeEventListener("visibilitychange", poll);
    };
  }, []);

  // 폴링 사이 1초 카운트다운 보간
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const byId = useMemo(
    () => new Map<string, SignalTiming>(snapshot?.data.signals.map((s) => [s.itstId, s])),
    [snapshot],
  );

  return {
    byId,
    elapsedMs: snapshot ? Math.max(0, now - snapshot.receivedAt) : 0,
    source: snapshot?.data.source ?? null,
    fallbackReason: snapshot?.data.fallbackReason,
    lastUpdated: snapshot?.receivedAt ?? null,
    error,
  };
}

export type SignalState = ReturnType<typeof useSignals>;
