import { INTERSECTIONS, INTERSECTION_BY_ID } from "@/constants/intersections";

/** 이 줌 이상으로 확대하면 화면 속 구를 실시간으로 갱신한다. 그보다 멀리서는 시뮬레이션 값을 보여 준다 */
export const WATCH_MIN_ZOOM = 13;
export const MAX_ROUTE_DISTRICTS = 4;
export const MAX_VIEW_DISTRICTS = 2;

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
  zoom: number;
}

export function isZoomedIn(viewport: Bounds | null): boolean {
  return !!viewport && viewport.zoom >= WATCH_MIN_ZOOM;
}

/** 등록한 구간(또는 편집 중인 교차로)이 속한 구 — 줌과 관계없이 항상 실시간 */
export function routeDistricts(intersectionIds: string[]): string[] {
  const result: string[] = [];
  for (const id of intersectionIds) {
    const sgg = INTERSECTION_BY_ID.get(id)?.sggCd;
    if (sgg && !result.includes(sgg)) result.push(sgg);
  }
  return result.slice(0, MAX_ROUTE_DISTRICTS).sort();
}

/** 확대했을 때 화면에 교차로가 가장 많이 보이는 구 (최대 2개) */
export function viewDistricts(viewport: Bounds | null): string[] {
  if (!viewport || !isZoomedIn(viewport)) return [];
  const counts = new Map<string, number>();
  for (const i of INTERSECTIONS) {
    if (!i.sggCd) continue;
    if (i.lng < viewport.west || i.lng > viewport.east || i.lat < viewport.south || i.lat > viewport.north) continue;
    counts.set(i.sggCd, (counts.get(i.sggCd) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_VIEW_DISTRICTS)
    .map(([sgg]) => sgg)
    .sort();
}
