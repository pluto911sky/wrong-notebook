const SUBJECTS = ['语文', '数学', '英语', '科学'];

function supportedSubject(name) {
    const value = String(name || '').trim();
    if (SUBJECTS.includes(value)) return value;
    return /^(物理|化学|生物|自然科学)$/.test(value) ? '科学' : '';
}

function inferSubject(questionText, hint) {
    const text = String(questionText || '').normalize('NFKC');
    const prompt = text.split(/\n|。/).filter(Boolean).slice(-3).join(' ');
    const words = text.match(/\b[A-Za-z]{2,}\b/g) || [];
    if (/首字母填空|英语|英文|单词|选词填空|过去式|时态|按要求改写句子.*[A-Za-z]/i.test(text) ||
        words.length >= 4) return '英语';
    if (/古诗|文言文|拼音|多音字|近义词|反义词|成语|修辞|病句|课文|自然段|作文|字词/.test(text)) return '语文';
    if (/解方程|列式|竖式|脱式|求值|计算题|周长|面积|分数|因数|倍数|画.{0,8}角|\d\s*[-+×÷=*/]\s*\d/.test(text) ||
        /多少.{0,8}(千克|公斤|克|吨|米|元|升|毫升|个|块|支|张|棵|分钟|小时|写作|%)|几.{0,4}(支|个|块|小时|千克)/.test(prompt)) return '数学';
    if (/光合作用|蒸发|凝结|磁铁|电路|导电|摩擦力|重力|浮力|光源|观察实验|科学实验|实验现象|食物链|种子发芽|月相|水循环|声音传播/.test(text)) return '科学';
    if (/阅读理解|选词|改写句子|概括|从文中|阅读短文|给.{0,8}加点字/.test(text)) return '语文';
    return supportedSubject(hint);
}

module.exports = { SUBJECTS, supportedSubject, inferSubject };
