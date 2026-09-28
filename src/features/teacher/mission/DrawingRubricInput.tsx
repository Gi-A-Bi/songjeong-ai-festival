import {
  DRAWING_RUBRIC,
  type DrawingRubricId,
  type DrawingRubricScores,
} from '../../../domain/drawingPrompts';

interface DrawingRubricInputProps {
  teamName: string;
  scores: DrawingRubricScores;
  onChange: (scores: DrawingRubricScores) => void;
}

/** 그리기 심사 영역별 점수 입력. 고르면 합계가 점수 칸에 들어간다. */
export function DrawingRubricInput({ teamName, scores, onChange }: DrawingRubricInputProps) {
  const change = (id: DrawingRubricId, value: string) => {
    const next = { ...scores };
    if (value === '') delete next[id];
    else next[id] = Number(value);
    onChange(next);
  };

  return (
    <div className="rubric-input" role="group" aria-label={`${teamName} 영역별 점수`}>
      {DRAWING_RUBRIC.map((item) => (
        <label key={item.id} className="rubric-input__item" title={item.description}>
          <span className="rubric-input__name">{item.name}</span>
          <select
            className="rubric-input__select number"
            aria-label={`${teamName} ${item.name} 점수(${item.max}점 만점)`}
            value={scores[item.id] ?? ''}
            onChange={(event) => change(item.id, event.target.value)}
          >
            <option value="">-</option>
            {Array.from({ length: item.max + 1 }, (_, score) => (
              <option key={score} value={score}>
                {score}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}
