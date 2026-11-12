import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { getAIService } from "@/lib/ai";
import { DifficultyLevel } from "@/lib/ai/types";
import { notFound, internalError, unauthorized } from "@/lib/api-errors";
import { classifyAIError } from "@/lib/ai/errors";
import { createLogger } from "@/lib/logger";
import { parseStoredVariants } from "@/lib/practice-variants";
import { isPracticeLevel } from "@/lib/practice-progress";
import { getPracticeProgress } from "@/lib/practice-progress-server";

const logger = createLogger('api:practice:generate');

export async function POST(req: Request) {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
        return unauthorized("Authentication required");
    }

    try {
        const body = await req.json();
        const { errorItemId, language } = body;
        let forceRegenerate = body.forceRegenerate === true;
        const targetDifficulty = (body.difficulty || 'medium') as DifficultyLevel;

        const currentUser = session.user.email
            ? await prisma.user.findUnique({
                where: { email: session.user.email },
                select: { id: true },
            })
            : null;

        if (!currentUser) {
            return unauthorized("Authentication required");
        }

        const errorItemWithSubject = await prisma.errorItem.findUnique({
            where: { id: errorItemId },
            include: { subject: true }
        });

        if (!errorItemWithSubject || errorItemWithSubject.userId !== currentUser.id) {
            return notFound("Item not found");
        }

        // 闯关校验：未解锁的关卡不能出题；作答过的关卡不能换题（否则可以换题反复刷）
        if (isPracticeLevel(targetDifficulty)) {
            const progress = await getPracticeProgress(currentUser.id, errorItemWithSubject.id);
            const state = progress.levels[targetDifficulty];
            if (!state.unlocked) {
                return NextResponse.json({ message: 'PRACTICE_LOCKED' }, { status: 403 });
            }
            if (state.attempted) {
                forceRegenerate = false;
            }
        }

        // 1. 优先读取已经预生成并持久化的变式题（点击即显，0延迟，0报错）
        const storedVariants = parseStoredVariants(errorItemWithSubject.ocrText);
        if (!forceRegenerate && storedVariants[targetDifficulty]?.questionText) {
            logger.info({ errorItemId, difficulty: targetDifficulty }, 'Returning pre-generated practice variant from DB cache');
            return NextResponse.json(storedVariants[targetDifficulty]);
        }

        let tags: string[] = [];
        try {
            tags = JSON.parse(errorItemWithSubject.knowledgePoints || "[]");
        } catch {
            tags = [];
        }

        try {
            const aiService = getAIService();
            const similarQuestion = await aiService.generateSimilarQuestion(
                errorItemWithSubject.questionText || "",
                tags,
                language,
                targetDifficulty,
                errorItemWithSubject.gradeSemester
            );

            const validSubjects = ["数学", "物理", "化学", "生物", "英语", "语文", "历史", "地理", "政治", "其他"] as const;
            const subjectName = errorItemWithSubject.subject?.name || "数学";
            similarQuestion.subject = validSubjects.includes(subjectName as any) ? subjectName as typeof validSubjects[number] : "数学";

            // 将新生成的变式题写回数据库缓存
            const updatedVariants = {
                ...storedVariants,
                [targetDifficulty]: similarQuestion,
            };
            await prisma.errorItem.update({
                where: { id: errorItemWithSubject.id },
                data: { ocrText: JSON.stringify(updatedVariants) },
            });

            return NextResponse.json(similarQuestion);
        } catch (aiErr) {
            // 重新生成失败时只回退到同一难度的缓存题：
            // 之前会回退到其他难度，界面显示「类似题型」实际却是困难题，判题也会对不上
            const fallback = storedVariants[targetDifficulty];
            if (fallback?.questionText) {
                logger.warn({ errorItemId, difficulty: targetDifficulty }, 'AI generation failed, returning cached variant fallback');
                return NextResponse.json(fallback);
            }
            throw aiErr;
        }
    } catch (error) {
        logger.error({ error }, 'Error generating practice');
        // 统一返回 AI 错误码，前端可翻译
        return internalError(classifyAIError(error));
    }
}
