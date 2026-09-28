import { describe, expect, it } from 'vitest';
import {
  createDefaultDrawingConfig,
  DEFAULT_DRAWING_PROMPTS,
  DRAWING_MAX_SCORE,
  DRAWING_RUBRIC,
  drawingArtworkLabel,
  drawingOptionMark,
  getDrawingConfigError,
  getDrawingGradeBand,
  listDrawingPromptOptions,
  resolveDrawingPrompt,
  selectDrawingPrompt,
  sumDrawingRubric,
} from './drawingPrompts';

describe('명화 그림 프롬프트', () => {
  it('학년군마다 ①, ② 두 가지가 있다', () => {
    const config = createDefaultDrawingConfig();
    expect(listDrawingPromptOptions(config, 3).map((prompt) => prompt.id)).toEqual([
      'starry-night',
      'gleaners',
    ]);
    expect(listDrawingPromptOptions(config, 4)).toEqual(listDrawingPromptOptions(config, 3));
    expect(listDrawingPromptOptions(config, 5).map((prompt) => prompt.id)).toEqual([
      'ssireum',
      'grande-jatte',
    ]);
    expect(getDrawingGradeBand(6)).toBe('grade56');
  });

  it('모든 프롬프트에 명화, 화풍, AI 시대 재해석 요소가 있다', () => {
    for (const prompt of DEFAULT_DRAWING_PROMPTS) {
      expect(prompt.text).toContain(prompt.artist === '쇠라' ? '쇠라' : prompt.artwork);
      expect(prompt.text).toMatch(/로봇/);
      expect(prompt.technique).not.toBe('');
    }
    expect(drawingOptionMark(DEFAULT_DRAWING_PROMPTS[1])).toBe('②');
    expect(drawingArtworkLabel(DEFAULT_DRAWING_PROMPTS[2])).toBe('김홍도 〈씨름〉');
  });

  it('고르지 않은 학년은 첫 번째 프롬프트, 고른 학년은 고른 프롬프트로 그린다', () => {
    const config = createDefaultDrawingConfig();
    expect(resolveDrawingPrompt(config, 3)?.id).toBe('starry-night');
    const selected = selectDrawingPrompt(config, 3, 'gleaners');
    expect(selected && resolveDrawingPrompt(selected, 3)?.id).toBe('gleaners');
    // 학년별로 고르므로 같은 학년군의 다른 학년은 바뀌지 않는다.
    expect(selected && resolveDrawingPrompt(selected, 4)?.id).toBe('starry-night');
  });

  it('다른 학년군의 프롬프트는 고를 수 없다', () => {
    const config = createDefaultDrawingConfig();
    expect(selectDrawingPrompt(config, 3, 'ssireum')).toBeNull();
    expect(getDrawingConfigError({ ...config, selectedPromptIds: { 5: 'starry-night' } })).toMatch(
      /5학년/,
    );
    expect(getDrawingConfigError(config)).toBeNull();
    expect(getDrawingConfigError({ ...config, prompts: [] })).toMatch(/하나도 없어요/);
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
