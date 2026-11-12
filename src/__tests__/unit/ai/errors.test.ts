import { describe, it, expect } from 'vitest';
import { classifyAIError, AIError } from '@/lib/ai/errors';
import { extractTag, parseQuestionResponse } from '@/lib/ai/response-parser';
import { thinkingConfigForModel } from '@/lib/ai/gemini-provider';

describe('classifyAIError', () => {
    it('已有错误码直接透传', () => {
        expect(classifyAIError(new Error('AI_RESPONSE_ERROR'))).toBe('AI_RESPONSE_ERROR');
        expect(classifyAIError(new Error('AI_AUTH_ERROR: key missing'))).toBe('AI_AUTH_ERROR');
        expect(classifyAIError(new AIError('AI_CONTENT_BLOCKED'))).toBe('AI_CONTENT_BLOCKED');
    });

    it('优先使用 SDK 的 HTTP status', () => {
        expect(classifyAIError(Object.assign(new Error('boom'), { status: 429 }))).toBe('AI_QUOTA_EXCEEDED');
        expect(classifyAIError(Object.assign(new Error('boom'), { status: 503 }))).toBe('AI_SERVICE_UNAVAILABLE');
    });

    it('SDK 超时（aborted）归为超时', () => {
        expect(classifyAIError(new Error('This operation was aborted'))).toBe('AI_TIMEOUT_ERROR');
    });

    it('请求 ID 中的数字不会被误判为状态码', () => {
        expect(classifyAIError(new Error('request req_5003xyz failed weirdly'))).toBe('AI_UNKNOWN_ERROR');
    });

    it('disconnect 不应被当成连接失败的关键词 connect', () => {
        expect(classifyAIError(new Error('client disconnected unexpectedly'))).toBe('AI_UNKNOWN_ERROR');
    });
});

describe('response-parser', () => {
    it('重复同名标签时只取第一段', () => {
        const text = '<analysis>first</analysis> noise <analysis>second</analysis>';
        expect(extractTag(text, 'analysis')).toBe('first');
    });

    it('analysis 未闭合时读到末尾（截断场景）', () => {
        const text = '<question_text>Q</question_text><answer_text>A</answer_text><analysis>partial';
        expect(parseQuestionResponse(text).analysis).toBe('partial');
    });

    it('知识点超过 5 个时截断，而不是校验失败', () => {
        const text = '<question_text>Q</question_text><answer_text>A</answer_text><analysis>An</analysis><knowledge_points>a,b,c,d,e,f,g</knowledge_points>';
        expect(parseQuestionResponse(text).knowledgePoints).toEqual(['a', 'b', 'c', 'd', 'e']);
    });

    it('模型声明图片里没有题目时给出专门错误码，而不是编造题目', () => {
        expect(() => parseQuestionResponse('<no_question>true</no_question>')).toThrow('AI_NO_QUESTION_FOUND');
    });

    it('截断且缺关键标签时给出截断错误码', () => {
        expect(() => parseQuestionResponse('<question_text>Q', { truncated: true })).toThrow('AI_RESPONSE_TRUNCATED');
    });
});

describe('thinkingConfigForModel', () => {
    it('按模型代际选择思考参数', () => {
        expect(thinkingConfigForModel('gemini-2.5-flash')).toEqual({ thinkingBudget: 0 });
        expect(thinkingConfigForModel('gemini-2.5-pro')).toBeUndefined();
        expect(thinkingConfigForModel('gemini-3.8-flash')).toEqual({ thinkingLevel: 'LOW' });
        expect(thinkingConfigForModel('gemini-3.5-flash-lite')).toEqual({ thinkingLevel: 'LOW' });
        expect(thinkingConfigForModel('gemini-flash-latest')).toBeUndefined();
    });
});
