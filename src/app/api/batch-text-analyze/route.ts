import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { getAppConfig, getActiveOpenAIConfig } from "@/lib/config";
import { badRequest, createErrorResponse, ErrorCode, unauthorized } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

const logger = createLogger("api:batch-text-analyze");

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
    if (!session?.user) {
        return unauthorized();
    }

    try {
        const body = await req.json();
        const { text, subjectId, language = "zh" } = body;

        if (!text || typeof text !== "string" || text.trim().length === 0) {
            return badRequest("Missing or empty text");
        }

        // 获取错题本科目名称
        let subjectName = "数学";
        if (subjectId) {
            try {
                const sub = await prisma.subject.findUnique({
                    where: { id: subjectId },
                    select: { name: true },
                });
                if (sub?.name) subjectName = sub.name;
            } catch (e) {
                logger.warn({ e }, "Failed to find subject name");
            }
        }

        const appConfig = getAppConfig();
        const apiKey = appConfig.gemini?.apiKey || process.env.GOOGLE_API_KEY;

        if (!apiKey) {
            return createErrorResponse("AI_AUTH_ERROR: Google API Key is not configured", 500, ErrorCode.AI_ERROR);
        }

        const ai = new GoogleGenAI({
            apiKey,
            httpOptions: {
                baseUrl: appConfig.gemini?.baseUrl || "https://generativelanguage.googleapis.com",
                timeout: 45000,
            },
        });

        const modelName = appConfig.gemini?.model || "gemini-2.5-flash";

        const systemPrompt = `你是一个资深的中小学各学科名师和错题整理专家。
用户直接粘贴了一段可能包含【1道题】或者【多道不同错题】的文本（通常通过数字序号 1. 2. 3.、大写题号 一、二、三、换行段落或【第X题】区分）。

你的任务是：
1. 仔细阅读用户粘贴的全文，智能识别并拆分出文本中的【每一道独立的错题】。
2. 无论用户输入是 1 道还是多道题，请将拆分出的每一道题分别进行精准解题、步骤推导和考点归纳。
3. 如果包含数学公式或运算符号，请严格使用标准 LaTeX 格式（如 $x^2 + 2x + 1 = 0$ 或 $\\frac{1}{2}$）。
4. 必须输出严格合法的 JSON 数组，严禁包含任何前缀文字或附加废话。

每个数组项的对象结构如下：
{
  "questionText": "题目的完整题干（包含题目背景、已知条件、待求问题）",
  "answerText": "简明的最终标准答案（直接给出答案结论，不带冗余步骤）",
  "analysis": "规范详细的解题步骤、推导过程与思路解析",
  "knowledgePoints": ["核心知识点标签1", "核心知识点标签2"],
  "wrongAnswerText": "学生常见的典型错误答案（如有，没有可为空字符串）",
  "mistakeAnalysis": "一句话错误原因诊断与避坑点拨（如有，没有可为空字符串）",
  "mistakeStatus": "wrong"
}

请注意：必须输出 JSON 数组格式，即使只有 1 道题也要放在数组中返回！`;

        const userContent = `【学科】：${subjectName}\n【语言】：${language}\n【用户输入的文本内容】：\n${text}`;

        const response = await ai.models.generateContent({
            model: modelName,
            config: {
                thinkingConfig: {
                    thinkingBudget: 0,
                },
                responseMimeType: "application/json",
            },
            contents: [
                { text: systemPrompt },
                { text: userContent },
            ],
        });

        const rawText = response.text || "[]";
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
            if (match) {
                parsed = JSON.parse(match[0]);
            } else {
                throw new Error("Failed to parse JSON response from AI");
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
        const formattedQuestions: BatchParsedQuestion[] = questions
            .filter((q) => q && (q.questionText || q.answerText))
            .map((q) => ({
                questionText: q.questionText || text,
                answerText: q.answerText || "",
                analysis: q.analysis || "",
                knowledgePoints: Array.isArray(q.knowledgePoints) ? q.knowledgePoints : ["综合应用"],
                wrongAnswerText: q.wrongAnswerText || "",
                mistakeAnalysis: q.mistakeAnalysis || "",
                mistakeStatus: q.mistakeStatus || "wrong",
                subject: subjectName,
            }));

        logger.info({ count: formattedQuestions.length }, "Successfully batch analyzed questions from text");

        return NextResponse.json({
            success: true,
            count: formattedQuestions.length,
            questions: formattedQuestions,
        });
    } catch (error: any) {
        logger.error({ error: error?.message || String(error) }, "Batch text analyze failed");
        return createErrorResponse(error?.message || "Failed to analyze batch text", 500, ErrorCode.AI_ERROR);
    }
}
