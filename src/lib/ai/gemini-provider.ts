import { GoogleGenAI, type GenerateContentResponse, type ThinkingConfig, type ThinkingLevel } from "@google/genai";
import { AIService, ParsedQuestion, DifficultyLevel, AIConfig, ReanswerQuestionResult, GeogebraAnalysisResult } from "./types";
import { generateAnalyzePrompt, generateSimilarQuestionPrompt, generateGeogebraPrompt } from './prompts';
import { getAppConfig } from '../config';
import { getMathTagsFromDB, getTagsFromDB } from './tag-service';
import { createLogger } from '../logger';
import { normalizeMistakeStatusForSave } from '../mistake-status';
import { AIError, classifyAIError, isRetryableAIError } from './errors';
import { extractTag, parseKnowledgePoints, parseQuestionResponse } from './response-parser';

const logger = createLogger('ai:gemini');

type GeminiContent = string | Array<
    { text: string } |
    { inlineData: { mimeType: string; data: string } }
>;

/** 单次 AI 操作的默认时间预算（未读到配置时使用） */
const DEFAULT_BUDGET_MS = 170_000;
/** 剩余预算低于该值时不再发起重试，避免必然超时的请求 */
const MIN_ATTEMPT_MS = 8_000;
const MAX_ATTEMPTS = 3;

/** 这些 finishReason 表示内容被安全策略拦截，重试无意义 */
const BLOCKED_FINISH_REASONS = new Set([
    'SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY',
]);

/**
 * 按模型选择「少思考」参数，减少延迟：
 * - Gemini 2.x flash 系列：thinkingBudget=0 可完全关闭思考；
 * - Gemini 2.5 pro 不允许关闭，不传；
 * - Gemini 3 及以后的 flash 系列：官方改用 thinkingLevel，传 LOW；
 * - 其他未知模型不传，交给服务端默认。
 */
export function thinkingConfigForModel(model: string): ThinkingConfig | undefined {
    const m = model.toLowerCase();
    if (/gemini-2\.\d+-pro/.test(m)) return undefined;
    if (/gemini-2\.\d+/.test(m)) return { thinkingBudget: 0 };
    if (/gemini-([3-9]|\d{2,})(\.\d+)?-flash/.test(m)) return { thinkingLevel: 'LOW' as ThinkingLevel };
    return undefined;
}

interface GenerateResult {
    text: string;
    finishReason?: string;
}

export class GeminiProvider implements AIService {
    private ai: GoogleGenAI;
    private modelName: string;
    private baseUrl: string;
    /** 服务端拒绝思考参数（400）后置为 false，本实例后续请求不再携带 */
    private thinkingSupported = true;

    constructor(config?: AIConfig) {
        const apiKey = config?.apiKey;
        const baseUrl = config?.baseUrl;

        if (!apiKey) {
            throw new Error("AI_AUTH_ERROR: GOOGLE_API_KEY is required for Gemini provider");
        }

        // 使用 httpOptions.baseUrl 来配置自定义 API 地址，避免全局 setDefaultBaseUrls 的竞态条件。
        // 超时不在这里写死，而是每次请求按剩余时间预算单独设置（见 generate）。
        this.ai = new GoogleGenAI({
            apiKey,
            httpOptions: baseUrl ? { baseUrl } : undefined,
        });

        this.modelName = config?.model || 'gemini-2.5-flash';
        this.baseUrl = baseUrl || 'https://generativelanguage.googleapis.com';

        logger.info({
            provider: 'Gemini',
            model: this.modelName,
            baseUrl: this.baseUrl,
            apiKeyPrefix: apiKey.substring(0, 8) + '...'
        }, 'AI Provider initialized');
    }

    /**
     * 单次操作的时间预算：比前端超时（timeouts.analyze）少 10 秒，
     * 保证后端先返回明确的错误码，而不是被前端 abort 成笼统的超时。
     */
    private getBudgetMs(): number {
        const configured = getAppConfig().timeouts?.analyze;
        if (!configured || configured <= 0) return DEFAULT_BUDGET_MS;
        return Math.max(30_000, configured - 10_000);
    }

    /**
     * 统一的生成调用：
     * 1. 整个操作共享一个时间预算，每次尝试只用剩余时间作为 HTTP 超时；
     * 2. 只对服务繁忙 / 网络抖动重试，超时、配额、鉴权等直接失败；
     * 3. 服务端不认思考参数时自动去掉后重试一次；
     * 4. 检查 promptFeedback / finishReason，区分「被拦截」「被截断」。
     */
    private async generate(contents: GeminiContent, options: { maxOutputTokens: number; json?: boolean }): Promise<GenerateResult> {
        const deadline = Date.now() + this.getBudgetMs();
        let lastError: unknown;

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            const remaining = deadline - Date.now();
            if (remaining < MIN_ATTEMPT_MS) break;

            const thinkingConfig = this.thinkingSupported ? thinkingConfigForModel(this.modelName) : undefined;
            try {
                const response: GenerateContentResponse = await this.ai.models.generateContent({
                    model: this.modelName,
                    config: {
                        httpOptions: { timeout: remaining },
                        maxOutputTokens: options.maxOutputTokens,
                        ...(options.json ? { responseMimeType: 'application/json' } : {}),
                        ...(thinkingConfig ? { thinkingConfig } : {}),
                    },
                    contents,
                });
                return this.inspectResponse(response);
            } catch (error) {
                lastError = error;
                if (error instanceof AIError) throw error;

                const message = error instanceof Error ? error.message : String(error);
                const status = (error as { status?: number })?.status;
                if (thinkingConfig && (status === 400 || /\b400\b/.test(message)) && /thinking/i.test(message)) {
                    logger.warn({ model: this.modelName, message }, 'Model rejected thinking config, retrying without it');
                    this.thinkingSupported = false;
                    continue;
                }

                const code = classifyAIError(error);
                if (!isRetryableAIError(code) || attempt === MAX_ATTEMPTS) {
                    throw error;
                }
                const delay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s
                logger.warn({ attempt, code, message, nextRetryDelayMs: delay }, 'Gemini call failed, retrying');
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        // 预算耗尽仍未成功
        throw lastError ?? new AIError('AI_TIMEOUT_ERROR', 'time budget exhausted before request');
    }

    private inspectResponse(response: GenerateContentResponse): GenerateResult {
        const blockReason = response.promptFeedback?.blockReason;
        const candidate = response.candidates?.[0];
        const finishReason = candidate?.finishReason ? String(candidate.finishReason) : undefined;

        logger.debug({ usageMetadata: response.usageMetadata, finishReason, blockReason }, 'Gemini response metadata');

        if (blockReason || (finishReason && BLOCKED_FINISH_REASONS.has(finishReason))) {
            throw new AIError('AI_CONTENT_BLOCKED', `blockReason=${blockReason} finishReason=${finishReason}`);
        }

        const text = response.text || '';
        if (!text) {
            throw new AIError(finishReason === 'MAX_TOKENS' ? 'AI_RESPONSE_TRUNCATED' : 'AI_RESPONSE_ERROR', `empty text, finishReason=${finishReason}`);
        }
        return { text, finishReason };
    }

    // 保留为方法以兼容既有单元测试，实际逻辑在 response-parser 中共用
    private parseResponse(text: string, truncated = false): ParsedQuestion {
        return parseQuestionResponse(text, { truncated });
    }

    async analyzeImage(imageBase64: string, mimeType: string = "image/jpeg", language: 'zh' | 'en' = 'zh', grade?: 7 | 8 | 9 | 10 | 11 | 12 | null, subject?: string | null, gradeSemester?: string | null): Promise<ParsedQuestion> {
        const config = getAppConfig();

        // 仅在初高中阶段（grade != null）查询预置大纲标签；小学阶段由 AI 自行提取知识点，避免塞入上千个标签拖慢速度
        const shouldFetchSyllabusTags = grade !== null && grade !== undefined;
        const [
            prefetchedMathTags,
            prefetchedPhysicsTags,
            prefetchedChemistryTags,
            prefetchedBiologyTags,
            prefetchedEnglishTags,
        ] = shouldFetchSyllabusTags ? await Promise.all([
            (subject === '数学' || !subject) ? getMathTagsFromDB(grade) : Promise.resolve([]),
            (subject === '物理' || !subject) ? getTagsFromDB('physics') : Promise.resolve([]),
            (subject === '化学' || !subject) ? getTagsFromDB('chemistry') : Promise.resolve([]),
            (subject === '生物' || !subject) ? getTagsFromDB('biology') : Promise.resolve([]),
            (subject === '英语' || !subject) ? getTagsFromDB('english') : Promise.resolve([]),
        ]) : [[], [], [], [], []];

        const prompt = generateAnalyzePrompt(language, grade, subject, {
            customTemplate: config.prompts?.analyze,
            prefetchedMathTags,
            prefetchedPhysicsTags,
            prefetchedChemistryTags,
            prefetchedBiologyTags,
            prefetchedEnglishTags,
        }, gradeSemester);

        logger.info({
            model: this.modelName,
            imageSize: imageBase64.length,
            mimeType,
            language,
            grade: grade || 'all',
            promptLength: prompt.length,
        }, 'Gemini image analysis request');
        logger.box('📝 Full Prompt', prompt);

        try {
            const startedAt = Date.now();
            const { text, finishReason } = await this.generate([
                { text: prompt },
                { inlineData: { data: imageBase64, mimeType } },
            ], { maxOutputTokens: 16384 });

            logger.info({ durationMs: Date.now() - startedAt, finishReason, textLength: text.length }, 'Gemini image analysis responded');
            logger.box('🤖 AI Raw Response', text);

            const parsedResult = this.parseResponse(text, finishReason === 'MAX_TOKENS');
            logger.box('✅ Parsed & Validated Result', JSON.stringify(parsedResult, null, 2));
            return parsedResult;
        } catch (error) {
            this.handleError(error);
        }
    }

    async generateSimilarQuestion(originalQuestion: string, knowledgePoints: string[], language: 'zh' | 'en' = 'zh', difficulty: DifficultyLevel = 'medium', gradeSemester?: string | null): Promise<ParsedQuestion> {
        const config = getAppConfig();
        const prompt = generateSimilarQuestionPrompt(language, originalQuestion, knowledgePoints, difficulty, {
            customTemplate: config.prompts?.similar
        }, gradeSemester);

        logger.info({
            model: this.modelName,
            difficulty,
            language,
            knowledgePoints: knowledgePoints.join(', '),
        }, 'Gemini similar question request');
        logger.box('📝 Full Prompt', prompt);

        try {
            const { text, finishReason } = await this.generate(prompt, { maxOutputTokens: 8192 });
            logger.box('🤖 AI Raw Response', text);
            return this.parseResponse(text, finishReason === 'MAX_TOKENS');
        } catch (error) {
            this.handleError(error);
        }
    }

    async reanswerQuestion(questionText: string, language: 'zh' | 'en' = 'zh', subject?: string | null, imageBase64?: string, gradeSemester?: string | null): Promise<ReanswerQuestionResult> {
        const { generateReanswerPrompt } = await import('./prompts');
        const prompt = generateReanswerPrompt(language, questionText, subject, undefined, gradeSemester);

        logger.info({
            model: this.modelName,
            questionLength: questionText.length,
            subject: subject || 'auto',
            hasImage: !!imageBase64
        }, 'Gemini reanswer request');
        logger.debug({ prompt }, 'Full prompt');

        try {
            let contents: GeminiContent;
            if (imageBase64) {
                // 移除 data:image/xxx;base64, 前缀（如果存在），并保留真实 mimeType
                const match = imageBase64.match(/^data:([^;]+);base64,/);
                const mimeType = match?.[1] || 'image/jpeg';
                const base64Data = imageBase64.replace(/^data:[^;]+;base64,/, '');
                contents = [
                    { text: prompt },
                    { inlineData: { mimeType, data: base64Data } }
                ];
            } else {
                contents = prompt;
            }

            const { text } = await this.generate(contents, { maxOutputTokens: 8192 });
            logger.debug({ rawResponse: text }, 'AI raw response');

            const wrongAnswerText = extractTag(text, "wrong_answer_text") || "";
            return {
                answerText: extractTag(text, "answer_text") || "",
                analysis: extractTag(text, "analysis", true) || "",
                knowledgePoints: parseKnowledgePoints(extractTag(text, "knowledge_points")),
                wrongAnswerText,
                mistakeAnalysis: extractTag(text, "mistake_analysis") || "",
                mistakeStatus: normalizeMistakeStatusForSave(extractTag(text, "mistake_status"), wrongAnswerText),
            };
        } catch (error) {
            this.handleError(error);
        }
    }

    async analyzeForGeogebra(questionText: string, answerText: string, analysis: string, previousErrors?: string): Promise<GeogebraAnalysisResult> {
        const prompt = generateGeogebraPrompt(questionText, answerText, analysis, previousErrors);

        logger.info({ model: this.modelName, questionLength: questionText.length }, 'GeoGebra Analysis Request');

        try {
            const { text } = await this.generate(prompt, { maxOutputTokens: 4096 });
            logger.debug({ rawResponse: text }, 'GeoGebra AI raw response');

            // 兼容 markdown 代码块包裹的 JSON
            let jsonStr = text.trim();
            const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (jsonMatch) {
                jsonStr = jsonMatch[1].trim();
            }
            const objStart = jsonStr.indexOf('{');
            const objEnd = jsonStr.lastIndexOf('}');
            if (objStart !== -1 && objEnd !== -1) {
                jsonStr = jsonStr.substring(objStart, objEnd + 1);
            }

            let parsed: { suitable?: unknown; commands?: unknown; description?: unknown };
            try {
                parsed = JSON.parse(jsonStr);
            } catch {
                throw new AIError('AI_RESPONSE_ERROR', `GeoGebra JSON parse failed: ${jsonStr.substring(0, 200)}`);
            }

            return {
                suitable: Boolean(parsed.suitable),
                commands: Array.isArray(parsed.commands) ? parsed.commands : [],
                description: typeof parsed.description === 'string' ? parsed.description : "",
            };
        } catch (error) {
            this.handleError(error);
        }
    }

    async completeText(systemPrompt: string, userContent: string, options: { json?: boolean; maxOutputTokens?: number } = {}): Promise<string> {
        try {
            const { text } = await this.generate(
                [{ text: systemPrompt }, { text: userContent }],
                { maxOutputTokens: options.maxOutputTokens ?? 16384, json: options.json }
            );
            return text;
        } catch (error) {
            this.handleError(error);
        }
    }

    /** 记录原始错误后抛出统一错误码（前端据此翻译提示） */
    private handleError(error: unknown): never {
        logger.error({
            error: error instanceof Error ? error.message : String(error),
            detail: error instanceof AIError ? error.detail : undefined,
            status: (error as { status?: number })?.status,
        }, 'Gemini error');
        throw new Error(classifyAIError(error));
    }
}
