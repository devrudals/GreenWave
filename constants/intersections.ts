import type { Intersection } from "@/lib/types";
import data from "./intersections.json";

/**
 * 서울시 교차로 시드 데이터.
 *
 * 실시간 API 응답에는 교차로명/좌표가 없으므로 itstId로 이 목록과 매핑해 지도에 표시한다.
 * `npm run build:intersections`가 T-Data 교차로 Map 정보와 실시간 신호 API를 합쳐 intersections.json을 다시 만든다.
 * (생성 전 기본값은 `demo-` 접두사가 붙은 예시라 실시간 데이터와 절대 매칭되지 않고, 시뮬레이션으로 표시된다)
 */
export const INTERSECTIONS: Intersection[] = data;

export const INTERSECTION_BY_ID = new Map(INTERSECTIONS.map((i) => [i.itstId, i]));
