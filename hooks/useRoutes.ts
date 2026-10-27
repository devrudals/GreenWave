"use client";

import { useCallback, useEffect, useState } from "react";
import type { CustomRoute, RouteInput } from "@/lib/types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `요청 실패 (HTTP ${res.status})`);
  return body as T;
}

export function toInput(route: CustomRoute): RouteInput {
  return {
    route_name: route.route_name,
    description: route.description,
    signal_ids: route.intersections.map((i) => i.itstId),
    is_favorite: route.is_favorite,
  };
}

export function useRoutes() {
  const [routes, setRoutes] = useState<CustomRoute[]>([]);
  const [storage, setStorage] = useState<"neon" | "memory" | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await request<{ routes: CustomRoute[]; storage: "neon" | "memory" }>("/api/routes");
      setRoutes(data.routes);
      setStorage(data.storage);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 1회 원격 데이터 로드
    refresh();
  }, [refresh]);

  const create = useCallback(
    async (input: RouteInput) => {
      const { route } = await request<{ route: CustomRoute }>("/api/routes", {
        method: "POST",
        body: JSON.stringify(input),
      });
      await refresh();
      return route;
    },
    [refresh],
  );

  const update = useCallback(
    async (id: number, input: RouteInput) => {
      const { route } = await request<{ route: CustomRoute }>(`/api/routes/${id}`, {
        method: "PUT",
        body: JSON.stringify(input),
      });
      await refresh();
      return route;
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: number) => {
      await request<void>(`/api/routes/${id}`, { method: "DELETE" });
      await refresh();
    },
    [refresh],
  );

  return { routes, storage, loading, error, create, update, remove };
}
