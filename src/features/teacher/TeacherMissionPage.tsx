import { useCallback, useState } from 'react';
import { useParams } from 'react-router';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { StatusBadge } from '../../components/StatusBadge';
import { EmptyView, ErrorView, InlineAlert, LoadingView } from '../../components/StateViews';
import type { FinalizeRankingOutcome, MissionParticipant } from '../../data/EventRepository';
import { toUserMessage } from '../../data/errors';
import { useRepository } from '../../data/RepositoryContext';
import { getTicketCountForRank, rankByScore } from '../../domain/rewards';
import { ROUND_NUMBERS } from '../../domain/rotation';
import type { Grade, Mission, RoundNo, Submission } from '../../domain/types';
import { useAction } from '../../hooks/useAction';
import { useAsyncData } from '../../hooks/useAsyncData';
import { createRequestId } from '../../lib/random';
import { formatTimeOfDay } from '../../lib/time';
import { useTeacherContext } from './teacherContext';

export function TeacherMissionPage() {
  const { eventId, event } = useTeacherContext();
  const { missionId = '' } = useParams();
  const repository = useRepository();
  const grade = event.activeGrade;
  const [round, setRound] = useState<RoundNo>(event.activeRound === 0 ? 1 : event.activeRound);

  const load = useCallback(async () => {
    if (grade === null) return null;
    const [mission, participants, revealed] = await Promise.all([
      repository.getMission(eventId, missionId),
      repository.listMissionParticipants(eventId, missionId, grade, round),
      repository.isAnswerRevealed(eventId, missionId, grade, round),
    ]);
    return { mission, participants, revealed };
  }, [repository, eventId, missionId, grade, round]);
  const data = useAsyncData(load);

  const reveal = useAction(
    useCallback(
      async (revealed: boolean) => {
        if (grade !== null)
          await repository.setAnswerRevealed(eventId, missionId, grade, round, revealed);
      },
      [repository, eventId, missionId, grade, round],
    ),
  );

  if (grade === null) {
    return <EmptyView title="대시보드에서 진행할 학년을 먼저 골라 주세요" icon="school" />;
  }
  if (data.status === 'loading') return <LoadingView label="참가 팀을 불러오고 있어요" />;
  if (data.status === 'error') return <ErrorView error={data.error} onRetry={data.reload} />;
  if (!data.data) return null;

  const { mission, participants, revealed } = data.data;
  const finalized = participants.some((participant) => participant.result !== null);

  return (
    <>
      <div className="teacher-title">
        <div>
          <p className="muted">
            미션 {mission.no} · {mission.room} · {grade}학년
          </p>
          <h1 className="page__title">{mission.title} 운영</h1>
        </div>
        <Button variant="secondary" icon="refresh" onClick={data.reload}>
          새로고침
        </Button>
      </div>

      <div className="panel teacher-actions" style={{ justifyContent: 'space-between' }}>
        <div className="round-picker" role="group" aria-label="라운드 선택">
          <span className="muted">라운드</span>
          {ROUND_NUMBERS.map((value) => (
            <button
              key={value}
              type="button"
              className="round-picker__button number"
              aria-pressed={round === value}
              onClick={() => setRound(value)}
            >
              {value}
            </button>
          ))}
          {event.activeRound === round ? (
            <StatusBadge tone="primary" icon="play_arrow">
              현재 라운드
            </StatusBadge>
          ) : null}
        </div>
        {mission.type === 'golden_bell' ? (
          <Button
            variant={revealed ? 'secondary' : 'accent'}
            icon={revealed ? 'visibility' : 'lightbulb'}
            loading={reveal.isPending}
            onClick={async () => {
              const result = await reveal.run(!revealed);
              if (result?.ok) data.reload();
            }}
          >
            {revealed ? '정답 숨기기' : '학생 화면에 정답 공개'}
          </Button>
        ) : null}
      </div>
      {reveal.status === 'error' ? (
        <InlineAlert tone="danger">{toUserMessage(reveal.error)}</InlineAlert>
      ) : null}

      <RankingEditor
        key={`${grade}-${round}-${finalized}`}
        eventId={eventId}
        mission={mission}
        grade={grade}
        round={round}
        participants={participants}
        finalized={finalized}
        onFinalized={data.reload}
      />
    </>
  );
}

interface RankingEditorProps {
  eventId: string;
  mission: Mission;
  grade: Grade;
  round: RoundNo;
  participants: MissionParticipant[];
  finalized: boolean;
  onFinalized: () => void;
}

interface RowDraft {
  score: string;
  rank: number;
}

function initialDrafts(participants: MissionParticipant[]): Record<string, RowDraft> {
  const ranked = rankByScore(
    participants.map((participant) => ({
      teamId: participant.team.id,
      score: participant.result?.score ?? participant.submission?.score ?? 0,
      submittedAt: participant.submission?.submittedAt ?? null,
    })),
  );
  return Object.fromEntries(
    ranked.map((entry) => {
      const participant = participants.find((item) => item.team.id === entry.teamId);
      return [
        entry.teamId,
        { score: String(entry.score), rank: participant?.result?.rank ?? entry.rank },
      ];
    }),
  );
}

/** 점수·순위 수정과 순위 확정. 자동 순위는 언제든 교사가 바꿀 수 있다. */
function RankingEditor({
  eventId,
  mission,
  grade,
  round,
  participants,
  finalized,
  onFinalized,
}: RankingEditorProps) {
  const repository = useRepository();
  const [drafts, setDrafts] = useState(() => initialDrafts(participants));
  const [requestId] = useState(createRequestId);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [outcome, setOutcome] = useState<FinalizeRankingOutcome | null>(null);

  const finalize = useAction(
    useCallback(
      () =>
        repository.finalizeRanking({
          eventId,
          missionId: mission.id,
          grade,
          roundNo: round,
          requestId,
          entries: participants.map((participant) => ({
            teamId: participant.team.id,
            score: Number(drafts[participant.team.id].score),
            rank: drafts[participant.team.id].rank,
          })),
        }),
      [repository, eventId, mission.id, grade, round, requestId, participants, drafts],
    ),
  );

  if (participants.length === 0) {
    return <EmptyView title="이 라운드에 참가하는 팀이 없어요" />;
  }

  const scoreInvalid = participants.some((participant) => {
    const value = Number(drafts[participant.team.id].score);
    return drafts[participant.team.id].score.trim() === '' || !Number.isFinite(value) || value < 0;
  });

  const rows = [...participants].sort(
    (a, b) => drafts[a.team.id].rank - drafts[b.team.id].rank || a.team.classNo - b.team.classNo,
  );

  const updateDraft = (teamId: string, patch: Partial<RowDraft>) =>
    setDrafts((previous) => ({ ...previous, [teamId]: { ...previous[teamId], ...patch } }));

  const autoRank = () => {
    const ranked = rankByScore(
      participants.map((participant) => ({
        teamId: participant.team.id,
        score: Number(drafts[participant.team.id].score) || 0,
        submittedAt: participant.submission?.submittedAt ?? null,
      })),
    );
    setDrafts((previous) => {
      const next = { ...previous };
      for (const entry of ranked) next[entry.teamId] = { ...next[entry.teamId], rank: entry.rank };
      return next;
    });
  };

  const submittedCount = participants.filter(
    (participant) => participant.submission && participant.submission.status !== 'draft',
  ).length;
  const totalTickets = participants.reduce((sum, participant) => sum + participant.ticketCount, 0);

  return (
    <section className="stack" aria-labelledby="ranking-title">
      <div className="teacher-title">
        <h2 id="ranking-title" className="section-title">
          <Icon name="leaderboard" /> {round}라운드 참가 팀
          <StatusBadge
            tone={submittedCount === participants.length ? 'info' : 'warning'}
            icon="groups"
          >
            제출 {submittedCount}/{participants.length}
          </StatusBadge>
        </h2>
        {finalized ? (
          <StatusBadge tone="success" icon="trophy" size="lg">
            순위 확정됨 · 뽑기권 {totalTickets}장 발급
          </StatusBadge>
        ) : null}
      </div>

      {outcome && !outcome.alreadyFinalized ? (
        <InlineAlert tone="success">
          순위를 확정했어요. 뽑기권{' '}
          {Object.values(outcome.ticketsByTeam).reduce((sum, count) => sum + count, 0)}장을
          만들었어요.
        </InlineAlert>
      ) : null}
      {mission.type === 'ozobot' && !finalized ? (
        <InlineAlert tone="info">
          완주 시간과 재시도 횟수를 반영한 점수를 입력한 뒤 순위를 정해 주세요.
        </InlineAlert>
      ) : null}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col" className="data-table__num">
                순위
              </th>
              <th scope="col">팀</th>
              <th scope="col">제출</th>
              <th scope="col">답안</th>
              <th scope="col" className="data-table__num">
                점수
              </th>
              <th scope="col" className="data-table__num">
                뽑기권
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((participant) => {
              const { team, submission } = participant;
              const draft = drafts[team.id];
              const missing = !submission || submission.status === 'draft';
              return (
                <tr key={team.id} className={missing ? 'data-table__row--missing' : undefined}>
                  <td className="data-table__num">
                    {finalized ? (
                      <span className="rank-stepper__value number">
                        {participant.result?.rank ?? '-'}위
                      </span>
                    ) : (
                      <span className="rank-stepper">
                        <button
                          type="button"
                          className="rank-stepper__button"
                          aria-label={`${team.displayName} 순위 올리기`}
                          disabled={draft.rank <= 1}
                          onClick={() => updateDraft(team.id, { rank: draft.rank - 1 })}
                        >
                          <Icon name="arrow_upward" />
                        </button>
                        <span className="rank-stepper__value number">{draft.rank}위</span>
                        <button
                          type="button"
                          className="rank-stepper__button"
                          aria-label={`${team.displayName} 순위 내리기`}
                          disabled={draft.rank >= participants.length}
                          onClick={() => updateDraft(team.id, { rank: draft.rank + 1 })}
                        >
                          <Icon name="arrow_downward" />
                        </button>
                      </span>
                    )}
                  </td>
                  <th scope="row">{team.displayName}</th>
                  <td>
                    {missing ? (
                      <StatusBadge tone="warning" icon="warning">
                        미제출
                      </StatusBadge>
                    ) : submission.status === 'verified' ? (
                      <StatusBadge tone="success" icon="task_alt">
                        확인
                      </StatusBadge>
                    ) : (
                      <StatusBadge tone="info" icon="check_circle">
                        제출
                      </StatusBadge>
                    )}
                    <div className="muted number">
                      {formatTimeOfDay(submission?.submittedAt ?? null)}
                    </div>
                  </td>
                  <td className="answer-summary">{summarizeAnswer(mission, submission)}</td>
                  <td className="data-table__num">
                    {finalized ? (
                      <span className="number">{participant.result?.score}</span>
                    ) : (
                      <input
                        className="table-input number"
                        inputMode="numeric"
                        aria-label={`${team.displayName} 점수`}
                        aria-invalid={
                          draft.score.trim() === '' ||
                          Number(draft.score) < 0 ||
                          Number.isNaN(Number(draft.score)) ||
                          undefined
                        }
                        value={draft.score}
                        onChange={(change) => updateDraft(team.id, { score: change.target.value })}
                      />
                    )}
                  </td>
                  <td className="data-table__num">
                    <span className={finalized ? 'ticket-chip' : 'muted'}>
                      <Icon name="playing_cards" size="sm" />×
                      {finalized ? participant.ticketCount : getTicketCountForRank(draft.rank)}
                      {finalized ? '' : ' 예정'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {finalized ? null : (
        <>
          {scoreInvalid ? (
            <InlineAlert tone="danger">점수는 0 이상의 숫자로 입력해 주세요.</InlineAlert>
          ) : null}
          {finalize.status === 'error' ? (
            <InlineAlert tone="danger">{toUserMessage(finalize.error)}</InlineAlert>
          ) : null}
          <div className="teacher-actions">
            <Button
              variant="secondary"
              size="lg"
              icon="sort"
              onClick={autoRank}
              disabled={scoreInvalid}
            >
              점수로 자동 정렬
            </Button>
            <Button
              size="lg"
              icon="trophy"
              onClick={() => setConfirmOpen(true)}
              disabled={scoreInvalid}
            >
              순위 확정
            </Button>
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={`${round}라운드 ${mission.title} 순위를 확정할까요?`}
        confirmLabel="순위 확정"
        confirmIcon="trophy"
        loading={finalize.isPending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={async () => {
          const result = await finalize.run();
          setConfirmOpen(false);
          if (result?.ok) {
            setOutcome(result.value);
            onFinalized();
          }
        }}
      >
        <p>확정하면 순위에 따라 뽑기권이 만들어져요. (1위 3장, 2위 2장, 나머지 1장)</p>
        <ul className="exchange-log">
          {rows.map((participant) => (
            <li key={participant.team.id} className="exchange-log__item">
              <strong>{drafts[participant.team.id].rank}위</strong> {participant.team.displayName}
              <span className="ticket-chip">
                <Icon name="playing_cards" size="sm" />×
                {getTicketCountForRank(drafts[participant.team.id].rank)}
              </span>
            </li>
          ))}
        </ul>
      </ConfirmDialog>
    </section>
  );
}

function summarizeAnswer(mission: Mission, submission: Submission | null) {
  if (!submission) return '-';
  const answer = submission.answer;
  const config = mission.config;
  switch (answer.type) {
    case 'golden_bell': {
      const correct = config.type === 'golden_bell' && config.answerIndex === answer.choiceIndex;
      return `${answer.choiceIndex + 1}번 선택 · ${correct ? '정답' : '오답'}`;
    }
    case 'error_hunt': {
      const total = config.type === 'error_hunt' ? config.regions.length : '?';
      return `찾음 ${answer.foundRegionIds.length}/${total} · 오답 ${answer.wrongTaps}번 · 남은 ${answer.remainingSeconds}초`;
    }
    case 'drawing':
      return answer.previewDataUrl ? (
        <img src={answer.previewDataUrl} alt="제출한 그림" width={120} height={68} />
      ) : (
        `그림 제출 (선 ${answer.strokeCount}개)`
      );
    case 'ozobot':
      return '시작 준비 완료';
    case 'library_check':
      return `틀린 부분: ${answer.wrongPart} / 수정: ${answer.correction} / 『${answer.bookTitle}』 ${answer.page}쪽`;
  }
}
