import { describe, expect, it } from 'vitest';
import {
  createDefaultDrawingConfig,
  DEFAULT_DRAWING_PROMPTS,
  DRAWING_GRADES,
  DRAWING_MAX_SCORE,
  DRAWING_RUBRIC,
  drawingArtworkLabel,
  getDrawingPrompt,
  listDrawingCriteria,
  sumDrawingRubric,
} from './drawingPrompts';

describe('학년별 명화 그림 프롬프트', () => {
  it('학년마다 명화 한 점이 정해져 있고 쉬운 것부터 어려운 순서다', () => {
    expect(DRAWING_GRADES.map((grade) => getDrawingPrompt(grade).id)).toEqual([
      'gleaners',
      'starry-night',
      'ssireum',
      'grande-jatte',
    ]);
    expect(drawingArtworkLabel(getDrawingPrompt(3))).toBe('밀레 〈이삭 줍는 여인들〉');
    expect(drawingArtworkLabel(getDrawingPrompt(6))).toBe('쇠라 〈그랑드자트섬의 일요일 오후〉');
    // 같은 학년은 언제나 같은 그림이다.
    expect(getDrawingPrompt(4)).toBe(getDrawingPrompt(4));
  });

  it('모든 프롬프트에 명화, 화풍, AI 시대 재해석 요소와 영역별 확인 조건이 있다', () => {
    expect(DEFAULT_DRAWING_PROMPTS).toHaveLength(4);
    for (const prompt of DEFAULT_DRAWING_PROMPTS) {
      expect(prompt.text).toContain(prompt.artwork);
      expect(prompt.text).toMatch(/로봇/);
      expect(prompt.technique).not.toBe('');
      expect(prompt.focus).not.toBe('');
      for (const item of DRAWING_RUBRIC) {
        expect(prompt.criteria[item.id]).toMatch(/는가$|가$/);
      }
    }
  });

  it('확인 조건은 채점표와 같은 영역 순서로 돌려준다', () => {
    const list = listDrawingCriteria(getDrawingPrompt(3).criteria);
    expect(list.map(({ item }) => item.id)).toEqual(DRAWING_RUBRIC.map((item) => item.id));
    expect(list[0].text).toContain('로봇 3대');
    expect(list[3].text).toContain('황토색');
  });

  it('그리기 설정에는 저장할 값이 없다', () => {
    expect(createDefaultDrawingConfig()).toEqual({ type: 'drawing' });
  });
});

describe('AI 심사 기준', () => {
  it('다섯 영역의 배점은 3·2·2·2·1로 모두 10점이다', () => {
    expect(DRAWING_RUBRIC.map((item) => item.max)).toEqual([3, 2, 2, 2, 1]);
    expect(DRAWING_MAX_SCORE).toBe(10);
  });

  it('영역별 점수를 더하고, 입력하지 않은 영역은 0점으로 센다', () => {
    expect(sumDrawingRubric({})).toBe(0);
    expect(
      sumDrawingRubric({ elements: 2, layout: 2, style: 1, color: 1, reinterpretation: 1 }),
    ).toBe(7);
    // 배점을 넘는 값은 배점까지만 센다.
    expect(sumDrawingRubric({ elements: 9 })).toBe(3);
  });
});
