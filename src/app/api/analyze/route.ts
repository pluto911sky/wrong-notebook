import { NextResponse } from "next/server";
import { getAIService } from "@/lib/ai";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { calculateGradeNumber, inferSubjectFromName } from "@/lib/knowledge-tags";
import { calculateGrade } from "@/lib/grade-calculator";
import { prisma } from "@/lib/prisma";
import { badRequest, createErrorResponse, ErrorCode } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { classifyAIError } from "@/lib/ai/errors";

const logger = createLogger('api:analyze');

// 前端会把图片压到 0.5MB 左右，这里给足余量；超出说明不是正常客户端请求
const MAX_IMAGE_BASE64_LENGTH = 12 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

export async function POST(req: Request) {
    logger.info('Analyze API called');

    const session = await getServerSession(authOptions);

    // 认证检查
    if (!session) {
        logger.warn('Unauthorized access attempt');
        return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await req.json();
        let { imageBase64, mimeType, language, subjectId } = body;

        logger.debug({
            imageLength: imageBase64?.length,
            mimeType,
            language,
            subjectId
        }, 'Request received');

        if (!imageBase64 || typeof imageBase64 !== 'string') {
            logger.warn('Missing image data');
            return badRequest("Missing image data");
        }
        if (imageBase64.length > MAX_IMAGE_BASE64_LENGTH) {
            logger.warn({ imageLength: imageBase64.length }, 'Image too large');
            return badRequest("Image too large");
        }

        // Parse Data URL if present
        if (imageBase64.startsWith('data:')) {
            const matches = imageBase64.match(/^data:([^;]+);base64,(.+)$/);
            if (matches) {
                mimeType = matches[1];
                imageBase64 = matches[2];
                logger.debug({ mimeType, base64Length: imageBase64.length }, 'Parsed Data URL');
            }
        }
        if (mimeType && !ALLOWED_MIME_TYPES.has(mimeType)) {
            return badRequest("Unsupported image type");
        }
        if (language !== 'zh' && language !== 'en') {
            language = 'zh';
        }

        // 先获取用户年级信息，用于动态生成 AI prompt 中的标签列表
        let userGrade: 7 | 8 | 9 | 10 | 11 | 12 | null = null;
        let userGradeSemester: string | null = null;
        let subjectName: 'math' | 'physics' | 'chemistry' | 'biology' | 'english' | 'chinese' | 'history' | 'geography' | 'politics' | null = null;

        if (session?.user?.email) {
            try {
                // 并行获取用户信息与错题本科目信息
                const [user, subject] = await Promise.all([
                    prisma.user.findUnique({
                        where: { email: session.user.email },
                        select: { educationStage: true, enrollmentYear: true }
                    }),
                    subjectId
                        ? prisma.subject.findUnique({
                            where: { id: subjectId },
                            select: { name: true }
                        })
                        : Promise.resolve(null)
                ]);

                if (user) {
                    userGrade = calculateGradeNumber(user.educationStage, user.enrollmentYear);
                    if (user.educationStage && user.enrollmentYear) {
                        userGradeSemester = calculateGrade(user.educationStage, user.enrollmentYear, new Date(), 'zh');
                    }
                    logger.debug({ userGrade, userGradeSemester }, 'Calculated user grade');
                }

                if (subject) {
                    subjectName = inferSubjectFromName(subject.name);
                    logger.debug({ subjectName, subjectDisplayName: subject.name }, 'Inferred subject');
                }
            } catch (error) {
                logger.error({ error }, 'Error fetching user/subject info');
                // 继续执行，不传递年级参数（会返回所有年级的标签）
            }
        }


        // 将内部科目名称转换为中文科目名称
        const subjectNameMapping: Record<string, string> = {
            'math': '数学',
            'physics': '物理',
            'chemistry': '化学',
            'biology': '生物',
            'english': '英语',
            'chinese': '语文',
            'history': '历史',
            'geography': '地理',
            'politics': '政治',
        };
        const subjectChinese = subjectName ? subjectNameMapping[subjectName] : null;

        logger.info({ userGrade, userGradeSemester, subject: subjectChinese }, 'Calling AI service for image analysis');
        const aiService = getAIService();
        const analysisResult = await aiService.analyzeImage(imageBase64, mimeType, language, userGrade, subjectChinese, userGradeSemester);

        logger.debug({
            knowledgePointsCount: analysisResult.knowledgePoints?.length,
            knowledgePointsType: typeof analysisResult.knowledgePoints,
            isArray: Array.isArray(analysisResult.knowledgePoints)
        }, 'AI returned knowledge points');

        // AI 现在从数据库获取标签列表，返回的标签已经是标准化的，不需要额外处理
        if (!analysisResult.knowledgePoints || analysisResult.knowledgePoints.length === 0) {
            logger.warn('Knowledge points is empty or null');
        }

        logger.info('AI analysis successful');

        return NextResponse.json(analysisResult);
    } catch (error: any) {
        logger.error({
            error: error.message,
            stack: error.stack
        }, 'Analysis error occurred');

        // 统一映射为 AI 错误码，前端据此显示可读提示（未知异常不再把英文原文弹给用户）
        const errorMessage = classifyAIError(error);
        return createErrorResponse(errorMessage, 500, ErrorCode.AI_ERROR, error.message);
    }
}
