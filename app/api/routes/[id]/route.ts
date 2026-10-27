import type { NextRequest } from "next/server";
import { routeRepo, validateRouteInput, ValidationError } from "@/lib/db";

async function parseId(ctx: RouteContext<"/api/routes/[id]">): Promise<number | null> {
  const { id } = await ctx.params;
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function PUT(request: NextRequest, ctx: RouteContext<"/api/routes/[id]">) {
  const id = await parseId(ctx);
  if (id === null) return Response.json({ error: "잘못된 ID입니다" }, { status: 400 });
  try {
    const data = validateRouteInput(await request.json().catch(() => null));
    const route = await routeRepo.update(id, data);
    if (!route) return Response.json({ error: "구간을 찾을 수 없습니다" }, { status: 404 });
    return Response.json({ route });
  } catch (err) {
    if (err instanceof ValidationError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    console.error("[routes] 수정 실패", err);
    return Response.json({ error: "구간을 수정하지 못했습니다" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/routes/[id]">) {
  const id = await parseId(ctx);
  if (id === null) return Response.json({ error: "잘못된 ID입니다" }, { status: 400 });
  try {
    const removed = await routeRepo.remove(id);
    if (!removed) return Response.json({ error: "구간을 찾을 수 없습니다" }, { status: 404 });
    return new Response(null, { status: 204 });
  } catch (err) {
    console.error("[routes] 삭제 실패", err);
    return Response.json({ error: "구간을 삭제하지 못했습니다" }, { status: 500 });
  }
}
