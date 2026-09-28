import { describe, expect, it } from 'vitest';
import { createDefaultDrawingConfig } from '../../domain/drawingPrompts';
import { normalizeAnswer, normalizeMissionConfig } from './mappers';

describe('예전 형식 그리기 자료', () => {
  it('설명 글 하나만 있던 설정은 기본 명화 프롬프트로 바꾼다', () => {
    const config = normalizeMissionConfig({
      type: 'drawing',
      promptId: 'draw-sample-1',
      prompt: '초록 언덕 위에 빨간 지붕 집이 있어요.',
    });
    expect(config).toEqual(createDefaultDrawingConfig());
  });

  it('저장된 프롬프트와 학년별 선택은 그대로 읽는다', () => {
    const saved = { ...createDefaultDrawingConfig(), selectedPromptIds: { 4: 'gleaners' } };
    expect(normalizeMissionConfig(saved)).toEqual(saved);
  });

  it('화면 그림판으로 낸 예전 제출은 프롬프트 없이 파일 정보만 읽는다', () => {
    expect(
      normalizeAnswer({
        type: 'drawing',
        strokeCount: 12,
        mimeType: 'image/webp',
        byteSize: 1200,
        width: 960,
        height: 540,
      }),
    ).toEqual({
      type: 'drawing',
      promptId: null,
      mimeType: 'image/webp',
      byteSize: 1200,
      width: 960,
      height: 540,
    });
    expect(normalizeAnswer({ type: 'drawing', strokeCount: 3 })).toEqual({
      type: 'drawing',
      promptId: null,
      mimeType: 'image/webp',
      byteSize: 0,
      width: 0,
      height: 0,
    });
  });
});
