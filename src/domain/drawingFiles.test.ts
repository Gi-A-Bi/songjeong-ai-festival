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
    expect(drawingZipName('AI 설명대로 그려라', 4, 2)).toBe('AI설명대로그려라_4학년_2라운드.zip');
  });
});

describe('AI 평가 요청문', () => {
  it('그림 설명과 첨부 파일 목록, 평가 기준과 답변 형식을 담는다', () => {
    const prompt = buildDrawingEvaluationPrompt({
      description: '초록 언덕 위에 빨간 지붕 집이 있어요.',
      fileNames: ['4학년-1반-3팀_1라운드.webp', '4학년-2반-3팀_1라운드.webp'],
    });
    expect(prompt).toContain('초록 언덕 위에 빨간 지붕 집이 있어요.');
    expect(prompt).toContain('1. 4학년-1반-3팀_1라운드.webp');
    expect(prompt).toContain('2. 4학년-2반-3팀_1라운드.webp');
    expect(prompt).toContain('그림 파일 2개');
    expect(prompt).toContain('설명 일치도');
    expect(prompt).toContain('최종 순위');
  });
});
