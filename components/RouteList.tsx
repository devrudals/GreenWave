"use client";

import { MapPin, Pencil, Star, Trash2 } from "lucide-react";
import type { CustomRoute } from "@/lib/types";

export function RouteList({
  routes,
  activeId,
  loading,
  onSelect,
  onEdit,
  onDelete,
  onToggleFavorite,
}: {
  routes: CustomRoute[];
  activeId: number | null;
  loading: boolean;
  onSelect: (route: CustomRoute) => void;
  onEdit: (route: CustomRoute) => void;
  onDelete: (route: CustomRoute) => void;
  onToggleFavorite: (route: CustomRoute) => void;
}) {
  if (loading) {
    return <p className="py-6 text-center text-sm text-zinc-400">불러오는 중…</p>;
  }
  if (routes.length === 0) {
    return (
      <p className="py-6 text-center text-sm leading-relaxed text-zinc-500">
        아직 저장한 구간이 없습니다.
        <br />
        자주 다니는 길의 교차로를 묶어 보세요.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {routes.map((route) => {
        const active = route.id === activeId;
        return (
          <li
            key={route.id}
            className={`group rounded-xl border transition-colors ${
              active ? "border-emerald-500 bg-emerald-50" : "border-zinc-200 bg-white hover:border-zinc-300"
            }`}
          >
            <div className="flex items-start gap-1 p-1">
              <button
                type="button"
                onClick={() => onSelect(route)}
                className="min-w-0 flex-1 rounded-lg px-2 py-1.5 text-left"
              >
                <p className="truncate text-sm font-semibold text-zinc-900">{route.route_name}</p>
                {route.description && <p className="truncate text-xs text-zinc-500">{route.description}</p>}
                <p className="mt-1 flex items-center gap-1 text-[11px] text-zinc-500">
                  <MapPin className="size-3" />
                  교차로 {route.intersections.length}개 ·{" "}
                  {route.intersections.map((i) => i.itstNm).join(" → ")}
                </p>
              </button>
              <div className="flex shrink-0 items-center">
                <IconButton label={route.is_favorite ? "즐겨찾기 해제" : "즐겨찾기"} onClick={() => onToggleFavorite(route)}>
                  <Star
                    className={`size-4 ${route.is_favorite ? "fill-amber-400 text-amber-400" : "text-zinc-400"}`}
                  />
                </IconButton>
                <IconButton label="수정" onClick={() => onEdit(route)}>
                  <Pencil className="size-4 text-zinc-500" />
                </IconButton>
                <IconButton label="삭제" onClick={() => onDelete(route)}>
                  <Trash2 className="size-4 text-zinc-500 hover:text-rose-600" />
                </IconButton>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="rounded-md p-1.5 hover:bg-zinc-100"
    >
      {children}
    </button>
  );
}
