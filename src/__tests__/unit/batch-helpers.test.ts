import { describe, it, expect, vi, beforeEach } from 'vitest';

const post = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ apiClient: { post } }));

import { saveBatchQuestions, matchNotebookBySubject, pickNotebookForSubjects } from '@/lib/batch-save';
import { runWithConcurrency } from '@/lib/concurrency';
import type { BatchQuestionItem } from '@/components/batch-review-editor';

const item = (id: string, extra: Partial<BatchQuestionItem> = {}): BatchQuestionItem => ({
    id, questionText: `Q${id}`, answerText: 'A', analysis: 'An', knowledgePoints: [], selected: true, ...extra,
});
const notebooks = [{ id: 'nb-math', name: '初二数学' }, { id: 'nb-en', name: '英语错题本' }];

describe('saveBatchQuestions', () => {
    beforeEach(() => post.mockReset());

    it('单条失败不中断，返回成功与失败的 id', async () => {
        post.mockResolvedValueOnce({ id: '1' }).mockRejectedValueOnce(new Error('500')).mockResolvedValueOnce({ id: '3' });
        const result = await saveBatchQuestions([item('a'), item('b'), item('c')], 'nb-math');
        expect(result).toEqual({ savedIds: ['a', 'c'], failedIds: ['b'] });
    });

    it('每题优先使用自己的错题本，且不再发送非法的 mistakeStatus "wrong"', async () => {
        post.mockResolvedValue({});
        await saveBatchQuestions([item('a', { notebookId: 'nb-en' }), item('b')], 'nb-math');
        expect(post.mock.calls[0][1].subjectId).toBe('nb-en');
        expect(post.mock.calls[1][1].subjectId).toBe('nb-math');
        expect(post.mock.calls.every(([, body]) => body.mistakeStatus !== 'wrong')).toBe(true);
    });

    it('没有任何错题本时不发请求，记为失败', async () => {
        const result = await saveBatchQuestions([item('a')], undefined);
        expect(post).not.toHaveBeenCalled();
        expect(result.failedIds).toEqual(['a']);
    });
});

describe('notebook matching', () => {
    it('按学科名包含关系匹配', () => {
        expect(matchNotebookBySubject(notebooks, '英语')).toBe('nb-en');
        expect(matchNotebookBySubject(notebooks, '其他')).toBeUndefined();
        expect(pickNotebookForSubjects(notebooks, ['数学', '英语', '数学'])).toBe('nb-math');
    });
});

describe('runWithConcurrency', () => {
    it('并发数不超过上限，且全部执行', async () => {
        let running = 0;
        let peak = 0;
        const done: number[] = [];
        await runWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
            running++;
            peak = Math.max(peak, running);
            await new Promise((r) => setTimeout(r, 5));
            done.push(n);
            running--;
        });
        expect(peak).toBe(2);
        expect(done.sort()).toEqual([1, 2, 3, 4, 5]);
    });

    it('中止后不再启动新任务', async () => {
        const controller = new AbortController();
        const started: number[] = [];
        await runWithConcurrency([1, 2, 3, 4], 1, async (n) => {
            started.push(n);
            if (n === 2) controller.abort();
        }, controller.signal);
        expect(started).toEqual([1, 2]);
    });
});
