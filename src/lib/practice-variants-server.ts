import { getAIService } from "./ai";
import { DifficultyLevel } from "./ai/types";
import { createLogger } from "./logger";
import { DIFFICULTY_LEVELS, VariantMap, parseStoredVariants } from "./practice-variants";

export { DIFFICULTY_LEVELS, parseStoredVariants };
export type { VariantMap };

const logger = createLogger("practice-variants-server");

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
}): Promise<VariantMap> {
    const {
        questionText,
        knowledgePoints,
        language = "zh",
        gradeSemester = null,
        subjectName = "数学",
        existing = {},
        levels = DIFFICULTY_LEVELS,
    } = params;

    if (!questionText || !questionText.trim()) {
        return existing;
    }

    const aiService = getAIService();
    const validSubjects = ["数学", "物理", "化学", "生物", "英语", "语文", "历史", "地理", "政治", "其他"] as const;
    const normalizedSubject = validSubjects.includes(subjectName as any)
        ? (subjectName as typeof validSubjects[number])
        : "数学";

    const result: VariantMap = { ...existing };
    const missingLevels = levels.filter((lvl) => !result[lvl]?.questionText);

    if (missingLevels.length === 0) {
        return result;
    }

    logger.info({ missingLevels }, "Generating practice variants in parallel on server");

    await Promise.allSettled(
        missingLevels.map(async (level) => {
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
        })
    );

    return result;
}
