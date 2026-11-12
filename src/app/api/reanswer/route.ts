import { NextResponse } from "next/server";
import { getAIService } from "@/lib/ai";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { badRequest, createErrorResponse, ErrorCode } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { classifyAIError } from "@/lib/ai/errors";

const logger = createLogger('api:reanswer');

export async function POST(req: Request) {
    logger.info('Reanswer API called');

    const session = await getServerSession(authOptions);

    // 认证检查
    if (!session) {
        logger.warn('Unauthorized access attempt');
        return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await req.json();
        const { questionText, language = 'zh', subject, imageBase64, gradeSemester } = body;

        logger.debug({
            questionLength: questionText?.length,
            language,
            subject,
            hasImage: !!imageBase64,
            gradeSemester
        }, 'Reanswer request received');

        if (!questionText || typeof questionText !== 'string' || questionText.trim().length === 0) {
            logger.warn('Missing question text');
            return badRequest("Missing question text");
        }
        // 输入上限：防止超长文本 / 超大图片耗尽内存与 AI 额度
        if (questionText.length > 20000) {
            return badRequest("Question text too long");
        }
        if (imageBase64 && (typeof imageBase64 !== 'string' || imageBase64.length > 12 * 1024 * 1024)) {
            return badRequest("Image too large");
        }

        const aiService = getAIService();

        // 根据是否有图片选择不同的重新解题方式
        const result = await aiService.reanswerQuestion(questionText, language, subject, imageBase64, gradeSemester);

        logger.info('Reanswer successful');

        return NextResponse.json(result);
    } catch (error: unknown) {
        const errorMessageFromError = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : undefined;
        logger.error({ error: errorMessageFromError, stack }, 'Reanswer error occurred');

        // 统一映射为 AI 错误码，前端据此显示可读提示
        const errorMessage = classifyAIError(error);

        return createErrorResponse(errorMessage, 500, ErrorCode.AI_ERROR);
    }
}
