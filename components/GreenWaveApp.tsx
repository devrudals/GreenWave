"use client";

import { ChevronDown, ChevronUp, Plus, Radio, RefreshCw, TrafficCone } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";
import { toInput, useRoutes } from "@/hooks/useRoutes";
import { useSignals } from "@/hooks/useSignals";
import { isZoomedIn, routeDistricts, viewDistricts, type Bounds } from "@/lib/districts";
import type { CustomRoute } from "@/lib/types";
import { FocusBoard } from "./FocusBoard";
import type { FitTarget } from "./MapView";
import { RouteForm } from "./RouteForm";
import { RouteList } from "./RouteList";

const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 animate-pulse bg-zinc-100" />,
});

type Mode = { kind: "browse" } | { kind: "create" } | { kind: "edit"; route: CustomRoute };

export function GreenWaveApp() {
  const { routes, storage, loading, error: routesError, create, update, remove } = useRoutes();

  const [mode, setMode] = useState<Mode>({ kind: "browse" });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [fitTarget, setFitTarget] = useState<FitTarget | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [viewport, setViewport] = useState<Bounds | null>(null);

  const selecting = mode.kind !== "browse";
  const activeRoute = routes.find((r) => r.id === activeId) ?? null;

  // 등록한 구간(편집 중이면 선택한 교차로 포함)의 구는 줌과 관계없이 항상 실시간으로 갱신한다
  const routeIds = useMemo(
    () => [...(selecting ? selectedIds : []), ...routes.flatMap((r) => r.intersections.map((i) => i.itstId))],
    [routes, selecting, selectedIds],
  );
  const zoomedIn = isZoomedIn(viewport);
  const routeDistrictList = useMemo(() => routeDistricts(routeIds), [routeIds]);
  // 확대했을 때만 화면 속 구를 실시간으로 받고, 확대 전에는 나머지를 시뮬레이션 값으로 채운다
  const viewDistrictList = useMemo(() => viewDistricts(viewport), [viewport]);
  const signals = useSignals({
    routeDistricts: routeDistrictList,
    viewDistricts: viewDistrictList,
    fillSimulated: !zoomedIn,
  });

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }, []);

  function focusRoute(route: CustomRoute) {
    setActiveId(route.id);
    setFitTarget({ key: Date.now(), points: route.intersections });
    // 모바일에서는 지도와 보드가 보이도록 패널을 접는다
    if (window.innerWidth < 768) setPanelOpen(false);
  }

  function startCreate() {
    setMode({ kind: "create" });
    setSelectedIds([]);
    setActiveId(null);
  }

  function startEdit(route: CustomRoute) {
    setMode({ kind: "edit", route });
    setSelectedIds(route.intersections.map((i) => i.itstId));
    setActiveId(null);
    setFitTarget({ key: Date.now(), points: route.intersections });
  }

  function endEdit() {
    setMode({ kind: "browse" });
    setSelectedIds([]);
  }

  async function handleSubmit(fields: { route_name: string; description?: string | null }) {
    const input = { ...fields, signal_ids: selectedIds };
    const saved =
      mode.kind === "edit"
        ? await update(mode.route.id, { ...input, is_favorite: mode.route.is_favorite })
        : await create(input);
    endEdit();
    focusRoute(saved);
  }

  async function handleDelete(route: CustomRoute) {
    if (!confirm(`'${route.route_name}' 구간을 삭제할까요?`)) return;
    try {
      await remove(route.id);
      if (activeId === route.id) setActiveId(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleToggleFavorite(route: CustomRoute) {
    try {
      await update(route.id, { ...toInput(route), is_favorite: !route.is_favorite });
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-zinc-100">
      <MapView
        signals={signals.byId}
        simulatedIds={signals.simulatedIds}
        elapsedMs={signals.elapsedMs}
        selecting={selecting}
        selectedIds={selectedIds}
        highlightIds={activeRoute?.intersections.map((i) => i.itstId) ?? []}
        fitTarget={fitTarget}
        onToggleSelect={toggleSelect}
        onViewportChange={setViewport}
      />

      {/* 사이드바 (모바일: 바텀시트) */}
      <aside
        className="absolute inset-x-0 bottom-0 z-10 flex max-h-[60dvh] flex-col rounded-t-2xl border border-zinc-200 bg-white shadow-2xl md:inset-x-auto md:bottom-auto md:left-4 md:top-4 md:max-h-[calc(100dvh-2rem)] md:w-96 md:rounded-2xl"
      >
        <header className="flex items-center gap-2 border-b border-zinc-100 px-4 py-3">
          <TrafficCone className="size-5 text-emerald-600" />
          <h1 className="text-lg font-black tracking-tight text-zinc-900">GreenWave</h1>
          <SourceBadge
            live={signals.source === "tdata" && signals.realCount > 0}
            zoomedIn={zoomedIn}
            reason={signals.fallbackReason}
            error={signals.error}
          />
          <button
            type="button"
            onClick={signals.refresh}
            disabled={signals.refreshing}
            className="ml-auto rounded-md p-1 text-zinc-500 hover:bg-zinc-100 hover:text-emerald-700 disabled:opacity-60"
            aria-label="실시간 신호 지금 새로고침"
            title="실시간 신호 지금 새로고침"
          >
            <RefreshCw className={`size-4 ${signals.refreshing ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={() => setPanelOpen((o) => !o)}
            className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100"
            aria-label={panelOpen ? "패널 접기" : "패널 펼치기"}
          >
            {panelOpen ? <ChevronDown className="size-5 md:rotate-180" /> : <ChevronUp className="size-5 md:rotate-180" />}
          </button>
        </header>

        {panelOpen && signals.source === "tdata" && signals.quota && (
          <p className="border-b border-zinc-100 px-4 py-1.5 text-[11px] text-zinc-500">
            T-Data 오늘 호출 {signals.quota.used}/{signals.quota.limit}회
            {signals.quota.intervalSec !== null && ` · ${signals.quota.intervalSec}초마다 갱신`}
            {signals.observedAt &&
              signals.lastUpdated &&
              ` · 가장 오래된 값 ${Math.max(0, Math.round((signals.lastUpdated + signals.elapsedMs - signals.observedAt) / 1000))}초 전`}
          </p>
        )}
        {panelOpen && signals.source === "tdata" && !zoomedIn && (
          <p className="border-b border-zinc-100 px-4 py-1.5 text-[11px] leading-snug text-zinc-500">
            확대 전에는 등록한 구간만 실시간이고, 나머지 옅은 점은 시뮬레이션 값입니다. 지도를 확대하면 그 지역도 실시간으로 바뀝니다.
          </p>
        )}
        {panelOpen && signals.fallbackReason && (
          <p className="border-b border-zinc-100 bg-zinc-50 px-4 py-2 text-[11px] leading-snug text-zinc-500">
            {signals.source === "mock" && "시뮬레이션 사용 중 · "}
            {signals.fallbackReason}
          </p>
        )}

        {panelOpen && (
          <div className="flex-1 overflow-y-auto p-4">
            {selecting ? (
              <>
                <h2 className="mb-3 text-sm font-bold text-zinc-900">
                  {mode.kind === "edit" ? "구간 수정" : "새 구간 만들기"}
                </h2>
                <RouteForm
                  key={mode.kind === "edit" ? mode.route.id : "new"}
                  initial={
                    mode.kind === "edit"
                      ? { route_name: mode.route.route_name, description: mode.route.description ?? "" }
                      : { route_name: "", description: "" }
                  }
                  selectedIds={selectedIds}
                  onRemoveId={toggleSelect}
                  onSubmit={handleSubmit}
                  onCancel={endEdit}
                />
              </>
            ) : (
              <>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-bold text-zinc-900">내 모니터링 구간</h2>
                  <button
                    type="button"
                    onClick={startCreate}
                    className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                  >
                    <Plus className="size-3.5" /> 새 구간
                  </button>
                </div>
                {routesError && <p className="mb-2 text-xs text-rose-600">{routesError}</p>}
                <RouteList
                  routes={routes}
                  activeId={activeId}
                  loading={loading}
                  onSelect={focusRoute}
                  onEdit={startEdit}
                  onDelete={handleDelete}
                  onToggleFavorite={handleToggleFavorite}
                />
                {storage === "memory" && (
                  <p className="mt-4 rounded-lg bg-amber-50 p-2 text-[11px] leading-relaxed text-amber-800">
                    DATABASE_URL이 없거나 postgresql:// 형식이 아니어서 메모리에 임시 저장 중입니다. 서버를 재시작하면 사라집니다.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </aside>

      {/* 집중 모니터링 보드 */}
      {activeRoute && !selecting && (
        <div className="pointer-events-none absolute inset-x-2 bottom-16 z-20 md:bottom-4 md:left-[26rem] md:right-4">
          <FocusBoard
            route={activeRoute}
            signals={signals.byId}
            simulatedIds={signals.simulatedIds}
            elapsedMs={signals.elapsedMs}
            onClose={() => setActiveId(null)}
          />
        </div>
      )}

      {selecting && (
        <div className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-full bg-zinc-900/85 px-4 py-2 text-xs font-medium text-white shadow-lg md:left-[calc(50%+13rem)]">
          교차로를 클릭해 구간에 추가/제외하세요 · {selectedIds.length}개 선택됨
        </div>
      )}
    </main>
  );
}

function SourceBadge({
  live,
  zoomedIn,
  reason,
  error,
}: {
  live: boolean;
  zoomedIn: boolean;
  reason?: string;
  error: string | null;
}) {
  if (error) {
    return <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700">연결 오류</span>;
  }
  const label = !live ? "시뮬레이션" : zoomedIn ? "실시간" : "구간 실시간";
  return (
    <span
      title={reason ?? (live ? "서울 T-Data 실시간" : "시뮬레이션 데이터")}
      className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
        live ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-600"
      }`}
    >
      <Radio className={`size-3 ${live ? "animate-pulse" : ""}`} />
      {label}
    </span>
  );
}
