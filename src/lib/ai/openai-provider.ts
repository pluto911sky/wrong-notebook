import OpenAI from "openai";
import { AIService, ParsedQuestion, DifficultyLevel, AIConfig, ReanswerQuestionResult, GeogebraAnalysisResult } from "./types";
import { generateAnalyzePrompt, generateSimilarQuestionPrompt, generateGeogebraPrompt } from './prompts';
import { getAppConfig } from '../config';
import { AIError, classifyAIError } from './errors';
import { extractTag, parseQuestionResponse } from './response-parser';
import { getMathTagsFromDB, getTagsFromDB } from './tag-service';
import { createLogger } from '../logger';
import { normalizeMistakeStatusForSave } from '../mistake-status';

const logger = createLogger('ai:openai');

/**
 * 思考模式默认策略：
 * - 显式 true/false 永远优先，与端点是否被识别无关；
 * - 普通三操作和 LongCat 图片分支保留旧默认 disabled；
 * - GeoGebra 未显式选择时仅对已识别端点默认 disabled，未知端点不发字段。
 */
const THINKING_CAPABLE_HOSTS = (process.env.THINKING_CAPABLE_HOSTS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

function isThinkingCapableEndpoint(baseUrl?: string): boolean {
    if (!baseUrl) return false;
    const lower = baseUrl.toLowerCase();
    return THINKING_CAPABLE_HOSTS.some((host) => lower.includes(host));
}

type OpenAIUserContent = string | Array<
    { type: "text"; text: string } |
    { type: "image_url"; image_url: { url: string } }
>;

export class OpenAIProvider implements AIService {
    private openai: OpenAI;
    private model: string;
    private baseURL: string;
    private apiKey: string;
    private isLongCat: boolean;
    private disableThinking: boolean;
    private explicitDisableThinking: boolean | undefined;
    private isThinkingCapable: boolean;

    constructor(config?: AIConfig) {
        const apiKey = config?.apiKey;
        const baseURL = config?.baseUrl;

        if (!apiKey) {
            throw new Error("AI_AUTH_ERROR: OPENAI_API_KEY is required for OpenAI provider");
        }

        this.openai = new OpenAI({
            apiKey: apiKey,
            baseURL: baseURL || undefined,
            defaultHeaders: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
        });

        this.model = config?.model || 'gpt-4o'; // Fallback for safety
        this.baseURL = baseURL || 'https://api.openai.com/v1';
        this.apiKey = apiKey;
        this.isLongCat = this.baseURL.includes('longcat.chat');

        // 先保存用户显式选择，再保存解析后的实际默认值。
        this.isThinkingCapable = isThinkingCapableEndpoint(this.baseURL);
        this.explicitDisableThinking = config?.disableThinking;
        this.disableThinking = config?.disableThinking ?? this.isThinkingCapable;

        logger.info({
            provider: 'OpenAI',
            model: this.model,
            baseURL: this.baseURL,
            apiKeyPrefix: apiKey.substring(0, 8) + '...',
            disableThinking: this.disableThinking,
            thinkingCapableEndpoint: this.isThinkingCapable,
        }, 'AI Provider initialized');
    }

    /**
     * 构造控制思考模式的请求参数。
     *
     * 部分推理型端点通过顶层 `thinking` 字段控制（OpenAI 官方接口无此字段，
     * 但 SDK 会原样透传未知的顶层参数）。
     * 关闭思考可避免思维链吃满 max_tokens 导致 content 为空。
     */
    private thinkingParam(legacyDefaultDisabled = false): Record<string, unknown> {
        if (this.explicitDisableThinking !== undefined) {
            return { thinking: { type: this.explicitDisableThinking ? 'disabled' : 'enabled' } };
        }
        // 按操作保留 main 的默认行为，而不是用主机识别覆盖旧的 disabled。
        if (legacyDefaultDisabled || this.disableThinking) {
            return { thinking: { type: 'disabled' } };
        }
        return {};
    }

    /**
     * 合并请求参数。思考模式参数需要在运行时按配置注入，
     * 而 OpenAI SDK 的请求类型不允许未知顶层字段，故此处统一断言。
     */
    private withThinking<T extends object>(params: T, legacyDefaultDisabled = true): T {
        return { ...params, ...this.thinkingParam(legacyDefaultDisabled) } as T;
    }

    private adaptMessagesForLongCat(messages: Array<{ role: string; content: any }>): Array<{ role: string; content: any }> {
        return messages.map(msg => {
            if (typeof msg.content === 'string') {
                return { ...msg, content: [{ type: 'text', text: msg.content }] };
            }
            if (Array.isArray(msg.content)) {
                const adapted = msg.content.map((part: any) => {
                    if (part.type === 'image_url') {
                        return {
                            type: 'input_image',
                            input_image: { data: [part.image_url.url], type: 'url' }
                        };
                    }
                    return part;
                });
                return { ...msg, content: adapted };
            }
            return msg;
        });
    }

    // 解析逻辑与其他 Provider 共用（response-parser.ts）
    private extractTag(text: string, tagName: string): string | null {
        return extractTag(text, tagName, tagName === 'analysis');
    }

    private parseResponse(text: string, truncated = false): ParsedQuestion {
        return parseQuestionResponse(text, { truncated });
    }

    async analyzeImage(imageBase64: string, mimeType: string = "image/jpeg", language: 'zh' | 'en' = 'zh', grade?: 7 | 8 | 9 | 10 | 11 | 12 | null, subject?: string | null, gradeSemester?: string | null): Promise<ParsedQuestion> {
        const config = getAppConfig();

        // 从数据库获取各学科标签
        // 如果指定了学科，只获取该学科；否则获取所有学科标签供 AI 判断
        const prefetchedMathTags = (subject === '数学' || !subject) ? await getMathTagsFromDB(grade || null) : [];
        const prefetchedPhysicsTags = (subject === '物理' || !subject) ? await getTagsFromDB('physics') : [];
        const prefetchedChemistryTags = (subject === '化学' || !subject) ? await getTagsFromDB('chemistry') : [];
        const prefetchedBiologyTags = (subject === '生物' || !subject) ? await getTagsFromDB('biology') : [];
        const prefetchedEnglishTags = (subject === '英语' || !subject) ? await getTagsFromDB('english') : [];

        const systemPrompt = generateAnalyzePrompt(language, grade, subject, {
            customTemplate: config.prompts?.analyze,
            prefetchedMathTags,
            prefetchedPhysicsTags,
            prefetchedChemistryTags,
            prefetchedBiologyTags,
            prefetchedEnglishTags,
        }, gradeSemester);

        logger.box('🔍 AI Image Analysis Request', {
            provider: 'OpenAI',
            endpoint: `${this.baseURL}/chat/completions`,
            imageSize: `${imageBase64.length} bytes`,
            mimeType,
            model: this.model,
            language,
            grade: grade || 'all'
        });
        logger.box('📝 Full System Prompt', systemPrompt);

        try {
            // 构建请求参数（用于日志显示，图片数据截断）
            const requestParamsForLog = {
                model: this.model,
                messages: [
                    {
                        role: "system",
                        content: systemPrompt
                    },
                    {
                        role: "user",
                        content: [
                            {
                                type: "image_url",
                                image_url: {
                                    url: `data:${mimeType};base64,[...${imageBase64.length} bytes base64 data...]`,
                                },
                            },
                        ],
                    },
                ],
                max_tokens: 32768,
            };

            logger.box('📤 API Request (发送给 AI 的原始请求)', JSON.stringify(requestParamsForLog, null, 2));

            let response: any;

            if (this.isLongCat) {
                // LongCat 使用不同的多模态格式，绕过 SDK 直接请求
                const messages = this.adaptMessagesForLongCat([
                    { role: "system", content: systemPrompt },
                    {
                        role: "user",
                        content: [
                            {
                                type: "image_url",
                                image_url: {
                                    url: `data:${mimeType};base64,${imageBase64}`,
                                },
                            },
                        ],
                    },
                ]);

                const res = await fetch(`${this.baseURL}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        model: this.model,
                        messages,
                        ...this.thinkingParam(true),
                        max_tokens: 32768,
                    }),
                });

                if (!res.ok) {
                    const errBody = await res.text();
                    logger.error({ status: res.status, body: errBody }, 'LongCat API error');
                    throw new Error(`${res.status} status code (${errBody})`);
                }

                response = await res.json();
            } else {
                response = await this.openai.chat.completions.create(
                    this.withThinking({
                        model: this.model,
                        messages: [
                            {
                                role: "system",
                                content: systemPrompt
                            },
                            {
                                role: "user",
                                content: [
                                    {
                                        type: "image_url",
                                        image_url: {
                                            url: `data:${mimeType};base64,${imageBase64}`,
                                        },
                                    },
                                ],
                            },
                        ],
                        // response_format: { type: "json_object" }, // Removing to improve compatibility with 3rd party providers
                        max_tokens: 32768,
                    }) as any
                );
            }

            logger.box('📦 Full API Response', JSON.stringify(response, null, 2));

            // 检查响应是否有效
            if (!response || !response.choices || response.choices.length === 0) {
                logger.error({ response: JSON.stringify(response) }, 'Invalid API response - no choices array');
                throw new Error("AI_RESPONSE_ERROR: API returned empty or invalid response");
            }

            const text = response.choices[0]?.message?.content || "";

            logger.box('🤖 AI Raw Response', text);

            if (!text) throw new Error("Empty response from AI");
            const parsedResult = this.parseResponse(text);

            logger.box('✅ Parsed & Validated Result', JSON.stringify(parsedResult, null, 2));

            return parsedResult;

        } catch (error) {
            logger.box('❌ Error during AI analysis', {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            });
            this.handleError(error);
        }
    }

    async generateSimilarQuestion(originalQuestion: string, knowledgePoints: string[], language: 'zh' | 'en' = 'zh', difficulty: DifficultyLevel = 'medium', gradeSemester?: string | null): Promise<ParsedQuestion> {
        const config = getAppConfig();
        const systemPrompt = generateSimilarQuestionPrompt(language, originalQuestion, knowledgePoints, difficulty, {
            customTemplate: config.prompts?.similar
        }, gradeSemester);
        const userPrompt = `\nOriginal Question: "${originalQuestion}"\nKnowledge Points: ${knowledgePoints.join(", ")}\n    `;

        logger.box('🎯 Generate Similar Question Request', {
            provider: 'OpenAI',
            endpoint: `${this.baseURL}/chat/completions`,
            model: this.model,
            originalQuestion: originalQuestion.substring(0, 100) + '...',
            knowledgePoints: knowledgePoints.join(', '),
            difficulty,
            language
        });
        logger.box('📝 System Prompt', systemPrompt);
        logger.box('📝 User Prompt', userPrompt);

        try {
            const response = await this.openai.chat.completions.create(
                this.withThinking({
                    model: this.model,
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: userPrompt },
                    ],
                    // response_format: { type: "json_object" }, // Removing to improve compatibility with 3rd party providers
                    max_tokens: 32768,
                }) as any
            );

            const text = response.choices[0]?.message?.content || "";

            logger.box('🤖 AI Raw Response', text);

            if (!text) throw new Error("Empty response from AI");
            const parsedResult = this.parseResponse(text);

            logger.box('✅ Parsed & Validated Result', JSON.stringify(parsedResult, null, 2));

            return parsedResult;

        } catch (error) {
            logger.box('❌ Error during question generation', {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            });
            this.handleError(error);
        }
    }

    async reanswerQuestion(questionText: string, language: 'zh' | 'en' = 'zh', subject?: string | null, imageBase64?: string, gradeSemester?: string | null): Promise<ReanswerQuestionResult> {
        const { generateReanswerPrompt } = await import('./prompts');
        const prompt = generateReanswerPrompt(language, questionText, subject, undefined, gradeSemester);

        logger.info({
            provider: 'OpenAI',
            endpoint: `${this.baseURL}/chat/completions`,
            model: this.model,
            questionLength: questionText.length,
            subject: subject || 'auto',
            hasImage: !!imageBase64
        }, 'Reanswer Question Request');
        logger.debug({ prompt }, 'Full prompt');

        try {
            // 根据是否有图片构建不同的消息内容
            let userContent: OpenAIUserContent = "请根据上述题目提供答案和解析。";
            if (imageBase64) {
                // 如果有图片，构建多模态消息
                const imageUrl = imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`;
                logger.debug({ imageLength: imageUrl.length }, 'Image added to request');
                userContent = [
                    { type: "text", text: "请结合图片和题目描述提供答案和解析。" },
                    { type: "image_url", image_url: { url: imageUrl } }
                ];
            } else {
                logger.debug({ imageBase64Type: typeof imageBase64, hasValue: !!imageBase64 }, 'No image data');
            }

            // 打印请求参数
            const requestParams = {
                model: this.model,
                messages: [
                    { role: "system", content: prompt.substring(0, 200) + "..." },
                    { role: "user", content: typeof userContent === 'string' ? userContent : "[包含图片的多模态消息]" }
                ],
                max_tokens: 32768
            };
            logger.debug({ requestParams }, 'Request parameters');

            const response = await this.openai.chat.completions.create(
                this.withThinking({
                    model: this.model,
                    messages: [
                        { role: "system", content: prompt },
                        { role: "user", content: userContent }
                    ],
                    max_tokens: 32768,
                }) as any
            );

            logger.debug({ response: JSON.stringify(response) }, 'Full API response');

            // 检查响应是否有效
            if (!response || !response.choices || response.choices.length === 0) {
                logger.error({ response: JSON.stringify(response) }, 'Invalid API response - no choices array');
                throw new Error("AI_RESPONSE_ERROR: API returned empty or invalid response");
            }

            const text = response.choices[0]?.message?.content || "";

            logger.debug({ rawResponse: text }, 'AI raw response');

            if (!text) throw new Error("Empty response from AI");

            // 解析响应
            const answerText = this.extractTag(text, "answer_text") || "";
            const analysis = this.extractTag(text, "analysis") || "";
            const knowledgePointsRaw = this.extractTag(text, "knowledge_points") || "";
            const knowledgePoints = knowledgePointsRaw.split(/[,，\n]/).map(k => k.trim()).filter(k => k.length > 0);
            const wrongAnswerText = this.extractTag(text, "wrong_answer_text") || "";
            const mistakeAnalysis = this.extractTag(text, "mistake_analysis") || "";
            const mistakeStatus = normalizeMistakeStatusForSave(
                this.extractTag(text, "mistake_status"),
                wrongAnswerText
            );

            logger.info('Reanswer parsed successfully');

            return { answerText, analysis, knowledgePoints, wrongAnswerText, mistakeAnalysis, mistakeStatus };

        } catch (error) {
            logger.error({ error, stack: error instanceof Error ? error.stack : undefined }, 'Error during reanswer');
            this.handleError(error);
        }
    }

    async analyzeForGeogebra(questionText: string, answerText: string, analysis: string, previousErrors?: string): Promise<GeogebraAnalysisResult> {
        const prompt = generateGeogebraPrompt(questionText, answerText, analysis, previousErrors);

        logger.info({
            provider: 'OpenAI',
            model: this.model,
            questionLength: questionText.length,
        }, 'GeoGebra Analysis Request');

        try {
            const response = await this.openai.chat.completions.create(
                this.withThinking({
                    model: this.model,
                    messages: [
                        { role: "system", content: prompt },
                        { role: "user", content: "请分析上述题目并生成 GeoGebra 演示命令。" }
                    ],
                    // 该任务需要输出较大的 JSON（多条 GeoGebra 命令）；
                    // PR 的 8192 预算保留，但不得扩散到其他任务。
                    // 保留旧未知端点无 thinking 字段；显式选择仍优先于自动识别。
                    max_tokens: 8192,
                }, false) as any
            );

            const text = response.choices[0]?.message?.content || '';
            logger.debug({ rawResponse: text }, 'GeoGebra AI raw response');

            if (!text) throw new Error("Empty response from AI");

            // Extract JSON from response (handle possible markdown code blocks)
            let jsonStr = text.trim();
            const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (jsonMatch) {
                jsonStr = jsonMatch[1].trim();
            }

            // Try to find JSON object
            const objStart = jsonStr.indexOf('{');
            const objEnd = jsonStr.lastIndexOf('}');
            if (objStart !== -1 && objEnd !== -1) {
                jsonStr = jsonStr.substring(objStart, objEnd + 1);
            }

            const parsed = JSON.parse(jsonStr);

            return {
                suitable: Boolean(parsed.suitable),
                commands: Array.isArray(parsed.commands) ? parsed.commands : [],
                description: parsed.description || "",
            };
        } catch (error) {
            logger.error({ error, stack: error instanceof Error ? error.stack : undefined }, 'Error during GeoGebra analysis');
            this.handleError(error);
        }
    }

    async completeText(systemPrompt: string, userContent: string, options: { json?: boolean; maxOutputTokens?: number } = {}): Promise<string> {
        try {
            // 不传 response_format：部分第三方兼容端点不支持，JSON 约束交给提示词
            const response = await this.openai.chat.completions.create(
                this.withThinking({
                    model: this.model,
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: userContent },
                    ],
                    max_tokens: options.maxOutputTokens ?? 16384,
                }) as any
            );
            const text = response.choices?.[0]?.message?.content || "";
            if (!text) throw new AIError('AI_RESPONSE_ERROR', 'empty completion');
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
        }, 'OpenAI error');
        throw new Error(classifyAIError(error));
    }
}

