export const DIRECTIONS = ["nt", "et", "st", "wt", "ne", "se", "sw", "nw"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const DIRECTION_LABELS: Record<Direction, string> = {
  nt: "북",
  et: "동",
  st: "남",
  wt: "서",
  ne: "북동",
  se: "남동",
  sw: "남서",
  nw: "북서",
};

export interface Intersection {
  itstId: string;
  itstNm: string;
  lat: number;
  lng: number;
  /** 실시간 API를 구 단위로 조회할 때 쓰는 시군구 코드 */
  sggCd?: string;
}

/** 잔여시간은 T-Data 원본과 동일하게 1/10초 단위로 보관한다. null = 해당 방향 신호 없음 */
export type DirectionTimes = Partial<Record<Direction, number | null>>;

/** 신호 상태: 진행(녹색) / 정리(황색·보행 점멸) / 정지(적색) */
export type SignalPhase = "go" | "clear" | "stop";
export type DirectionPhases = Partial<Record<Direction, SignalPhase | null>>;

export interface SignalTiming {
  itstId: string;
  pedestrian: DirectionTimes;
  vehicle: DirectionTimes;
  pedestrianPhase?: DirectionPhases;
  vehiclePhase?: DirectionPhases;
}

export type SignalSource = "tdata" | "mock";

export interface SignalsResponse {
  source: SignalSource;
  /** 서버가 잔여시간을 얻은 시각 (epoch ms) */
  fetchedAt: number;
  signals: SignalTiming[];
  /** T-Data 원본이 송신된 시각 (가장 오래된 교차로 기준, epoch ms). 잔여시간은 이미 fetchedAt 기준으로 보정됨 */
  observedAt?: number;
  /** Mock으로 대체된 이유, 또는 실시간 데이터에 대한 안내 (한도·오류 등) */
  fallbackReason?: string;
  /** T-Data 일일 호출 한도 사용 현황. intervalSec = 현재 허용되는 호출 간격 */
  quota?: { used: number; limit: number; intervalSec: number | null };
}

export interface CustomRoute {
  id: number;
  route_name: string;
  description: string | null;
  intersections: Intersection[];
  is_favorite: boolean;
  created_at: string;
}

export interface RouteInput {
  route_name: string;
  description?: string | null;
  signal_ids: string[];
  is_favorite?: boolean;
}
