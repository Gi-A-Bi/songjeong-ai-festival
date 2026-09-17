import { DEFAULT_EVENT_ID } from '../../config';
import { CARD_TYPES, drawOfferedTypes } from '../../domain/cards';
import { getSelectionModeForRank, OFFER_COUNT_BY_MODE } from '../../domain/rewards';
import {
  emptyFinalClassState,
  emptyFinalResponse,
  emptyFinalSession,
  finishFinal,
  scoreResponses,
  snapshotCards,
} from '../../domain/finalMission';
import { computeClassCardProgress } from '../../domain/cards';
import { getTeamNoForMission, ROUND_NUMBERS, TEAM_NUMBERS } from '../../domain/rotation';
import {
  emptyTeamMissionRecord,
  missionRoundStateId,
  type TeamMissionRecord,
} from '../../domain/tour';
import type {
  ActivityEvent,
  CardAward,
  CardType,
  ClassCardProgress,
  ClassInfo,
  DrawingFile,
  FestivalEvent,
  FinalClassState,
  FinalQuestionSet,
  FinalResponse,
  FinalSession,
  GoldenBellQuestion,
  Grade,
  Mission,
  MissionResult,
  MissionRoundState,
  RoundNo,
  RoundStatus,
  Submission,
  SubmissionAnswer,
  Team,
  TeacherProfile,
} from '../../domain/types';
import { createSeededRandom } from '../../lib/random';
import { createSampleFinalQuestionSet } from './finalQuestions';
import { resultId, resultKey, roundKey, submissionId, toClassId, toTeamId } from './keys';

export const GRADES: readonly Grade[] = [3, 4, 5, 6];
export const GRADE_CLASS_COUNTS: Record<Grade, number> = { 3: 4, 4: 5, 5: 6, 6: 5 };
export const TEAMS_PER_CLASS = TEAM_NUMBERS.length;

export const DEV_TEACHER: TeacherProfile = {
  uid: 'dev-teacher',
  displayName: '개발용 총괄 선생님',
  role: 'admin',
  missionId: null,
  classId: null,
};

/** 명세 23장: 4학년 2반 3팀이 2라운드 참여 중이며 1라운드 1위 카드 보상을 고르기 전인 상태 */
export const DEMO_TEAM_ID = toTeamId(4, 2, 3);
const DEMO_GRADE: Grade = 4;
/** 미션 투어를 마치고 학급 최종 미션 중인 학년. 카드 성장·힌트·최종 미션 상태를 확인하는 샘플이다. */
export const FINAL_DEMO_GRADE: Grade = 3;
const MINUTE = 60_000;

export interface MockState {
  event: FestivalEvent;
  missions: Mission[];
  classes: ClassInfo[];
  teams: Team[];
  roundStatuses: Record<string, RoundStatus>;
  submissions: Record<string, Submission>;
  /** 미션·학년·라운드별 작은 상태(정답 공개, 마지막 변경 시각) */
  missionStates: Record<string, { answerRevealed: boolean; updatedAt: number }>;
  /** 팀별 그림 파일 */
  drawings: Record<string, DrawingFile>;
  results: MissionResult[];
  /** 카드 보상 원장. 진행도의 원본이다. */
  cardAwards: CardAward[];
  /** 화면 편의용 학급 카드 진행도 캐시. 원장과 다르면 원장을 우선한다. */
  cardProgressCache: Record<string, ClassCardProgress>;
  /** 팀 이동 기록(`${classId}_${teamNo}_${roundNo}`). 없으면 입장 전으로 본다. */
  teamMissionRecords: Record<string, TeamMissionRecord>;
  /** 부스의 학년·라운드별 상태 */
  missionRoundStates: Record<string, MissionRoundState>;
  /** 활동 기록. ID가 같으면 한 번만 남는다. */
  activityEvents: Record<string, ActivityEvent>;
  /** 이 기기가 마지막으로 입장한 팀(미션 교실 QR 체크인에 쓴다) */
  deviceTeamId: string | null;
  /** 학년별 최종 미션 세션 */
  finalSessions: Partial<Record<Grade, FinalSession>>;
  /** 학년별 최종 미션 문제(정답·힌트 제거 대상 포함). 화면에는 문제만 보낸다. */
  finalQuestionSets: Partial<Record<Grade, FinalQuestionSet>>;
  /** classId → 학급 최종 미션 상태 */
  finalClassStates: Record<string, FinalClassState>;
  /** `${classId}_${questionId}` → 문제별 응답 */
  finalResponses: Record<string, FinalResponse>;
  sessions: Record<string, number>;
  /** requestId → 처리된 문서 ID(멱등 처리용) */
  processedRequests: Record<string, string>;
}

/** 골든벨 샘플 7문항. 실제 문제는 교사가 미션 운영 화면에서 등록한다. */
const SAMPLE_GOLDEN_BELL_QUESTIONS: GoldenBellQuestion[] = [
  {
    id: 'q1',
    question: 'AI가 알려 준 정보를 쓰기 전에 가장 먼저 해야 할 일은 무엇일까요?',
    choices: [
      '그대로 친구에게 알려 준다',
      '책이나 믿을 만한 자료로 사실인지 확인한다',
      '더 길게 써 달라고 한다',
      '마음에 들 때만 믿는다',
    ],
    answerIndex: 1,
    explanation: 'AI도 틀릴 수 있어요. 책이나 믿을 만한 자료로 꼭 확인해요.',
  },
  {
    id: 'q2',
    question: 'AI에게 질문할 때 알려 주면 안 되는 정보는 무엇일까요?',
    choices: [
      '좋아하는 동물',
      '궁금한 과학 질문',
      '우리 집 주소와 전화번호',
      '오늘 배운 수업 주제',
    ],
    answerIndex: 2,
    explanation: '이름, 주소, 전화번호 같은 개인정보는 AI에게 알려 주지 않아요.',
  },
  {
    id: 'q3',
    question: 'AI가 만든 사진인지 알아보는 좋은 방법은 무엇일까요?',
    choices: [
      '손가락 개수나 그림자처럼 작은 부분을 자세히 본다',
      '색이 예쁘면 진짜라고 믿는다',
      '사진을 빨리 넘겨 본다',
      '크게 나온 사진은 모두 진짜라고 생각한다',
    ],
    answerIndex: 0,
    explanation: 'AI 그림은 손가락, 글자, 그림자 같은 작은 부분이 이상한 경우가 많아요.',
  },
  {
    id: 'q4',
    question: 'AI는 주로 어떻게 배울까요?',
    choices: [
      '잠을 많이 자면서 배운다',
      '태어날 때부터 모든 것을 안다',
      '밥을 먹으면서 배운다',
      '아주 많은 자료(데이터)를 보고 배운다',
    ],
    answerIndex: 3,
    explanation: 'AI는 많은 데이터 속에서 규칙을 찾아 배워요.',
  },
  {
    id: 'q5',
    question: '친구 얼굴 사진으로 AI 그림을 만들고 싶을 때 먼저 해야 할 일은?',
    choices: [
      '몰래 만들어서 깜짝 보여 준다',
      '친구에게 허락을 받는다',
      '반 단체방에 먼저 올린다',
      '얼굴을 조금 바꾸면 괜찮다',
    ],
    answerIndex: 1,
    explanation: '다른 사람의 얼굴 사진은 꼭 허락을 받고 사용해요.',
  },
  {
    id: 'q6',
    question: '로봇이 길을 따라 정확하게 움직이려면 무엇이 필요할까요?',
    choices: [
      '로봇에게 큰 소리로 부탁하기',
      '로봇을 손으로 밀어 주기',
      '순서와 규칙이 정확한 명령',
      '로봇을 예쁘게 꾸미기',
    ],
    answerIndex: 2,
    explanation: '로봇은 정해진 순서와 규칙(명령)대로 움직여요.',
  },
  {
    id: 'q7',
    question: 'AI의 답이 이상하다고 느꼈을 때 가장 좋은 행동은 무엇일까요?',
    choices: [
      '다른 자료로 확인하고 선생님께 이야기한다',
      'AI가 한 말이니 그냥 믿는다',
      '화가 나서 컴퓨터를 끈다',
      '친구에게 틀린 답을 그대로 알려 준다',
    ],
    answerIndex: 0,
    explanation: '이상한 답은 다른 자료로 확인하고 어른과 함께 이야기해요.',
  },
];

/** 샘플 미션 콘텐츠. 실제 문제·교실은 행사 전에 교사가 설정한다(명세 24장). */
export function createSampleMissions(): Mission[] {
  return [
    {
      id: 'golden-bell',
      no: 1,
      type: 'golden_bell',
      title: 'AI 골든벨',
      room: '시청각실',
      cardType: 'thinking',
      summary: '팀이 함께 AI 퀴즈를 풀어요',
      teacherJudged: false,
      enabled: true,
      config: {
        type: 'golden_bell',
        questions: SAMPLE_GOLDEN_BELL_QUESTIONS,
      },
    },
    {
      id: 'error-hunt',
      no: 2,
      type: 'error_hunt',
      title: 'AI 틀린그림 찾기',
      room: '컴퓨터실',
      cardType: 'observation',
      summary: 'AI 그림 속 이상한 곳을 찾아요',
      teacherJudged: false,
      enabled: true,
      config: {
        type: 'error_hunt',
        imageKey: 'missionErrorHunt',
        instruction: 'AI가 만든 그림에서 이상한 곳 4군데를 찾아 눌러 보세요.',
        regions: [
          { id: 'flying-dog', x: 0.675, y: 0.217, r: 0.065, label: '하늘을 나는 강아지' },
          { id: 'floating-ball', x: 0.694, y: 0.417, r: 0.05, label: '공중에 뜬 축구공' },
          { id: 'odd-chair', x: 0.872, y: 0.344, r: 0.06, label: '담장 앞 이상한 의자' },
          { id: 'wrong-reflection', x: 0.82, y: 0.517, r: 0.06, label: '거꾸로 비친 나무' },
        ],
      },
    },
    {
      id: 'drawing',
      no: 3,
      type: 'drawing',
      title: 'AI 설명대로 그려라',
      room: '미술실',
      cardType: 'expression',
      summary: '설명을 듣고 그림으로 표현해요',
      teacherJudged: true,
      enabled: true,
      config: {
        type: 'drawing',
        promptId: 'draw-sample-1',
        prompt:
          '초록 언덕 위에 빨간 지붕 집이 있어요. 집 왼쪽에는 큰 나무 한 그루가 있고, 하늘에는 해와 구름 두 개가 떠 있어요.',
      },
    },
    {
      id: 'ozobot',
      no: 4,
      type: 'ozobot',
      title: '로봇 길찾기',
      room: '과학실',
      cardType: 'command',
      summary: '오조봇이 길을 완주하게 설계해요',
      teacherJudged: true,
      enabled: true,
      config: {
        type: 'ozobot',
        rules: [
          '선이 끊기지 않게 굵고 진하게 그려요.',
          '컬러 코드는 선 위에 순서대로 칠해요.',
          '출발선에 로봇을 올리고 준비되면 버튼을 눌러요.',
          '완주 시간과 재시도 횟수는 선생님이 기록해요.',
        ],
      },
    },
    {
      id: 'library-check',
      no: 5,
      type: 'library_check',
      title: 'AI 오류찾기',
      room: '도서관',
      cardType: 'verification',
      summary: 'AI 글의 틀린 곳을 책으로 확인해요',
      teacherJudged: true,
      enabled: true,
      config: {
        type: 'library_check',
        passageTitle: 'AI가 쓴 “꿀벌” 소개 글',
        passage:
          '꿀벌은 다리가 8개인 곤충이에요. 꿀벌은 꽃에서 꽃가루와 꿀을 모으고, 벌집에서 함께 살아요. 일벌은 춤을 추어 꽃이 있는 곳을 친구들에게 알려 줘요.',
      },
    },
  ];
}

function sampleAnswer(mission: Mission, variant: number): SubmissionAnswer {
  const config = mission.config;
  switch (config.type) {
    case 'golden_bell':
      return {
        type: 'golden_bell',
        selections: Object.fromEntries(
          config.questions.map((question, index) => [
            question.id,
            (index + variant) % 3 === 0
              ? question.answerIndex
              : (question.answerIndex + 1) % question.choices.length,
          ]),
        ),
      };
    case 'error_hunt':
      return {
        type: 'error_hunt',
        foundRegionIds: config.regions
          .slice(0, (variant % config.regions.length) + 1)
          .map((region) => region.id),
        wrongTaps: variant % 3,
        remainingSeconds: 60 + variant * 20,
      };
    case 'drawing':
      return {
        type: 'drawing',
        strokeCount: 12 + variant * 3,
        mimeType: 'image/webp',
        byteSize: 0,
        width: 960,
        height: 540,
      };
    case 'ozobot':
      return { type: 'ozobot', ready: true };
    case 'library_check':
      return {
        type: 'library_check',
        wrongPart: '꿀벌은 다리가 8개인 곤충이에요.',
        correction: '곤충인 꿀벌의 다리는 6개예요.',
        bookTitle: '신기한 곤충 백과',
        page: 20 + variant,
      };
  }
}

/**
 * 4학년 2반 1라운드 카드 보상. 3팀(1위)은 아직 고르지 않아 보상 선택 화면을 바로 확인할 수 있다.
 * 표현 카드를 고르면 2/4, 생각 카드를 고르면 3/4로 다음 조각이 열린다.
 */
const DEMO_CLASS_AWARDS: Record<string, { offered: CardType[]; selected: CardType | null }> = {
  [toTeamId(4, 2, 1)]: { offered: ['thinking'], selected: 'thinking' },
  [toTeamId(4, 2, 2)]: { offered: ['observation'], selected: 'observation' },
  [toTeamId(4, 2, 3)]: { offered: ['expression', 'command', 'thinking'], selected: null },
  [toTeamId(4, 2, 4)]: { offered: ['thinking', 'verification'], selected: 'thinking' },
  [toTeamId(4, 2, 5)]: { offered: ['expression'], selected: 'expression' },
};

/**
 * 최종 미션 샘플 학년(3학년)의 반별 카드 획득 수(생각·관찰·표현·명령·검증 순, 합계 25).
 * - 1반: 5종 모두 완성, 종류마다 중복 +1 → 힌트 5개(중복은 힌트를 늘리지 않는다)
 * - 2반: 표현 카드 3/4 → 완성 4종, 힌트 4개
 * - 3반: 관찰 카드 2/4 → 완성 4종, 힌트 4개
 * - 4반: 검증 카드 0/4, 생각 카드 중복 +4 → 완성 4종, 힌트 4개
 */
const FINAL_DEMO_CARD_COUNTS: Record<number, [number, number, number, number, number]> = {
  1: [5, 5, 5, 5, 5],
  2: [6, 4, 3, 7, 5],
  3: [7, 2, 4, 6, 6],
  4: [8, 7, 6, 4, 0],
};

/** 종류별 획득 수를 번갈아 늘어놓아 라운드마다 받은 종류가 섞이게 한다. */
function interleaveCardTypes(counts: readonly number[]): CardType[] {
  const remaining = [...counts];
  const order: CardType[] = [];
  while (remaining.some((count) => count > 0)) {
    CARD_TYPES.forEach((cardType, index) => {
      if (remaining[index] > 0) {
        order.push(cardType);
        remaining[index] -= 1;
      }
    });
  }
  return order;
}

/** 샘플용 카드 보상. selected가 있으면 받은 상태, 없으면 고르기 전 상태다. */
function seedAward(
  result: MissionResult,
  classId: string,
  offered: CardType[],
  selected: CardType | null,
  claimedAt: number,
): CardAward {
  const selectionMode = getSelectionModeForRank(result.rank);
  if (offered.length !== OFFER_COUNT_BY_MODE[selectionMode]) {
    throw new Error(`샘플 카드 보상 후보 수가 순위와 맞지 않아요: ${result.id}`);
  }
  return {
    id: result.id,
    resultId: result.id,
    grade: result.grade,
    classId,
    teamId: result.teamId,
    missionId: result.missionId,
    roundNo: result.roundNo,
    rank: result.rank,
    selectionMode,
    offeredTypes: offered,
    selectedType: selected,
    status: selected ? 'claimed' : 'pending',
    createdAt: result.finalizedAt,
    claimedAt: selected ? claimedAt : null,
  };
}

/** 받은 종류를 먼저 두고 나머지 후보를 겹치지 않게 채운다. */
function offersIncluding(selected: CardType, rank: number, random: () => number): CardType[] {
  const count = OFFER_COUNT_BY_MODE[getSelectionModeForRank(rank)];
  return [selected, ...drawOfferedTypes(count - 1, random, [selected])];
}

export interface SampleEventStructure {
  event: FestivalEvent;
  classes: ClassInfo[];
  teams: Team[];
  missions: Mission[];
}

/**
 * 행사 기본 구조(행사 문서, 학급, 팀, 미션)를 만든다.
 * mock 샘플 상태와 Firestore 초기 생성이 같은 구조를 쓰도록 여기서 한 번만 정의한다.
 */
export function buildSampleEvent(eventId: string, now: number): SampleEventStructure {
  const classes: ClassInfo[] = [];
  const teams: Team[] = [];
  for (const grade of GRADES) {
    for (let classNo = 1; classNo <= GRADE_CLASS_COUNTS[grade]; classNo += 1) {
      const classId = toClassId(grade, classNo);
      classes.push({
        id: classId,
        grade,
        classNo,
        displayName: `${grade}학년 ${classNo}반`,
        status: 'ready',
      });
      for (const teamNo of TEAM_NUMBERS) {
        teams.push({
          id: toTeamId(grade, classNo, teamNo),
          classId,
          grade,
          classNo,
          teamNo,
          displayName: `${grade}학년 ${classNo}반 ${teamNo}팀`,
          status: 'ready',
        });
      }
    }
  }
  return {
    event: {
      id: eventId,
      title: '2026 송정 AI 페스티벌',
      schoolName: '서울송정초등학교',
      status: 'ready',
      activeGrade: null,
      activeRound: 0,
      roundEndsAt: null,
      pausedRemainingMs: null,
      roundEndedAt: null,
      roundDurationMs: 8 * MINUTE,
      moveDurationMs: 2 * MINUTE,
      updatedAt: now,
    },
    classes,
    teams,
    missions: createSampleMissions(),
  };
}

export function createSeedState(now: number): MockState {
  const random = createSeededRandom(2026);
  const missions = createSampleMissions();
  const classes: ClassInfo[] = [];
  const teams: Team[] = [];

  for (const grade of GRADES) {
    for (let classNo = 1; classNo <= GRADE_CLASS_COUNTS[grade]; classNo += 1) {
      const classId = toClassId(grade, classNo);
      classes.push({
        id: classId,
        grade,
        classNo,
        displayName: `${grade}학년 ${classNo}반`,
        status:
          grade === DEMO_GRADE ? 'touring' : grade === FINAL_DEMO_GRADE ? 'final_active' : 'ready',
      });
      for (const teamNo of TEAM_NUMBERS) {
        teams.push({
          id: toTeamId(grade, classNo, teamNo),
          classId,
          grade,
          classNo,
          teamNo,
          displayName: `${grade}학년 ${classNo}반 ${teamNo}팀`,
          status:
            grade === DEMO_GRADE ? 'active' : grade === FINAL_DEMO_GRADE ? 'finished' : 'ready',
        });
      }
    }
  }

  const roundStatuses: Record<string, RoundStatus> = {};
  for (const grade of GRADES) {
    for (const roundNo of ROUND_NUMBERS) roundStatuses[roundKey(grade, roundNo)] = 'waiting';
  }
  roundStatuses[roundKey(DEMO_GRADE, 1)] = 'closed';
  roundStatuses[roundKey(DEMO_GRADE, 2)] = 'active';
  for (const roundNo of ROUND_NUMBERS)
    roundStatuses[roundKey(FINAL_DEMO_GRADE, roundNo)] = 'closed';

  // 2라운드를 시작한 지 2분 30초: 체크인하지 않은 팀은 미도착 경고가 보인다.
  const round2StartedAt = now - 2.5 * MINUTE;
  const round1StartedAt = round2StartedAt - 10 * MINUTE;
  const round1FinalizedAt = round1StartedAt + 9 * MINUTE;

  const event: FestivalEvent = {
    id: DEFAULT_EVENT_ID,
    title: '2026 송정 AI 페스티벌',
    schoolName: '서울송정초등학교',
    status: 'active',
    activeGrade: DEMO_GRADE,
    activeRound: 2,
    roundEndsAt: round2StartedAt + 8 * MINUTE,
    pausedRemainingMs: null,
    roundEndedAt: null,
    roundDurationMs: 8 * MINUTE,
    moveDurationMs: 2 * MINUTE,
    updatedAt: now,
  };

  const submissions: Record<string, Submission> = {};
  const results: MissionResult[] = [];
  const cardAwards: CardAward[] = [];
  const classCount = GRADE_CLASS_COUNTS[DEMO_GRADE];

  for (const mission of missions) {
    for (let classNo = 1; classNo <= classCount; classNo += 1) {
      const classId = toClassId(DEMO_GRADE, classNo);

      // 1라운드: 제출·순위 확정·카드 획득까지 끝난 상태
      const round1: RoundNo = 1;
      const team1Id = toTeamId(DEMO_GRADE, classNo, getTeamNoForMission(mission.no, round1));
      const rank = ((classNo + mission.no) % classCount) + 1;
      const score = (classCount + 1 - rank) * 100;
      const submittedAt = round1StartedAt + (2 + rank) * MINUTE;
      const id1 = submissionId(mission.id, team1Id);
      submissions[id1] = {
        id: id1,
        teamId: team1Id,
        classId,
        missionId: mission.id,
        grade: DEMO_GRADE,
        roundNo: round1,
        status: 'verified',
        answer: sampleAnswer(mission, classNo),
        score,
        reopened: false,
        submittedAt,
        updatedAt: round1FinalizedAt,
      };
      const result1: MissionResult = {
        id: resultId(resultKey(mission.id, DEMO_GRADE, round1), team1Id),
        missionId: mission.id,
        grade: DEMO_GRADE,
        roundNo: round1,
        teamId: team1Id,
        score,
        rank,
        finalizedBy: DEV_TEACHER.uid,
        finalizedAt: round1FinalizedAt,
      };
      results.push(result1);
      const demoAward = DEMO_CLASS_AWARDS[team1Id];
      if (demoAward) {
        cardAwards.push(
          seedAward(
            result1,
            classId,
            demoAward.offered,
            demoAward.selected,
            round1FinalizedAt + MINUTE,
          ),
        );
      } else {
        const offered = drawOfferedTypes(
          OFFER_COUNT_BY_MODE[getSelectionModeForRank(rank)],
          random,
        );
        cardAwards.push(
          seedAward(result1, classId, offered, offered[0], round1FinalizedAt + MINUTE),
        );
      }

      // 2라운드: 진행 중, 절반 정도의 팀이 제출한 상태
      const round2: RoundNo = 2;
      const team2Id = toTeamId(DEMO_GRADE, classNo, getTeamNoForMission(mission.no, round2));
      if ((classNo + mission.no) % 2 === 0 && team2Id !== DEMO_TEAM_ID) {
        const answer = sampleAnswer(mission, classNo + 1);
        const id2 = submissionId(mission.id, team2Id);
        const submittedAt2 = round2StartedAt + (classNo % 3) * 20_000 + 30_000;
        submissions[id2] = {
          id: id2,
          teamId: team2Id,
          classId,
          missionId: mission.id,
          grade: DEMO_GRADE,
          roundNo: round2,
          status: 'submitted',
          answer,
          score: null,
          reopened: false,
          submittedAt: submittedAt2,
          updatedAt: submittedAt2,
        };
      }
    }
  }

  // 3학년: 5라운드 투어를 모두 마치고 학급 최종 미션 중인 상태
  const finalClassCount = GRADE_CLASS_COUNTS[FINAL_DEMO_GRADE];
  const tourStartedAt = now - 90 * MINUTE;
  for (let classNo = 1; classNo <= finalClassCount; classNo += 1) {
    const classId = toClassId(FINAL_DEMO_GRADE, classNo);
    const cardOrder = interleaveCardTypes(FINAL_DEMO_CARD_COUNTS[classNo]);
    let awardIndex = 0;
    for (const roundNo of ROUND_NUMBERS) {
      const roundStartedAt = tourStartedAt + (roundNo - 1) * 10 * MINUTE;
      const finalizedAt = roundStartedAt + 9 * MINUTE;
      for (const mission of missions) {
        const teamId = toTeamId(
          FINAL_DEMO_GRADE,
          classNo,
          getTeamNoForMission(mission.no, roundNo),
        );
        const rank = ((classNo + mission.no + roundNo) % finalClassCount) + 1;
        const score = (finalClassCount + 1 - rank) * 100;
        const id = submissionId(mission.id, teamId);
        submissions[id] = {
          id,
          teamId,
          classId,
          missionId: mission.id,
          grade: FINAL_DEMO_GRADE,
          roundNo,
          status: 'verified',
          answer: sampleAnswer(mission, classNo + roundNo),
          score,
          reopened: false,
          submittedAt: roundStartedAt + (2 + rank) * MINUTE,
          updatedAt: finalizedAt,
        };
        const result: MissionResult = {
          id: resultId(resultKey(mission.id, FINAL_DEMO_GRADE, roundNo), teamId),
          missionId: mission.id,
          grade: FINAL_DEMO_GRADE,
          roundNo,
          teamId,
          score,
          rank,
          finalizedBy: DEV_TEACHER.uid,
          finalizedAt,
        };
        results.push(result);
        const selected = cardOrder[awardIndex];
        awardIndex += 1;
        cardAwards.push(
          seedAward(
            result,
            classId,
            offersIncluding(selected, rank, random),
            selected,
            finalizedAt + MINUTE,
          ),
        );
      }
    }
  }

  // ---- 4학년 2라운드 팀 이동 샘플 ----
  // 골든벨·틀린그림 부스는 미션을 시작했고, 나머지는 입장만 받은 상태다.
  // 미도착: 4학년 2반 3팀(샘플 팀, 직접 체크인해 볼 수 있다), 4학년 4반 5팀
  // 잘못된 교실: 4학년 5반 4팀이 도서관 대신 과학실 QR을 찍었다.
  const teamMissionRecords: Record<string, TeamMissionRecord> = {};
  const missionRoundStates: Record<string, MissionRoundState> = {};
  const activityEvents: Record<string, ActivityEvent> = {};
  const startedMissionIds = ['golden-bell', 'error-hunt'];
  const notArrived = new Set([DEMO_TEAM_ID, toTeamId(DEMO_GRADE, 4, 5)]);
  const wrongStationTeamId = toTeamId(DEMO_GRADE, 5, 4);
  const demoRound: RoundNo = 2;
  for (const mission of missions) {
    const boothStartedAt = startedMissionIds.includes(mission.id) ? round2StartedAt + 30_000 : null;
    if (boothStartedAt !== null) {
      const id = missionRoundStateId(mission.id, DEMO_GRADE, demoRound);
      missionRoundStates[id] = {
        id,
        grade: DEMO_GRADE,
        missionId: mission.id,
        roundNo: demoRound,
        status: 'active',
        startedAt: boothStartedAt,
        completedAt: null,
        resultFinalizedAt: null,
        updatedBy: DEV_TEACHER.uid,
      };
    }
    for (let classNo = 1; classNo <= classCount; classNo += 1) {
      const teamNo = getTeamNoForMission(mission.no, demoRound);
      const teamId = toTeamId(DEMO_GRADE, classNo, teamNo);
      if (notArrived.has(teamId)) continue;
      const record = emptyTeamMissionRecord({
        grade: DEMO_GRADE,
        classId: toClassId(DEMO_GRADE, classNo),
        teamId,
        teamNo,
        roundNo: demoRound,
        expectedMissionId: mission.id,
      });
      const checkedInAt = round2StartedAt - 40_000 + classNo * 5_000;
      teamMissionRecords[record.id] =
        teamId === wrongStationTeamId
          ? {
              ...record,
              actualMissionId: 'ozobot',
              wrongStationId: 'ozobot',
              updatedAt: checkedInAt,
            }
          : {
              ...record,
              actualMissionId: mission.id,
              checkedInAt,
              startedAt: boothStartedAt,
              updatedAt: boothStartedAt ?? checkedInAt,
            };
    }
  }
  const seedActivity = (event: ActivityEvent) => {
    activityEvents[event.id] = event;
  };
  seedActivity({
    id: `round__g${DEMO_GRADE}__r2__start__${round2StartedAt}`,
    grade: DEMO_GRADE,
    type: 'round_changed',
    message: `${DEMO_GRADE}학년 2라운드 시작`,
    classId: null,
    teamId: null,
    missionId: null,
    roundNo: 2,
    at: round2StartedAt,
  });
  seedActivity({
    id: `wrong__${toClassId(DEMO_GRADE, 5)}_4_2__ozobot`,
    grade: DEMO_GRADE,
    type: 'wrong_station',
    message: `${DEMO_GRADE}학년 5반 4팀 · 과학실에 잘못 입장(가야 할 곳: 도서관)`,
    classId: toClassId(DEMO_GRADE, 5),
    teamId: wrongStationTeamId,
    missionId: 'ozobot',
    roundNo: 2,
    at: round2StartedAt - 15_000,
  });

  // ---- 3학년 최종 미션 샘플 ----
  // 총괄 운영자가 10분 전에 열었고, 반마다 따로 시작했다. 결과는 아직 공개 전이다.
  // 1반: 5종 완성(힌트 5개) · 3분 전에 시작해 4번 문제를 푸는 중 · 힌트 1개 사용
  // 2반: 제출 완료(8문제 정답, 6분 10초) · 3반: 제출 완료(8문제 정답, 7분 30초)
  // 4반: 아직 시작하지 않음
  const finalSessions: Partial<Record<Grade, FinalSession>> = {
    [FINAL_DEMO_GRADE]: {
      ...emptyFinalSession(FINAL_DEMO_GRADE),
      status: 'open',
      openedAt: now - 10 * MINUTE,
      openedBy: DEV_TEACHER.uid,
    },
  };
  const finalQuestionSets = Object.fromEntries(
    GRADES.map((grade) => [grade, createSampleFinalQuestionSet(grade)]),
  ) as Partial<Record<Grade, FinalQuestionSet>>;
  const finalClassStates: Record<string, FinalClassState> = {};
  const finalResponses: Record<string, FinalResponse> = {};
  const finalSet = createSampleFinalQuestionSet(FINAL_DEMO_GRADE);
  const finalSession = finalSessions[FINAL_DEMO_GRADE] ?? emptyFinalSession(FINAL_DEMO_GRADE);

  /** 앞에서부터 answered문제를 확정한다. wrong에 든 문제 번호(0부터)는 오답을 고른다. */
  const seedFinal = (input: {
    classNo: number;
    startedAt: number;
    answered: number;
    wrong: number[];
    hintOn: number[];
    submittedAfterMs: number | null;
  }) => {
    const classId = toClassId(FINAL_DEMO_GRADE, input.classNo);
    const progress = computeClassCardProgress(classId, cardAwards);
    let state: FinalClassState = {
      ...emptyFinalClassState(classId, FINAL_DEMO_GRADE, input.startedAt),
      ...snapshotCards(progress),
      status: 'active',
      startedAt: input.startedAt,
      currentQuestionIndex: input.answered,
      hintUsed: input.hintOn.length,
    };
    const responses: FinalResponse[] = [];
    finalSet.questions.slice(0, input.answered).forEach((config, index) => {
      const wrongChoice = config.question.choices.find(
        (choice) => choice.id !== config.answerChoiceId && choice.id !== config.hintRemoveChoiceId,
      );
      const confirmedAt = input.startedAt + (index + 1) * 35_000;
      const response: FinalResponse = {
        ...emptyFinalResponse(classId, FINAL_DEMO_GRADE, config.question.id, confirmedAt),
        selectedChoiceId: input.wrong.includes(index)
          ? (wrongChoice?.id ?? null)
          : config.answerChoiceId,
        hintUsed: input.hintOn.includes(index),
        removedChoiceId: input.hintOn.includes(index) ? config.hintRemoveChoiceId : null,
        confirmedAt,
      };
      responses.push(response);
      finalResponses[response.id] = response;
    });
    if (input.submittedAfterMs !== null) {
      state = finishFinal(
        finalSession,
        state,
        scoreResponses(finalSet, responses),
        input.startedAt + input.submittedAfterMs,
        'completed',
      );
    }
    finalClassStates[classId] = state;
  };
  seedFinal({
    classNo: 1,
    startedAt: now - 3 * MINUTE,
    answered: 3,
    wrong: [],
    hintOn: [1],
    submittedAfterMs: null,
  });
  seedFinal({
    classNo: 2,
    startedAt: now - 9 * MINUTE,
    answered: 10,
    wrong: [3, 7],
    hintOn: [0, 4],
    submittedAfterMs: 6 * MINUTE + 10_000,
  });
  seedFinal({
    classNo: 3,
    startedAt: now - 8.5 * MINUTE,
    answered: 10,
    wrong: [1, 8],
    hintOn: [2],
    submittedAfterMs: 7.5 * MINUTE,
  });

  return {
    event,
    missions,
    classes,
    teams,
    roundStatuses,
    submissions,
    missionStates: {},
    drawings: {},
    results,
    cardAwards,
    cardProgressCache: {},
    teamMissionRecords,
    missionRoundStates,
    activityEvents,
    deviceTeamId: null,
    finalSessions,
    finalQuestionSets,
    finalClassStates,
    finalResponses,
    sessions: {},
    processedRequests: {},
  };
}
