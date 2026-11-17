const OCR_TIMEOUT_MS = 8000;
const MAX_IMAGE_SIDE = 1600;

async function readPixels(filePath) {
    const { width, height } = await new Promise((resolve, reject) => {
        wx.getImageInfo({ src: filePath, success: resolve, fail: reject });
    });
    if (!(width > 0 && height > 0)) throw new Error('无法读取题图');

    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const canvas = wx.createOffscreenCanvas({ type: '2d', width: w, height: h });
    const context = canvas.getContext('2d');
    const image = canvas.createImage();
    await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = filePath;
    });
    context.drawImage(image, 0, 0, w, h);
    return { frameBuffer: context.getImageData(0, 0, w, h).data.buffer, width: w, height: h };
}

function getQuestionText(anchors) {
    if (!Array.isArray(anchors)) return '';
    // 微信静态图 OCR 的首个锚点给出全文，subtext 给出各文本块。
    const fullText = anchors[0] && anchors[0].text;
    if (typeof fullText === 'string' && fullText.trim()) return fullText.trim();
    return anchors.map((anchor) => anchor && typeof anchor.subtext === 'string'
        ? anchor.subtext.trim()
        : '').filter(Boolean).join('\n');
}

function formatQuestionText(text) {
    const numbered = text.replace(/^[\u3400-\u9fff](?=\s*[0-9０-９]+[.．、]\s*[\u3400-\u9fff])/u, (prefix) =>
        prefix === '第' ? prefix : '');
    const subsections = numbered.replace(
        /([。？！?!）)]|\n)[ \t\n]*(?=[（(][ \t]*[0-9０-９一二三四五六七八九十]+[ \t]*[）)])/g,
        '$1\n\n'
    );

    return subsections.split(/\n{2,}(?=[（(][ \t]*[0-9０-９一二三四五六七八九十]+[ \t]*[）)])/g).map((section) => {
        // 只把题目结束标点后的括号分值当成评分标注，保留题内的“6分”“6分钟”等条件。
        const score = /([。？！?!])\s*[（(]\s*[0-9０-９]+(?:[.．][0-9０-９]+)?\s*分\s*[）)]/u.exec(section);
        if (score) {
            const tail = section.slice(score.index + score[0].length).trim();
            const answerWork = /^(?:(?:答|解|订正?)\s*[:：]|[0-9０-９][^\n]{0,40}[=＝])/u.test(tail);
            if (!tail || answerWork) return section.slice(0, score.index + 1).trim();
            section = section.replace(score[0], score[1]);
        }
        return section.replace(/([？?])\s*(?:答|解|订正)\s*[:：][\s\S]*$/u, '$1').trim();
    }).join('\n\n');
}

async function recognizeImage(filePath, getWebGLContext) {
    if (typeof wx.createVKSession !== 'function' || typeof wx.createOffscreenCanvas !== 'function') {
        throw new Error('当前微信或设备不支持手机识题，请手动填写题干');
    }
    let finished = false;
    let session;
    let timer;
    let frameRequest;
    let stage = '准备题图';

    async function recognize() {
        const [gl, pixels] = await Promise.all([getWebGLContext(), readPixels(filePath)]);
        if (finished) return;
        if (!gl) throw new Error('当前设备无法初始化手机识题，请手动填写题干');
        stage = '启动识题';
        session = wx.createVKSession({ track: { OCR: { mode: 2 } }, version: 'v1', gl });
        if (!session || typeof session.runOCR !== 'function') {
            throw new Error('当前微信或设备不支持手机识题，请手动填写题干');
        }
        return new Promise((resolve, reject) => {
            // 与微信静态图 OCR 示例一致，等待识别期间主动读取会话帧。
            let lastFrameTime = -Infinity;
            const readFrame = () => {
                if (finished) return;
                try {
                    const now = Date.now();
                    if (now - lastFrameTime >= 32) {
                        lastFrameTime = now;
                        session.getVKFrame(gl.drawingBufferWidth || 1, gl.drawingBufferHeight || 1);
                    }
                    frameRequest = session.requestAnimationFrame(readFrame);
                } catch {
                    reject(new Error('无法读取手机识题结果，请重试或手动填写题干'));
                }
            };
            session.on('updateAnchors', (anchors) => {
                const text = formatQuestionText(getQuestionText(anchors));
                if (text) resolve(text);
                else reject(new Error('未识别到文字，请重新框选题目或手动填写题干'));
            });
            session.start((error) => {
                if (finished) return;
                if (error) {
                    reject(new Error('无法启动手机识题，请手动填写题干'));
                    return;
                }
                try {
                    stage = '等待识别结果';
                    session.runOCR(pixels);
                    frameRequest = session.requestAnimationFrame(readFrame);
                } catch {
                    reject(new Error('手机识题失败，请重试或手动填写题干'));
                }
            });
        });
    }

    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('手机识题超时（' + stage + '），可改用云端识题或手动填写题干')), OCR_TIMEOUT_MS);
    });
    try {
        return await Promise.race([recognize(), timeout]);
    } finally {
        finished = true;
        clearTimeout(timer);
        if (frameRequest !== undefined && session && typeof session.cancelAnimationFrame === 'function') {
            try { session.cancelAnimationFrame(frameRequest); } catch { /* 会话可能已退出。 */ }
        }
        if (session && typeof session.destroy === 'function') {
            try { session.destroy(); } catch { /* 某些设备已自行关闭会话。 */ }
        }
    }
}

module.exports = { recognizeImage };
