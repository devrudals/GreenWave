import { INTERSECTIONS, INTERSECTION_BY_ID } from "@/constants/intersections";

/** 이 줌보다 멀리서 볼 때는 화면 속 구를 갱신하지 않는다 (서울 전체를 보면 25개 구라 한도를 금방 쓴다) */
export const WATCH_MIN_ZOOM = 13;
export const MAX_WATCHED_DISTRICTS = 4;

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
  zoom: number;
}

/**
 * 실시간 갱신할 구 코드: 선택한 구간(또는 편집 중인 교차로)의 구를 먼저,
 * 그다음 화면에 교차로가 많이 보이는 구 순으로 최대 4개.
 */
export function districtsToWatch(viewport: Bounds | null, routeIds: string[]): string[] {
  const result: string[] = [];
  const add = (sgg: string | undefined) => {
    if (sgg && !result.includes(sgg)) result.push(sgg);
  };
  for (const id of routeIds) add(INTERSECTION_BY_ID.get(id)?.sggCd);

  if (viewport && viewport.zoom >= WATCH_MIN_ZOOM) {
    const counts = new Map<string, number>();
    for (const i of INTERSECTIONS) {
      if (!i.sggCd) continue;
      if (i.lng < viewport.west || i.lng > viewport.east || i.lat < viewport.south || i.lat > viewport.north) continue;
      counts.set(i.sggCd, (counts.get(i.sggCd) ?? 0) + 1);
    }
    for (const [sgg] of [...counts].sort((a, b) => b[1] - a[1])) add(sgg);
  }
  return result.slice(0, MAX_WATCHED_DISTRICTS).sort();
}
