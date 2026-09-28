import { describe, expect, it } from 'vitest';
import { buildDrawingEvaluationPrompt, drawingFileName, drawingZipName } from './drawingFiles';

describe('그림 파일 이름', () => {
  it('학년·반·팀·라운드를 넣는다', () => {
    expect(drawingFileName({ grade: 4, classNo: 2, teamNo: 3 }, 1, 'image/webp')).toBe(
      '4학년-2반-3팀_1라운드.webp',
    );
    expect(drawingFileName({ grade: 5, classNo: 6, teamNo: 1 }, 4, 'image/png')).toBe(
      '5학년-6반-1팀_4라운드.png',
    );
    // 팀 이름표를 붙인 사진은 JPEG로 내려받는다.
    expect(drawingFileName({ grade: 3, classNo: 1, teamNo: 2 }, 5, 'image/jpeg')).toBe(
      '3학년-1반-2팀_5라운드.jpg',
    );
    expect(drawingZipName('AI 설명대로 그려라', 4, 2)).toBe('AI설명대로그려라_4학년_2라운드.zip');
  });
});

describe('AI 심사 요청문', () => {
  const description = '하늘에는 노란 별 11개와 오른쪽 위에 초승달 1개가 떠 있어요.';

  const teams = [
    { name: '4학년 1반 3팀', fileName: '4학년-1반-3팀_1라운드.jpg' },
    { name: '4학년 2반 3팀', fileName: '4학년-2반-3팀_1라운드.jpg' },
  ];

  it('운영 계획의 심사 영역과 배점, 제시 문장을 담는다', () => {
    const prompt = buildDrawingEvaluationPrompt({ description, teams: [], labeled: true });
    expect(prompt).toContain('명화 재해석 그림 미션의 심사위원');
    expect(prompt).toContain(
      '요소·수량 3점, 위치·구도 2점, 화풍 표현 2점, 색채 조건 2점, 재해석 1점으로 10점 만점',
    );
    expect(prompt).toContain('‘판단 어려움’');
    expect(prompt).toContain('칭찬 한 가지와 보완할 점 한 가지');
    expect(prompt).toContain(`[제시 문장] : ${description}`);
    // 제출한 팀이 없으면 계획서의 문구 그대로다.
    expect(prompt).not.toContain('[첨부한 그림]');
    expect(prompt).not.toContain('5)');
  });

  it('답변 맨 위에 팀별 점수표를 채점표와 같은 영역 순서로 보여 달라고 한다', () => {
    const prompt = buildDrawingEvaluationPrompt({ description, teams, labeled: true });
    expect(prompt).toContain('첨부한 그림은 모두 2장이고 팀마다 한 장이야.');
    expect(prompt).toContain('답변 맨 위에 아래 표와 같은 [팀별 점수표]를 먼저 보여 줘.');
    expect(prompt).toContain(
      '| 팀 | 요소·수량(3점) | 위치·구도(2점) | 화풍 표현(2점) | 색채 조건(2점) | 재해석(1점) | 총점(10점) |',
    );
    expect(prompt).toContain('총점이 같은 팀이 있으면');
    expect(prompt).toContain('[첨부한 그림]\n1. 4학년 1반 3팀\n2. 4학년 2반 3팀');
    expect(prompt).toContain(`[제시 문장] : ${description}`);
    // 계획서의 1)~4) 다음에 번호가 이어진다.
    expect(prompt).toMatch(/\n4\) .+\n5\) .+\n6\) /);
  });

  it('사진에 팀 이름표가 있으면 이름표로 팀을 알아보고 이름표는 심사하지 않게 한다', () => {
    const prompt = buildDrawingEvaluationPrompt({ description, teams, labeled: true });
    expect(prompt).toContain('그림 아래쪽 흰 띠에 적힌 글자는 팀 이름표야.');
    expect(prompt).toContain('이름표를 읽을 수 없는 그림');
    expect(prompt).not.toContain('파일 이름:');
  });

  it('이름표를 붙이지 못했으면 첨부 순서와 파일 이름으로 팀을 알아보게 한다', () => {
    const prompt = buildDrawingEvaluationPrompt({ description, teams, labeled: false });
    expect(prompt).toContain('그림은 [첨부한 그림]에 적힌 순서대로 첨부했어.');
    expect(prompt).toContain('1. 4학년 1반 3팀 (파일 이름: 4학년-1반-3팀_1라운드.jpg)');
    expect(prompt).not.toContain('이름표');
  });

  it('한 팀만 제출했으면 동점 안내는 넣지 않는다', () => {
    const prompt = buildDrawingEvaluationPrompt({
      description,
      teams: teams.slice(0, 1),
      labeled: true,
    });
    expect(prompt).toContain('첨부한 그림은 모두 1장');
    expect(prompt).toContain('[팀별 점수표]');
    expect(prompt).not.toContain('총점이 같은 팀');
  });
});
