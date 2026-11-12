import { getAIService } from "./ai";
import { DifficultyLevel } from "./ai/types";
import { createLogger } from "./logger";
import { inferSubjectFromName } from "./knowledge-tags";
import { DIFFICULTY_LEVELS, VariantMap, parseStoredVariants } from "./practice-variants";

export { DIFFICULTY_LEVELS, parseStoredVariants };
export type { VariantMap };

const logger = createLogger("practice-variants-server");

const VALID_SUBJECTS = ["数学", "物理", "化学", "生物", "英语", "语文", "历史", "地理", "政治", "其他"] as const;
type SubjectZh = typeof VALID_SUBJECTS[number];
const SUBJECT_KEY_TO_ZH: Record<string, SubjectZh> = {
    math: "数学", physics: "物理", chemistry: "化学", biology: "生物", english: "英语",
    chinese: "语文", history: "历史", geography: "地理", politics: "政治",
};

/**
 * 错题本名称（如「英语错题本」「初二物理」）→ 标准学科名。
 * 之前只做精确匹配，匹配不上一律回落为「数学」，导致英语题的变式题被标成数学。
 */
function normalizeSubjectName(name?: string | null): SubjectZh {
    if (!name) return "其他";
    if ((VALID_SUBJECTS as readonly string[]).includes(name)) return name as SubjectZh;
    const key = inferSubjectFromName(name);
    return (key && SUBJECT_KEY_TO_ZH[key]) || "其他";
}

/**
 * 服务端专用的变式题并行生成器（调用 AI 服务）
 */
export async function generateAllVariants(params: {
    questionText: string;
    knowledgePoints: string[];
    language?: "zh" | "en";
    gradeSemester?: string | null;
    subjectName?: string | null;
    existing?: VariantMap;
    levels?: DifficultyLevel[];
    /** 逐个难度依次生成（后台任务使用，避免瞬间并发触发免费额度的每分钟限流） */
    sequential?: boolean;
}): Promise<VariantMap> {
    const {
        questionText,
        knowledgePoints,
        language = "zh",
        gradeSemester = null,
        subjectName = "数学",
        existing = {},
        levels = DIFFICULTY_LEVELS,
        sequential = false,
    } = params;

    if (!questionText || !questionText.trim()) {
        return existing;
    }

    const aiService = getAIService();
    const normalizedSubject = normalizeSubjectName(subjectName);

    const result: VariantMap = { ...existing };
    const missingLevels = levels.filter((lvl) => !result[lvl]?.questionText);

    if (missingLevels.length === 0) {
        return result;
    }

    logger.info({ missingLevels, sequential }, "Generating practice variants on server");

    const generateLevel = async (level: DifficultyLevel) => {
        try {
            const q = await aiService.generateSimilarQuestion(
                questionText,
                knowledgePoints,
                language,
                level,
                gradeSemester
            );
            q.subject = normalizedSubject;
            result[level] = q;
        } catch (err) {
            logger.warn({ level, err: err instanceof Error ? err.message : String(err) }, "Failed to generate variant level");
        }
    };

    if (sequential) {
        for (const level of missingLevels) {
            await generateLevel(level);
        }
    } else {
        await Promise.allSettled(missingLevels.map(generateLevel));
    }

    return result;
}

/**
 * 进程内的后台变式题生成队列：同一时间只跑一个任务。
 * 批量保存多道题时，之前会瞬间并发 N×3 个 AI 请求，免费额度下大量触发 429。
 */
let backgroundQueue: Promise<void> = Promise.resolve();

export function enqueueBackgroundTask(task: () => Promise<void>): Promise<void> {
    const run = backgroundQueue.then(task, task);
    // 队列本身不因单个任务失败而中断
    backgroundQueue = run.catch(() => undefined);
    return run;
}
