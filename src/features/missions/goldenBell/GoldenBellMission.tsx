import { useState } from 'react';
import { Link } from 'react-router';
import { paths } from '../../../app/paths';
import { AssetImage } from '../../../components/AssetImage';
import { Button } from '../../../components/Button';
import { Icon } from '../../../components/Icon';
import { MissionShell } from '../../../components/MissionShell';
import { StatusBadge } from '../../../components/StatusBadge';
import { useRepository } from '../../../data/RepositoryContext';
import { canSubmitInPhase } from '../../../domain/missionPhase';
import type { GoldenBellConfig } from '../../../domain/types';
import { MissionNotice } from '../MissionNotice';
import type { MissionScreenProps } from '../missionTypes';
import { useMissionSubmit } from '../useMissionSubmit';
import '../Missions.css';

interface GoldenBellMissionProps extends MissionScreenProps {
  config: GoldenBellConfig;
}

export function GoldenBellMission({
  eventId,
  view,
  event,
  phase,
  onSubmitted,
  config,
}: GoldenBellMissionProps) {
  const { team, mission, submission, answerRevealed, roundNo } = view;
  const repository = useRepository();
  const savedChoice =
    submission?.answer.type === 'golden_bell' ? submission.answer.choiceIndex : null;
  const [selected, setSelected] = useState<number | null>(savedChoice);
  const { submit, isPending, error } = useMissionSubmit(eventId, team.id, mission.id, onSubmitted);

  const canSubmit = canSubmitInPhase(phase) && savedChoice === null;
  const choice = savedChoice ?? selected;
  const isCorrect = savedChoice !== null && savedChoice === config.answerIndex;

  return (
    <MissionShell
      mission={mission}
      team={team}
      roundNo={roundNo}
      event={event}
      phase={phase}
      notice={
        <MissionNotice
          phase={phase}
          event={event}
          error={error}
          teacherJudged={mission.teacherJudged}
          cardsPath={paths.cards(eventId, team.id)}
        />
      }
      actions={
        savedChoice !== null ? (
          <StatusBadge tone="info" icon="lock" size="lg">
            제출한 답은 바꿀 수 없어요
          </StatusBadge>
        ) : (
          <>
            <p className="mission-actions__hint">
              <Icon name="info" />
              제출하면 답을 바꿀 수 없어요
            </p>
            <Button
              size="xl"
              icon="send"
              disabled={!canSubmit || selected === null}
              loading={isPending}
              loadingLabel="제출하는 중"
              onClick={() => {
                if (selected !== null) void submit({ type: 'golden_bell', choiceIndex: selected });
              }}
            >
              정답 제출
            </Button>
          </>
        )
      }
    >
      <section className="gb-question" aria-labelledby="gb-question-text">
        <p className="gb-question__no">
          <Icon name="notifications_active" />
          문제 {config.questionNo}
        </p>
        <h2 id="gb-question-text" className="gb-question__text">
          {config.question}
        </h2>
      </section>

      <div className="gb-choices" role="radiogroup" aria-labelledby="gb-question-text">
        {config.choices.map((text, index) => {
          const isChosen = choice === index;
          const isAnswer = answerRevealed && index === config.answerIndex;
          const className = [
            'gb-choice',
            isChosen ? 'gb-choice--chosen' : '',
            isAnswer ? 'gb-choice--answer' : '',
            answerRevealed && isChosen && !isAnswer ? 'gb-choice--wrong' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <button
              key={text}
              type="button"
              role="radio"
              aria-checked={isChosen}
              className={className}
              disabled={!canSubmit || isPending}
              onClick={() => setSelected(index)}
            >
              <span className="gb-choice__no number">{index + 1}</span>
              <span className="gb-choice__text">{text}</span>
              {isAnswer ? (
                <StatusBadge tone="success" icon="check_circle">
                  정답
                </StatusBadge>
              ) : null}
              {isChosen && !isAnswer ? (
                <StatusBadge
                  tone={answerRevealed ? 'danger' : 'info'}
                  icon={answerRevealed ? 'close' : 'check'}
                >
                  우리 답
                </StatusBadge>
              ) : null}
            </button>
          );
        })}
      </div>

      {answerRevealed ? (
        <section className="gb-reveal" aria-live="polite">
          <AssetImage
            asset={isCorrect ? 'mascotCorrect' : 'mascotHint'}
            decorative
            className="gb-reveal__mascot"
          />
          <div>
            <p className="gb-reveal__title">
              {isCorrect
                ? '정답이에요! 100점'
                : savedChoice === null
                  ? '정답 공개'
                  : '아쉬워요! 해설을 읽어 봐요'}
            </p>
            <p>{config.explanation}</p>
          </div>
        </section>
      ) : null}

      {repository.mode === 'mock' && savedChoice !== null && !answerRevealed ? (
        <p className="dev-note">
          <Icon name="settings" size="sm" />
          개발용:{' '}
          <Link to={paths.teacherMission(eventId, mission.id)}>교사 화면에서 정답 공개하기</Link>
        </p>
      ) : null}
    </MissionShell>
  );
}
