import { DEFAULT_EVENT_ID } from '../../config';
import { drawCardType } from '../../domain/cards';
import { getTicketCountForRank } from '../../domain/rewards';
import { getTeamNoForMission, ROUND_NUMBERS, TEAM_NUMBERS } from '../../domain/rotation';
import { calculateAutoScore } from '../../domain/scoring';
import type {
  CardType,
  ClassInfo,
  DrawTicket,
  Exchange,
  FestivalEvent,
  Grade,
  Mission,
  MissionResult,
  RoundNo,
  RoundStatus,
  Submission,
  SubmissionAnswer,
  Team,
  TeacherProfile,
} from '../../domain/types';
import { createSeededRandom } from '../../lib/random';
import { resultId, resultKey, roundKey, submissionId, toClassId, toTeamId } from './keys';

export const GRADES: readonly Grade[] = [3, 4, 5, 6];
export const GRADE_CLASS_COUNTS: Record<Grade, number> = { 3: 4, 4: 5, 5: 6, 6: 5 };
export const TEAMS_PER_CLASS = TEAM_NUMBERS.length;

export const DEV_TEACHER: TeacherProfile = {
  uid: 'dev-teacher',
  displayName: '개발용 교사',
  role: 'admin',
};

/** 명세 23장: 4학년 2반 3팀이 2라운드 참여 중이며 카드 2장을 가진 상태 */
export const DEMO_TEAM_ID = toTeamId(4, 2, 3);
const DEMO_GRADE: Grade = 4;
const MINUTE = 60_000;

export interface MockState {
  event: FestivalEvent;
  missions: Mission[];
  classes: ClassInfo[];
  teams: Team[];
  roundStatuses: Record<string, RoundStatus>;
  submissions: Record<string, Submission>;
  revealedAnswers: Record<string, boolean>;
  results: MissionResult[];
  tickets: DrawTicket[];
  exchanges: Exchange[];
  sessions: Record<string, number>;
  /** requestId → 처리된 문서 ID(멱등 처리용) */
  processedRequests: Record<string, string>;
}

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
        questionNo: 1,
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
      return { type: 'golden_bell', choiceIndex: variant % config.choices.length };
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
      return { type: 'drawing', strokeCount: 12 + variant * 3, previewDataUrl: null };
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
 * 4학년 2반은 검증 카드만 없는 상태로 시작한다.
 * 3팀의 미사용 뽑기권에 검증 카드가 있어 카드를 뽑으면 컬렉션 완성을 확인할 수 있다.
 */
const DEMO_CLASS_CARDS: Record<string, CardType[]> = {
  [toTeamId(4, 2, 1)]: ['thinking'],
  [toTeamId(4, 2, 2)]: ['observation'],
  [toTeamId(4, 2, 3)]: ['observation', 'verification', 'thinking'],
  [toTeamId(4, 2, 4)]: ['expression', 'command'],
  [toTeamId(4, 2, 5)]: ['thinking'],
};
const DEMO_STARTING_CARDS: CardType[] = ['command', 'expression'];

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
        status: grade === DEMO_GRADE ? 'touring' : 'ready',
      });
      for (const teamNo of TEAM_NUMBERS) {
        teams.push({
          id: toTeamId(grade, classNo, teamNo),
          classId,
          grade,
          classNo,
          teamNo,
          displayName: `${grade}학년 ${classNo}반 ${teamNo}팀`,
          status: grade === DEMO_GRADE ? 'active' : 'ready',
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

  const round2StartedAt = now - 1.5 * MINUTE;
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
    roundDurationMs: 8 * MINUTE,
    moveDurationMs: 2 * MINUTE,
    updatedAt: now,
  };

  const submissions: Record<string, Submission> = {};
  const results: MissionResult[] = [];
  const tickets: DrawTicket[] = [];
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
        submittedAt,
        updatedAt: round1FinalizedAt,
      };
      const rId = resultId(resultKey(mission.id, DEMO_GRADE, round1), team1Id);
      results.push({
        id: rId,
        missionId: mission.id,
        grade: DEMO_GRADE,
        roundNo: round1,
        teamId: team1Id,
        score,
        rank,
        finalizedBy: DEV_TEACHER.uid,
        finalizedAt: round1FinalizedAt,
      });
      const cardTypes =
        DEMO_CLASS_CARDS[team1Id] ??
        Array.from({ length: getTicketCountForRank(rank) }, () => drawCardType(random));
      cardTypes.forEach((cardType, index) => {
        tickets.push({
          id: `${rId}__${index + 1}`,
          teamId: team1Id,
          classId,
          sourceResultId: rId,
          cardType,
          claimedAt: team1Id === DEMO_TEAM_ID ? null : round1FinalizedAt + MINUTE,
          createdAt: round1FinalizedAt,
        });
      });

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
          score: calculateAutoScore(mission.config, answer),
          submittedAt: submittedAt2,
          updatedAt: submittedAt2,
        };
      }
    }
  }

  DEMO_STARTING_CARDS.forEach((cardType, index) => {
    tickets.push({
      id: `dev-start__${DEMO_TEAM_ID}__${index + 1}`,
      teamId: DEMO_TEAM_ID,
      classId: toClassId(DEMO_GRADE, 2),
      sourceResultId: 'dev-start',
      cardType,
      claimedAt: round1StartedAt,
      createdAt: round1StartedAt,
    });
  });

  return {
    event,
    missions,
    classes,
    teams,
    roundStatuses,
    submissions,
    revealedAnswers: {},
    results,
    tickets,
    exchanges: [],
    sessions: {},
    processedRequests: {},
  };
}
