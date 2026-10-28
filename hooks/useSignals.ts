"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { INTERSECTIONS } from "@/constants/intersections";
import { simulateSignal } from "@/lib/mock";
import type { SignalTiming, SignalsResponse } from "@/lib/types";

const POLL_MS = 5000;
const TICK_MS = 1000;

interface Snapshot {
  data: SignalsResponse;
  /** 응답을 받은 클라이언트 시각. 서버/클라이언트 시계 차이를 피하려고 로컬 시각을 기준으로 보간한다 */
  receivedAt: number;
}

interface Options {
  /** 등록 구간의 구: 줌과 관계없이 항상 실시간 */
  routeDistricts: string[];
  /** 확대한 화면 속 구 */
  viewDistricts: string[];
  /** true면 실시간 값이 없는 교차로를 시뮬레이션 값으로 채운다 (확대 전) */
  fillSimulated: boolean;
}

export function useSignals({ routeDistricts, viewDistricts, fillSimulated }: Options) {
  const query = `route=${routeDistricts.join(",")}&view=${viewDistricts.join(",")}`;
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(0); // 프리렌더 시점 시각이 고정되지 않도록 첫 tick에서 채운다
  const pollRef = useRef<(force: boolean) => Promise<void>>(async () => {});

  // 5초 폴링: 탭이 숨겨져 있으면 건너뛰고, 다시 보이면 즉시 갱신
  useEffect(() => {
    let cancelled = false;
    let controller: AbortController | null = null;

    async function poll(force = false) {
      if (document.hidden && !force) return;
      controller?.abort();
      controller = new AbortController();
      try {
        const res = await fetch(`/api/signals?${query}${force ? "&force=1" : ""}`, {
          cache: "no-store",
          signal: controller.signal,
        });
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

    pollRef.current = poll;
    const onVisible = () => poll();
    poll();
    const id = setInterval(poll, POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      controller?.abort();
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // 조회할 구가 바뀌면 즉시 다시 받는다
  }, [query]);

  // 폴링 사이 1초 카운트다운 보간
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  /** 수동 새로고침: 5초를 기다리지 않고 바로 T-Data에서 다시 받는다 */
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await pollRef.current(true);
    } finally {
      setRefreshing(false);
    }
  }, []);

  const { byId, simulatedIds } = useMemo(() => {
    const map = new Map<string, SignalTiming>(snapshot?.data.signals.map((s) => [s.itstId, s]));
    const simulated = new Set<string>();
    if (snapshot?.data.source === "mock") {
      for (const id of map.keys()) simulated.add(id);
    } else if (snapshot && fillSimulated) {
      // 같은 수신 시각 기준으로 만들어야 실시간 값과 똑같이 1초씩 보간된다
      for (const i of INTERSECTIONS) {
        if (map.has(i.itstId)) continue;
        map.set(i.itstId, simulateSignal(i.itstId, snapshot.receivedAt));
        simulated.add(i.itstId);
      }
    }
    return { byId: map, simulatedIds: simulated };
  }, [snapshot, fillSimulated]);

  return {
    byId,
    simulatedIds,
    elapsedMs: snapshot ? Math.max(0, now - snapshot.receivedAt) : 0,
    source: snapshot?.data.source ?? null,
    fallbackReason: snapshot?.data.fallbackReason,
    quota: snapshot?.data.quota,
    observedAt: snapshot?.data.observedAt,
    lastUpdated: snapshot?.receivedAt ?? null,
    realCount: snapshot?.data.source === "tdata" ? snapshot.data.signals.length : 0,
    error,
    refresh,
    refreshing,
  };
}

export type SignalState = ReturnType<typeof useSignals>;
