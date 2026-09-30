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
  skip: {
    label: (round) => `${round}라운드 건너뛰기`,
    icon: 'arrow_forward',
    done: '라운드를 건너뛰었어요.',
  },
};

/**
 * 부스 라운드 진행: 라운드 열기 → 게임 시작 → 순위 매기기 → 라운드 종료.
 * 지금 할 일 하나만 큰 버튼으로 보여 주고, 누를 수 없을 때는 이유를 함께 알려 준다.
 * 연습이나 시간이 모자랄 때는 게임과 순위 없이 라운드를 건너뛸 수 있다.
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
        if (action === 'skip') return repository.skipStationRound(input);
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
  const context = { status, touring, previousCompleted, rankingFinalized };
  const blocker = next === null ? null : getBoothActionBlocker(next, context);
  // 건너뛰기는 앞 라운드를 끝낸 뒤, 순위를 확정하기 전에만 보여 준다.
  const canSkip = status !== 'completed' && getBoothActionBlocker('skip', context) === null;
  const missing = arrivals ? arrivals.expected - arrivals.arrived : 0;
  const badge = BOOTH_STATUS_BADGES[status];
  const played = booth.startedAt !== null;

  const press = (action: BoothAction) => {
    // 되돌릴 수 없는 종료·건너뛰기와, 아직 들어오지 않은 팀이 있는 시작은 한 번 더 묻는다.
    if (action === 'close' || action === 'skip' || (action === 'start' && missing > 0)) {
      setConfirming(action);
    } else void run(action);
  };

  let guide: string;
  if (booth.skipped) {
    guide =
      round === 5
        ? '5라운드를 건너뛰었어요. 이제 우리 반으로 돌아가 최종 미션(담임 활동)을 진행해요.'
        : `${round}라운드를 건너뛰었어요. 다음 라운드를 열어 주세요.`;
  } else if (status === 'ready') {
    guide = `${round}라운드를 열면 팀이 이 교실의 인증코드를 넣고 들어올 수 있어요.`;
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
          <StatusBadge
            tone={booth.skipped ? 'neutral' : badge.tone}
            icon={booth.skipped ? 'arrow_forward' : badge.icon}
            size="lg"
          >
            {booth.skipped ? '건너뜀' : MISSION_ROUND_STATUS_LABELS[status]}
          </StatusBadge>
        </h2>
        {/* 게임을 시작한 뒤에는 끝난 뒤에도 “시간 종료”로 보여 준다. */}
        <Timer
          status={played ? 'active' : 'ready'}
          endsAt={status === 'active' ? booth.endsAt : booth.startedAt}
        />
      </div>

      {booth.skipped ? null : (
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
      )}

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
      {played || booth.completedAt !== null ? (
        <p className="muted">
          {[
            played ? `게임 시작 ${formatTimeOfDay(booth.startedAt)}` : null,
            booth.endsAt !== null ? `게임 끝 ${formatTimeOfDay(booth.endsAt)}` : null,
            booth.completedAt !== null
              ? `${booth.skipped ? '건너뜀' : '라운드 종료'} ${formatTimeOfDay(booth.completedAt)}`
              : null,
          ]
            .filter((item) => item !== null)
            .join(' · ')}
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
        {canSkip ? (
          <Button
            variant="secondary"
            icon={ACTIONS.skip.icon}
            disabled={advance.isPending}
            onClick={() => press('skip')}
          >
            {ACTIONS.skip.label(round)}
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
          시작하면 {gameMinutes}분이 흐르기 시작해요. 늦게 온 팀도 게임 중에 인증코드를 넣고 들어올
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
      <ConfirmDialog
        open={confirming === 'skip'}
        title={`${round}라운드를 건너뛸까요?`}
        confirmLabel={`${round}라운드 건너뛰기`}
        confirmIcon="arrow_forward"
        tone="danger"
        loading={advance.isPending}
        onCancel={() => setConfirming(null)}
        onConfirm={() => run('skip')}
      >
        <p>
          게임과 순위 없이 이 라운드를 끝내요. 이 라운드에 올 팀은 이 미션을 하지 않고 다음 교실로
          넘어가고, 카드 조각도 받지 않아요.
        </p>
        <p>
          <strong>건너뛴 라운드는 다시 열 수 없어요.</strong>
          {played ? ' 이미 시작한 게임은 제출을 더 받지 않아요.' : ''}
        </p>
      </ConfirmDialog>
    </section>
  );
}
