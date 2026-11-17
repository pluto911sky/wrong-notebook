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

module.exports = { PRACTICE_STAGES, PRACTICE_EXP, completePractice, practiceQuestions, normalizePracticeAnswer, practiceAnswerMatches };
