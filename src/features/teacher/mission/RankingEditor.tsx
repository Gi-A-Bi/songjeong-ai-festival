import { useCallback, useState } from 'react';
import { Button } from '../../../components/Button';
import { ConfirmDialog } from '../../../components/Dialog';
import { Icon } from '../../../components/Icon';
import { InlineAlert } from '../../../components/StateViews';
import { StatusBadge } from '../../../components/StatusBadge';
import type { FinalizeRankingInput, MissionParticipant } from '../../../data/EventRepository';
import { toUserMessage } from '../../../data/errors';
import { useRepository } from '../../../data/RepositoryContext';
import { CARD_INFO } from '../../../domain/catalog';
import {
  getSelectionModeForRank,
  rankByScore,
  SELECTION_MODE_LABELS,
} from '../../../domain/rewards';
import type { CardAward, Grade, Mission, RoundNo } from '../../../domain/types';
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
 * 확정 전에는 제출을 되돌릴 수 있고, 확정 후에는 순위를 고치면 고르기 전 카드 보상도 맞춰진다.
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

  const modeOf = (participant: MissionParticipant) =>
    getSelectionModeForRank(drafts[participant.team.id].rank);
  /** 순위 수정으로 선택 방식이 바뀌는 보상 */
  const modeChanged = (participant: MissionParticipant) =>
    participant.award !== null && participant.award.selectionMode !== modeOf(participant);
  const reofferCount = participants.filter(
    (participant) => modeChanged(participant) && participant.award?.status === 'pending',
  ).length;
  const keptCount = participants.filter(
    (participant) => modeChanged(participant) && participant.award?.status === 'claimed',
  ).length;

  const submittedCount = participants.filter(isSubmitted).length;
  const claimedCount = participants.filter(
    (participant) => participant.award?.status === 'claimed',
  ).length;
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
        const { reoffered, keptClaimed } = result.value;
        onChanged(
          `순위를 고쳤어요. 후보를 다시 정한 카드 보상 ${reoffered}개` +
            (keptClaimed > 0 ? `, 이미 받아서 그대로 둔 보상 ${keptClaimed}개` : ''),
        );
      }
      return;
    }
    const result = await finalize.run();
    setConfirmOpen(false);
    if (result?.ok) {
      onChanged(`순위를 확정했어요. 카드 보상 ${result.value.awards.length}개를 만들었어요.`);
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
            {editing
              ? '순위 수정 중'
              : `순위 확정됨 · 카드 보상 받음 ${claimedCount}/${participants.length}`}
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
              <th scope="col">카드 보상</th>
              {!finalized ? <th scope="col">관리</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((participant) => {
              const { team, submission } = participant;
              const draft = drafts[team.id];
              const submitted = isSubmitted(participant);
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
                  <td>
                    {!finalized ? (
                      <span className="award-chip award-chip--planned">
                        <Icon name="playing_cards" size="sm" />
                        {SELECTION_MODE_LABELS[modeOf(participant)]} 예정
                      </span>
                    ) : editing && participant.award ? (
                      <span className="award-chip">
                        <Icon name="playing_cards" size="sm" />
                        {SELECTION_MODE_LABELS[modeOf(participant)]}
                        {modeChanged(participant) ? (
                          <span className="award-chip__note">
                            {participant.award.status === 'pending'
                              ? ' (후보 다시 정함)'
                              : ' (이미 받아 그대로 둠)'}
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      <AwardSummary award={participant.award} />
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
            아직 고르지 않은 카드 보상은 새 순위에 맞춰 후보를 다시 정해요({reofferCount}개). 이미
            받은 보상은 학급 카드가 열린 뒤라 그대로 둬요
            {keptCount > 0 ? <strong> · 그대로 둘 보상 {keptCount}개</strong> : null}.
          </p>
        ) : (
          <p>
            확정하면 팀마다 카드 조각 보상이 하나씩 만들어져요. 1위는 3종 중 선택, 2위는 2종 중
            선택, 나머지는 자동 배정이에요.
          </p>
        )}
        <ul className="confirm-list">
          {rows.map((participant) => (
            <li key={participant.team.id} className="confirm-list__item">
              <strong>{drafts[participant.team.id].rank}위</strong> {participant.team.displayName}
              <span className="award-chip">
                <Icon name="playing_cards" size="sm" />
                {SELECTION_MODE_LABELS[modeOf(participant)]}
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

/** 확정된 카드 보상 한 줄 요약: 고르기 전이면 후보, 받았으면 받은 카드 */
function AwardSummary({ award }: { award: CardAward | null }) {
  if (!award) return <span className="muted">-</span>;
  if (award.status === 'pending') {
    return (
      <span className="award-chip">
        <StatusBadge tone="warning" icon="hourglass_top">
          선택 대기
        </StatusBadge>
        <span className="muted">
          {award.offeredTypes.map((cardType) => CARD_INFO[cardType].name).join('·')}
        </span>
      </span>
    );
  }
  return (
    <span className="award-chip">
      <StatusBadge tone="success" icon="check_circle">
        {award.selectedType ? CARD_INFO[award.selectedType].name : '받음'}
      </StatusBadge>
      <span className="muted">{SELECTION_MODE_LABELS[award.selectionMode]}</span>
    </span>
  );
}
