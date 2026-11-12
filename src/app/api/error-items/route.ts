import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { calculateGrade } from "@/lib/grade-calculator";
import { unauthorized, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { findParentTagIdForGrade } from "@/lib/tag-recognition";
import { inferSubjectFromName } from "@/lib/knowledge-tags";
import { normalizeMistakeStatusForSave } from "@/lib/mistake-status";
import { generateAllVariants, parseStoredVariants, enqueueBackgroundTask } from "@/lib/practice-variants-server";

const logger = createLogger('api:error-items');

/**
 * 在响应返回后执行后台任务。
 * after() 只能在 Next 请求作用域内调用；脱离作用域（如直接调用路由的测试、脚本）时
 * 退化为不等待的异步执行，保证保存本身不受影响。
 */
function runAfterResponse(task: () => Promise<void>) {
    try {
        after(task);
    } catch {
        void task();
    }
}

export async function POST(req: Request) {
    logger.info('POST /api/error-items called');

    const session = await getServerSession(authOptions);

    try {
        const body = await req.json();
        const {
            questionText,
            answerText,
            analysis,
            wrongAnswerText,
            mistakeAnalysis,
            mistakeStatus,
            knowledgePoints,
            originalImageUrl,
            subjectId,
            gradeSemester,
            paperLevel,
            geogebraCommands,
            ocrText,
        } = body;

        // 记录请求参数（不记录完整图片数据）
        logger.debug({
            hasQuestionText: !!questionText,
            questionTextLength: questionText?.length || 0,
            hasAnswerText: !!answerText,
            hasAnalysis: !!analysis,
            hasWrongAnswerText: !!wrongAnswerText,
            hasMistakeAnalysis: !!mistakeAnalysis,
            mistakeStatus,
            knowledgePointsCount: Array.isArray(knowledgePoints) ? knowledgePoints.length : 0,
            hasImage: !!originalImageUrl,
            imageSize: originalImageUrl?.length || 0,
            subjectId,
            gradeSemester,
            paperLevel,
            hasGeogebraCommands: !!geogebraCommands,
        }, 'Request parameters received');

        // 查找用户
        let user;
        if (session?.user?.email) {
            user = await prisma.user.findUnique({
                where: { email: session.user.email },
            });
            logger.debug({ userId: user?.id, email: session.user.email }, 'User lookup result');
        } else {
            logger.warn('No session email found');
        }

        if (!user) {
            logger.warn({ sessionEmail: session?.user?.email }, 'User not found in DB');
            return unauthorized("No user found in DB");
        }

        // ========== 去重检查：2秒内同一用户提交相同题目视为重复 ==========
        const DEDUP_WINDOW_MS = 2000; // 2秒去重窗口
        const questionTextPrefix = questionText?.substring(0, 100) || ''; // 取前100字符比较

        if (questionTextPrefix) {
            const recentDuplicate = await prisma.errorItem.findFirst({
                where: {
                    userId: user.id,
                    questionText: {
                        startsWith: questionTextPrefix,
                    },
                    createdAt: {
                        gte: new Date(Date.now() - DEDUP_WINDOW_MS),
                    },
                },
                include: {
                    tags: true,
                },
            });

            if (recentDuplicate) {
                logger.info({
                    existingId: recentDuplicate.id,
                    userId: user.id,
                    timeDiff: Date.now() - recentDuplicate.createdAt.getTime()
                }, 'Duplicate submission detected within dedup window, returning existing record');

                return NextResponse.json({
                    ...recentDuplicate,
                    duplicate: true, // 标记为重复提交
                }, { status: 200 }); // 返回 200 而非 201
            }
        }

        // 计算年级
        let finalGradeSemester = gradeSemester;
        if (!finalGradeSemester && user.educationStage && user.enrollmentYear) {
            finalGradeSemester = calculateGrade(user.educationStage, user.enrollmentYear);
            logger.debug({ finalGradeSemester, educationStage: user.educationStage, enrollmentYear: user.enrollmentYear }, 'Grade calculated');
        }

        // 处理知识点标签
        const tagNames: string[] = Array.isArray(knowledgePoints) ? knowledgePoints : [];
        const tagConnections: { id: string }[] = [];

        // 推断学科
        const subject = await prisma.subject.findUnique({ where: { id: subjectId || '' } });
        const subjectKey = inferSubjectFromName(subject?.name ?? null) || 'other';
        logger.debug({ subjectId, subjectName: subject?.name, subjectKey }, 'Subject inferred');

        // 处理每个标签
        for (const tagName of tagNames) {
            try {
                let tag = await prisma.knowledgeTag.findFirst({
                    where: {
                        name: tagName,
                        OR: [
                            { isSystem: true },
                            { userId: user.id },
                        ],
                    },
                });

                if (!tag) {
                    const parentId = await findParentTagIdForGrade(finalGradeSemester, subjectKey);
                    logger.debug({ tagName, parentId, subjectKey }, 'Creating new custom tag');

                    tag = await prisma.knowledgeTag.create({
                        data: {
                            name: tagName,
                            subject: subjectKey,
                            isSystem: false,
                            userId: user.id,
                            parentId: parentId,
                        },
                    });
                    logger.debug({ tagId: tag.id, tagName }, 'Custom tag created');
                } else {
                    logger.debug({ tagId: tag.id, tagName, isSystem: tag.isSystem }, 'Existing tag found');
                }

                tagConnections.push({ id: tag.id });
            } catch (tagError) {
                logger.error({ tagName, error: tagError }, 'Error processing tag');
                throw tagError;
            }
        }

        logger.info({ tagNames, tagConnectionsCount: tagConnections.length }, 'Creating ErrorItem with tags');

        // 客户端可能已带上预生成的变式题（ocrText 中的 JSON），这里只保留合法的变式题结构
        const existingVariants = parseStoredVariants(ocrText);
        const serializedVariants = Object.keys(existingVariants).length > 0 ? JSON.stringify(existingVariants) : null;
        const needsVariants = !existingVariants.hard || !existingVariants.harder || !existingVariants.medium;

        // 创建错题记录
        try {
            const errorItem = await prisma.errorItem.create({
                data: {
                    userId: user.id,
                    subjectId: subjectId || undefined,
                    originalImageUrl,
                    ocrText: serializedVariants,
                    questionText,
                    answerText,
                    analysis,
                    wrongAnswerText: wrongAnswerText || null,
                    mistakeAnalysis: mistakeAnalysis || null,
                    mistakeStatus: normalizeMistakeStatusForSave(mistakeStatus, wrongAnswerText),
                    knowledgePoints: JSON.stringify(tagNames),
                    gradeSemester: finalGradeSemester,
                    paperLevel: paperLevel,
                    geogebraCommands: geogebraCommands || null,
                    masteryLevel: 0,
                    tags: {
                        connect: tagConnections,
                    },
                },
                include: {
                    tags: true,
                },
            });

            logger.info({ errorItemId: errorItem.id, tagsCount: errorItem.tags?.length || 0 }, 'ErrorItem created successfully');

            // 「举一反三」变式题放到响应之后后台生成：
            // 之前在保存请求里同步等待 3 次 AI 调用，单次保存可能超过前端 60s 超时，
            // 前端判失败而后端仍落库，用户重试就会产生重复错题。
            if (needsVariants && questionText) {
                runAfterResponse(() => enqueueBackgroundTask(async () => {
                    try {
                        const variants = await generateAllVariants({
                            questionText,
                            knowledgePoints: tagNames,
                            language: "zh",
                            gradeSemester: finalGradeSemester,
                            subjectName: subject?.name || null,
                            existing: existingVariants,
                            sequential: true,
                        });
                        if (Object.keys(variants).length > 0) {
                            await prisma.errorItem.update({
                                where: { id: errorItem.id },
                                data: { ocrText: JSON.stringify(variants) },
                            });
                        }
                        logger.info({ errorItemId: errorItem.id, levels: Object.keys(variants) }, 'Background variant generation finished');
                    } catch (e) {
                        logger.warn({ errorItemId: errorItem.id, error: e instanceof Error ? e.message : String(e) }, 'Background variant generation failed');
                    }
                }));
            }

            return NextResponse.json(errorItem, { status: 201 });
        } catch (dbError) {
            logger.error({
                error: dbError,
                userId: user.id,
                subjectId,
                tagConnectionsCount: tagConnections.length
            }, 'Database error creating ErrorItem');
            throw dbError;
        }
    } catch (error) {
        logger.error({
            error,
            errorMessage: error instanceof Error ? error.message : String(error),
            errorStack: error instanceof Error ? error.stack : undefined
        }, 'Error saving item');
        return internalError("Failed to save error item");
    }
}
