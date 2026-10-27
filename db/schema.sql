-- Neon SQL Editor에서 실행하거나, 앱이 첫 요청 시 자동으로 생성한다 (lib/db.ts)
CREATE TABLE IF NOT EXISTS custom_routes (
  id            SERIAL PRIMARY KEY,
  route_name    VARCHAR(100) NOT NULL,
  description   TEXT,
  intersections JSONB NOT NULL,
  is_favorite   BOOLEAN DEFAULT false,
  created_at    TIMESTAMP DEFAULT NOW()
);
