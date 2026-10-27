import { connection } from "next/server";
import { routeRepo, storageMode, validateRouteInput, ValidationError } from "@/lib/db";

export async function GET() {
  await connection();
  try {
    const routes = await routeRepo.list();
    return Response.json({ routes, storage: storageMode });
  } catch (err) {
    console.error("[routes] 조회 실패", err);
    return Response.json({ error: "구간 목록을 불러오지 못했습니다" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const data = validateRouteInput(await request.json().catch(() => null));
    const route = await routeRepo.create(data);
    return Response.json({ route }, { status: 201 });
  } catch (err) {
    if (err instanceof ValidationError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    console.error("[routes] 생성 실패", err);
    return Response.json({ error: "구간을 저장하지 못했습니다" }, { status: 500 });
  }
}
