"use client";

import {
  LngLatBounds,
  Map as MapLibreMap,
  NavigationControl,
  Popup,
  setWorkerUrl,
  type GeoJSONSource,
} from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { INTERSECTIONS, INTERSECTION_BY_ID } from "@/constants/intersections";
import { remainingSeconds, representative, toneOf } from "@/lib/signal";
import { WATCH_MIN_ZOOM, type Bounds } from "@/lib/districts";
import type { Intersection, SignalTiming } from "@/lib/types";
import { SignalDetail } from "./SignalDetail";

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const SEOUL_CENTER: [number, number] = [126.978, 37.5446];
const SOURCE_ID = "gw-intersections";
const CIRCLE_LAYER = "gw-circle";
// 숫자는 이 줌부터 표시한다 (그 아래에서는 신호색 점만). 실시간 갱신 시작 줌과 맞춘다
const LABEL_MIN_ZOOM = WATCH_MIN_ZOOM;

// 번들러가 MapLibre 워커 파일을 함께 내보내지 못하므로 public/에 복사한 파일을 쓴다 (npm run copy-worker)
setWorkerUrl("/maplibre-gl-worker.mjs");

export interface FitTarget {
  key: number;
  points: Intersection[];
}

interface Props {
  signals: Map<string, SignalTiming>;
  elapsedMs: number;
  selecting: boolean;
  selectedIds: string[];
  highlightIds: string[];
  fitTarget: FitTarget | null;
  onToggleSelect: (id: string) => void;
  onViewportChange?: (viewport: Bounds) => void;
}

type FeatureState = Pick<Props, "signals" | "elapsedMs" | "selecting" | "selectedIds" | "highlightIds">;

function viewportOf(map: MapLibreMap): Bounds {
  const b = map.getBounds();
  return { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth(), zoom: map.getZoom() };
}

/** 교차로 수천 곳을 DOM 마커 대신 GeoJSON 레이어로 그린다. 매초 이 데이터만 다시 넣는다 */
function buildFeatures({ signals, elapsedMs, selecting, selectedIds, highlightIds }: FeatureState) {
  const highlighted = new Set(highlightIds);
  return {
    type: "FeatureCollection" as const,
    features: INTERSECTIONS.map((itst) => {
      const rep = representative(signals.get(itst.itstId));
      const sec = remainingSeconds(rep.tenths, elapsedMs);
      const order = selectedIds.indexOf(itst.itstId);
      return {
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [itst.lng, itst.lat] },
        properties: {
          itstId: itst.itstId,
          label: sec === null ? "" : String(sec),
          tone: toneOf(rep.phase, sec),
          order: order >= 0 ? String(order + 1) : "",
          marked: order >= 0 || highlighted.has(itst.itstId),
          dimmed: selecting && order < 0,
        },
      };
    }),
  };
}

function addLayers(map: MapLibreMap, state: FeatureState) {
  map.addSource(SOURCE_ID, { type: "geojson", data: buildFeatures(state) });
  map.addLayer({
    id: CIRCLE_LAYER,
    type: "circle",
    source: SOURCE_ID,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 2.5, 12, 4.5, LABEL_MIN_ZOOM, 11, 16, 14],
      "circle-color": [
        "match",
        ["get", "tone"],
        "go", "#059669",
        "clear", "#d97706",
        "stop", "#e11d48",
        "#a1a1aa",
      ],
      "circle-stroke-color": ["case", ["get", "marked"], "#18181b", "#ffffff"],
      "circle-stroke-width": ["case", ["get", "marked"], 3, 1.5],
      "circle-opacity": ["case", ["get", "dimmed"], 0.45, 1],
      "circle-stroke-opacity": ["case", ["get", "dimmed"], 0.45, 1],
    },
  });
  map.addLayer({
    id: "gw-label",
    type: "symbol",
    source: SOURCE_ID,
    minzoom: LABEL_MIN_ZOOM,
    layout: {
      "text-field": ["get", "label"],
      "text-font": ["Noto Sans Bold"],
      "text-size": 12,
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: { "text-color": "#ffffff" },
  });
  // 구간 편집 중 선택 순서
  map.addLayer({
    id: "gw-order",
    type: "symbol",
    source: SOURCE_ID,
    filter: ["!=", ["get", "order"], ""],
    layout: {
      "text-field": ["get", "order"],
      "text-font": ["Noto Sans Bold"],
      "text-size": 11,
      "text-offset": [1.3, -1.3],
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: { "text-color": "#18181b", "text-halo-color": "#ffffff", "text-halo-width": 2 },
  });
}

export default function MapView({
  signals,
  elapsedMs,
  selecting,
  selectedIds,
  highlightIds,
  fitTarget,
  onToggleSelect,
  onViewportChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const [popupContainer] = useState(() =>
    typeof document === "undefined" ? null : document.createElement("div"),
  );
  const [popupId, setPopupId] = useState<string | null>(null);

  // 지도 이벤트 핸들러가 항상 최신 props를 보도록 ref로 전달
  const stateRef = useRef<FeatureState>({ signals, elapsedMs, selecting, selectedIds, highlightIds });
  const clickRef = useRef<(id: string) => void>(() => {});
  const viewportRef = useRef(onViewportChange);
  useEffect(() => {
    viewportRef.current = onViewportChange;
    stateRef.current = { signals, elapsedMs, selecting, selectedIds, highlightIds };
    clickRef.current = (id) => {
      if (selecting) onToggleSelect(id);
      else setPopupId(id);
    };
    // 1초마다(보간) 또는 선택이 바뀔 때 레이어 데이터 갱신
    const source = mapRef.current?.getSource<GeoJSONSource>(SOURCE_ID);
    source?.setData(buildFeatures(stateRef.current));
  }, [signals, elapsedMs, selecting, selectedIds, highlightIds, onToggleSelect, onViewportChange]);

  // 지도는 한 번만 만든다
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: STYLE_URL,
      center: SEOUL_CENTER,
      zoom: 12,
    });
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    map.on("load", () => {
      addLayers(map, stateRef.current);
      viewportRef.current?.(viewportOf(map));
    });
    // 화면에 보이는 구만 실시간 갱신하도록 상위에 알린다
    map.on("moveend", () => viewportRef.current?.(viewportOf(map)));
    map.on("click", CIRCLE_LAYER, (e) => {
      const id = e.features?.[0]?.properties?.itstId;
      if (typeof id === "string") clickRef.current(id);
    });
    map.on("mouseenter", CIRCLE_LAYER, () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", CIRCLE_LAYER, () => (map.getCanvas().style.cursor = ""));

    return () => {
      popupRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // 구간 선택 시 카메라 이동
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fitTarget || fitTarget.points.length === 0) return;
    const { points } = fitTarget;
    if (points.length === 1) {
      map.flyTo({ center: [points[0].lng, points[0].lat], zoom: 15 });
      return;
    }
    const bounds = new LngLatBounds();
    for (const p of points) bounds.extend([p.lng, p.lat]);
    const wide = window.innerWidth >= 768;
    map.fitBounds(bounds, {
      padding: wide
        ? { top: 80, bottom: 260, left: 440, right: 80 }
        : { top: 60, bottom: 320, left: 40, right: 40 },
      maxZoom: 16,
    });
  }, [fitTarget]);

  // 상세 팝업 열기/닫기
  useEffect(() => {
    const map = mapRef.current;
    popupRef.current?.remove();
    popupRef.current = null;
    const itst = popupId ? INTERSECTION_BY_ID.get(popupId) : undefined;
    if (!map || !itst || !popupContainer) return;

    const popup = new Popup({ offset: 16, maxWidth: "300px", closeOnClick: true })
      .setLngLat([itst.lng, itst.lat])
      .setDOMContent(popupContainer)
      .addTo(map);
    popup.on("close", () => setPopupId((cur) => (cur === itst.itstId ? null : cur)));
    popupRef.current = popup;
  }, [popupId, popupContainer]);

  // 선택 모드로 들어가면 열린 팝업은 닫는다
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 외부(지도) 상태와 동기화
    if (selecting) setPopupId(null);
  }, [selecting]);

  const popupItst = popupId ? INTERSECTION_BY_ID.get(popupId) : undefined;

  return (
    <>
      {/* maplibre-gl.css가 컨테이너에 position: relative를 주므로 바깥 div로 크기를 잡는다 */}
      <div className="absolute inset-0">
        <div ref={containerRef} className="h-full w-full" />
      </div>
      {popupContainer &&
        popupItst &&
        createPortal(
          <SignalDetail intersection={popupItst} signal={signals.get(popupItst.itstId)} elapsedMs={elapsedMs} />,
          popupContainer,
        )}
    </>
  );
}
