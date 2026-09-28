import { DRAWING_MAX_SCORE, DRAWING_RUBRIC } from './drawingPrompts';
import type { RoundNo, Team } from './types';

/** 그림 목표 크기와 제출 차단 크기(명세 6.3) */
export const DRAWING_TARGET_BYTES = 300 * 1024;
export const DRAWING_MAX_BYTES = 350 * 1024;

export const DRAWING_MIME_TYPES = ['image/webp', 'image/png'] as const;

export function drawingExtension(mimeType: string): string {
  if (mimeType === 'image/png') return 'png';
  // 교사가 내려받는 팀 이름표 붙은 사진은 JPEG다.
  if (mimeType === 'image/jpeg') return 'jpg';
  return 'webp';
}

/** 내려받는 파일 이름. AI 평가 프롬프트의 파일 목록과 같은 이름을 쓴다. */
export function drawingFileName(
  team: Pick<Team, 'grade' | 'classNo' | 'teamNo'>,
  roundNo: RoundNo,
  mimeType: string,
): string {
  return `${team.grade}학년-${team.classNo}반-${team.teamNo}팀_${roundNo}라운드.${drawingExtension(mimeType)}`;
}

export function drawingZipName(missionTitle: string, grade: number, roundNo: RoundNo): string {
  const title = missionTitle.replace(/[\\/:*?"<>|\s]+/g, '');
  return `${title}_${grade}학년_${roundNo}라운드.zip`;
}

export function formatBytes(byteSize: number): string {
  if (byteSize < 1024) return `${byteSize}B`;
  return `${Math.round(byteSize / 1024)}KB`;
}

export interface DrawingPromptTeam {
  /** 팀 이름표와 점수표에 쓰는 이름(예: 4학년 1반 2팀) */
  name: string;
  fileName: string;
}

export interface DrawingPromptInput {
  /** 학생에게 제공한 그림 프롬프트 */
  description: string;
  /** 그림을 제출한 팀. 점수표의 줄 순서가 된다. */
  teams: readonly DrawingPromptTeam[];
  /** 내려받은 사진 아래에 팀 이름표가 붙어 있는지 */
  labeled: boolean;
}

/**
 * 외부 생성형 AI 서비스에 붙여 넣을 AI 심사용 프롬프트.
 * 1)~4)와 [제시 문장]은 운영 계획 5장의 교사 입력용 문구 그대로다.
 * 앱은 AI를 호출하지 않는다. 교사가 복사해 그림 사진과 함께 직접 보내고, 답변 맨 위의 팀별 점수표를 보고 점수를 입력한다.
 */
export function buildDrawingEvaluationPrompt({ description, teams, labeled }: DrawingPromptInput) {
  const base = `너는 초등학생 명화 재해석 그림 미션의 심사위원이야. 아래 [제시 문장]과 첨부한 그림을 비교해서 심사해 줘.
1) 제시 문장의 조건을 ‘요소·수량, 위치·구도, 화풍 표현, 색채 조건, 재해석’으로 나누어 하나씩 확인하고, 지켰으면 ○, 지키지 않았으면 ×로 표시해 줘.
2) 요소·수량 3점, 위치·구도 2점, 화풍 표현 2점, 색채 조건 2점, 재해석 1점으로 10점 만점 점수를 매기고, 점수를 준 이유를 한 줄씩 써 줘.
3) 그림 실력이 아니라 조건을 얼마나 정확히 지켰는지만 평가하고, 사진이 흐려 판단하기 어려운 부분은 ‘판단 어려움’이라고 솔직하게 표시해 줘.
4) 초등학생이 이해하기 쉬운 말로 칭찬 한 가지와 보완할 점 한 가지를 알려 줘.`;
  const sentence = `[제시 문장] : ${description.trim()}`;
  if (teams.length === 0) return `${base}\n${sentence}`;

  const count = teams.length;
  const identify = labeled
    ? '그림 아래쪽 흰 띠에 적힌 글자는 팀 이름표야. 이름표는 심사하지 말고 어느 팀의 그림인지 알아보는 데만 써 줘.'
    : '그림은 [첨부한 그림]에 적힌 순서대로 첨부했어. 파일 이름이 보이면 파일 이름으로, 보이지 않으면 첨부한 순서로 어느 팀의 그림인지 알아봐 줘.';
  const unreadable = labeled ? '이름표를 읽을 수 없는 그림' : '어느 팀의 그림인지 알 수 없는 그림';
  const header = [
    '팀',
    ...DRAWING_RUBRIC.map((item) => `${item.name}(${item.max}점)`),
    `총점(${DRAWING_MAX_SCORE}점)`,
  ].join(' | ');
  const list = teams
    .map(
      (team, index) =>
        `${index + 1}. ${team.name}${labeled ? '' : ` (파일 이름: ${team.fileName})`}`,
    )
    .join('\n');
  const steps = [
    `첨부한 그림은 모두 ${count}장이고 팀마다 한 장이야. ${identify}`,
    `답변 맨 위에 아래 표와 같은 [팀별 점수표]를 먼저 보여 줘. 팀은 [첨부한 그림]에 적힌 순서대로 쓰고, 점수는 정수로만 써 줘.\n| ${header} |`,
    ...(count > 1
      ? [
          '총점이 같은 팀이 있으면 점수표 바로 아래에 어느 팀이 조건을 더 정확히 지켰는지 순서와 이유를 한 줄로 써 줘.',
        ]
      : []),
    '그다음에 팀별로 1)~4)의 심사 내용을 차례로 써 줘.',
    `첨부된 그림이 ${count}장이 아니거나 ${unreadable}이 있으면 점수표보다 먼저 알려 줘.`,
  ];
  return `${base}
${steps.map((step, index) => `${index + 5}) ${step}`).join('\n')}
${sentence}
[첨부한 그림]
${list}`;
}
