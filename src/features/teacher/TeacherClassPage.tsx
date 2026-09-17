import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { paths } from '../../app/paths';
import { Button, ButtonLink } from '../../components/Button';
import { ConfirmDialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { StatusBadge } from '../../components/StatusBadge';
import { ErrorView, InlineAlert, LoadingView } from '../../components/StateViews';
import type { ClassOpsDetail } from '../../data/EventRepository';
import { toUserMessage } from '../../data/errors';
import { useRepository } from '../../data/RepositoryContext';
import { CARD_TYPES } from '../../domain/cards';
import { CARD_INFO } from '../../domain/catalog';
import { FINAL_CLASS_STATUS_LABELS } from '../../domain/finalMission';
import { SELECTION_MODE_LABELS } from '../../domain/rewards';
import { useAction } from '../../hooks/useAction';
import { useAsyncData } from '../../hooks/useAsyncData';
import { useFinalLive } from '../../hooks/useFinalLive';
import { createRequestId } from '../../lib/random';
import { formatTimeOfDay } from '../../lib/time';
import { CardProgressTile } from '../cards/CardProgressTile';
import '../cards/CardPages.css';
import { FinalCountdown } from '../final/FinalCountdown';
import { ClassTeamsTable } from './dashboard/ClassDetailPanel';
import './dashboard/OpsBoard.css';
import { useTeacherContext } from './teacherContext';

/** 담임용 학급 상세: 팀 위치·순위·카드 진행도와 최종 미션 시작 */
export function TeacherClassPage() {
  const { eventId } = useTeacherContext();
  const { classId = '' } = useParams();
  const repository = useRepository();
  const { liveOps, classFinal } = repository.capabilities;

  const load = useCallback(async () => {
    const [cards, detail] = await Promise.all([
      repository.getTeacherClassCards(eventId, classId),
      // 팀 이동·최종 미션을 연결하지 않은 모드에서는 카드 기록만 보여 준다.
      liveOps && classFinal ? repository.getClassOpsDetail(eventId, classId) : null,
    ]);
    return { cards, detail };
  }, [repository, eventId, classId, liveOps, classFinal]);
  const data = useAsyncData(load);

  // 총괄 선생님이 최종 미션을 열면 시작 버튼이 바로 켜지게 다시 읽는다.
  const grade = data.status === 'success' ? data.data.cards.classInfo.grade : null;
  const revision = useFinalLive(eventId, classFinal ? grade : null, classId);
  const [seenRevision, setSeenRevision] = useState(revision);
  if (seenRevision !== revision) {
    setSeenRevision(revision);
    if (data.status === 'success') data.reload();
  }

  if (data.status === 'loading') return <LoadingView />;
  if (data.status === 'error') return <ErrorView error={data.error} onRetry={data.reload} />;

  const { cards, detail } = data.data;
  const { classInfo, teams, progress, awards } = cards;
  const teamNoOf = (teamId: string) => teams.find((team) => team.id === teamId)?.teamNo ?? teamId;

  return (
    <>
      <div className="teacher-title">
        <h1 className="page__title">{classInfo.displayName}</h1>
        <div className="cluster">
          <ButtonLink to={paths.teacherCards(eventId)} variant="ghost" icon="arrow_back">
            학급 목록
          </ButtonLink>
          <Button variant="secondary" icon="refresh" onClick={data.reload}>
            새로고침
          </Button>
        </div>
      </div>

      {detail ? (
        <FinalStartPanel eventId={eventId} detail={detail} onChanged={data.reload} />
      ) : null}

      {detail ? (
        <section className="panel stack" aria-labelledby="class-teams-title">
          <h2 id="class-teams-title" className="section-title">
            <Icon name="groups" /> 팀별 위치와 결과
          </h2>
          <ClassTeamsTable detail={detail} />
        </section>
      ) : null}

      <section className="stack" aria-labelledby="class-progress-title">
        <h2 id="class-progress-title" className="section-title">
          <Icon name="style" /> 카드 진행도 · 완성 {progress.completedCount}/5
          {detail ? (
            <StatusBadge tone="accent" icon="lightbulb">
              최종 미션 힌트 {detail.hintPreview}개
            </StatusBadge>
          ) : null}
        </h2>
        <ul className="card-board">
          {CARD_TYPES.map((cardType) => (
            <CardProgressTile key={cardType} card={progress.cards[cardType]} />
          ))}
        </ul>
      </section>

      <section className="panel stack" aria-labelledby="class-awards-title">
        <h2 id="class-awards-title" className="section-title">
          <Icon name="playing_cards" /> 카드 보상 기록 ({awards.length}개)
        </h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">출처</th>
                <th scope="col">팀</th>
                <th scope="col">방식</th>
                <th scope="col">후보</th>
                <th scope="col">받은 카드</th>
                <th scope="col">받은 시각</th>
              </tr>
            </thead>
            <tbody>
              {awards.map((award) => (
                <tr key={award.id}>
                  <th scope="row">{award.sourceLabel}</th>
                  <td>{teamNoOf(award.teamId)}팀</td>
                  <td>{SELECTION_MODE_LABELS[award.selectionMode]}</td>
                  <td>
                    {award.offeredTypes.map((cardType) => CARD_INFO[cardType].name).join(', ')}
                  </td>
                  <td>
                    {award.status === 'claimed' && award.selectedType ? (
                      <StatusBadge tone="success" icon="check_circle">
                        {CARD_INFO[award.selectedType].name}
                      </StatusBadge>
                    ) : (
                      <StatusBadge tone="warning" icon="hourglass_top">
                        선택 대기
                      </StatusBadge>
                    )}
                  </td>
                  <td className="number">{formatTimeOfDay(award.claimedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

/** 최종 미션 준비 상태와 시작 버튼. 시작은 확인 → 3, 2, 1 카운트다운 → 한 번만 기록한다. */
function FinalStartPanel({
  eventId,
  detail,
  onChanged,
}: {
  eventId: string;
  detail: ClassOpsDetail;
  onChanged: () => void;
}) {
  const repository = useRepository();
  const navigate = useNavigate();
  const { classInfo, finalStatus, finalState, startBlocker, canRunFinal, hintPreview, progress } =
    detail;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [counting, setCounting] = useState(false);
  const [requestId] = useState(createRequestId);
  const start = useAction(
    useCallback(
      () => repository.startClassFinal({ eventId, classId: classInfo.id, requestId }),
      [repository, eventId, classInfo.id, requestId],
    ),
  );
  const finalPath = paths.teacherClassFinal(eventId, classInfo.id);

  const beginAfterCountdown = async () => {
    setCounting(false);
    const result = await start.run();
    if (result?.ok) navigate(finalPath);
    else onChanged();
  };

  const started = finalState.startedAt !== null;
  const blocker = !canRunFinal ? '담당 학급의 최종 미션만 시작할 수 있어요.' : startBlocker;

  return (
    <section className="panel stack final-start" aria-labelledby="final-start-title">
      <div className="teacher-title">
        <h2 id="final-start-title" className="section-title">
          <Icon name="trophy" /> 학급 최종 미션
        </h2>
        <StatusBadge
          tone={finalStatus === 'ready' ? 'primary' : finalStatus === 'locked' ? 'neutral' : 'info'}
          icon={finalStatus === 'locked' ? 'lock' : finalStatus === 'ready' ? 'play_arrow' : 'info'}
          size="lg"
        >
          {FINAL_CLASS_STATUS_LABELS[finalStatus]}
        </StatusBadge>
      </div>
      <p>
        학급 전체가 전자칠판으로 4지선다 10문제를 함께 풀어요. 지금 시작하면 완성 카드{' '}
        <strong className="number">{progress.completedCount}종</strong> → 힌트{' '}
        <strong className="number">{hintPreview}개</strong>
        {progress.allComplete ? ', 5종 완성으로 동점이면 우리 반이 앞서요.' : '를 받아요.'}
      </p>
      {started ? (
        <div className="cluster">
          <ButtonLink to={finalPath} size="xl" icon="play_arrow">
            {finalStatus === 'active' ? '최종 미션 이어서 하기' : '최종 미션 화면 보기'}
          </ButtonLink>
          <span className="muted">시작 시각 {formatTimeOfDay(finalState.startedAt)}</span>
        </div>
      ) : (
        <>
          <Button
            size="xl"
            icon="rocket_launch"
            disabled={blocker !== null || start.isPending || counting}
            loading={start.isPending}
            onClick={() => setConfirmOpen(true)}
          >
            최종 미션 시작
          </Button>
          {blocker ? (
            <p className="muted">
              <Icon name="lock" size="sm" /> {blocker}
            </p>
          ) : null}
        </>
      )}
      {start.status === 'error' ? (
        <InlineAlert tone="danger">{toUserMessage(start.error)}</InlineAlert>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        title={`${classInfo.displayName} 최종 미션을 시작할까요?`}
        confirmLabel="시작하기"
        confirmIcon="rocket_launch"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          setCounting(true);
        }}
      >
        <p>
          <strong>시작하면 시간이 측정되며 다시 시작할 수 없습니다.</strong>
        </p>
        <p className="muted">전자칠판에 이 화면을 띄우고 학생들이 준비됐는지 확인해 주세요.</p>
      </ConfirmDialog>
      {counting ? <FinalCountdown onDone={() => void beginAfterCountdown()} /> : null}
    </section>
  );
}
