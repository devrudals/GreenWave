# GreenWave

서울 T-Data 신호제어기 잔여시간 API와 OpenFreeMap(MapLibre GL JS)으로 자주 다니는 구간의 신호등 잔여시간을 모니터링하는 웹앱.

## 실행

```bash
cp .env.example .env.local   # 키가 없으면 비워 둬도 동작 (Mock + 메모리 저장소)
npm install
npm run dev                  # http://localhost:3000
```

| 환경변수 | 없을 때 |
| --- | --- |
| `TDATA_API_KEY` | 신호 시뮬레이션(Mock) 사용 |
| `DATABASE_URL` (Neon) | 메모리 저장소 사용 (재시작 시 초기화) |
| `SIGNAL_MODE=mock` | 키가 있어도 강제로 Mock 사용 |

`custom_routes` 테이블은 첫 요청 시 자동 생성된다. 직접 만들려면 `db/schema.sql`을 Neon SQL Editor에서 실행한다.

## 구조

```
app/api/signals/route.ts       T-Data 프록시 (CORS·Mixed Content 회피, 3초 타임아웃 → Mock 폴백, 2초 캐시)
app/api/routes/route.ts        GET 목록 / POST 생성
app/api/routes/[id]/route.ts   PUT 수정 / DELETE 삭제
constants/intersections.ts     교차로 시드 (itstId → 이름, 좌표)
hooks/useSignals.ts            5초 폴링 + 1초 카운트다운 보간
hooks/useRoutes.ts             구간 CRUD 클라이언트
components/MapView.tsx         지도, 마커 뱃지, 상세 팝업, fitBounds
components/FocusBoard.tsx      집중 모니터링 보드
lib/mock.ts                    결정적 신호 시뮬레이터
lib/tdata.ts                   T-Data 응답 정규화 (1/10초 단위 유지)
lib/db.ts                      Neon / 메모리 저장소 + 입력 검증
```

## 참고

- 잔여시간은 API 원본(1/10초)으로 보관하고, 화면에 표시할 때 `Math.round((값 - 경과ms/100) / 10)`으로 초로 바꾼다.
- MapLibre v6 워커 파일은 `npm run dev/build` 전에 `public/`으로 복사된다 (`copy-worker` 스크립트).

## T-Data 연동 (2026-10-27 실호출로 확인)

| 용도 | 서비스 (data_id) | 엔드포인트 |
| --- | --- | --- |
| 실시간 신호 | (실시간) 신호제어기 신호정보 및 잔여시간 현시 정보 (10381) | `v2xSignalPhaseTimingFusionCurrentInfo/1.0` |
| 교차로 이름·좌표 | 교차로 Map 정보 (10121, CSV는 10144) | `v2xCrossroadMapInformation/1.0` |

- 실시간 API는 `sggCd`(시군구) 또는 `itstId`가 **필수**다. 서울 25개 구(`11010`~`11250`)에서 약 2,600곳이 조회된다.
- **실시간 API는 키당 하루 1,000회 한도**가 있다 (`X-RateLimit-Limit: 1000`, 한국시간 자정 초기화). 그래서 프록시는 다음 규칙으로 동작한다.
  - 클라이언트가 보고 있는 구(줌 13 이상일 때 화면 속 구 + 선택한 구간의 구, 최대 4개)만 갱신한다.
  - 호출 간격 = 자정까지 남은 시간 ÷ 남은 한도 (최소 15초), 한 번에 가장 오래된 구 1개만 갱신한다.
  - 구별 스냅샷과 오늘 호출 수, 429 차단 시각을 Neon(`signal_snapshots`, `tdata_usage`)에 저장해 서버리스 인스턴스끼리 공유한다.
  - 호출 사이에는 클라이언트가 1초 단위로 카운트다운을 보간한다. `TDATA_DAILY_BUDGET`(기본 900)으로 사용량을 조절할 수 있다.
- 교차로당 최신 1건이 오고 지연은 보통 1초 이내다. 다만 수십 일 전 레코드도 섞여 있어 **60초보다 오래된 레코드는 버린다**.
- `*StatNm`은 SAE J2735 상태값이다: `*-Movement-Allowed` → 진행, `*-clearance` → 정리(황색·보행 점멸), `stop-*` → 정지, `dark` → 소등.
- 잔여시간(`*RmdrCs`)은 1/10초 단위이고, `trsmUtcTime`부터 지난 시간만큼 서버에서 차감해 내려준다.
- 잔여시간 값의 약 7%는 `36001`(J2735 TimeMark "알 수 없음")이다. 36000 이상은 잔여시간 없음으로 처리하고 상태만 표시한다.
- **교차로 Map 정보 API는 6시간에 1회**만 호출된다. 응답은 `scripts/cache/crossroad-map.json`에 캐시하고, 다음 호출은 `numOfRows`를 크게 줘 한 번에 전부 받는다.
- 구 버전 `v2xSignalPhaseTimingInformation`은 5분에 1회 제한이 있는 이력 데이터라 사용하지 않는다.
- `DATABASE_URL`은 Neon의 **postgresql:// 연결 문자열**이어야 한다 (Data API의 `https://…/rest/v1` 주소는 사용 불가).

### 교차로 시드 생성

```bash
npm run build:intersections                 # 캐시된 Map 정보 사용 (없으면 API 호출)
npm run build:intersections -- --refresh    # Map 정보 API 재호출 (6시간 제한)
npm run build:intersections -- --csv 파일.csv  # T-Data에서 받은 교차로 MAP 정보 CSV 사용
npm run build:intersections -- --sgg 11130,11140  # 일부 구만
```

실시간 신호가 들어오면서 좌표도 있는 교차로만 `constants/intersections.json`에 저장된다. 지도는 수천 개 지점을 GeoJSON 레이어로 그리며, 줌 13부터 숫자를 표시한다.

## 배포 (Vercel)

환경변수 `TDATA_API_KEY`, `DATABASE_URL`을 등록한 뒤 배포한다.
