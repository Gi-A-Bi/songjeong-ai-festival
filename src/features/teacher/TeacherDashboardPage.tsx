import { useCallback, useState } from 'react';
import { Link } from 'react-router';
import { paths } from '../../app/paths';
import { missionImageKeys } from '../../assets/manifest';
import { AssetImage } from '../../components/AssetImage';
import { Button, ButtonLink } from '../../components/Button';
import { ConfirmDialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { StatusBadge } from '../../components/StatusBadge';
import { EmptyView, ErrorView, InlineAlert, LoadingView } from '../../components/StateViews';
import { Timer } from '../../components/Timer';
import type { RoundControlAction } from '../../data/EventRepository';
import { toUserMessage } from '../../data/errors';
import { useDevTools, useRepository } from '../../data/RepositoryContext';
import { MISSION_TYPE_INFO } from '../../domain/catalog';
import type { Grade } from '../../domain/types';
import { useAction } from '../../hooks/useAction';
import { useAsyncData } from '../../hooks/useAsyncData';
import { OpsBoard } from './dashboard/OpsBoard';
import { EVENT_STATUS_BADGES, useTeacherContext } from './teacherContext';

const GRADES: Grade[] = [3, 4, 5, 6];

export function TeacherDashboardPage() {
  const { eventId, event, teacher } = useTeacherContext();
  const repository = useRepository();
  const devTools = useDevTools();
  const isAdmin = teacher.role === 'admin';
  const liveOps = repository.capabilities.liveOps;
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const grade = event.activeGrade;
  const round = event.activeRound;

  const loadMissions = useCallback(() => repository.listMissions(eventId), [repository, eventId]);
  const missions = useAsyncData(loadMissions);

  const loadProgress = useCallback(async () => {
    // 운영 상황판을 쓰는 모드에서는 라운드 상태만 있으면 된다.
    if (grade === null || round === 0) return null;
    const [progress, roundStatus] = await Promise.all([
      liveOps ? [] : repository.getRoundProgress(eventId, grade, round),
      repository.getRoundStatus(eventId, grade, round),
    ]);
    return { progress, roundStatus };
    // 라운드 상태가 바뀔 때마다 제출 현황을 다시 읽는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repository, eventId, grade, round, event.status, liveOps]);
  const progress = useAsyncData(loadProgress);

  const control = useAction(
    useCallback(
      (action: RoundControlAction) => repository.controlRound(eventId, action),
      [repository, eventId],
    ),
  );
  const changeGrade = useAction(
    useCallback((value: Grade) => repository.setActiveGrade(eventId, value), [repository, eventId]),
  );

  const statusBadge = EVENT_STATUS_BADGES[event.status];
  const running = event.status === 'active' || event.status === 'paused';
  const roundStatus = progress.status === 'success' ? progress.data?.roundStatus : undefined;
  const roundEnded = round === 0 || roundStatus === 'scoring' || roundStatus === 'closed';

  let startLabel = `${round}라운드 시작`;
  if (event.status === 'paused') startLabel = '다시 시작';
  else if (event.status === 'active') startLabel = '진행 중';
  else if (roundEnded) startLabel = round < 5 ? `${round + 1}라운드 시작` : '모든 라운드 끝';
  const startDisabled =
    event.status === 'active' || grade === null || (!running && roundEnded && round === 5);

  const actionError =
    control.status === 'error'
      ? control.error
      : changeGrade.status === 'error'
        ? changeGrade.error
        : null;

  return (
    <>
      <div className="teacher-title">
        <h1 className="page__title">실시간 운영 대시보드</h1>
        {liveOps ? null : (
          <Button variant="secondary" icon="refresh" onClick={progress.reload}>
            제출 현황 새로고침
          </Button>
        )}
      </div>

      <section className="panel control-bar" aria-label="행사 진행">
        <dl className="control-bar__facts">
          <div>
            <dt>행사 상태</dt>
            <dd>
              <StatusBadge tone={statusBadge.tone} icon={statusBadge.icon} size="lg">
                {statusBadge.label}
              </StatusBadge>
            </dd>
          </div>
          <div>
            <dt>
              <label htmlFor="active-grade">활성 학년</label>
            </dt>
            <dd>
              <select
                id="active-grade"
                className="text-input control-bar__select"
                value={grade ?? ''}
                disabled={!isAdmin || running || changeGrade.isPending}
                onChange={(change) => void changeGrade.run(Number(change.target.value) as Grade)}
              >
                {grade === null ? <option value="">선택</option> : null}
                {GRADES.map((value) => (
                  <option key={value} value={value}>
                    {value}학년
                  </option>
                ))}
              </select>
            </dd>
          </div>
          <div>
            <dt>현재 라운드</dt>
            <dd className="control-bar__round number">
              {round === 0 ? '시작 전' : `${round} / 5`}
            </dd>
          </div>
          <div>
            <dt>남은 시간</dt>
            <dd>
              <Timer
                status={event.status}
                endsAt={event.roundEndsAt}
                pausedRemainingMs={event.pausedRemainingMs}
              />
            </dd>
          </div>
        </dl>
        <div className="control-bar__actions">
          <Button
            size="lg"
            icon="play_arrow"
            disabled={!isAdmin || startDisabled}
            loading={control.isPending}
            onClick={() => void control.run('start')}
          >
            {startLabel}
          </Button>
          <Button
            size="lg"
            variant="secondary"
            icon="pause"
            disabled={!isAdmin || event.status !== 'active' || control.isPending}
            onClick={() => void control.run('pause')}
          >
            일시정지
          </Button>
          <Button
            size="lg"
            variant="danger"
            icon="stop_circle"
            disabled={!isAdmin || !running || control.isPending}
            onClick={() => setConfirmEnd(true)}
          >
            라운드 종료
          </Button>
        </div>
        {!isAdmin ? (
          <p className="control-bar__hint muted">
            <Icon name="visibility" size="sm" /> 전체 현황은 읽기 전용이에요. 라운드 제어는 총괄
            선생님만 할 수 있어요.
          </p>
        ) : running ? null : (
          <p className="control-bar__hint muted">
            <Icon name="info" size="sm" /> 학년은 라운드가 멈춰 있을 때만 바꿀 수 있어요.
          </p>
        )}
        {actionError ? <InlineAlert tone="danger">{toUserMessage(actionError)}</InlineAlert> : null}
      </section>

      {liveOps && grade !== null ? (
        <OpsBoard eventId={eventId} grade={grade} event={event} />
      ) : null}
      {liveOps && grade === null ? (
        <EmptyView title="진행할 학년을 먼저 골라 주세요" icon="school" />
      ) : null}

      <section className="stack" aria-labelledby="mission-cards-title" hidden={liveOps}>
        <h2 id="mission-cards-title" className="section-title">
          <Icon name="leaderboard" />
          {grade && round ? `${grade}학년 ${round}라운드 미션 현황` : '미션 현황'}
        </h2>
        {missions.status === 'loading' ? <LoadingView /> : null}
        {missions.status === 'error' ? (
          <ErrorView error={missions.error} onRetry={missions.reload} />
        ) : null}
        {missions.status === 'success' ? (
          <ul className="mission-cards">
            {missions.data.map((mission) => {
              const item =
                progress.status === 'success'
                  ? progress.data?.progress.find((entry) => entry.missionId === mission.id)
                  : undefined;
              const missing = item ? item.total - item.submitted : null;
              return (
                <li
                  key={mission.id}
                  className={`mission-card accent-${MISSION_TYPE_INFO[mission.type].accent}`}
                >
                  <AssetImage
                    asset={missionImageKeys[mission.type]}
                    decorative
                    className="mission-card__image"
                  />
                  <div className="mission-card__body">
                    <p className="mission-card__eyebrow">
                      <Icon name={MISSION_TYPE_INFO[mission.type].icon} size="sm" />
                      미션 {mission.no} · {mission.room}
                    </p>
                    <h3 className="mission-card__title">{mission.title}</h3>
                    {item ? (
                      <>
                        <p className="mission-card__count">
                          제출 <strong className="number">{item.submitted}</strong> / {item.total}팀
                        </p>
                        <progress
                          className="mission-card__bar"
                          max={item.total}
                          value={item.submitted}
                        >
                          {item.submitted}/{item.total}
                        </progress>
                        <div className="cluster">
                          {item.finalized ? (
                            <StatusBadge tone="success" icon="trophy">
                              순위 확정
                            </StatusBadge>
                          ) : missing && missing > 0 ? (
                            <StatusBadge tone="warning" icon="warning">
                              미제출 {missing}팀
                            </StatusBadge>
                          ) : (
                            <StatusBadge tone="info" icon="check_circle">
                              모두 제출
                            </StatusBadge>
                          )}
                          {mission.teacherJudged ? (
                            <StatusBadge tone="accent" icon="school">
                              교사 판정
                            </StatusBadge>
                          ) : null}
                        </div>
                      </>
                    ) : (
                      <p className="muted">라운드를 시작하면 제출 현황이 보여요.</p>
                    )}
                    <ButtonLink
                      to={paths.teacherStation(eventId, mission.id)}
                      variant="secondary"
                      iconEnd="arrow_forward"
                      fullWidth
                    >
                      운영하기
                    </ButtonLink>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
        {progress.status === 'error' ? (
          <InlineAlert
            tone="danger"
            action={
              <Button variant="secondary" icon="refresh" onClick={progress.reload}>
                다시 시도
              </Button>
            }
          >
            {toUserMessage(progress.error)}
          </InlineAlert>
        ) : null}
        {grade === null ? <EmptyView title="진행할 학년을 먼저 골라 주세요" icon="school" /> : null}
      </section>

      <section className="panel teacher-shortcuts" aria-label="바로 가기">
        <AssetImage asset="sceneFinale" decorative className="teacher-shortcuts__image" />
        <div className="stack">
          <h2 className="section-title">
            <Icon name="trophy" /> 카드 성장과 학급 최종 미션
          </h2>
          <p className="muted">
            학급별 네 조각 카드 진행도를 확인해요. 투어가 끝나면 총괄 선생님이 최종 미션을 열고, 각
            반은 준비되면 전자칠판에서 10문제를 시작해요.
          </p>
          <div className="cluster">
            <Link to={paths.teacherCards(eventId)} className="teacher-shortcuts__link">
              학급 카드 현황 <Icon name="arrow_forward" size="sm" />
            </Link>
            {repository.capabilities.classFinal ? (
              <Link to={paths.finalResults(eventId)} className="teacher-shortcuts__link">
                최종 미션 현황 <Icon name="arrow_forward" size="sm" />
              </Link>
            ) : (
              <span className="muted">최종 미션은 Firebase 연결 뒤 열려요.</span>
            )}
          </div>
        </div>
      </section>

      {devTools ? (
        <section className="panel dev-tools" aria-labelledby="dev-tools-title">
          <h2 id="dev-tools-title" className="section-title">
            <Icon name="settings" /> 개발·리허설 도구 (mock 전용)
          </h2>
          <p className="muted">
            데이터는 이 브라우저 메모리에만 있어요. 새로고침하면 샘플 상태로 돌아가요.
          </p>
          <div className="cluster">
            <Button variant="secondary" icon="wifi_off" onClick={() => devTools.failNextRequest()}>
              다음 요청 실패 흉내
            </Button>
            <Button variant="secondary" icon="restart_alt" onClick={() => setConfirmReset(true)}>
              샘플 데이터 초기화
            </Button>
          </div>
        </section>
      ) : null}

      <ConfirmDialog
        open={confirmEnd}
        title={`${round}라운드를 종료할까요?`}
        confirmLabel="라운드 종료"
        confirmIcon="stop_circle"
        tone="danger"
        loading={control.isPending}
        onCancel={() => setConfirmEnd(false)}
        onConfirm={async () => {
          await control.run('end');
          setConfirmEnd(false);
        }}
      >
        <p>종료하면 학생들은 더 이상 제출할 수 없고, 미션별 채점·순위 확정 단계로 넘어가요.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmReset}
        title="샘플 데이터로 초기화할까요?"
        confirmLabel="초기화"
        confirmIcon="restart_alt"
        tone="danger"
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => {
          devTools?.resetData();
          setConfirmReset(false);
          missions.reload();
          progress.reload();
        }}
      >
        <p>이번 접속에서 바꾼 제출·순위·체크인·카드 보상·최종 미션 기록이 모두 지워져요.</p>
      </ConfirmDialog>
    </>
  );
}
