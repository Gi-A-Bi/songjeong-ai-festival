import type { RoundNo, Team } from './types';

/** 그림 목표 크기와 제출 차단 크기(명세 6.3) */
export const DRAWING_TARGET_BYTES = 300 * 1024;
export const DRAWING_MAX_BYTES = 350 * 1024;

export const DRAWING_MIME_TYPES = ['image/webp', 'image/png'] as const;

export function drawingExtension(mimeType: string): string {
  return mimeType === 'image/png' ? 'png' : 'webp';
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

export interface DrawingPromptInput {
  /** 학생에게 보여 준 그림 설명 */
  description: string;
  fileNames: readonly string[];
}

/**
 * 외부 생성형 AI 서비스에 붙여 넣을 평가 요청문.
 * 앱은 AI를 호출하지 않는다. 교사가 복사해 그림 파일과 함께 직접 보낸다.
 */
export function buildDrawingEvaluationPrompt({ description, fileNames }: DrawingPromptInput) {
  const files = fileNames.map((name, index) => `${index + 1}. ${name}`).join('\n');
  return `당신은 초등학생 그림 활동의 보조 심사위원입니다.
여러 팀이 같은 [그림 설명]을 듣고 그린 그림 파일 ${fileNames.length}개를 첨부했습니다.
각 그림이 설명의 조건과 얼마나 일치하는지 평가해 주세요.

[그림 설명]
${description.trim()}

[첨부한 그림 파일]
${files}

[평가 방법]
1. 먼저 [그림 설명]에서 그림에 꼭 들어가야 할 조건을 번호를 붙여 모두 뽑아 주세요.
   (등장하는 대상, 개수, 색깔, 위치 관계, 크기 비교 같은 조건)
2. 파일마다 조건을 하나씩 확인해 ○(충족), △(일부 충족), ×(없음)로 표시하고 짧은 근거를 적어 주세요.
3. 조건 충족 정도로 100점 만점 "설명 일치도" 점수를 매겨 주세요.
   ○는 조건 점수 전체, △는 절반, ×는 0점으로 계산하고 조건마다 점수는 같게 나눠 주세요.
4. 그림 솜씨, 색칠의 꼼꼼함, 꾸밈은 점수에 넣지 마세요. 설명과 맞는지만 봅니다.
5. 알아보기 어려운 부분은 초등학생 그림이라는 점을 고려해 너그럽게 판단하되, 판단이 어려우면 △로 표시하고 이유를 적어 주세요.
6. 첨부된 파일 수가 ${fileNames.length}개가 아니거나 열리지 않는 파일이 있으면 가장 먼저 알려 주세요.

[답변 형식]
1) 뽑은 조건 목록
2) 아래 표
| 순위 | 파일 이름 | 설명 일치도(100점) | 충족한 조건 | 빠지거나 다른 조건 | 한 줄 평 |
3) 마지막 줄에 "최종 순위: 파일 이름 > 파일 이름 > ..." 형식으로 정리
   점수가 같으면 "=" 로 표시해 주세요.`;
}
