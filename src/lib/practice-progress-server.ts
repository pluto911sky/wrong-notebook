import { prisma } from "./prisma";
import { computePracticeProgress, type PracticeProgress } from "./practice-progress";

/** 读取某用户某道错题的闯关进度 */
export async function getPracticeProgress(userId: string, errorItemId: string, now: Date = new Date()): Promise<PracticeProgress> {
    const records = await prisma.practiceRecord.findMany({
        where: { userId, errorItemId },
        select: { difficulty: true, isCorrect: true, createdAt: true },
    });
    return computePracticeProgress(records, now);
}

/**
 * 同一用户 + 同一错题的作答串行执行。
 * 「先检查今天是否答过，再写记录」不是原子的，连点两次提交会写入两条并发记录；
 * 进程内按 key 排队即可（应用是单进程 SQLite）。
 */
const locks = new Map<string, Promise<unknown>>();

export function withPracticeLock<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = locks.get(key) ?? Promise.resolve();
    const run = previous.then(task, task);
    const settled = run.then(() => undefined, () => undefined);
    locks.set(key, settled);
    settled.then(() => {
        if (locks.get(key) === settled) locks.delete(key);
    });
    return run;
}
