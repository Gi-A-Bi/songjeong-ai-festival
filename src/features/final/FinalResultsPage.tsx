import { useCallback, useId, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { paths } from '../../app/paths';
import { Button } from '../../components/Button';
import { ConfirmDialog, Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { StatusBadge, type StatusTone } from '../../components/StatusBadge';
import { ErrorView, InlineAlert, LoadingView } from '../../components/StateViews';
import type { IconName } from '../../components/icons';
import type { FinalBoard, FinalBoardRow } from '../../data/EventRepository';
import { toUserMessage } from '../../data/errors';
import { useRepository } from '../../data/RepositoryContext';
import { FINAL_CLASS_STATUS_LABELS, getOverrideError } from '../../domain/finalMission';
import type { FinalClassStatus, FinalSessionStatus, Grade } from '../../domain/types';
import { useAction } from '../../hooks/useAction';
import { useAsyncData } from '../../hooks/useAsyncData';
import { useFinalLive } from '../../hooks/useFinalLive';
import { useServerNow } from '../../hooks/useServerNow';
import { formatClock, formatTimeOfDay } from '../../lib/time';
import { useTeacherContext } from '../teacher/teacherContext';
import './Final.css';

const GRADES: Grade[] = [3, 4, 5, 6];

const SESSION_BADGES: Record<
  FinalSessionStatus,
  { label: string; tone: StatusTone; icon: IconName }
> = {
  locked: { label: '열기 전', tone: 'neutral', icon: 'lock' },
  open: { label: '진행 중(반별 시작)', tone: 'primary', icon: 'play_arrow' },
  results_hidden: { label: '모든 반 제출 · 결과 공개 전', tone: 'warning', icon: 'visibility_off' },
  results_published: { label: '결과 공개', tone: 'success', icon: 'trophy' },
  closed: { label: '종료', tone: 'success', icon: 'task_alt' },
};

const CLASS_STATUS_BADGES: Record<FinalClassStatus, { tone: StatusTone; icon: IconName }> = {
  locked: { tone: 'neutral', icon: 'lock' },
  ready: { tone: 'info', icon: 'hourglass_top' },
  active: { tone: 'warning', icon: 'play_arrow' },
  submitted: { tone: 'success', icon: 'check_circle' },
  timeout: { tone: 'success', icon: 'timer_off' },
  review_required: { tone: 'danger', icon: 'warning' },
};

/** 학년별 최종 미션 현황과 결과: 개방, 반별 진행 중계, 결과 공개, 관리자 보정 */
export function FinalResultsPage() {
  const { eventId, event, teacher } = useTeacherContext();
  const repository = useRepository();
  const [grade, setGrade] = useState<Grade>(event.activeGrade ?? 3);
  const load = useCallback(
    () => repository.getFinalBoard(eventId, grade),
    [repository, eventId, grade],
  );
  const board = useAsyncData(load);

  const revision = useFinalLive(eventId, grade);
  const [seenRevision, setSeenRevision] = useState(revision);
  if (seenRevision !== revision) {
    setSeenRevision(revision);
    if (board.status === 'success') board.reload();
  }

  return (
    <>
      <div className="teacher-title">
        <h1 className="page__title">학급 최종 미션</h1>
        <div className="cluster">
          <label htmlFor="final-grade" className="visually-hidden">
            학년
          </label>
          <select
            id="final-grade"
            className="text-input control-bar__select"
            value={grade}
            onChange={(change) => setGrade(Number(change.target.value) as Grade)}
          >
            {GRADES.map((value) => (
              <option key={value} value={value}>
                {value}학년
              </option>
            ))}
          </select>
          <Button variant="secondary" icon="refresh" onClick={board.reload}>
            새로고침
          </Button>
        </div>
      </div>

      {board.status === 'loading' ? <LoadingView label="최종 미션 현황을 불러오고 있어요" /> : null}
      {board.status === 'error' ? <ErrorView error={board.error} onRetry={board.reload} /> : null}
      {board.status === 'success' ? (
        <>
          <SessionPanel
            key={`${grade}-${board.data.session.status}-${board.data.session.durationLimitSec}`}
            eventId={eventId}
            grade={grade}
            board={board.data}
            isAdmin={teacher.role === 'admin'}
            onChanged={board.reload}
          />
          <ClassRows
            eventId={eventId}
            grade={grade}
            board={board.data}
            isAdmin={teacher.role === 'admin'}
            onChanged={board.reload}
          />
        </>
      ) : null}
    </>
  );
}

function SessionPanel({
  eventId,
  grade,
  board,
  isAdmin,
  onChanged,
}: {
  eventId: string;
  grade: Grade;
  board: FinalBoard;
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const repository = useRepository();
  const { session, checklist, allFinished } = board;
  const badge = SESSION_BADGES[session.status];
  const minutesId = useId();
  const reasonId = useId();
  const [minutes, setMinutes] = useState(String(Math.round(session.durationLimitSec / 60)));
  const [openDialog, setOpenDialog] = useState(false);
  const [publishDialog, setPublishDialog] = useState(false);
  const [reason, setReason] = useState('');

  const blocked = checklist.blockers.length > 0;
  const open = useAction(
    useCallback(
      () => repository.openFinal({ eventId, grade, force: blocked, reason }),
      [repository, eventId, grade, blocked, reason],
    ),
  );
  const publish = useAction(
    useCallback(() => repository.publishFinalResults(eventId, grade), [repository, eventId, grade]),
  );
  const saveDuration = useAction(
    useCallback(
      (value: number) => repository.setFinalDuration(eventId, grade, value * 60),
      [repository, eventId, grade],
    ),
  );
  const minutesValue = Number(minutes);
  const minutesInvalid = !Number.isInteger(minutesValue) || minutesValue < 1 || minutesValue > 60;
  const anyStarted = board.rows.some((row) => row.state.startedAt !== null);
  const actionError =
    open.status === 'error'
      ? open.error
      : publish.status === 'error'
        ? publish.error
        : saveDuration.status === 'error'
          ? saveDuration.error
          : null;

  return (
    <section className="panel control-bar" aria-label={`${grade}학년 최종 미션 진행`}>
      <dl className="control-bar__facts">
        <div>
          <dt>상태</dt>
          <dd>
            <StatusBadge tone={badge.tone} icon={badge.icon} size="lg">
              {badge.label}
            </StatusBadge>
          </dd>
        </div>
        <div>
          <dt>연 시각</dt>
          <dd className="control-bar__round number">{formatTimeOfDay(session.openedAt)}</dd>
        </div>
        <div>
          <dt>
            <label htmlFor={minutesId}>제한 시간(분)</label>
          </dt>
          <dd className="cluster">
            <input
              id={minutesId}
              className="table-input number"
              inputMode="numeric"
              value={minutes}
              aria-invalid={minutesInvalid || undefined}
              disabled={!isAdmin || anyStarted}
              onChange={(change) => setMinutes(change.target.value)}
            />
            {isAdmin && !anyStarted ? (
              <Button
                variant="secondary"
                icon="save"
                disabled={minutesInvalid}
                loading={saveDuration.isPending}
                onClick={async () => {
                  const result = await saveDuration.run(minutesValue);
                  if (result?.ok) onChanged();
                }}
              >
                저장
              </Button>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>문제 수</dt>
          <dd className="control-bar__round number">{session.questionCount}문제</dd>
        </div>
      </dl>

      {session.status === 'locked' ? (
        <ul className="final-checklist" aria-label="최종 미션 개방 조건">
          <ChecklistItem done={checklist.roundsClosed} label="5라운드 종료" />
          <ChecklistItem
            done={checklist.missingResults === 0}
            label={
              checklist.missingResults === 0
                ? '모든 미션 결과 확정'
                : `결과 미확정 미션 ${checklist.missingResults}개`
            }
          />
          <ChecklistItem
            done={checklist.pendingAwards === 0}
            label={
              checklist.pendingAwards === 0
                ? '카드 보상 선택 완료'
                : `고르지 않은 카드 보상 ${checklist.pendingAwards}개`
            }
          />
        </ul>
      ) : null}

      {isAdmin ? (
        <div className="control-bar__actions">
          <Button
            size="lg"
            icon="lock_open"
            disabled={session.status !== 'locked' || open.isPending}
            onClick={() => setOpenDialog(true)}
          >
            {grade}학년 최종 미션 열기
          </Button>
          <Button
            size="lg"
            variant="secondary"
            icon="visibility"
            disabled={
              !allFinished ||
              session.status === 'results_published' ||
              session.status === 'closed' ||
              publish.isPending
            }
            onClick={() => setPublishDialog(true)}
          >
            결과 공개
          </Button>
        </div>
      ) : (
        <p className="control-bar__hint muted">
          <Icon name="visibility" size="sm" /> 최종 미션을 열고 결과를 공개하는 것은 총괄 선생님만
          할 수 있어요. 각 반은 학급 화면에서 시작해요.
        </p>
      )}
      {!board.canViewResults ? (
        <InlineAlert tone="info" icon="visibility_off">
          진행 중에는 상태, 문제 번호, 경과 시간, 남은 힌트만 보여요. 점수와 순위는 모든 반이 제출한
          뒤 총괄 선생님이 공개해요.
        </InlineAlert>
      ) : null}
      {isAdmin && !allFinished && session.status === 'open' ? (
        <p className="control-bar__hint muted">
          <Icon name="info" size="sm" /> 모든 반이 제출(또는 마감)해야 결과를 공개할 수 있어요.
        </p>
      ) : null}
      {actionError ? <InlineAlert tone="danger">{toUserMessage(actionError)}</InlineAlert> : null}

      <Dialog
        open={openDialog}
        title={`${grade}학년 최종 미션을 열까요?`}
        onClose={open.isPending ? () => undefined : () => setOpenDialog(false)}
        footer={
          <>
            <Button
              variant="secondary"
              size="lg"
              onClick={() => setOpenDialog(false)}
              disabled={open.isPending}
              data-autofocus
            >
              취소
            </Button>
            <Button
              size="lg"
              variant={blocked ? 'danger' : 'primary'}
              icon="lock_open"
              loading={open.isPending}
              disabled={blocked && reason.trim().length < 2}
              onClick={async () => {
                const result = await open.run();
                setOpenDialog(false);
                if (result?.ok) onChanged();
              }}
            >
              {blocked ? '사유를 남기고 강제로 열기' : '최종 미션 열기'}
            </Button>
          </>
        }
      >
        <p>열고 나면 각 반 담임 선생님 화면의 “최종 미션 시작” 버튼이 켜져요.</p>
        {blocked ? (
          <div className="stack">
            <InlineAlert tone="warning">
              아직 채우지 못한 조건이 있어요: {checklist.blockers.join(' ')}
            </InlineAlert>
            <label htmlFor={reasonId} className="form-field__label">
              강제로 여는 사유
            </label>
            <input
              id={reasonId}
              className="text-input"
              value={reason}
              maxLength={80}
              onChange={(change) => setReason(change.target.value)}
            />
          </div>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={publishDialog}
        title={`${grade}학년 최종 결과를 공개할까요?`}
        confirmLabel="결과 공개"
        confirmIcon="visibility"
        loading={publish.isPending}
        onCancel={() => setPublishDialog(false)}
        onConfirm={async () => {
          const result = await publish.run();
          setPublishDialog(false);
          if (result?.ok) onChanged();
        }}
      >
        <p>
          정답 수 → 5종 카드 완성 여부 → 소요 시간 순서로 순위를 확정하고, 모든 선생님과 학급 화면에
          점수와 순위를 보여 줘요.
        </p>
      </ConfirmDialog>
    </section>
  );
}

function ChecklistItem({ done, label }: { done: boolean; label: string }) {
  return (
    <li className={`final-checklist__item${done ? ' final-checklist__item--done' : ''}`}>
      <Icon name={done ? 'check_circle' : 'warning'} size="sm" /> {label}
    </li>
  );
}

type AdminAction = 'adjust' | 'force' | 'reset';

function ClassRows({
  eventId,
  grade,
  board,
  isAdmin,
  onChanged,
}: {
  eventId: string;
  grade: Grade;
  board: FinalBoard;
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const now = useServerNow(1000);
  const [editing, setEditing] = useState<{ row: FinalBoardRow; action: AdminAction } | null>(null);
  const { session, canViewResults } = board;

  return (
    <section className="panel stack" aria-labelledby="final-rows-title">
      <h2 id="final-rows-title" className="section-title">
        <Icon name="leaderboard" /> {grade}학년 학급 현황{canViewResults ? '과 순위' : ''}
      </h2>
      <p className="muted">
        순위는 정답 수가 많은 반 → 5종 카드를 모두 완성한 반 → 소요 시간이 짧은 반 순서예요. 세
        가지가 모두 같으면 공동 순위예요.
      </p>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              {canViewResults ? (
                <th scope="col" className="data-table__num">
                  순위
                </th>
              ) : null}
              <th scope="col">학급</th>
              <th scope="col">상태</th>
              <th scope="col">문제</th>
              <th scope="col">소요 시간</th>
              <th scope="col">남은 힌트</th>
              <th scope="col">5종 완성</th>
              {canViewResults ? <th scope="col">정답</th> : null}
              <th scope="col">관리</th>
            </tr>
          </thead>
          <tbody>
            {board.rows.map((row) => {
              const { classInfo, state, status } = row;
              const badge = CLASS_STATUS_BADGES[status];
              const started = state.startedAt !== null;
              const finished = status === 'submitted' || status === 'timeout';
              const elapsedMs = finished
                ? (state.durationMs ?? 0)
                : started
                  ? Math.min(now - (state.startedAt ?? now), session.durationLimitSec * 1000)
                  : null;
              return (
                <tr key={classInfo.id}>
                  {canViewResults ? (
                    <td className="data-table__num">
                      <span className="rank-stepper__value number">
                        {state.finalRank !== null ? `${state.finalRank}위` : '-'}
                      </span>
                      {state.manualOverride ? <div className="muted">보정됨</div> : null}
                    </td>
                  ) : null}
                  <th scope="row">
                    <Link to={paths.teacherClass(eventId, classInfo.id)}>
                      {classInfo.displayName}
                    </Link>
                  </th>
                  <td>
                    <StatusBadge tone={badge.tone} icon={badge.icon}>
                      {FINAL_CLASS_STATUS_LABELS[status]}
                    </StatusBadge>
                  </td>
                  <td className="number">
                    {started
                      ? `${Math.min(row.confirmedCount + (finished ? 0 : 1), session.questionCount)} / ${session.questionCount}`
                      : '-'}
                  </td>
                  <td className="number">
                    {elapsedMs === null ? '-' : formatClock(Math.floor(elapsedMs / 1000))}
                  </td>
                  <td className="number">
                    {started ? `${row.hintLeft} / ${state.hintTotal}` : '-'}
                  </td>
                  <td>
                    {started ? (
                      state.allFiveCardsCompletedSnapshot ? (
                        <StatusBadge tone="success" icon="check_circle">
                          완성
                        </StatusBadge>
                      ) : (
                        <span className="muted">{state.completedCardTypeCountSnapshot}종</span>
                      )
                    ) : (
                      <span className="muted">-</span>
                    )}
                  </td>
                  {canViewResults ? (
                    <td className="number">
                      {state.correctCount !== null
                        ? `${state.correctCount} / ${session.questionCount}`
                        : '-'}
                    </td>
                  ) : null}
                  <td>
                    <div className="cluster">
                      <Link
                        to={paths.teacherClassFinal(eventId, classInfo.id)}
                        className="teacher-shortcuts__link"
                      >
                        화면 열기
                      </Link>
                      {isAdmin && session.status !== 'locked' ? (
                        <>
                          {finished ? (
                            <Button
                              variant="secondary"
                              icon="edit"
                              onClick={() => setEditing({ row, action: 'adjust' })}
                            >
                              보정
                            </Button>
                          ) : (
                            <Button
                              variant="secondary"
                              icon="stop_circle"
                              onClick={() => setEditing({ row, action: 'force' })}
                            >
                              강제 마감
                            </Button>
                          )}
                          {started ? (
                            <Button
                              variant="ghost"
                              icon="restart_alt"
                              onClick={() => setEditing({ row, action: 'reset' })}
                            >
                              초기화
                            </Button>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing ? (
        <AdminActionDialog
          key={`${editing.row.classInfo.id}-${editing.action}`}
          eventId={eventId}
          row={editing.row}
          action={editing.action}
          questionCount={session.questionCount}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      ) : null}
    </section>
  );
}

const ACTION_TEXT: Record<AdminAction, { title: string; body: string; confirm: string }> = {
  adjust: {
    title: '결과 보정',
    body: '네트워크·입력 오류가 있었을 때만 고쳐요. 비워 둔 값은 바꾸지 않아요.',
    confirm: '보정 저장',
  },
  force: {
    title: '강제 마감',
    body: '지금까지 저장된 답안으로 마감해요. 고르지 않은 문제는 오답이 되고, 시작하지 못한 반은 0점·제한 시간 전체로 기록돼요.',
    confirm: '강제 마감',
  },
  reset: {
    title: '최종 미션 초기화',
    body: '이 반의 답안과 힌트 사용, 시작 시각을 모두 지우고 시작 전으로 되돌려요. 다시 시작하면 카드 스냅샷을 새로 만들어요.',
    confirm: '초기화',
  },
};

function AdminActionDialog({
  eventId,
  row,
  action,
  questionCount,
  onClose,
  onSaved,
}: {
  eventId: string;
  row: FinalBoardRow;
  action: AdminAction;
  questionCount: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const repository = useRepository();
  const reasonId = useId();
  const correctId = useId();
  const secondsId = useId();
  const rankId = useId();
  const [reason, setReason] = useState('');
  const [correct, setCorrect] = useState('');
  const [seconds, setSeconds] = useState('');
  const [rank, setRank] = useState('');
  const text = ACTION_TEXT[action];
  const classId = row.classInfo.id;

  const input = useMemo(() => {
    const toNumber = (value: string) => (value.trim() === '' ? null : Number(value));
    const secondsValue = toNumber(seconds);
    return {
      reason,
      correctCount: action === 'adjust' ? toNumber(correct) : null,
      durationMs: action === 'adjust' && secondsValue !== null ? secondsValue * 1000 : null,
      finalRank: action === 'adjust' ? toNumber(rank) : null,
    };
  }, [action, reason, correct, seconds, rank]);
  const inputError = getOverrideError(input, questionCount);

  const run = useAction(
    useCallback(async () => {
      if (action === 'adjust') {
        await repository.adjustFinalResult({ eventId, classId, ...input });
      } else if (action === 'force') {
        await repository.forceCloseClassFinal({ eventId, classId, reason });
      } else {
        await repository.resetClassFinal({ eventId, classId, reason });
      }
    }, [repository, eventId, classId, action, reason, input]),
  );

  return (
    <Dialog
      open
      title={`${row.classInfo.displayName} ${text.title}`}
      onClose={run.isPending ? () => undefined : onClose}
      footer={
        <>
          <Button
            variant="secondary"
            size="lg"
            onClick={onClose}
            disabled={run.isPending}
            data-autofocus
          >
            취소
          </Button>
          <Button
            size="lg"
            variant={action === 'adjust' ? 'primary' : 'danger'}
            icon="save"
            loading={run.isPending}
            disabled={inputError !== null}
            onClick={async () => {
              const result = await run.run();
              if (result?.ok) onSaved();
            }}
          >
            {text.confirm}
          </Button>
        </>
      }
    >
      <div className="stack">
        <p>{text.body}</p>
        {action === 'adjust' ? (
          <div className="final-adjust">
            <div>
              <label htmlFor={correctId} className="form-field__label">
                정답 수 (0~{questionCount})
              </label>
              <input
                id={correctId}
                className="text-input number"
                inputMode="numeric"
                placeholder={String(row.state.correctCount ?? '')}
                value={correct}
                onChange={(change) => setCorrect(change.target.value)}
              />
            </div>
            <div>
              <label htmlFor={secondsId} className="form-field__label">
                소요 시간(초)
              </label>
              <input
                id={secondsId}
                className="text-input number"
                inputMode="numeric"
                placeholder={String(Math.round((row.state.durationMs ?? 0) / 1000))}
                value={seconds}
                onChange={(change) => setSeconds(change.target.value)}
              />
            </div>
            <div>
              <label htmlFor={rankId} className="form-field__label">
                순위 직접 지정 (비우면 자동)
              </label>
              <input
                id={rankId}
                className="text-input number"
                inputMode="numeric"
                value={rank}
                onChange={(change) => setRank(change.target.value)}
              />
            </div>
          </div>
        ) : null}
        <div>
          <label htmlFor={reasonId} className="form-field__label">
            사유 (꼭 적어 주세요)
          </label>
          <input
            id={reasonId}
            className="text-input"
            value={reason}
            maxLength={80}
            aria-invalid={reason.trim().length < 2 || undefined}
            onChange={(change) => setReason(change.target.value)}
          />
          <p className="muted">수정한 사람과 사유가 기록에 남아요.</p>
        </div>
        {inputError && reason.trim().length >= 2 ? (
          <InlineAlert tone="danger">{inputError}</InlineAlert>
        ) : null}
        {run.status === 'error' ? (
          <InlineAlert tone="danger">{toUserMessage(run.error)}</InlineAlert>
        ) : null}
      </div>
    </Dialog>
  );
}
