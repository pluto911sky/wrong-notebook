import type { DifficultyLevel, ParsedQuestion } from "./ai/types";

export type VariantMap = Partial<Record<DifficultyLevel, ParsedQuestion>>;

export const DIFFICULTY_LEVELS: DifficultyLevel[] = ["hard", "harder", "medium"];

/**
 * 客户端与服务端通用的变式题解析器（零 Node.js 依赖，纯 JSON 解析）
 */
export function parseStoredVariants(ocrText?: string | null): VariantMap {
    if (!ocrText) return {};
    try {
        const parsed = JSON.parse(ocrText);
        if (parsed && typeof parsed === "object" && (parsed.hard || parsed.harder || parsed.medium || parsed.easy)) {
            return parsed as VariantMap;
        }
    } catch {
        // Not valid variant JSON
    }
    return {};
}
