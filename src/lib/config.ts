import fs from 'fs';
import path from 'path';
import { createLogger } from './logger';

const logger = createLogger('config');

const CONFIG_FILE_PATH = path.join(process.cwd(), 'config', 'app-config.json');

// OpenAI 实例配置
export interface OpenAIInstance {
    id: string;           // 唯一标识 (UUID)
    name: string;         // 用户自定义名称
    apiKey: string;
    baseUrl: string;
    model: string;
    // 关闭推理模型的思考模式；undefined 表示由后端自动判定
    // 详见 src/types/api.ts 的说明
    disableThinking?: boolean;
}

export interface AppConfig {
    aiProvider: 'gemini' | 'openai' | 'azure';
    allowRegistration?: boolean;
    // 抽奖功能配置（独立于错题，不与积分挂钩）
    lottery?: {
        enabled?: boolean;       // 总开关，默认 true
        drawsPerDay?: number;    // 每人每天可抽次数；0 = 不限
        blankRate?: number;      // 「谢谢惠顾」概率，默认 0.3（即 70% 中奖）
    };
    openai?: {
        instances?: OpenAIInstance[];
        activeInstanceId?: string;
    };
    gemini?: {
        apiKey?: string;
        baseUrl?: string;
        model?: string;
    };
    azure?: {
        apiKey?: string;
        endpoint?: string;       // Azure 资源端点 (https://xxx.openai.azure.com)
        deploymentName?: string; // 部署名称
        apiVersion?: string;     // API 版本
        model?: string;          // 显示用模型名
    };
    prompts?: {
        analyze?: string;
        similar?: string;
    };
    timeouts?: {
        analyze?: number; // 毫秒
    };
}

// 旧版 OpenAI 配置格式（用于迁移检测）
interface LegacyOpenAIConfig {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
}

// 检测是否为旧版配置格式
function isLegacyOpenAIConfig(config: unknown): config is LegacyOpenAIConfig {
    if (!config || typeof config !== 'object') return false;
    // 旧版配置包含 apiKey 直接字段，而新版包含 instances 数组
    return 'apiKey' in config && !('instances' in config);
}

// 生成唯一 ID
function generateId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// 迁移旧版 OpenAI 配置到新版多实例格式
function migrateOpenAIConfig(legacy: LegacyOpenAIConfig): AppConfig['openai'] {
    if (!legacy.apiKey) {
        // 没有有效配置，返回空实例数组
        return { instances: [], activeInstanceId: undefined };
    }

    const defaultInstance: OpenAIInstance = {
        id: generateId(),
        name: 'Default',
        apiKey: legacy.apiKey,
        baseUrl: legacy.baseUrl || 'https://api.openai.com/v1',
        model: legacy.model || 'gpt-4o',
    };

    return {
        instances: [defaultInstance],
        activeInstanceId: defaultInstance.id,
    };
}

const DEFAULT_CONFIG: AppConfig = {
    aiProvider: (process.env.AI_PROVIDER as 'gemini' | 'openai' | 'azure') || 'gemini',
    allowRegistration: true,
    openai: {
        instances: process.env.OPENAI_API_KEY ? [{
            id: 'env-default',
            name: 'Default (ENV)',
            apiKey: process.env.OPENAI_API_KEY,
            baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
            model: process.env.OPENAI_MODEL || 'gpt-4o',
            // 未显式配置时由后端按端点自动判定
            // （端点清单来自环境变量 THINKING_CAPABLE_HOSTS，为空则不做判定）
            disableThinking: process.env.OPENAI_DISABLE_THINKING
                ? process.env.OPENAI_DISABLE_THINKING === 'true'
                : undefined,
        }] : [],
        activeInstanceId: process.env.OPENAI_API_KEY ? 'env-default' : undefined,
    },
    gemini: {
        apiKey: process.env.GOOGLE_API_KEY,
        baseUrl: process.env.GEMINI_BASE_URL,
        model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    },
    azure: {
        apiKey: process.env.AZURE_OPENAI_API_KEY,
        endpoint: process.env.AZURE_OPENAI_ENDPOINT,
        deploymentName: process.env.AZURE_OPENAI_DEPLOYMENT,
        apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-02-15-preview',
        model: process.env.AZURE_OPENAI_MODEL || 'gpt-4o',
    },
    prompts: {
        analyze: '',
        similar: '',
    },
    timeouts: {
        analyze: 180000,
    },
};

// 按文件修改时间缓存解析结果：一次识别请求里会多次调用 getAppConfig，
// 之前每次都同步读盘 + JSON.parse；文件变化（保存设置）后 mtime 改变会自动重新加载
let configCache: { mtimeMs: number; size: number; value: AppConfig } | null = null;

export function getAppConfig(): AppConfig {
    let stat: fs.Stats | null = null;
    try {
        stat = fs.statSync(CONFIG_FILE_PATH);
    } catch {
        stat = null;
    }
    if (stat && configCache && configCache.mtimeMs === stat.mtimeMs && configCache.size === stat.size) {
        // 返回副本，避免调用方修改缓存
        return structuredClone(configCache.value);
    }
    const value = loadAppConfig();
    configCache = stat ? { mtimeMs: stat.mtimeMs, size: stat.size, value } : null;
    return structuredClone(value);
}

function loadAppConfig(): AppConfig {
    if (fs.existsSync(CONFIG_FILE_PATH)) {
        try {
            const fileContent = fs.readFileSync(CONFIG_FILE_PATH, 'utf-8');
            const userConfig = JSON.parse(fileContent);

            // 检测并迁移旧版 OpenAI 配置
            let openaiConfig = userConfig.openai;
            if (isLegacyOpenAIConfig(userConfig.openai)) {
                logger.info('Detected legacy OpenAI config, migrating to multi-instance format...');
                openaiConfig = migrateOpenAIConfig(userConfig.openai);
                // 持久化迁移结果
                const migratedConfig = {
                    ...userConfig,
                    openai: openaiConfig,
                };
                fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(migratedConfig, null, 2));
                logger.info('Legacy OpenAI config migrated successfully');
            }

            // Merge with default to ensure all fields exist
            return {
                ...DEFAULT_CONFIG,
                ...userConfig,
                openai: {
                    instances: openaiConfig?.instances || DEFAULT_CONFIG.openai?.instances || [],
                    activeInstanceId: openaiConfig?.activeInstanceId || DEFAULT_CONFIG.openai?.activeInstanceId,
                },
                gemini: { ...DEFAULT_CONFIG.gemini, ...userConfig.gemini },
                azure: { ...DEFAULT_CONFIG.azure, ...userConfig.azure },
                prompts: { ...DEFAULT_CONFIG.prompts, ...userConfig.prompts },
                timeouts: { ...DEFAULT_CONFIG.timeouts, ...userConfig.timeouts },
            };
        } catch (error) {
            logger.error({ error }, 'Failed to read config file');
            return DEFAULT_CONFIG;
        }
    }
    return DEFAULT_CONFIG;
}

export function updateAppConfig(newConfig: Partial<AppConfig>) {
    const currentConfig = getAppConfig();
    const updatedConfig = {
        ...currentConfig,
        ...newConfig,
        openai: {
            instances: newConfig.openai?.instances ?? currentConfig.openai?.instances ?? [],
            activeInstanceId: newConfig.openai?.activeInstanceId ?? currentConfig.openai?.activeInstanceId,
        },
        gemini: { ...currentConfig.gemini, ...newConfig.gemini },
        azure: { ...currentConfig.azure, ...newConfig.azure },
        prompts: { ...currentConfig.prompts, ...newConfig.prompts },
        timeouts: { ...currentConfig.timeouts, ...newConfig.timeouts },
        // 抽奖配置需要逐字段合并，否则只传 drawsPerDay 会把 enabled 冲掉
        lottery: { ...currentConfig.lottery, ...newConfig.lottery },
    };

    try {
        fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(updatedConfig, null, 2));
        // 同一毫秒内写入且大小相同时 mtime 可能不变，主动失效缓存
        configCache = null;
        return updatedConfig;
    } catch (error) {
        logger.error({ error }, 'Failed to write config file');
        throw error;
    }
}

// 获取当前激活的 OpenAI 实例配置
export function getActiveOpenAIConfig(): OpenAIInstance | undefined {
    const config = getAppConfig();
    const instances = config.openai?.instances || [];
    const activeId = config.openai?.activeInstanceId;

    if (!activeId || instances.length === 0) {
        return undefined;
    }

    return instances.find(i => i.id === activeId);
}

// 最大实例数限制
export const MAX_OPENAI_INSTANCES = 10;

