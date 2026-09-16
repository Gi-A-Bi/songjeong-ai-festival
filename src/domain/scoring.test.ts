import { describe, expect, it } from 'vitest';
import { calculateAutoScore, resolveSubmissionScore } from './scoring';
import type { ErrorHuntConfig, GoldenBellConfig, Mission, Submission } from './types';

const goldenBell: GoldenBellConfig = {
  type: 'golden_bell',
  questions: [
    { id: 'a', question: '1', choices: ['x', 'y'], answerIndex: 0, explanation: '' },
    { id: 'b', question: '2', choices: ['x', 'y'], answerIndex: 1, explanation: '' },
    { id: 'c', question: '3', choices: ['x', 'y'], answerIndex: 1, explanation: '' },
  ],
};

describe('골든벨 자동 점수', () => {
  it('맞힌 문제마다 100점이고 풀지 않은 문제는 0점이다', () => {
    expect(
      calculateAutoScore(goldenBell, { type: 'golden_bell', selections: { a: 0, b: 0 } }),
    ).toBe(100);
    expect(
      calculateAutoScore(goldenBell, { type: 'golden_bell', selections: { a: 0, b: 1, c: 1 } }),
    ).toBe(300);
  });

  it('지금 등록된 문제 기준으로 센다(삭제된 문제의 답은 무시)', () => {
    expect(
      calculateAutoScore(goldenBell, { type: 'golden_bell', selections: { removed: 0, a: 0 } }),
    ).toBe(100);
  });
});

describe('틀린그림 자동 점수', () => {
  const config: ErrorHuntConfig = {
    type: 'error_hunt',
    imageKey: 'missionErrorHunt',
    instruction: '',
    regions: [
      { id: 'r1', x: 0, y: 0, r: 0.1, label: '' },
      { id: 'r2', x: 0, y: 0, r: 0.1, label: '' },
    ],
  };

  it('없는 영역 ID나 같은 영역을 여러 번 넣어도 한 번만 센다', () => {
    expect(
      calculateAutoScore(config, {
        type: 'error_hunt',
        foundRegionIds: ['r1', 'r1', 'fake'],
        wrongTaps: 0,
        remainingSeconds: 300,
      }),
    ).toBe(100);
  });

  it('모두 찾으면 남은 시간 보너스를 더한다', () => {
    expect(
      calculateAutoScore(config, {
        type: 'error_hunt',
        foundRegionIds: ['r1', 'r2'],
        wrongTaps: 1,
        remainingSeconds: 100,
      }),
    ).toBe(200 + 200 - 20);
  });
});

describe('교사 화면 제출 점수', () => {
  const mission = { config: goldenBell } as Mission;
  const submission: Submission = {
    id: 's',
    teamId: 't',
    classId: 'c',
    missionId: 'golden-bell',
    grade: 4,
    roundNo: 1,
    status: 'submitted',
    answer: { type: 'golden_bell', selections: { a: 0 } },
    score: null,
    reopened: false,
    submittedAt: 1,
    updatedAt: 1,
  };

  it('저장소에 점수가 없어도 자동 점수를 계산한다', () => {
    expect(resolveSubmissionScore(submission, mission)).toBe(100);
  });

  it('순위가 확정된 제출은 교사가 정한 점수를 쓴다', () => {
    expect(resolveSubmissionScore({ ...submission, status: 'verified', score: 50 }, mission)).toBe(
      50,
    );
  });
});
