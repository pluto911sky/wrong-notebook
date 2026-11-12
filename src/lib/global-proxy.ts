import { Agent, ProxyAgent, setGlobalDispatcher } from 'undici';
import dns from 'node:dns';
import { createLogger } from './logger';

const logger = createLogger('proxy');

export function setupGlobalProxy() {
    // 优先使用 IPv4，避免在 Fake-IP / TUN 模式下因 IPv6 AAAA 记录不可达导致请求卡死超时
    try {
        dns.setDefaultResultOrder('ipv4first');
    } catch {
        // ignore
    }

    const httpProxy = process.env.http_proxy || process.env.HTTP_PROXY;
    const httpsProxy = process.env.https_proxy || process.env.HTTPS_PROXY;
    const allProxy = process.env.all_proxy || process.env.ALL_PROXY;

    // Logic: Specific proxy > All proxy > None
    const targetHttpProxy = httpProxy || allProxy;
    const targetHttpsProxy = httpsProxy || allProxy;

    if (targetHttpProxy || targetHttpsProxy) {
        if (process.env.NODE_ENV === 'development') {
            logger.info({ http: targetHttpProxy, https: targetHttpsProxy }, 'Configuring proxy');
        }

        // 1. Configure Undici (global fetch)
        // Undici accepts a single dispatcher.
        // For general usage (APIs, etc.), we usually care about the HTTPS proxy.
        // If only HTTP is available, fall back to that.
        const undiciProxy = targetHttpsProxy || targetHttpProxy;
        if (undiciProxy) {
            try {
                const proxyAgent = new ProxyAgent(undiciProxy);
                setGlobalDispatcher(proxyAgent);
                if (process.env.NODE_ENV === 'development') {
                    logger.info({ proxy: undiciProxy }, 'Global Undici dispatcher set');
                }
            } catch (error) {
                logger.error({ error }, 'Failed to set global Undici dispatcher');
            }
        }

        // 2. Configure legacy http/https modules using global-agent
        try {
            // We set the environment variables that global-agent looks for
            if (targetHttpProxy) process.env.GLOBAL_AGENT_HTTP_PROXY = targetHttpProxy;
            if (targetHttpsProxy) process.env.GLOBAL_AGENT_HTTPS_PROXY = targetHttpsProxy;

            // Also set the global config object which global-agent uses
            // @ts-ignore
            global.GLOBAL_AGENT = {
                HTTP_PROXY: targetHttpProxy,
                HTTPS_PROXY: targetHttpsProxy,
            };

            // Import bootstrap to patch http/https
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('global-agent/bootstrap');

            if (process.env.NODE_ENV === 'development') {
                logger.info('global-agent/bootstrap initialized');
            }
        } catch (error) {
            logger.error({ error }, 'Failed to initialize global-agent');
        }
    } else {
        // 未配置显式代理（例如使用系统 TUN 透明代理）时，缩短空闲连接复用时间，防止复用被 TUN 回收的死连接导致 AbortError
        try {
            const directAgent = new Agent({
                keepAliveTimeout: 1000,
                keepAliveMaxTimeout: 2000,
                connect: {
                    timeout: 10000,
                },
            });
            setGlobalDispatcher(directAgent);
        } catch (error) {
            logger.error({ error }, 'Failed to set direct Undici Agent');
        }
    }
}
