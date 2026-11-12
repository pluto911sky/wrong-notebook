import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { getAIService } from "@/lib/ai";
import { classifyAIError } from "@/lib/ai/errors";
import { normalizeMistakeStatusForSave } from "@/lib/mistake-status";
import { badRequest, createErrorResponse, ErrorCode, unauthorized } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

const logger = createLogger("api:batch-text-analyze");

// 单次粘贴的文本上限（约 20 道题的量），超长文本既容易被截断也会快速消耗额度
const MAX_TEXT_LENGTH = 20000;
const MAX_QUESTIONS = 30;

export interface BatchParsedQuestion {
    questionText: string;
    answerText: string;
    analysis: string;
    knowledgePoints: string[];
    wrongAnswerText?: string;
    mistakeAnalysis?: string;
    mistakeStatus?: string;
    subject?: string;
}

export async function POST(req: Request) {
    logger.info("POST /api/batch-text-analyze called");

    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return unauthorized();
    }

    try {
        const body = await req.json();
        const { text, subjectId } = body;
        const language = body.language === "en" ? "en" : "zh";

        if (!text || typeof text !== "string" || text.trim().length === 0) {
            return badRequest("Missing or empty text");
        }
        if (text.length > MAX_TEXT_LENGTH) {
            return badRequest("Text too long");
        }

        // 获取错题本科目名称
        let subjectName = "数学";
        if (subjectId) {
            try {
                // 只读取当前用户自己的错题本
                const sub = await prisma.subject.findFirst({
                    where: { id: subjectId, user: { email: session.user.email } },
                    select: { name: true },
                });
                if (sub?.name) subjectName = sub.name;
            } catch (e) {
                logger.warn({ e }, "Failed to find subject name");
            }
        }

        const systemPrompt = `你是一个资深的中小学各学科名师和错题整理专家。
用户直接粘贴了一段可能包含【1道题】或者【多道不同错题】的文本（通常通过数字序号 1. 2. 3.、大写题号 一、二、三、换行段落或【第X题】区分）。

你的任务是：
1. 仔细阅读用户粘贴的全文，智能识别并拆分出文本中的【每一道独立的错题】。
2. 无论用户输入是 1 道还是多道题，请将拆分出的每一道题分别进行精准解题、步骤推导和考点归纳。
3. 如果包含数学公式或运算符号，请严格使用标准 LaTeX 格式（如 $x^2 + 2x + 1 = 0$ 或 $\\frac{1}{2}$）。
4. 必须输出严格合法的 JSON 对象，形如 {"questions": [ ... ]}，严禁包含任何前缀文字或附加废话。

questions 数组中每一项的结构如下：
{
  "questionText": "题目的完整题干（包含题目背景、已知条件、待求问题）",
  "answerText": "简明的最终标准答案（直接给出答案结论，不带冗余步骤）",
  "analysis": "规范详细的解题步骤、推导过程与思路解析",
  "knowledgePoints": ["核心知识点标签1", "核心知识点标签2"],
  "wrongAnswerText": "学生常见的典型错误答案（如有，没有可为空字符串）",
  "mistakeAnalysis": "一句话错误原因诊断与避坑点拨（如有，没有可为空字符串）",
  "mistakeStatus": "wrong_attempt"
}

请注意：即使只有 1 道题，也要放在 questions 数组中返回！`;

        const userContent = `【学科】：${subjectName}\n【语言】：${language}\n【用户输入的文本内容】：\n${text}`;

        const rawText = await getAIService().completeText(systemPrompt, userContent, { json: true, maxOutputTokens: 32768 });
        logger.debug({ rawTextLength: rawText.length }, "AI batch text response received");

        let cleanJson = rawText.trim();
        if (cleanJson.startsWith("```json")) {
            cleanJson = cleanJson.replace(/^```json\s*/, "").replace(/\s*```$/, "");
        } else if (cleanJson.startsWith("```")) {
            cleanJson = cleanJson.replace(/^```\s*/, "").replace(/\s*```$/, "");
        }

        let parsed: any;
        try {
            parsed = JSON.parse(cleanJson);
        } catch (jsonErr) {
            logger.warn({ jsonErr, cleanJson: cleanJson.slice(0, 200) }, "Direct JSON parse failed, attempting regex extraction");
            const match = cleanJson.match(/\[[\s\S]*\]/);
            const objMatch = cleanJson.match(/\{[\s\S]*\}/);
            try {
                if (objMatch) parsed = JSON.parse(objMatch[0]);
                else if (match) parsed = JSON.parse(match[0]);
            } catch {
                parsed = undefined;
            }
            if (parsed === undefined) {
                // 多半是输出过长被截断，统一按「响应格式错误」返回错误码
                throw new Error("AI_RESPONSE_ERROR");
            }
        }

        // 如果 AI 返回的是单个对象而非数组，包裹成数组
        let questions: BatchParsedQuestion[] = [];
        if (Array.isArray(parsed)) {
            questions = parsed;
        } else if (parsed && typeof parsed === "object") {
            if (Array.isArray(parsed.questions)) {
                questions = parsed.questions;
            } else {
                questions = [parsed];
            }
        }

        // 规范化输出
        const str = (v: unknown) => (typeof v === "string" ? v : "");
        const formattedQuestions: BatchParsedQuestion[] = questions
            .filter((q) => q && typeof q === "object" && str(q.questionText).trim())
            .slice(0, MAX_QUESTIONS)
            .map((q) => {
                const wrongAnswerText = str(q.wrongAnswerText);
                return {
                    questionText: str(q.questionText),
                    answerText: str(q.answerText),
                    analysis: str(q.analysis),
                    knowledgePoints: Array.isArray(q.knowledgePoints)
                        ? q.knowledgePoints.filter((k): k is string => typeof k === "string" && k.trim().length > 0).slice(0, 5)
                        : [],
                    wrongAnswerText,
                    mistakeAnalysis: str(q.mistakeAnalysis),
                    mistakeStatus: normalizeMistakeStatusForSave(q.mistakeStatus, wrongAnswerText),
                    subject: subjectName,
                };
            });

        if (formattedQuestions.length === 0) {
            throw new Error("AI_RESPONSE_ERROR");
        }

        logger.info({ count: formattedQuestions.length }, "Successfully batch analyzed questions from text");

        return NextResponse.json({
            success: true,
            count: formattedQuestions.length,
            questions: formattedQuestions,
        });
    } catch (error: any) {
        logger.error({ error: error?.message || String(error) }, "Batch text analyze failed");
        // 统一返回 AI 错误码，前端翻译成可读提示，不再把英文原文弹给用户
        return createErrorResponse(classifyAIError(error), 500, ErrorCode.AI_ERROR);
    }
}
