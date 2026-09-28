import { useCallback, useState } from 'react';
import { paths } from '../../../app/paths';
import { Button, ButtonLink } from '../../../components/Button';
import { ConfirmDialog } from '../../../components/Dialog';
import { Icon } from '../../../components/Icon';
import type { IconName } from '../../../components/icons';
import { StatusBadge } from '../../../components/StatusBadge';
import { InlineAlert } from '../../../components/StateViews';
import { Timer } from '../../../components/Timer';
import { toUserMessage } from '../../../data/errors';
import { useRepository } from '../../../data/RepositoryContext';
import {
  BOOTH_STEPS,
  getBoothActionBlocker,
  getBoothStepIndex,
  getLiveRoundStatus,
  type BoothAction,
} from '../../../domain/boothRound';
import { MISSION_ROUND_STATUS_LABELS } from '../../../domain/tour';
import type { Grade, Mission, MissionRoundState, RoundNo } from '../../../domain/types';
import { useAction } from '../../../hooks/useAction';
import { useServerNow } from '../../../hooks/useServerNow';
import { formatTimeOfDay } from '../../../lib/time';
import { BOOTH_STATUS_BADGES } from '../dashboard/tourBadges';

interface BoothRoundPanelProps {
  eventId: string;
  mission: Mission;
  grade: Grade;
  round: RoundNo;
  booth: MissionRoundState;
  /** 이 학년이 지금 진행 학년인지 */
  touring: boolean;
  /** 이 부스가 바로 앞 라운드를 종료했는지(1라운드는 늘 true) */
  previousCompleted: boolean;
  rankingFinalized: boolean;
  /** 입장한 팀 수와 올 팀 수. 아직 읽지 못했으면 null */
  arrivals: { arrived: number; expected: number } | null;
  gameMinutes: number;
  onChanged: (message: string) => void;
}

const ACTIONS: Record<
  BoothAction,
  { label: (round: RoundNo) => string; icon: IconName; done: string }
> = {
  open: {
    label: (round) => `${round}라운드 열기`,
    icon: 'meeting_room',
    done: '라운드를 열었어요. 팀이 들어올 수 있어요.',
  },
  start: { label: () => '게임 시작', icon: 'play_arrow', done: '게임을 시작했어요.' },
  close: {
    label: (round) => `${round}라운드 종료`,
    icon: 'stop_circle',
    done: '라운드를 종료했어요. 팀이 다음 교실로 이동해요.',
  },
};

/**
 * 부스 라운드 진행: 라운드 열기 → 게임 시작 → 순위 매기기 → 라운드 종료.
 * 지금 할 일 하나만 큰 버튼으로 보여 주고, 누를 수 없을 때는 이유를 함께 알려 준다.
 */
export function BoothRoundPanel({
  eventId,
  mission,
  grade,
  round,
  booth,
  touring,
  previousCompleted,
  rankingFinalized,
  arrivals,
  gameMinutes,
  onChanged,
}: BoothRoundPanelProps) {
  const repository = useRepository();
  const now = useServerNow(1000);
  const [confirming, setConfirming] = useState<BoothAction | null>(null);
  const status = getLiveRoundStatus(booth, now);
  const stepIndex = getBoothStepIndex(status, rankingFinalized);

  const advance = useAction(
    useCallback(
      (action: BoothAction) => {
        const input = { eventId, missionId: mission.id, grade, roundNo: round };
        if (action === 'open') return repository.openStationRound(input);
        if (action === 'start') return repository.startStationRound(input);
        return repository.closeStationRound(input);
      },
      [repository, eventId, mission.id, grade, round],
    ),
  );

  const run = async (action: BoothAction) => {
    const result = await advance.run(action);
    setConfirming(null);
    if (result?.ok) onChanged(`${round}라운드: ${ACTIONS[action].done}`);
  };

  const next: BoothAction | null =
    status === 'ready'
      ? 'open'
      : status === 'open'
        ? 'start'
        : status === 'completed'
          ? null
          : 'close';
  const blocker =
    next === null
      ? null
      : getBoothActionBlocker(next, { status, touring, previousCompleted, rankingFinalized });
  const missing = arrivals ? arrivals.expected - arrivals.arrived : 0;
  const badge = BOOTH_STATUS_BADGES[status];

  const press = (action: BoothAction) => {
    // 되돌릴 수 없는 종료와, 아직 들어오지 않은 팀이 있는 시작은 한 번 더 묻는다.
    if (action === 'close' || (action === 'start' && missing > 0)) setConfirming(action);
    else void run(action);
  };

  let guide: string;
  if (status === 'ready') {
    guide = `${round}라운드를 열면 팀이 교실 QR을 찍고 들어올 수 있어요.`;
  } else if (status === 'open') {
    guide = `팀이 모두 들어오면 게임을 시작해 주세요. 게임 시간은 ${gameMinutes}분이에요.`;
  } else if (status === 'completed') {
    guide =
      round === 5
        ? '5라운드까지 모두 끝났어요. 이제 우리 반으로 돌아가 최종 미션(담임 활동)을 진행해요.'
        : `${round}라운드를 종료했어요. 다음 라운드를 열어 주세요.`;
  } else if (rankingFinalized) {
    guide = '순위를 확정했어요. 라운드를 종료하면 팀이 다음 교실로 이동해요.';
  } else if (status === 'active') {
    guide =
      '게임 중이에요. 시간이 끝나면 제출이 닫혀요. 라운드를 종료하기 전에 아래에서 순위를 확정해 주세요.';
  } else {
    guide = '게임 시간이 끝났어요. 아래에서 순위를 확정한 뒤 라운드를 종료해 주세요.';
  }

  return (
    <section className="panel stack booth-round" aria-labelledby="booth-round-title">
      <div className="teacher-title">
        <h2 id="booth-round-title" className="section-title">
          <Icon name="flag" /> {round}라운드 진행
          <StatusBadge tone={badge.tone} icon={badge.icon} size="lg">
            {MISSION_ROUND_STATUS_LABELS[status]}
          </StatusBadge>
        </h2>
        <Timer
          status={status === 'active' ? 'active' : 'ready'}
          endsAt={status === 'active' ? booth.endsAt : null}
        />
      </div>

      <ol className="booth-steps" aria-label="라운드 진행 순서">
        {BOOTH_STEPS.map((step, index) => {
          const state = index < stepIndex ? 'done' : index === stepIndex ? 'current' : 'todo';
          return (
            <li
              key={step.status}
              className={`booth-step booth-step--${state}`}
              aria-current={state === 'current' ? 'step' : undefined}
            >
              <span className="booth-step__mark number" aria-hidden="true">
                {state === 'done' ? <Icon name="check_circle" /> : index + 1}
              </span>
              <span className="booth-step__label">{step.label}</span>
              <span className="visually-hidden">
                {state === 'done' ? ' 완료' : state === 'current' ? ' 지금 할 일' : ' 아직'}
              </span>
            </li>
          );
        })}
      </ol>

      <p className="booth-round__guide" role="status">
        {guide}
      </p>
      {arrivals && (status === 'open' || status === 'active') ? (
        <p className="booth-round__arrivals">
          <Icon name="login" /> 입장{' '}
          <strong className="number">
            {arrivals.arrived} / {arrivals.expected}팀
          </strong>
          {missing > 0 ? <span className="muted"> · 아직 {missing}팀이 오지 않았어요</span> : null}
        </p>
      ) : null}
      {booth.startedAt !== null ? (
        <p className="muted">
          게임 시작 {formatTimeOfDay(booth.startedAt)}
          {booth.endsAt !== null ? ` · 게임 끝 ${formatTimeOfDay(booth.endsAt)}` : ''}
          {booth.completedAt !== null ? ` · 라운드 종료 ${formatTimeOfDay(booth.completedAt)}` : ''}
        </p>
      ) : null}

      <div className="cluster">
        {next !== null ? (
          <Button
            size="lg"
            variant={next === 'close' ? 'danger' : 'primary'}
            icon={ACTIONS[next].icon}
            disabled={blocker !== null}
            loading={advance.isPending}
            onClick={() => press(next)}
          >
            {ACTIONS[next].label(round)}
          </Button>
        ) : null}
        {next === 'close' && !rankingFinalized ? (
          <Button
            size="lg"
            variant="secondary"
            icon="leaderboard"
            onClick={() => document.getElementById('ranking-title')?.scrollIntoView()}
          >
            순위표로 이동
          </Button>
        ) : null}
        {status === 'completed' && round === 5 ? (
          <ButtonLink to={paths.finalResults(eventId)} size="lg" icon="trophy">
            최종 미션으로 가기
          </ButtonLink>
        ) : null}
      </div>
      {blocker ? (
        <p className="booth-round__blocker">
          <Icon name="info" size="sm" /> {blocker}
        </p>
      ) : null}
      {advance.status === 'error' ? (
        <InlineAlert tone="danger">{toUserMessage(advance.error)}</InlineAlert>
      ) : null}

      <ConfirmDialog
        open={confirming === 'start'}
        title={`아직 ${missing}팀이 입장하지 않았어요. 게임을 시작할까요?`}
        confirmLabel="게임 시작"
        confirmIcon="play_arrow"
        loading={advance.isPending}
        onCancel={() => setConfirming(null)}
        onConfirm={() => run('start')}
      >
        <p>
          시작하면 {gameMinutes}분이 흐르기 시작해요. 늦게 온 팀도 게임 중에 교실 QR을 찍고 들어올
          수 있어요.
        </p>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirming === 'close'}
        title={`${round}라운드를 종료할까요?`}
        confirmLabel={`${round}라운드 종료`}
        confirmIcon="stop_circle"
        tone="danger"
        loading={advance.isPending}
        onCancel={() => setConfirming(null)}
        onConfirm={() => run('close')}
      >
        <p>
          종료하면 팀 화면이 다음 교실 안내로 바뀌어요. 종료한 라운드는 다시 열 수 없어요. 순위는
          종료한 뒤에도 고칠 수 있어요.
        </p>
      </ConfirmDialog>
    </section>
  );
}
