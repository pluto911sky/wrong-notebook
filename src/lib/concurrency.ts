/**
 * 以固定并发度处理一组任务。
 * 单个任务失败不影响其他任务（worker 自行捕获并记录错误）；
 * signal 中止后不再启动新任务，已在执行的由 worker 自己响应中止。
 */
export async function runWithConcurrency<T>(
    items: T[],
    limit: number,
    worker: (item: T, index: number) => Promise<void>,
    signal?: AbortSignal
): Promise<void> {
    let cursor = 0;
    const lanes = Math.max(1, Math.min(limit, items.length));

    async function lane() {
        while (cursor < items.length) {
            if (signal?.aborted) return;
            const index = cursor++;
            await worker(items[index], index);
        }
    }

    await Promise.all(Array.from({ length: lanes }, lane));
}
