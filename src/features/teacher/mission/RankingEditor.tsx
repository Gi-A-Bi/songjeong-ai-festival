import { useCallback, useState } from 'react';
import { Button } from '../../../components/Button';
import { ConfirmDialog } from '../../../components/Dialog';
import { Icon } from '../../../components/Icon';
import { InlineAlert } from '../../../components/StateViews';
import { StatusBadge } from '../../../components/StatusBadge';
import type { FinalizeRankingInput, MissionParticipant } from '../../../data/EventRepository';
import { toUserMessage } from '../../../data/errors';
import { useRepository } from '../../../data/RepositoryContext';
import { previewTicketChange } from '../../../domain/cards';
import { getTicketCountForRank, rankByScore } from '../../../domain/rewards';
import type { Grade, Mission, RoundNo } from '../../../domain/types';
import { useAction } from '../../../hooks/useAction';
import { createRequestId } from '../../../lib/random';
import { formatTimeOfDay } from '../../../lib/time';
import { AnswerSummary } from './answerSummary';

interface RankingEditorProps {
  eventId: string;
  mission: Mission;
  grade: Grade;
  round: RoundNo;
  participants: MissionParticipant[];
  finalized: boolean;
  /** 저장이 끝나면 화면 위쪽에 보여 줄 안내와 함께 다시 불러온다. */
  onChanged: (message: string) => void;
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

function isSubmitted(participant: MissionParticipant): boolean {
  return participant.submission !== null && participant.submission.status !== 'draft';
}

/**
 * 점수·순위 수정과 순위 확정. 자동 순위는 언제든 교사가 바꿀 수 있다.
 * 확정 전에는 제출을 되돌릴 수 있고, 확정 후에는 순위를 고치면 뽑기권 수도 맞춰진다.
 */
export function RankingEditor({
  eventId,
  mission,
  grade,
  round,
  participants,
  finalized,
  onChanged,
}: RankingEditorProps) {
  const repository = useRepository();
  const [drafts, setDrafts] = useState(() => initialDrafts(participants));
  const [requestId] = useState(createRequestId);
  const [editing, setEditing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reopenTarget, setReopenTarget] = useState<MissionParticipant | null>(null);

  const buildInput = useCallback(
    (): FinalizeRankingInput => ({
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
    [eventId, mission.id, grade, round, requestId, participants, drafts],
  );

  const finalize = useAction(
    useCallback(() => repository.finalizeRanking(buildInput()), [repository, buildInput]),
  );
  const revise = useAction(
    useCallback(() => repository.reviseRanking(buildInput()), [repository, buildInput]),
  );
  const reopen = useAction(
    useCallback(
      (teamId: string) => repository.reopenSubmission({ eventId, missionId: mission.id, teamId }),
      [repository, eventId, mission.id],
    ),
  );

  if (participants.length === 0) {
    return <InlineAlert tone="info">이 라운드에 참가하는 팀이 없어요.</InlineAlert>;
  }

  const editable = !finalized || editing;
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

  const changeOf = (participant: MissionParticipant) =>
    previewTicketChange(
      participant.ticketCount,
      participant.claimedTicketCount,
      getTicketCountForRank(drafts[participant.team.id].rank),
    );
  const totalChange = participants.reduce(
    (sum, participant) => {
      const change = changeOf(participant);
      return {
        added: sum.added + change.added,
        revoked: sum.revoked + change.revoked,
        revokedClaimed: sum.revokedClaimed + change.revokedClaimed,
      };
    },
    { added: 0, revoked: 0, revokedClaimed: 0 },
  );

  const submittedCount = participants.filter(isSubmitted).length;
  const totalTickets = participants.reduce((sum, participant) => sum + participant.ticketCount, 0);
  const actionError =
    finalize.status === 'error'
      ? finalize.error
      : revise.status === 'error'
        ? revise.error
        : reopen.status === 'error'
          ? reopen.error
          : null;

  const handleConfirm = async () => {
    if (finalized) {
      const result = await revise.run();
      setConfirmOpen(false);
      if (result?.ok) {
        const { added, revoked, revokedClaimed } = result.value;
        onChanged(
          `순위를 고쳤어요. 뽑기권 새로 발급 ${added}장, 회수 ${revoked}장` +
            (revokedClaimed > 0 ? ` (이미 뽑은 카드 ${revokedClaimed}장 포함)` : ''),
        );
      }
      return;
    }
    const result = await finalize.run();
    setConfirmOpen(false);
    if (result?.ok) {
      const count = Object.values(result.value.ticketsByTeam).reduce(
        (sum, value) => sum + value,
        0,
      );
      onChanged(`순위를 확정했어요. 뽑기권 ${count}장을 만들었어요.`);
    }
  };

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
            {editing ? '순위 수정 중' : `순위 확정됨 · 뽑기권 ${totalTickets}장`}
          </StatusBadge>
        ) : null}
      </div>

      {mission.type === 'ozobot' && editable ? (
        <InlineAlert tone="info">
          완주 시간과 재시도 횟수를 반영한 점수를 입력한 뒤 순위를 정해 주세요.
        </InlineAlert>
      ) : null}
      {mission.type === 'drawing' && editable ? (
        <InlineAlert tone="info">
          위의 AI 평가 결과는 참고만 하고, 점수와 순위는 선생님이 정해 주세요.
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
              {!finalized ? <th scope="col">관리</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((participant) => {
              const { team, submission } = participant;
              const draft = drafts[team.id];
              const submitted = isSubmitted(participant);
              const change = changeOf(participant);
              return (
                <tr key={team.id} className={submitted ? undefined : 'data-table__row--missing'}>
                  <td className="data-table__num">
                    {editable ? (
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
                    ) : (
                      <span className="rank-stepper__value number">
                        {participant.result?.rank ?? '-'}위
                      </span>
                    )}
                  </td>
                  <th scope="row">{team.displayName}</th>
                  <td>
                    {submission?.status === 'draft' ? (
                      <StatusBadge tone="warning" icon="restart_alt">
                        재제출 대기
                      </StatusBadge>
                    ) : !submitted ? (
                      <StatusBadge tone="warning" icon="warning">
                        미제출
                      </StatusBadge>
                    ) : submission?.status === 'verified' ? (
                      <StatusBadge tone="success" icon="task_alt">
                        확인
                      </StatusBadge>
                    ) : (
                      <StatusBadge tone="info" icon="check_circle">
                        제출
                      </StatusBadge>
                    )}
                    <div className="muted number">
                      {formatTimeOfDay(submitted ? (submission?.submittedAt ?? null) : null)}
                    </div>
                  </td>
                  <td className="answer-summary">
                    <AnswerSummary mission={mission} submission={submission} />
                  </td>
                  <td className="data-table__num">
                    {editable ? (
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
                    ) : (
                      <span className="number">{participant.result?.score}</span>
                    )}
                  </td>
                  <td className="data-table__num">
                    {!finalized ? (
                      <span className="muted">
                        <Icon name="playing_cards" size="sm" />×{getTicketCountForRank(draft.rank)}{' '}
                        예정
                      </span>
                    ) : editing ? (
                      <span className="ticket-chip">
                        <Icon name="playing_cards" size="sm" />×{getTicketCountForRank(draft.rank)}
                        {change.added > 0 ? (
                          <span className="muted"> (+{change.added})</span>
                        ) : null}
                        {change.revoked > 0 ? (
                          <span className="ticket-chip__revoke">
                            {' '}
                            (−{change.revoked}
                            {change.revokedClaimed > 0
                              ? `, 뽑은 카드 ${change.revokedClaimed}장`
                              : ''}
                            )
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="ticket-chip">
                        <Icon name="playing_cards" size="sm" />×{participant.ticketCount}
                        <span className="muted"> · 뽑음 {participant.claimedTicketCount}</span>
                      </span>
                    )}
                  </td>
                  {!finalized ? (
                    <td>
                      {submitted ? (
                        <Button
                          variant="secondary"
                          icon="restart_alt"
                          onClick={() => setReopenTarget(participant)}
                        >
                          재제출 허용
                        </Button>
                      ) : (
                        <span className="muted">-</span>
                      )}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editable && scoreInvalid ? (
        <InlineAlert tone="danger">점수는 0 이상의 숫자로 입력해 주세요.</InlineAlert>
      ) : null}
      {actionError ? <InlineAlert tone="danger">{toUserMessage(actionError)}</InlineAlert> : null}

      <div className="teacher-actions">
        {editable ? (
          <Button
            variant="secondary"
            size="lg"
            icon="sort"
            onClick={autoRank}
            disabled={scoreInvalid}
          >
            점수로 자동 정렬
          </Button>
        ) : null}
        {finalized && !editing ? (
          <Button variant="secondary" size="lg" icon="edit" onClick={() => setEditing(true)}>
            순위 수정
          </Button>
        ) : null}
        {editing ? (
          <Button
            variant="ghost"
            size="lg"
            icon="close"
            onClick={() => {
              setDrafts(initialDrafts(participants));
              setEditing(false);
            }}
          >
            수정 취소
          </Button>
        ) : null}
        {editable ? (
          <Button
            size="lg"
            icon={finalized ? 'save' : 'trophy'}
            onClick={() => setConfirmOpen(true)}
            disabled={scoreInvalid}
          >
            {finalized ? '수정 저장' : '순위 확정'}
          </Button>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={
          finalized
            ? `${round}라운드 ${mission.title} 순위를 고칠까요?`
            : `${round}라운드 ${mission.title} 순위를 확정할까요?`
        }
        confirmLabel={finalized ? '수정 저장' : '순위 확정'}
        confirmIcon={finalized ? 'save' : 'trophy'}
        loading={finalize.isPending || revise.isPending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void handleConfirm()}
      >
        {finalized ? (
          <p>
            순위에 맞춰 뽑기권을 새로 발급하거나 회수해요. 새로 발급 {totalChange.added}장, 회수{' '}
            {totalChange.revoked}장
            {totalChange.revokedClaimed > 0 ? (
              <strong> · 이미 뽑은 카드 {totalChange.revokedClaimed}장이 카드함에서 빠져요</strong>
            ) : null}
          </p>
        ) : (
          <p>확정하면 순위에 따라 뽑기권이 만들어져요. (1위 3장, 2위 2장, 나머지 1장)</p>
        )}
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

      <ConfirmDialog
        open={reopenTarget !== null}
        title={`${reopenTarget?.team.displayName ?? ''} 제출을 되돌릴까요?`}
        confirmLabel="재제출 허용"
        confirmIcon="restart_alt"
        loading={reopen.isPending}
        onCancel={() => setReopenTarget(null)}
        onConfirm={async () => {
          if (!reopenTarget) return;
          const result = await reopen.run(reopenTarget.team.id);
          const name = reopenTarget.team.displayName;
          setReopenTarget(null);
          if (result?.ok) onChanged(`${name}이 다시 제출할 수 있어요.`);
        }}
      >
        <p>학생 화면에서 답을 고쳐 다시 제출할 수 있어요. 라운드가 끝났어도 다시 낼 수 있어요.</p>
        {mission.type === 'drawing' ? (
          <p className="muted">새 그림을 내면 지금 그림 파일은 새 그림으로 바뀌어요.</p>
        ) : null}
      </ConfirmDialog>
    </section>
  );
}
