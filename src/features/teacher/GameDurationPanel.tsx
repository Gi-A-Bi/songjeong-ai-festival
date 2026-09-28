import { useCallback, useState } from 'react';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { InlineAlert } from '../../components/StateViews';
import { MAX_GAME_DURATION_MINUTES, MIN_GAME_DURATION_MINUTES } from '../../config';
import { toUserMessage } from '../../data/errors';
import { useRepository } from '../../data/RepositoryContext';
import { getGameDurationError } from '../../domain/gameDuration';
import type { FestivalEvent } from '../../domain/types';
import { useAction } from '../../hooks/useAction';

interface GameDurationPanelProps {
  eventId: string;
  event: FestivalEvent;
}

/** 게임 시간 설정. 부스에서 “게임 시작”을 누른 때부터 이 시간이 흐른다. */
export function GameDurationPanel({ eventId, event }: GameDurationPanelProps) {
  const repository = useRepository();
  const saved = Math.round(event.gameDurationMs / 60_000);
  const [draft, setDraft] = useState(String(saved));
  const [done, setDone] = useState(false);

  const save = useAction(
    useCallback(
      (minutes: number) => repository.setGameDuration(eventId, minutes),
      [repository, eventId],
    ),
  );

  const minutes = Number(draft);
  const inputError =
    draft.trim() === '' ? '게임 시간을 적어 주세요.' : getGameDurationError(minutes);
  const changed = inputError === null && minutes !== saved;

  return (
    <section className="panel stack" aria-labelledby="admin-duration-title">
      <h2 id="admin-duration-title" className="section-title">
        <Icon name="timer" /> 게임 시간
      </h2>
      <p className="muted">
        부스에서 “게임 시작”을 누르면 이 시간이 흐르고, 시간이 끝나면 제출이 닫혀요. 이미 시작한
        게임에는 바꾼 시간이 적용되지 않아요.
      </p>
      <form
        className="cluster"
        onSubmit={async (submit) => {
          submit.preventDefault();
          if (!changed) return;
          const result = await save.run(minutes);
          setDone(result?.ok === true);
        }}
      >
        <label htmlFor="game-duration">게임 시간(분)</label>
        <input
          id="game-duration"
          className="text-input control-bar__select number"
          type="number"
          inputMode="numeric"
          min={MIN_GAME_DURATION_MINUTES}
          max={MAX_GAME_DURATION_MINUTES}
          step={1}
          value={draft}
          aria-invalid={inputError !== null}
          aria-describedby={inputError ? 'game-duration-error' : undefined}
          onChange={(change) => {
            setDraft(change.target.value);
            setDone(false);
          }}
        />
        <Button type="submit" icon="check_circle" disabled={!changed} loading={save.isPending}>
          저장
        </Button>
        <span className="muted">
          지금 <strong className="number">{saved}분</strong>
        </span>
      </form>
      {inputError ? (
        <p id="game-duration-error" className="muted" role="alert">
          <Icon name="warning" size="sm" /> {inputError}
        </p>
      ) : null}
      {done && !changed ? (
        <InlineAlert tone="success">게임 시간을 {saved}분으로 바꿨어요.</InlineAlert>
      ) : null}
      {save.status === 'error' ? (
        <InlineAlert tone="danger">{toUserMessage(save.error)}</InlineAlert>
      ) : null}
    </section>
  );
}
