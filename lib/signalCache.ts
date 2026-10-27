import "server-only";
import { sqlClient } from "./db";
import type { ObservedSignal } from "./tdata";

/**
 * T-Data 실시간 API는 키당 하루 1,000회만 호출된다 (X-RateLimit-Limit: 1000, 자정 초기화).
 * Vercel 서버리스 인스턴스끼리는 메모리를 공유하지 않으므로, 구별 스냅샷과 오늘 호출 수를 DB에 둔다.
 * DATABASE_URL이 없으면 프로세스 메모리로 동작한다 (로컬 개발용).
 */

export interface Snapshot {
  sggCd: string;
  fetchedAt: number;
  signals: ObservedSignal[];
}

export interface Usage {
  calls: number;
  lastCallAt: number;
  blockedUntil: number;
}

/** 이보다 오래된 스냅샷은 모든 현시가 끝나 쓸모가 없다 */
const SNAPSHOT_MAX_AGE_MS = 5 * 60_000;

/** 한도 기준일 (한국 시간) */
export function kstDay(now = Date.now()): string {
  return new Date(now + 9 * 3600_000).toISOString().slice(0, 10);
}

export function msUntilKstMidnight(now = Date.now()): number {
  const kst = now + 9 * 3600_000;
  return 86_400_000 - (kst % 86_400_000);
}

interface Store {
  recent(): Promise<Snapshot[]>;
  save(snapshot: Snapshot): Promise<void>;
  usage(day: string): Promise<Usage>;
  /** 호출 1회를 기록하고 갱신된 사용량을 돌려준다 */
  recordCall(day: string, at: number): Promise<Usage>;
  block(day: string, until: number): Promise<void>;
}

function neonStore(sql: NonNullable<typeof sqlClient>): Store {
  let ready: Promise<unknown> | null = null;
  const ensure = () =>
    (ready ??= Promise.all([
      sql`CREATE TABLE IF NOT EXISTS signal_snapshots (
            sgg_cd VARCHAR(5) PRIMARY KEY,
            fetched_at BIGINT NOT NULL,
            signals JSONB NOT NULL)`,
      sql`CREATE TABLE IF NOT EXISTS tdata_usage (
            day DATE PRIMARY KEY,
            calls INT NOT NULL DEFAULT 0,
            last_call_at BIGINT NOT NULL DEFAULT 0,
            blocked_until BIGINT NOT NULL DEFAULT 0)`,
    ]).catch((err) => {
      ready = null;
      throw err;
    }));

  const toUsage = (row: Record<string, unknown> | undefined): Usage => ({
    calls: Number(row?.calls ?? 0),
    lastCallAt: Number(row?.last_call_at ?? 0),
    blockedUntil: Number(row?.blocked_until ?? 0),
  });

  return {
    async recent() {
      await ensure();
      const rows = await sql`
        SELECT sgg_cd, fetched_at, signals FROM signal_snapshots
        WHERE fetched_at > ${Date.now() - SNAPSHOT_MAX_AGE_MS}`;
      return rows.map((r) => ({
        sggCd: String(r.sgg_cd),
        fetchedAt: Number(r.fetched_at),
        signals: r.signals as ObservedSignal[],
      }));
    },
    async save(s) {
      await ensure();
      await sql`
        INSERT INTO signal_snapshots (sgg_cd, fetched_at, signals)
        VALUES (${s.sggCd}, ${s.fetchedAt}, ${JSON.stringify(s.signals)}::jsonb)
        ON CONFLICT (sgg_cd) DO UPDATE SET fetched_at = EXCLUDED.fetched_at, signals = EXCLUDED.signals`;
    },
    async usage(day) {
      await ensure();
      const rows = await sql`SELECT calls, last_call_at, blocked_until FROM tdata_usage WHERE day = ${day}`;
      return toUsage(rows[0]);
    },
    async recordCall(day, at) {
      await ensure();
      const rows = await sql`
        INSERT INTO tdata_usage (day, calls, last_call_at) VALUES (${day}, 1, ${at})
        ON CONFLICT (day) DO UPDATE SET calls = tdata_usage.calls + 1, last_call_at = EXCLUDED.last_call_at
        RETURNING calls, last_call_at, blocked_until`;
      return toUsage(rows[0]);
    },
    async block(day, until) {
      await ensure();
      await sql`
        INSERT INTO tdata_usage (day, blocked_until) VALUES (${day}, ${until})
        ON CONFLICT (day) DO UPDATE SET blocked_until = EXCLUDED.blocked_until`;
    },
  };
}

function memoryStore(): Store {
  const snapshots = new Map<string, Snapshot>();
  const usage = new Map<string, Usage>();
  const get = (day: string) => usage.get(day) ?? { calls: 0, lastCallAt: 0, blockedUntil: 0 };
  return {
    async recent() {
      const min = Date.now() - SNAPSHOT_MAX_AGE_MS;
      return [...snapshots.values()].filter((s) => s.fetchedAt > min);
    },
    async save(s) {
      snapshots.set(s.sggCd, s);
    },
    async usage(day) {
      return get(day);
    },
    async recordCall(day, at) {
      const u = { ...get(day), calls: get(day).calls + 1, lastCallAt: at };
      usage.set(day, u);
      return u;
    },
    async block(day, until) {
      usage.set(day, { ...get(day), blockedUntil: until });
    },
  };
}

export const signalStore: Store = sqlClient ? neonStore(sqlClient) : memoryStore();
