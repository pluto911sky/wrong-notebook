import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { unauthorized, badRequest, notFound, createErrorResponse, ErrorCode } from "@/lib/api-errors";
import { classifyAIError } from "@/lib/ai/errors";
import { generateAllVariants, parseStoredVariants } from "@/lib/practice-variants-server";
import { prisma } from "@/lib/prisma";

// 未入库分支本质是 AI 代理，限制输入规模，防止超长文本耗尽额度
const MAX_QUESTION_LENGTH = 8000;
const MAX_KNOWLEDGE_POINTS = 10;

export async function POST(req: Request) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return unauthorized("Authentication required");
    }
    const currentUser = await prisma.user.findUnique({
        where: { email: session.user.email },
        select: { id: true },
    });
    if (!currentUser) {
        return unauthorized("No user found in DB");
    }

    try {
        const body = await req.json();
        const {
            errorItemId,
            questionText,
            knowledgePoints = [],
            language = "zh",
            gradeSemester = null,
            subjectName = "数学",
        } = body;

        // 如果传了 errorItemId，先检查数据库中是否已有缓存的变式题
        if (errorItemId) {
            // 必须校验归属：之前按 id 直接查询，任何登录用户都能读写他人错题的变式题
            const item = await prisma.errorItem.findFirst({
                where: { id: errorItemId, userId: currentUser.id },
                include: { subject: true },
            });
            if (!item) {
                return notFound("Error item not found");
            }
            const existing = parseStoredVariants(item.ocrText);
            if (existing.hard && existing.harder && existing.medium) {
                return NextResponse.json({ variants: existing, cached: true });
            }

            let tags: string[] = [];
            try {
                tags = JSON.parse(item.knowledgePoints || "[]");
            } catch {
                tags = [];
            }

            const variants = await generateAllVariants({
                questionText: item.questionText || questionText || "",
                knowledgePoints: tags.length > 0 ? tags : knowledgePoints,
                language: language === "en" ? "en" : "zh",
                gradeSemester: item.gradeSemester || gradeSemester,
                subjectName: item.subject?.name || subjectName,
                existing,
            });

            await prisma.errorItem.update({
                where: { id: item.id },
                data: { ocrText: JSON.stringify(variants) },
            });

            return NextResponse.json({ variants, cached: false });
        }

        if (typeof questionText !== "string" || !questionText.trim()) {
            return badRequest("questionText is required");
        }
        if (questionText.length > MAX_QUESTION_LENGTH) {
            return badRequest("questionText too long");
        }

        // 上传预览阶段（尚未入库，没有 errorItemId）：直接并行预生成四档变式题（重点：困难 hard、挑战 harder）
        const variants = await generateAllVariants({
            questionText,
            knowledgePoints: Array.isArray(knowledgePoints) ? knowledgePoints.slice(0, MAX_KNOWLEDGE_POINTS) : [],
            language: language === "en" ? "en" : "zh",
            gradeSemester,
            subjectName,
        });

        return NextResponse.json({ variants, cached: false });
    } catch (error) {
        // 失败返回非 2xx + 错误码，前端不会再把失败当成功
        return createErrorResponse(classifyAIError(error), 500, ErrorCode.AI_ERROR);
    }
}
