import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { getAIService } from "@/lib/ai";
import { DifficultyLevel } from "@/lib/ai/types";
import { notFound, internalError, unauthorized } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { parseStoredVariants } from "@/lib/practice-variants";

const logger = createLogger('api:practice:generate');

export async function POST(req: Request) {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
        return unauthorized("Authentication required");
    }

    try {
        const { errorItemId, language, difficulty = 'hard', forceRegenerate = false } = await req.json();
        const targetDifficulty = (difficulty || 'hard') as DifficultyLevel;

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
            // 如果重新生成失败，但数据库里有缓存的该难度（或其他难度）变式题，优雅兜底返回，绝不报错
            const fallback =
                storedVariants[targetDifficulty] ||
                storedVariants.hard ||
                storedVariants.harder ||
                storedVariants.medium ||
                storedVariants.easy;
            if (fallback?.questionText) {
                logger.warn({ errorItemId, difficulty: targetDifficulty }, 'AI generation failed, returning cached variant fallback');
                return NextResponse.json(fallback);
            }
            throw aiErr;
        }
    } catch (error) {
        logger.error({ error }, 'Error generating practice');
        const errorMessage = error instanceof Error ? error.message : "Failed to generate practice question";
        return internalError(errorMessage);
    }
}
