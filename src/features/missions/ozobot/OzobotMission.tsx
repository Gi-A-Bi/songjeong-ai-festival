import { paths } from '../../../app/paths';
import { AssetImage } from '../../../components/AssetImage';
import { Button } from '../../../components/Button';
import { Icon } from '../../../components/Icon';
import { MissionShell } from '../../../components/MissionShell';
import { StatusBadge } from '../../../components/StatusBadge';
import { canSubmitInPhase } from '../../../domain/missionPhase';
import type { OzobotConfig } from '../../../domain/types';
import { MissionNotice } from '../MissionNotice';
import type { MissionScreenProps } from '../missionTypes';
import { useMissionSubmit } from '../useMissionSubmit';
import '../Missions.css';

interface OzobotMissionProps extends MissionScreenProps {
  config: OzobotConfig;
}

/** 로봇 기록은 교사가 직접 확인하므로 학생은 준비 완료만 알린다. */
export function OzobotMission({
  eventId,
  view,
  event,
  phase,
  onSubmitted,
  config,
}: OzobotMissionProps) {
  const { team, mission, submission, roundNo } = view;
  const ready = submission !== null && submission.status !== 'draft';
  const { submit, isPending, error } = useMissionSubmit(eventId, team.id, mission.id, onSubmitted);

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
        ready ? (
          <StatusBadge tone="info" icon="pending" size="lg">
            교사 확인 대기
          </StatusBadge>
        ) : (
          <>
            <p className="mission-actions__hint">
              <Icon name="smart_toy" />
              로봇을 출발선에 올렸나요?
            </p>
            <Button
              size="xl"
              icon="flag"
              disabled={!canSubmitInPhase(phase)}
              loading={isPending}
              loadingLabel="알리는 중"
              onClick={() => void submit({ type: 'ozobot', ready: true })}
            >
              시작 준비 완료
            </Button>
          </>
        )
      }
    >
      <div className="ozobot">
        <AssetImage asset="missionOzobot" className="ozobot__course" loading="eager" />
        <section className="panel" aria-labelledby="ozobot-rules-title">
          <h2 id="ozobot-rules-title" className="section-title">
            <Icon name="format_list_numbered" />
            미션 규칙
          </h2>
          <ol className="rule-list">
            {config.rules.map((rule, index) => (
              <li key={rule} className="rule-list__item">
                <span className="rule-list__no number">{index + 1}</span>
                {rule}
              </li>
            ))}
          </ol>
        </section>
      </div>

      {ready ? (
        <section className="waiting-panel" aria-live="polite">
          <AssetImage asset="mascotTimer" decorative className="waiting-panel__mascot" />
          <div>
            <p className="waiting-panel__title">교사 확인 대기</p>
            <p>선생님이 완주 시간과 재시도 횟수를 기록하고 있어요. 로봇을 만지지 말고 기다려요.</p>
          </div>
        </section>
      ) : null}
    </MissionShell>
  );
}
