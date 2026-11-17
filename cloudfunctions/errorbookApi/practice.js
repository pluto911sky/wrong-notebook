"use strict";

const PRACTICE_STAGES = ["similar", "advanced", "challenge"];
const PRACTICE_EXP = [5, 10, 15];

function completePractice(practice) {
  return PRACTICE_STAGES.every((stage) => {
    const round = practice?.[stage];
    return [round?.questionText, round?.answerText, round?.analysis].every(
      (value) => typeof value === "string" && value.trim());
  });
}

function practiceQuestions(practice) {
  return Object.fromEntries(PRACTICE_STAGES.map((stage) => [stage, {
    questionText: practice[stage].questionText,
  }]));
}

function normalizePracticeAnswer(value) {
  return String(value || "").normalize("NFKC").trim()
    .replace(/[−–]/gu, "-").replace(/\s+/gu, " ")
    .replace(/\s*([=+*/:,%()，、-])\s*/gu, "$1")
    .replace(/(?<=\d) (?=[\p{L}°])/gu, "").replace(/[。.]$/u, "");
}

function rational(value) {
  const fraction = /^([+-]?\d{1,40})\/([+-]?\d{1,40})$/.exec(value);
  if (fraction) {
    const divisor = BigInt(fraction[2]);
    return divisor === 0n ? null : [BigInt(fraction[1]), divisor];
  }
  const decimal = /^([+-]?)(\d{0,40})(?:\.(\d{1,40}))?$/.exec(value);
  if (!decimal || (!decimal[2] && !decimal[3])) return null;
  const decimals = decimal[3] || "";
  return [BigInt((decimal[1] || "") + decimal[2] + decimals), 10n ** BigInt(decimals.length)];
}

function practiceAnswerMatches(expected, answer) {
  const key = normalizePracticeAnswer(expected);
  if (key === answer) return true;
  const assignment = /^([a-zA-Z])=(.+)$/.exec(key);
  const submittedAssignment = /^([a-zA-Z])=(.+)$/.exec(answer);
  if (submittedAssignment && assignment?.[1] !== submittedAssignment[1]) return false;
  const left = rational(assignment ? assignment[2] : key);
  const right = rational(submittedAssignment ? submittedAssignment[2] : answer);
  return Boolean(left && right && left[0] * right[1] === right[0] * left[1]);
}

function setSquareAnswerMatches(question, answer) {
  const prompt = normalizePracticeAnswer(question);
  if (!/用(?:一副|两把|一对)三角尺/.test(prompt) || !/[画拼][^，。？?]{0,20}(?:°|度)的角/.test(prompt)) return false;
  const target = prompt.match(/[画拼][^，。？?\d]{0,16}(\d{1,3})\s*(?:°|度)的角/);
  if (!target) return false;
  const angles = /(\d{1,3})\s*(?:°|度)(?:的)?(?:角)?\s*(减去|减|[-]|加上|加|[+])\s*[^\d，。；！？=+-]{0,24}?(\d{1,3})\s*(?:°|度)(?:的)?(?:角)?(?!\d)/g;
  const response = normalizePracticeAnswer(answer);
  const matches = [...response.matchAll(angles)];
  if (matches.length !== 1 || /不能|不可以|不等于|不正确|不要/.test(response)) return false;
  const [, first, operator, second] = matches[0];
  const a = Number(first);
  const b = Number(second);
  const crossPair = ([45, 90].includes(a) && [30, 60, 90].includes(b)) ||
    ([45, 90].includes(b) && [30, 60, 90].includes(a));
  if (!crossPair) return false;
  const result = /^(减|[-])/.test(operator) ? a - b : a + b;
  const asserted = response.match(/(?:=|得到|等于)\s*(\d{1,3})\s*(?:°|度)/);
  return result === Number(target[1]) && (!asserted || Number(asserted[1]) === result);
}

module.exports = { PRACTICE_STAGES, PRACTICE_EXP, completePractice, practiceQuestions, normalizePracticeAnswer, practiceAnswerMatches, setSquareAnswerMatches };
