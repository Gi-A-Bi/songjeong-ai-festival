import { useState } from 'react';
import { AssetImage } from '../../../components/AssetImage';
import { Icon } from '../../../components/Icon';
import { InlineAlert } from '../../../components/StateViews';
import { getErrorHuntPuzzles } from '../../../domain/errorHunt';
import type { ErrorHuntConfig, Grade } from '../../../domain/types';
import { HuntRegionMarker } from '../../missions/errorHunt/HuntRegionMarker';
import '../../missions/errorHunt/ErrorHunt.css';

const GRADES: readonly Grade[] = [3, 4, 5, 6];

interface ErrorHuntAnswerSheetProps {
  config: ErrorHuntConfig;
  /** 지금 진행하는 학년. 그 학년의 그림부터 보여 준다. */
  grade: Grade | null;
}

/** 틀린그림 찾기의 그림과 정답. 학년을 골라 그 학년이 푸는 그림과 이상한 곳을 본다. */
export function ErrorHuntAnswerSheet({ config, grade }: ErrorHuntAnswerSheetProps) {
  const [picked, setPicked] = useState<Grade>(grade ?? 3);
  const [hidden, setHidden] = useState(false);
  const puzzles = getErrorHuntPuzzles(config, picked);
  const total = puzzles.reduce((sum, puzzle) => sum + puzzle.regions.length, 0);

  return (
    <section className="stack" aria-labelledby="hunt-answers-title">
      <h2 id="hunt-answers-title" className="section-title">
        <Icon name="image" /> 그림과 정답
      </h2>
      <InlineAlert tone="warning">
        정답이 보이는 화면이에요. 학생이 보는 전자칠판에는 띄우지 마세요.
      </InlineAlert>

      <div className="cluster">
        <div className="segmented" role="group" aria-label="그림을 볼 학년">
          {GRADES.map((item) => (
            <button
              key={item}
              type="button"
              className="segmented__button"
              aria-pressed={picked === item}
              onClick={() => setPicked(item)}
            >
              {item}학년
            </button>
          ))}
        </div>
        <label className="choice-row__answer">
          <input
            type="checkbox"
            checked={hidden}
            onChange={(event) => setHidden(event.target.checked)}
          />
          정답 표시 숨기기
        </label>
      </div>
      <p className="muted">
        {picked}학년은 그림 {puzzles.length}장에서 이상한 곳 {total}군데를 찾아요. 한 곳에 100점,
        잘못 누르면 20점 감점, 모두 찾으면 남은 시간(초) × 2점을 더해요.
      </p>

      <ol className="hunt-sheet">
        {puzzles.map((puzzle, index) => (
          <li key={puzzle.id} className="panel hunt-sheet__item">
            <h3 className="hunt-sheet__title">
              {index + 1}번 그림 · {puzzle.title}
            </h3>
            <div className="hunt-sheet__board">
              <AssetImage asset={puzzle.imageKey} className="hunt-board__image" />
              {hidden
                ? null
                : puzzle.regions.map((region, regionIndex) => (
                    <HuntRegionMarker
                      key={region.id}
                      region={region}
                      className="hunt-marker--answer"
                    >
                      <span className="hunt-marker__no number" aria-hidden="true">
                        {regionIndex + 1}
                      </span>
                    </HuntRegionMarker>
                  ))}
            </div>
            {hidden ? null : (
              <ol className="hunt-sheet__answers">
                {puzzle.regions.map((region) => (
                  <li key={region.id}>{region.label}</li>
                ))}
              </ol>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
