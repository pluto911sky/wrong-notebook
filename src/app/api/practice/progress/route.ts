import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { badRequest, notFound, unauthorized } from "@/lib/api-errors";
import { getPracticeProgress } from "@/lib/practice-progress-server";

/** GET /api/practice/progress?errorItemId=xxx —— 某道错题的闯关进度 */
export async function GET(req: Request) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return unauthorized();

    const errorItemId = new URL(req.url).searchParams.get("errorItemId");
    if (!errorItemId) return badRequest("errorItemId is required");

    const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } });
    if (!user) return unauthorized();

    const item = await prisma.errorItem.findFirst({ where: { id: errorItemId, userId: user.id }, select: { id: true } });
    if (!item) return notFound("Item not found");

    return NextResponse.json(await getPracticeProgress(user.id, item.id));
}
