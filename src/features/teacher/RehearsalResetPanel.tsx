import { useCallback, useId, useState } from 'react';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { ErrorView, InlineAlert, LoadingView } from '../../components/StateViews';
import { toUserMessage } from '../../data/errors';
import { useRepository } from '../../data/RepositoryContext';
import {
  getResetConfirmPhrase,
  hasRehearsalRecords,
  isResetConfirmed,
  REHEARSAL_RECORD_KEYS,
  REHEARSAL_RECORD_LABELS,
} from '../../domain/rehearsal';
import type { FestivalEvent, Grade } from '../../domain/types';
import { useAction } from '../../hooks/useAction';
import { useAsyncData } from '../../hooks/useAsyncData';

const GRADES: Grade[] = [3, 4, 5, 6];

interface RehearsalResetPanelProps {
  eventId: string;
  event: FestivalEvent;
}

/**
 * 연습(리허설)에서 남은 기록을 학년별로 지운다. 총괄 운영자만 쓴다.
 * 되살릴 수 없으므로 남은 기록 수를 먼저 보여 주고, 확인 창에 학년을 직접 적게 한다.
 */
export function RehearsalResetPanel({ eventId, event }: RehearsalResetPanelProps) {
  const repository = useRepository();
  const inputId = useId();
  const [grade, setGrade] = useState<Grade>(event.activeGrade ?? 3);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [doneGrade, setDoneGrade] = useState<Grade | null>(null);

  const load = useCallback(
    () => repository.getRehearsalSummary(eventId, grade),
    [repository, eventId, grade],
  );
  const summary = useAsyncData(load);
  const reset = useAction(
    useCallback(
      (value: Grade) => repository.resetRehearsal({ eventId, grade: value }),
      [repository, eventId],
    ),
  );

  const phrase = getResetConfirmPhrase(grade);
  const confirmed = isResetConfirmed(grade, typed);
  const hasRecords = summary.status === 'success' && hasRehearsalRecords(summary.data);

  const pickGrade = (value: Grade) => {
    setGrade(value);
    setDoneGrade(null);
  };

  const close = () => {
    setConfirmOpen(false);
    setTyped('');
  };

  const run = async () => {
    if (!confirmed) return;
    const result = await reset.run(grade);
    close();
    if (result?.ok) {
      setDoneGrade(grade);
      summary.reload();
    }
  };

  return (
    <section className="panel stack" aria-labelledby="admin-reset-title">
      <h2 id="admin-reset-title" className="section-title">
        <Icon name="restart_alt" /> 연습 기록 지우기
      </h2>
      <p className="muted">
        연습에서 남은 기록을 학년별로 지워 행사를 처음 상태에서 시작해요. 학급·팀·미션 문제, 최종
        미션 문제와 정답, 교사 계정, 게임 시간은 지우지 않아요.
      </p>

      <div className="segmented" role="group" aria-label="기록을 지울 학년">
        {GRADES.map((value) => (
          <button
            key={value}
            type="button"
            className="segmented__button"
            aria-pressed={grade === value}
            disabled={reset.isPending}
            onClick={() => pickGrade(value)}
          >
            {value}학년
          </button>
        ))}
      </div>

      {summary.status === 'loading' ? <LoadingView label="남은 기록을 세고 있어요" /> : null}
      {summary.status === 'error' ? (
        <ErrorView error={summary.error} onRetry={summary.reload} />
      ) : null}
      {summary.status === 'success' ? (
        <>
          <dl className="control-bar__facts reset-counts" aria-label={`${grade}학년에 남은 기록`}>
            {REHEARSAL_RECORD_KEYS.map((key) => (
              <div key={key}>
                <dt>{REHEARSAL_RECORD_LABELS[key].label}</dt>
                <dd className="number">
                  {summary.data.counts[key]}
                  {REHEARSAL_RECORD_LABELS[key].unit}
                </dd>
              </div>
            ))}
            <div>
              <dt>최종 미션</dt>
              <dd>{summary.data.finalOpened ? '열어 둠' : '열기 전'}</dd>
            </div>
          </dl>
          {doneGrade === grade && !hasRecords ? (
            <InlineAlert tone="success">{grade}학년 기록을 지웠어요.</InlineAlert>
          ) : null}
          {doneGrade !== grade && !hasRecords ? (
            <InlineAlert tone="success">{grade}학년에는 지울 기록이 없어요.</InlineAlert>
          ) : null}
          {hasRecords && event.activeGrade === grade ? (
            <InlineAlert tone="warning">
              {grade}학년은 지금 진행 학년이에요. 진행 중인 라운드의 기록도 함께 지워져요.
            </InlineAlert>
          ) : null}
        </>
      ) : null}
      {reset.status === 'error' ? (
        <InlineAlert tone="danger">{toUserMessage(reset.error)}</InlineAlert>
      ) : null}

      <div className="cluster">
        <Button
          variant="danger"
          size="lg"
          icon="delete"
          disabled={!hasRecords}
          loading={reset.isPending}
          loadingLabel="지우는 중"
          onClick={() => setConfirmOpen(true)}
        >
          {grade}학년 기록 지우기
        </Button>
        <Button variant="secondary" icon="refresh" onClick={summary.reload}>
          다시 세기
        </Button>
      </div>

      <Dialog
        open={confirmOpen}
        title={`${grade}학년의 기록을 모두 지울까요?`}
        onClose={reset.isPending ? () => undefined : close}
        footer={
          <>
            <Button variant="secondary" size="lg" onClick={close} disabled={reset.isPending}>
              취소
            </Button>
            <Button
              variant="danger"
              size="lg"
              icon="delete"
              disabled={!confirmed}
              loading={reset.isPending}
              loadingLabel="지우는 중"
              onClick={() => void run()}
            >
              {grade}학년 기록 지우기
            </Button>
          </>
        }
      >
        <div className="stack">
          <p>
            {grade}학년의 제출과 그림, 순위, 카드 보상, 교실 입장 기록, 부스 라운드, 정답 공개 상태,
            최종 미션 진행 기록을 지우고 팀에 묶인 기기를 풀어요.
          </p>
          <p>
            <strong>지운 기록은 되살릴 수 없어요.</strong> 학생 기기는 팀 QR로 다시 입장해야 해요.
          </p>
          <label htmlFor={inputId}>확인을 위해 “{phrase}”이라고 적어 주세요</label>
          <input
            id={inputId}
            className="text-input"
            type="text"
            autoComplete="off"
            data-autofocus
            value={typed}
            placeholder={phrase}
            onChange={(change) => setTyped(change.target.value)}
            onKeyDown={(press) => {
              if (press.key === 'Enter') void run();
            }}
          />
        </div>
      </Dialog>
    </section>
  );
}
