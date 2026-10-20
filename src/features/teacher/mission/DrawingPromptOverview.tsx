import { useState } from 'react';
import { AssetImage } from '../../../components/AssetImage';
import { Button } from '../../../components/Button';
import { Icon } from '../../../components/Icon';
import { InlineAlert } from '../../../components/StateViews';
import { StatusBadge } from '../../../components/StatusBadge';
import {
  DRAWING_GRADES,
  DRAWING_MAX_SCORE,
  drawingArtworkLabel,
  getDrawingPrompt,
  listDrawingCriteria,
} from '../../../domain/drawingPrompts';
import type { DrawingPrompt, Grade } from '../../../domain/types';
import { ArtworkDialog } from './ArtworkDialog';

interface DrawingPromptOverviewProps {
  /** 지금 진행하는 학년. 그 학년의 그림에 표시를 붙인다. */
  grade: Grade | null;
}

/**
 * 학년별로 정해진 명화 프롬프트와 심사 기준을 한눈에 본다. 고르거나 바꾸는 기능은 없다(프로그램에 고정).
 * 학년이 올라갈수록 조건이 많고 기법이 어렵다.
 */
export function DrawingPromptOverview({ grade }: DrawingPromptOverviewProps) {
  const [viewing, setViewing] = useState<DrawingPrompt | null>(null);

  return (
    <section className="stack" aria-labelledby="prompt-overview-title">
      <div className="teacher-title">
        <h2 id="prompt-overview-title" className="section-title">
          <Icon name="museum" /> 학년별 그림 프롬프트
        </h2>
      </div>
      <InlineAlert tone="info">
        학년마다 명화 한 점이 정해져 있어요. 학년이 올라갈수록 조건이 많고 기법이 어려워요. 심사는
        그림 실력이 아니라 조건을 얼마나 정확히 지켰는지로 {DRAWING_MAX_SCORE}점 만점이에요.
      </InlineAlert>

      <ul className="prompt-options" aria-label="학년별 그림 프롬프트 목록">
        {DRAWING_GRADES.map((item) => {
          const prompt = getDrawingPrompt(item);
          return (
            <li
              key={prompt.id}
              className="prompt-option"
              aria-current={grade === item ? 'true' : undefined}
            >
              {prompt.imageKey ? (
                <AssetImage asset={prompt.imageKey} decorative className="prompt-option__image" />
              ) : null}
              <div className="prompt-option__body">
                <div className="cluster">
                  <StatusBadge tone={grade === item ? 'primary' : 'neutral'} icon="school">
                    {item}학년{grade === item ? ' · 진행 중' : ''}
                  </StatusBadge>
                </div>
                <strong className="prompt-option__title">{drawingArtworkLabel(prompt)}</strong>
                <p className="muted">표현 기법: {prompt.technique}</p>
                <p className="muted">이 학년의 어려운 점: {prompt.focus}</p>
                <p>{prompt.text}</p>
                <ul className="rubric-list" aria-label={`${item}학년 심사 기준`}>
                  {listDrawingCriteria(prompt.criteria).map(({ item: rubric, text }) => (
                    <li key={rubric.id}>
                      <strong>
                        {rubric.name} {rubric.max}점
                      </strong>{' '}
                      {text}
                    </li>
                  ))}
                </ul>
                <Button variant="secondary" icon="fullscreen" onClick={() => setViewing(prompt)}>
                  크게 보기
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      <ArtworkDialog prompt={viewing} onClose={() => setViewing(null)} />
    </section>
  );
}
