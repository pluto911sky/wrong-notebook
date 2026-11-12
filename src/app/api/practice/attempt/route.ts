import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { badRequest, internalError, notFound, unauthorized } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { parseStoredVariants } from "@/lib/practice-variants";
import { isAnswerCorrect, isPracticeLevel } from "@/lib/practice-progress";
import { getPracticeProgress, withPracticeLock } from "@/lib/practice-progress-server";

const logger = createLogger("api:practice:attempt");

const MAX_ANSWER_LENGTH = 2000;

/**
 * POST /api/practice/attempt —— 提交一关的作答（服务端判题 + 防刷）
 * body: { errorItemId, difficulty: "medium" | "hard" | "harder", userAnswer }
 *
 * 规则（见 lib/practice-progress.ts）：未解锁 / 已通关 / 今天已答过 → 拒绝；
 * 答对且是该关首次通关 → rewarded=true，前端据此发宠物奖励；三关全通 → 自动标记已掌握。
 */
export async function POST(req: Request) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return unauthorized();

    try {
        const { errorItemId, difficulty, userAnswer } = await req.json();
        if (!errorItemId || typeof errorItemId !== "string") return badRequest("errorItemId is required");
        if (!isPracticeLevel(difficulty)) return badRequest("Invalid difficulty");
        if (typeof userAnswer !== "string" || !userAnswer.trim()) return badRequest("Answer is required");
        if (userAnswer.length > MAX_ANSWER_LENGTH) return badRequest("Answer too long");

        const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } });
        if (!user) return unauthorized();

        const item = await prisma.errorItem.findFirst({
            where: { id: errorItemId, userId: user.id },
            include: { subject: true },
        });
        if (!item) return notFound("Item not found");

        const question = parseStoredVariants(item.ocrText)[difficulty];
        if (!question?.questionText || !question.answerText) {
            return badRequest("Practice question not generated yet");
        }

        return await withPracticeLock(`${user.id}:${item.id}`, async () => {
            const before = await getPracticeProgress(user.id, item.id);
            const state = before.levels[difficulty];
            if (!state.unlocked) {
                return NextResponse.json({ message: "PRACTICE_LOCKED", progress: before }, { status: 403 });
            }
            if (state.cleared) {
                return NextResponse.json({ message: "PRACTICE_ALREADY_CLEARED", progress: before }, { status: 409 });
            }
            if (state.attemptedToday) {
                return NextResponse.json({ message: "PRACTICE_DAILY_LIMIT", progress: before }, { status: 429 });
            }

            const isCorrect = isAnswerCorrect(userAnswer, question.answerText);
            await prisma.practiceRecord.create({
                data: {
                    userId: user.id,
                    errorItemId: item.id,
                    subject: item.subject?.name || question.subject || null,
                    difficulty,
                    isCorrect,
                },
            });

            const progress = await getPracticeProgress(user.id, item.id);
            let mastered = false;
            if (progress.allCleared && item.masteryLevel < 2) {
                // 三关全部通关：自动标记为已掌握，不再进入待复习
                await prisma.errorItem.update({ where: { id: item.id }, data: { masteryLevel: 2 } });
                mastered = true;
            }

            logger.info({ errorItemId: item.id, difficulty, isCorrect, mastered }, "Practice attempt recorded");
            return NextResponse.json({
                isCorrect,
                // 走到这里说明这一关之前未通关，答对即是首次通关
                rewarded: isCorrect,
                correctAnswer: question.answerText,
                mastered,
                progress,
            });
        });
    } catch (error) {
        logger.error({ error: error instanceof Error ? error.message : String(error) }, "Practice attempt failed");
        return internalError("Failed to submit answer");
    }
}
