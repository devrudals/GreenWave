/**
 * constants/intersections.json 생성기.
 *
 *   node --env-file=.env scripts/build-intersections.mjs              # 교차로 Map 정보 Open API 사용
 *   node --env-file=.env scripts/build-intersections.mjs --csv 파일.csv  # T-Data 파일데이터(교차로 MAP 정보, CSV) 사용
 *   ... --sgg 11130,11140                                               # 특정 구만 포함
 *   ... --refresh                                                       # 캐시를 무시하고 Map 정보 API 재호출
 *
 * ⚠️ 교차로 Map 정보 API는 6시간에 1회만 호출된다. 응답은 scripts/cache/crossroad-map.json에 저장해 재사용한다.
 *
 * 1) 실시간 신호 API를 서울 25개 구 코드로 조회해 신호 데이터가 들어오는 교차로와 그 구 코드를 모은다.
 * 2) 교차로 Map 정보에서 이름과 좌표를 가져온다.
 * 3) 둘 다 있는 교차로만 남겨 저장한다.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const TAPI = "https://t-data.seoul.go.kr/apig/apiman-gateway/tapi";
const SIGNAL_API = `${TAPI}/v2xSignalPhaseTimingFusionCurrentInfo/1.0`;
const MAP_API = `${TAPI}/v2xCrossroadMapInformation/1.0`;
const OUT = new URL("../constants/intersections.json", import.meta.url);
const MAP_CACHE = new URL("./cache/crossroad-map.json", import.meta.url);
// 페이지마다 6시간 제한이 걸리므로 한 번에 전부 받는다
const MAP_ROWS = 20000;
// 서울 25개 구 (통계청 시군구 코드 11010~11250)
const SEOUL_SGG = Array.from({ length: 25 }, (_, i) => String(11010 + i * 10));
const SEOUL_BOUNDS = { minLat: 37.41, maxLat: 37.72, minLng: 126.76, maxLng: 127.19 };

const key = process.env.TDATA_API_KEY;
if (!key) {
  console.error("TDATA_API_KEY가 없습니다. node --env-file=.env 로 실행하세요.");
  process.exit(1);
}

const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const csvPath = argValue("--csv");
const sggFilter = argValue("--sgg")?.split(",");
const refresh = args.includes("--refresh");

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 120)}`);
  return JSON.parse(text);
}

async function liveIntersections() {
  const sggById = new Map();
  for (const sggCd of sggFilter ?? SEOUL_SGG) {
    const rows = await getJson(`${SIGNAL_API}?apikey=${key}&type=json&pageNo=1&numOfRows=1000&sggCd=${sggCd}`);
    for (const r of rows) sggById.set(String(r.itstId), sggCd);
    process.stdout.write(`\r실시간 신호 교차로 수집: ${sggCd} (${sggById.size}곳)`);
  }
  console.log();
  return sggById;
}

async function mapFromApi() {
  if (existsSync(MAP_CACHE) && !refresh) {
    const rows = JSON.parse(readFileSync(MAP_CACHE, "utf8"));
    console.log(`교차로 Map 정보: 캐시 사용 (${rows.length}건, --refresh로 재호출)`);
    return rows;
  }
  let batch;
  try {
    batch = await getJson(`${MAP_API}?apikey=${key}&type=json&pageNo=1&numOfRows=${MAP_ROWS}`);
  } catch (err) {
    console.error(`\n교차로 Map 정보 API 호출 실패: ${err.message}`);
    console.error("활용신청 여부와 6시간 호출 제한을 확인하거나 --csv 옵션을 사용하세요.");
    process.exit(1);
  }
  const rows = Array.isArray(batch) ? batch : (batch?.response?.body?.items?.item ?? []);
  mkdirSync(new URL("./cache/", import.meta.url), { recursive: true });
  writeFileSync(MAP_CACHE, JSON.stringify(rows));
  console.log(`교차로 Map 정보 수집: ${rows.length}건 → scripts/cache/crossroad-map.json`);
  if (rows.length >= MAP_ROWS) console.warn("⚠️ 한 번에 받은 행 수가 상한에 도달했습니다. 일부 교차로가 빠졌을 수 있습니다.");
  return rows;
}

function parseCsv(text) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter(Boolean);
  const split = (line) => line.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"').trim());
  const header = split(lines[0]);
  return lines.slice(1).map((line) => Object.fromEntries(split(line).map((v, i) => [header[i], v])));
}

function mapFromCsv(path) {
  const buf = readFileSync(path);
  let text = new TextDecoder("utf-8").decode(buf);
  if (text.includes("�")) text = new TextDecoder("euc-kr").decode(buf); // 공공데이터 CSV는 EUC-KR인 경우가 많다
  const rows = parseCsv(text);
  console.log(`CSV ${rows.length}행, 컬럼: ${Object.keys(rows[0] ?? {}).join(", ")}`);
  return rows;
}

function pick(row, ...names) {
  for (const n of names) if (row[n] !== undefined && row[n] !== "") return row[n];
  return undefined;
}

const sggById = await liveIntersections();
const mapRows = csvPath ? mapFromCsv(csvPath) : await mapFromApi();

const byId = new Map();
for (const row of mapRows) {
  const itstId = String(pick(row, "itstId", "ITST_ID", "교차로ID") ?? "");
  const itstNm = String(pick(row, "itstNm", "ITST_NM", "교차로명") ?? "").trim();
  const lat = Number(pick(row, "mapCtptIntLat", "MAP_CTPT_INT_LAT", "위도"));
  const lng = Number(pick(row, "mapCtptIntLot", "MAP_CTPT_INT_LOT", "경도"));
  const sggCd = sggById.get(itstId);
  if (!itstId || !itstNm || !sggCd) continue;
  const b = SEOUL_BOUNDS;
  if (!(lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng)) continue;
  byId.set(itstId, { itstId, itstNm, lat, lng, sggCd });
}

const result = [...byId.values()].sort((a, b) => a.sggCd.localeCompare(b.sggCd) || a.itstNm.localeCompare(b.itstNm, "ko"));
if (result.length === 0) {
  console.error("매칭된 교차로가 없습니다. 컬럼 이름이나 좌표 형식을 확인하세요. 파일은 바꾸지 않았습니다.");
  process.exit(1);
}
writeFileSync(OUT, JSON.stringify(result, null, 1) + "\n");
console.log(`저장: ${result.length}곳 (실시간 ${sggById.size}곳 중 좌표 매칭) → constants/intersections.json`);
