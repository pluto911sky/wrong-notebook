const api = require('../../utils/api');
const { syncPracticeExperience } = require('../../utils/pet');

const ROUNDS = [
  { key: 'similar', label: '同类', title: '同类变式', experience: 5 },
  { key: 'advanced', label: '进阶', title: '进阶升级', experience: 10 },
  { key: 'challenge', label: '压轴', title: '压轴挑战', experience: 15 },
];

Page({
  data: {
    rounds: ROUNDS,
    index: 0,
    progress: 0,
    loading: true,
    submitting: false,
    finished: false,
    question: '',
    answer: '',
    result: null,
    feedback: '',
    loadError: '',
    showSolution: false,
  },

  onLoad({ id } = {}) {
    this.itemId = id || '';
    return this.loadPractice();
  },

  async loadPractice() {
    this.setData({ loading: true, loadError: '' });
    try {
      if (!this.itemId) throw new Error('找不到这道错题');
      const { practice, progress } = await api.generatePractice(this.itemId);
      if (!ROUNDS.every(({ key }) => practice?.[key]?.questionText)) {
        throw new Error('题目暂未准备好');
      }
      this.questions = practice;
      const earned = Number.isInteger(progress) ? Math.min(ROUNDS.length, Math.max(0, progress)) : 0;
      this.setData({ progress: earned, finished: earned === ROUNDS.length });
      if (earned < ROUNDS.length) this.openRound(earned);
    } catch (error) {
      this.setData({ loadError: error?.message || '暂时无法出题' });
    } finally {
      this.setData({ loading: false });
    }
  },

  openRound(index) {
    this.setData({
      index,
      question: this.questions[ROUNDS[index].key].questionText,
      answer: '',
      result: null,
      feedback: '',
      showSolution: false,
      finished: false,
    });
  },

  onAnswerInput({ detail }) {
    this.setData({ answer: detail.value, feedback: '' });
  },

  async submitAnswer() {
    const { answer, index, submitting, result, question, finished } = this.data;
    if (!question || finished || submitting || result || !answer.trim()) return;
    this.setData({ submitting: true, feedback: '' });
    try {
      const checked = await api.submitPracticeAnswer(this.itemId, ROUNDS[index].key, answer.trim());
      if (!checked.correct) {
        this.setData({ feedback: '再检查数值、单位和题目要求的答案格式。' });
        return;
      }
      syncPracticeExperience(checked.totalExperience);
      this.setData({ result: checked, progress: Math.max(this.data.progress, index + 1) });
    } catch (error) {
      this.setData({ feedback: error?.message || '提交失败，请重试' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  toggleSolution() {
    this.setData({ showSolution: !this.data.showSolution });
  },

  advance() {
    if (!this.data.result?.correct) return;
    if (this.data.index + 1 === ROUNDS.length) {
      this.setData({ finished: true });
      return;
    }
    this.openRound(this.data.index + 1);
  },

  replay() {
    if (this.questions && this.data.finished) this.openRound(0);
  },

  goBack() {
    wx.navigateBack();
  },
});
