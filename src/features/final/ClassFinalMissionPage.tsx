import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { paths } from '../../app/paths';
import { useSettings } from '../../app/SettingsContext';
import { AssetImage } from '../../components/AssetImage';
import { Button, ButtonLink } from '../../components/Button';
import { ConfirmDialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { StatusBadge } from '../../components/StatusBadge';
import { ErrorView, InlineAlert, LoadingView } from '../../components/StateViews';
import type { ClassFinalView } from '../../data/EventRepository';
import { toUserMessage } from '../../data/errors';
import { useRepository } from '../../data/RepositoryContext';
import { CARD_INFO } from '../../domain/catalog';
import { FINAL_CLASS_STATUS_LABELS, getFinalDeadline } from '../../domain/finalMission';
import type { FinalQuestion } from '../../domain/types';
import { useAction } from '../../hooks/useAction';
import { useAsyncData } from '../../hooks/useAsyncData';
import { useFinalLive } from '../../hooks/useFinalLive';
import { useServerNow } from '../../hooks/useServerNow';
import { createRequestId } from '../../lib/random';
import { formatClock, formatSpokenDuration } from '../../lib/time';
import { useTeacherContext } from '../teacher/teacherContext';
import './Final.css';

/** 전자칠판용 학급 최종 미션: 학급 전체가 한 화면으로 4지선다 10문제를 함께 푼다. */
export function ClassFinalMissionPage() {
  const { eventId } = useTeacherContext();
  const { classId = '' } = useParams();
  const repository = useRepository();
  const load = useCallback(
    () => repository.getClassFinalView(eventId, classId),
    [repository, eventId, classId],
  );
  const loaded = useAsyncData(load);

  // 문제를 풀 때마다 저장소가 돌려준 최신 화면을 쓴다. 다시 읽으면 읽은 값으로 돌아간다.
  const [latest, setLatest] = useState<{ source: unknown; view: ClassFinalView } | null>(null);
  const source = loaded.status === 'success' ? loaded.data : null;
  const view = latest && latest.source === source ? latest.view : source;
  const update = useCallback((next: ClassFinalView) => setLatest({ source, view: next }), [source]);

  // 총괄 선생님의 초기화·강제 마감·결과 공개가 생기면 다시 읽는다.
  const revision = useFinalLive(eventId, view?.classInfo.grade ?? null, classId);
  const [seenRevision, setSeenRevision] = useState(revision);
  if (seenRevision !== revision) {
    setSeenRevision(revision);
    if (loaded.status === 'success') loaded.reload();
  }

  if (loaded.status === 'loading') return <LoadingView label="최종 미션을 준비하고 있어요" />;
  if (loaded.status === 'error') return <ErrorView error={loaded.error} onRetry={loaded.reload} />;
  if (!view) return null;

  const classPath = paths.teacherClass(eventId, view.classInfo.id);
  return (
    <div className="final-board">
      <FinalHeader view={view} onExpired={update} eventId={eventId} />
      {view.status === 'locked' || view.status === 'ready' ? (
        <section className="panel final-board__notice">
          <Icon name={view.status === 'locked' ? 'lock' : 'hourglass_top'} size="xl" />
          <h2>
            {view.status === 'locked'
              ? '총괄 선생님이 최종 미션을 열면 시작할 수 있어요'
              : '아직 최종 미션을 시작하지 않았어요'}
          </h2>
          <ButtonLink to={classPath} size="xl" icon="school">
            학급 화면에서 시작하기
          </ButtonLink>
        </section>
      ) : null}
      {view.question ? (
        <QuestionPanel
          // 문제가 바뀌면 요청 ID와 입력 상태를 새로 시작한다.
          key={view.question.id}
          eventId={eventId}
          view={view}
          question={view.question}
          onUpdate={update}
        />
      ) : null}
      {view.status === 'submitted' || view.status === 'timeout' ? (
        <FinishedPanel view={view} classPath={classPath} eventId={eventId} />
      ) : null}
    </div>
  );
}

function FinalHeader({
  view,
  eventId,
  onExpired,
}: {
  view: ClassFinalView;
  eventId: string;
  onExpired: (view: ClassFinalView) => void;
}) {
  const repository = useRepository();
  const now = useServerNow(500);
  const { session, state, classInfo } = view;
  const active = state.status === 'active';
  const deadline = getFinalDeadline(session, state);
  const remainingSeconds =
    active && deadline !== null
      ? Math.max(0, Math.ceil((deadline - now) / 1000))
      : session.durationLimitSec;
  const hintLeft = Math.max(0, state.hintTotal - state.hintUsed);

  // 제한 시간이 끝나면 저장된 답안으로 한 번만 마감을 요청한다.
  const closing = useRef(false);
  const expired = active && deadline !== null && now >= deadline;
  useEffect(() => {
    if (!expired || closing.current || !view.canRunFinal) return;
    closing.current = true;
    repository
      .closeExpiredClassFinal(eventId, classInfo.id)
      .then(onExpired)
      .catch(() => {
        // 실패하면 다음 갱신 때 다시 시도한다. 총괄 대시보드에는 제출 확인 필요로 보인다.
        closing.current = false;
      });
  }, [expired, repository, eventId, classInfo.id, onExpired, view.canRunFinal]);

  const questionNo = Math.min(state.currentQuestionIndex + 1, session.questionCount);
  return (
    <header className="final-board__header">
      <div>
        <p className="final-board__class">
          <Icon name="trophy" /> {classInfo.displayName} 최종 미션
        </p>
        <p className="final-board__progress number" aria-live="polite">
          {active
            ? `문제 ${questionNo} / ${session.questionCount}`
            : FINAL_CLASS_STATUS_LABELS[view.status]}
        </p>
      </div>
      <dl className="final-board__meters">
        <div
          className={`final-meter${active && remainingSeconds <= 60 ? ' final-meter--warning' : ''}`}
        >
          <dt>
            <Icon name="timer" size="sm" /> 남은 시간
          </dt>
          <dd
            className="number"
            role="timer"
            aria-label={`남은 시간 ${formatSpokenDuration(remainingSeconds)}`}
          >
            {formatClock(remainingSeconds)}
          </dd>
        </div>
        <div className="final-meter">
          <dt>
            <Icon name="lightbulb" size="sm" /> 남은 힌트
          </dt>
          <dd className="number">
            {active || state.startedAt !== null ? `${hintLeft} / ${state.hintTotal}` : '-'}
          </dd>
        </div>
      </dl>
    </header>
  );
}

function QuestionPanel({
  eventId,
  view,
  question,
  onUpdate,
}: {
  eventId: string;
  view: ClassFinalView;
  question: FinalQuestion;
  onUpdate: (view: ClassFinalView) => void;
}) {
  const repository = useRepository();
  const { playEffect } = useSettings();
  const classId = view.classInfo.id;
  const { session, state, response, canRunFinal } = view;
  const [hintRequestId] = useState(createRequestId);
  const [confirmRequestId] = useState(createRequestId);
  const [confirmHint, setConfirmHint] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  /** 저장 응답을 기다리는 동안에도 고른 보기를 바로 보여 준다. 저장에 실패해도 선택은 남긴다. */
  const [picked, setPicked] = useState<string | null>(null);

  const select = useAction(
    useCallback(
      (choiceId: string) =>
        repository.selectFinalChoice({ eventId, classId, questionId: question.id, choiceId }),
      [repository, eventId, classId, question.id],
    ),
  );
  const hint = useAction(
    useCallback(
      () =>
        repository.applyFinalHint({
          eventId,
          classId,
          questionId: question.id,
          requestId: hintRequestId,
        }),
      [repository, eventId, classId, question.id, hintRequestId],
    ),
  );
  const confirm = useAction(
    useCallback(
      () =>
        repository.confirmFinalAnswer({
          eventId,
          classId,
          questionId: question.id,
          requestId: confirmRequestId,
        }),
      [repository, eventId, classId, question.id, confirmRequestId],
    ),
  );

  const removedChoiceId = response?.removedChoiceId ?? null;
  const savedChoiceId = response?.selectedChoiceId ?? null;
  const selectedChoiceId = picked !== null && picked !== removedChoiceId ? picked : savedChoiceId;
  const isLast = state.currentQuestionIndex + 1 >= session.questionCount;
  const hintLeft = Math.max(0, state.hintTotal - state.hintUsed);
  const hintUsedHere = response?.hintUsed ?? false;
  const busy = select.isPending || hint.isPending || confirm.isPending;
  const unsaved = selectedChoiceId !== null && selectedChoiceId !== savedChoiceId;

  const choose = async (choiceId: string) => {
    setPicked(choiceId);
    const result = await select.run(choiceId);
    if (result?.ok) {
      onUpdate(result.value);
      playEffect('tap');
    }
  };

  const applyHint = async () => {
    const result = await hint.run();
    setConfirmHint(false);
    if (result?.ok) {
      setPicked(null);
      onUpdate(result.value);
      playEffect('success');
    } else if (result) {
      playEffect('error');
    }
  };

  const confirmAnswer = async () => {
    // 저장하지 못한 선택이 있으면 같은 선택을 먼저 다시 저장한다.
    if (unsaved && selectedChoiceId !== null) {
      const saved = await select.run(selectedChoiceId);
      if (!saved?.ok) {
        setConfirmSubmit(false);
        return;
      }
    }
    const result = await confirm.run();
    setConfirmSubmit(false);
    if (result?.ok) {
      onUpdate(result.value);
      playEffect(isLast ? 'success' : 'tap');
    } else if (result) {
      playEffect('error');
    }
  };

  const actionError =
    confirm.status === 'error'
      ? confirm.error
      : hint.status === 'error'
        ? hint.error
        : select.status === 'error'
          ? select.error
          : null;

  return (
    <section className="final-question" aria-labelledby="final-question-text">
      <p className="final-question__area">
        <StatusBadge tone="accent" icon="quiz" size="lg">
          {CARD_INFO[question.area].name.replace(' 카드', '')} 영역
        </StatusBadge>
      </p>
      <h2 id="final-question-text" className="final-question__text">
        {question.text}
      </h2>
      {question.passage ? <p className="final-question__passage">{question.passage}</p> : null}

      <fieldset className="final-choices" disabled={!canRunFinal}>
        <legend className="visually-hidden">보기 고르기</legend>
        {question.choices.map((choice, index) => {
          const removed = removedChoiceId === choice.id;
          const selected = selectedChoiceId === choice.id;
          const classes = ['final-choice'];
          if (selected) classes.push('final-choice--selected');
          if (removed) classes.push('final-choice--removed');
          return (
            <button
              key={choice.id}
              type="button"
              className={classes.join(' ')}
              aria-pressed={selected}
              disabled={removed || confirm.isPending || hint.isPending}
              onClick={() => void choose(choice.id)}
            >
              <span className="final-choice__no number">{index + 1}</span>
              <span className="final-choice__label">{choice.label}</span>
              {selected ? <Icon name="check_circle" size="lg" /> : null}
              {removed ? (
                <span className="final-choice__removed">
                  <Icon name="do_not_disturb_on" size="sm" /> 힌트로 지운 보기
                </span>
              ) : null}
            </button>
          );
        })}
      </fieldset>

      {actionError ? (
        <InlineAlert tone="danger">
          {toUserMessage(actionError)} 고른 답은 그대로 있어요. 다시 눌러 주세요.
        </InlineAlert>
      ) : null}
      {!canRunFinal ? (
        <InlineAlert tone="info" icon="visibility">
          이 학급의 담임 선생님과 총괄 선생님만 문제를 풀 수 있어요. 지금은 보기 전용이에요.
        </InlineAlert>
      ) : null}

      <div className="final-question__actions">
        <Button
          variant="secondary"
          size="xl"
          icon="lightbulb"
          disabled={!canRunFinal || hintUsedHere || hintLeft === 0 || busy}
          onClick={() => setConfirmHint(true)}
        >
          {hintUsedHere ? '이 문제는 힌트 사용함' : `힌트 사용 (남은 ${hintLeft}개)`}
        </Button>
        <Button
          size="xl"
          icon={isLast ? 'send' : 'arrow_forward'}
          disabled={!canRunFinal || selectedChoiceId === null || hint.isPending}
          loading={confirm.isPending}
          onClick={() => (isLast ? setConfirmSubmit(true) : void confirmAnswer())}
        >
          {isLast ? '답 확정하고 제출하기' : '답 확정하고 다음 문제로'}
        </Button>
      </div>
      <p className="muted">답을 확정하면 되돌릴 수 없어요. 정답 여부는 끝난 뒤에 알 수 있어요.</p>

      <ConfirmDialog
        open={confirmHint}
        title="힌트를 쓸까요?"
        confirmLabel="힌트 쓰기"
        confirmIcon="lightbulb"
        loading={hint.isPending}
        onCancel={() => setConfirmHint(false)}
        onConfirm={() => void applyHint()}
      >
        <p>
          이 문제의 틀린 보기 하나가 사라져요. 힌트는 <strong>{hintLeft}개</strong> 남았고, 한
          문제에 한 번만 쓸 수 있어요.
        </p>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirmSubmit}
        title="마지막 문제예요. 제출할까요?"
        confirmLabel="제출하기"
        confirmIcon="send"
        loading={confirm.isPending || select.isPending}
        onCancel={() => setConfirmSubmit(false)}
        onConfirm={() => void confirmAnswer()}
      >
        <p>답을 확정하면 10문제 전체가 제출되고 시간이 멈춰요.</p>
      </ConfirmDialog>
    </section>
  );
}

function FinishedPanel({
  view,
  classPath,
  eventId,
}: {
  view: ClassFinalView;
  classPath: string;
  eventId: string;
}) {
  const { state, session, canViewResults, classInfo } = view;
  const seconds = Math.round((state.durationMs ?? 0) / 1000);
  return (
    <section className="final-finished" aria-labelledby="final-finished-title" role="status">
      <AssetImage
        asset="sceneFinale"
        decorative
        className="final-finished__image"
        loading="eager"
      />
      <div className="final-finished__body">
        <p className="final-finished__kicker">
          <Icon name={view.status === 'timeout' ? 'timer_off' : 'check_circle'} />{' '}
          {view.status === 'timeout'
            ? '시간이 끝나 저장된 답안으로 마감했어요'
            : '10문제 제출 완료'}
        </p>
        <h2 id="final-finished-title" className="final-finished__title">
          {classInfo.displayName}, 수고했어요!
        </h2>
        <p className="final-finished__time">
          소요 시간 <strong className="number">{formatClock(seconds)}</strong> · 힌트{' '}
          <strong className="number">
            {state.hintUsed}/{state.hintTotal}
          </strong>{' '}
          사용
        </p>
        {canViewResults && state.correctCount !== null ? (
          <p className="final-finished__score">
            정답 <strong className="number">{state.correctCount}</strong> / {session.questionCount}
            {state.finalRank !== null ? (
              <>
                {' '}
                · {classInfo.grade}학년 <strong className="number">{state.finalRank}위</strong>
              </>
            ) : null}
          </p>
        ) : (
          <p className="final-finished__hidden">
            <Icon name="visibility_off" /> 점수와 순위는 같은 학년의 모든 반이 끝난 뒤 총괄 선생님이
            공개해요.
          </p>
        )}
        <div className="cluster">
          <ButtonLink to={classPath} variant="secondary" size="lg" icon="school">
            학급 화면
          </ButtonLink>
          <ButtonLink to={paths.finalResults(eventId)} size="lg" icon="leaderboard">
            최종 미션 현황
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
