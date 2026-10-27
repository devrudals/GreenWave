import "server-only";
import { neon } from "@neondatabase/serverless";
import { INTERSECTION_BY_ID } from "@/constants/intersections";
import type { CustomRoute, Intersection, RouteInput } from "./types";

export class ValidationError extends Error {}

export interface ValidRoute {
  route_name: string;
  description: string | null;
  intersections: Intersection[];
  is_favorite: boolean;
}

/** 요청 본문을 검증하고 signal_ids를 시드 데이터의 교차로 객체로 변환한다 */
export function validateRouteInput(body: unknown): ValidRoute {
  const input = (body ?? {}) as Partial<RouteInput>;
  const name = typeof input.route_name === "string" ? input.route_name.trim() : "";
  if (!name) throw new ValidationError("구간 이름을 입력하세요");
  if (name.length > 100) throw new ValidationError("구간 이름은 100자 이하여야 합니다");

  if (input.description != null && typeof input.description !== "string") {
    throw new ValidationError("메모 형식이 올바르지 않습니다");
  }

  if (!Array.isArray(input.signal_ids) || input.signal_ids.length === 0) {
    throw new ValidationError("교차로를 1개 이상 선택하세요");
  }
  const intersections = [...new Set(input.signal_ids.map(String))].map((id) => {
    const found = INTERSECTION_BY_ID.get(id);
    if (!found) throw new ValidationError(`알 수 없는 교차로 ID: ${id}`);
    return found;
  });

  return {
    route_name: name,
    description: input.description?.trim() || null,
    intersections,
    is_favorite: input.is_favorite === true,
  };
}

interface RouteRepo {
  list(): Promise<CustomRoute[]>;
  create(data: ValidRoute): Promise<CustomRoute>;
  update(id: number, data: ValidRoute): Promise<CustomRoute | null>;
  remove(id: number): Promise<boolean>;
}

type Row = Omit<CustomRoute, "created_at"> & { created_at: Date | string };

function fromRow(row: Row): CustomRoute {
  return {
    ...row,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

function neonRepo(url: string): RouteRepo {
  const sql = neon(url);
  let ready: Promise<unknown> | null = null;
  const ensureTable = () =>
    (ready ??= sql`
      CREATE TABLE IF NOT EXISTS custom_routes (
        id SERIAL PRIMARY KEY,
        route_name VARCHAR(100) NOT NULL,
        description TEXT,
        intersections JSONB NOT NULL,
        is_favorite BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      )`.catch((err) => {
      ready = null;
      throw err;
    }));

  return {
    async list() {
      await ensureTable();
      const rows = await sql`
        SELECT * FROM custom_routes ORDER BY is_favorite DESC, created_at DESC`;
      return (rows as Row[]).map(fromRow);
    },
    async create(d) {
      await ensureTable();
      const rows = await sql`
        INSERT INTO custom_routes (route_name, description, intersections, is_favorite)
        VALUES (${d.route_name}, ${d.description}, ${JSON.stringify(d.intersections)}::jsonb, ${d.is_favorite})
        RETURNING *`;
      return fromRow(rows[0] as Row);
    },
    async update(id, d) {
      await ensureTable();
      const rows = await sql`
        UPDATE custom_routes
        SET route_name = ${d.route_name}, description = ${d.description},
            intersections = ${JSON.stringify(d.intersections)}::jsonb, is_favorite = ${d.is_favorite}
        WHERE id = ${id}
        RETURNING *`;
      return rows[0] ? fromRow(rows[0] as Row) : null;
    },
    async remove(id) {
      await ensureTable();
      const rows = await sql`DELETE FROM custom_routes WHERE id = ${id} RETURNING id`;
      return rows.length > 0;
    },
  };
}

/** DATABASE_URL이 없을 때의 개발용 저장소. 서버 재시작 시 초기화된다. */
function memoryRepo(): RouteRepo {
  const store = ((globalThis as { __greenwaveRoutes?: { seq: number; rows: CustomRoute[] } })
    .__greenwaveRoutes ??= { seq: 0, rows: [] });
  const sorted = () =>
    [...store.rows].sort(
      (a, b) => Number(b.is_favorite) - Number(a.is_favorite) || b.created_at.localeCompare(a.created_at),
    );

  return {
    async list() {
      return sorted();
    },
    async create(d) {
      const route: CustomRoute = { id: ++store.seq, ...d, created_at: new Date().toISOString() };
      store.rows.push(route);
      return route;
    },
    async update(id, d) {
      const route = store.rows.find((r) => r.id === id);
      if (!route) return null;
      Object.assign(route, d);
      return route;
    },
    async remove(id) {
      const before = store.rows.length;
      store.rows = store.rows.filter((r) => r.id !== id);
      return store.rows.length < before;
    },
  };
}

const databaseUrl = process.env.DATABASE_URL;
// Neon 콘솔의 Data API(https://…/rest/v1) 주소는 드라이버가 받지 못하므로 postgres 연결 문자열만 사용한다
const usableUrl = databaseUrl && /^postgres(ql)?:\/\//.test(databaseUrl) ? databaseUrl : null;
if (databaseUrl && !usableUrl) {
  console.warn("[db] DATABASE_URL이 postgresql:// 형식이 아니어서 메모리 저장소를 사용합니다");
}

export const routeRepo: RouteRepo = usableUrl ? neonRepo(usableUrl) : memoryRepo();

export const storageMode = usableUrl ? "neon" : "memory";
