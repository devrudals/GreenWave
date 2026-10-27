"use client";

import { Loader2, MousePointerClick, X } from "lucide-react";
import { useState } from "react";
import { INTERSECTION_BY_ID } from "@/constants/intersections";
import type { RouteInput } from "@/lib/types";

export function RouteForm({
  initial,
  selectedIds,
  onRemoveId,
  onSubmit,
  onCancel,
}: {
  initial: { route_name: string; description: string };
  selectedIds: string[];
  onRemoveId: (id: string) => void;
  onSubmit: (input: Omit<RouteInput, "signal_ids" | "is_favorite">) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial.route_name);
  const [description, setDescription] = useState(initial.description);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("구간 이름을 입력하세요");
    if (selectedIds.length === 0) return setError("지도에서 교차로를 1개 이상 선택하세요");
    setSaving(true);
    setError(null);
    try {
      await onSubmit({ route_name: name, description });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600">
        구간 이름
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          placeholder="예: 학교 가는 길"
          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600">
        메모
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="예: 신촌역에서 연대 정문까지"
          className="resize-none rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
        />
      </label>

      <div>
        <p className="mb-1 text-xs font-medium text-zinc-600">
          선택한 교차로 <span className="text-emerald-700">{selectedIds.length}</span>
        </p>
        {selectedIds.length === 0 ? (
          <p className="flex items-center gap-2 rounded-lg border border-dashed border-zinc-300 p-3 text-xs text-zinc-500">
            <MousePointerClick className="size-4 shrink-0" />
            지도에서 교차로 마커를 클릭해 순서대로 추가하세요.
          </p>
        ) : (
          <ol className="flex max-h-40 flex-col gap-1 overflow-y-auto">
            {selectedIds.map((id, idx) => (
              <li key={id} className="flex items-center gap-2 rounded-lg bg-emerald-50 px-2 py-1.5 text-sm">
                <span className="flex size-5 items-center justify-center rounded-full bg-emerald-600 text-[11px] font-bold text-white">
                  {idx + 1}
                </span>
                <span className="flex-1 truncate text-zinc-800">{INTERSECTION_BY_ID.get(id)?.itstNm ?? id}</span>
                <button
                  type="button"
                  onClick={() => onRemoveId(id)}
                  className="rounded p-0.5 text-zinc-400 hover:bg-white hover:text-rose-600"
                  aria-label="선택 해제"
                >
                  <X className="size-4" />
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>

      {error && <p className="text-xs text-rose-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-lg border border-zinc-300 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
        >
          취소
        </button>
        <button
          type="submit"
          disabled={saving}
          className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {saving && <Loader2 className="size-4 animate-spin" />}
          저장
        </button>
      </div>
    </form>
  );
}
