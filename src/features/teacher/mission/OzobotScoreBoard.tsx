import { useCallback, useState } from 'react';
import { Button } from '../../../components/Button';
import { ConfirmDialog } from '../../../components/Dialog';
import { Icon } from '../../../components/Icon';
import { InlineAlert } from '../../../components/StateViews';
import type { MissionParticipant } from '../../../data/EventRepository';
import { toUserMessage } from '../../../data/errors';
import { useRepository } from '../../../data/RepositoryContext';
import {
  calculateOzobotScore,
  findOzobotChallenge,
  formatOzobotCell,
  getOzobotSolved,
  OZOBOT_CHALLENGES,
  OZOBOT_POINTS,
  ozobotStars,
} from '../../../domain/ozobot';
import type { Mission } from '../../../domain/types';
import { useAction } from '../../../hooks/useAction';
import { OzobotChallengeCard } from '../../missions/ozobot/OzobotChallengeCard';
import '../../missions/ozobot/Ozobot.css';

interface OzobotScoreBoardProps {
  eventId: string;
  mission: Mission;
  participants: readonly MissionParticipant[];
  /** 게임을 시작했는지 */
  started: boolean;
  /** 순위를 확정했는지 */
  finalized: boolean;
  onChanged: (message: string) => void;
}

interface Pending {
  teamId: string;
  teamName: string;
  challengeId: string;
  kind: 'add' | 'remove';
}

/**
 * 로봇 길찾기 성공 기록. 팀이 손을 들면 선생님이 오조봇으로 길을 지나가 보고,
 * 성공하면 팀이 받은 카드 번호를 골라 기록한다. 점수(★5·★★10·★★★20)는 순위표에 바로 들어간다.
 */
export function OzobotScoreBoard({
  eventId,
  mission,
  participants,
  started,
  finalized,
  onChanged,
}: OzobotScoreBoardProps) {
  const repository = useRepository();
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Pending | null>(null);

  const change = useAction(
    useCallback(
      (input: Pending) =>
        input.kind === 'add'
          ? repository.recordOzobotSuccess({
              eventId,
              missionId: mission.id,
              teamId: input.teamId,
              challengeId: input.challengeId,
            })
          : repository.undoOzobotSuccess({
              eventId,
              missionId: mission.id,
              teamId: input.teamId,
              challengeId: input.challengeId,
            }),
      [repository, eventId, mission.id],
    ),
  );

  const run = async (input: Pending) => {
    const result = await change.run(input);
    setPending(null);
    if (!result?.ok) return;
    const card = findOzobotChallenge(input.challengeId);
    setPicks((previous) => ({ ...previous, [input.teamId]: '' }));
    onChanged(
      input.kind === 'add'
        ? `${input.teamName} 도전 과제 ${card?.cardNo ?? ''} 성공 +${card ? OZOBOT_POINTS[card.level] : 0}점`
        : `${input.teamName} 도전 과제 ${card?.cardNo ?? ''} 기록을 지웠어요.`,
    );
  };

  const disabledReason = finalized
    ? '순위를 확정했어요. 점수를 고치려면 아래 순위표의 “순위 수정”을 써 주세요.'
    : !started
      ? '게임을 시작한 뒤에 성공을 기록할 수 있어요.'
      : null;

  return (
    <section className="panel stack" aria-labelledby="ozobot-board-title">
      <h2 id="ozobot-board-title" className="section-title">
        <Icon name="smart_toy" /> 도전 과제 성공 기록
      </h2>
      <p className="muted">
        팀이 손을 들면 학생 화면의 카드 번호를 확인하고, 보드판에 오조봇을 올려 출발 칸에서 도착
        칸까지 지나가는지 봐요. 성공하면 그 카드를 골라 “성공”을 눌러요. ★ 5점 · ★★ 10점 · ★★★
        20점이 순위표 점수에 바로 들어가요.
      </p>
      {disabledReason ? <InlineAlert tone="info">{disabledReason}</InlineAlert> : null}
      {change.status === 'error' ? (
        <InlineAlert tone="danger">{toUserMessage(change.error)}</InlineAlert>
      ) : null}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">팀</th>
              <th scope="col">성공한 카드</th>
              <th scope="col" className="data-table__num">
                점수
              </th>
              <th scope="col">성공 기록</th>
            </tr>
          </thead>
          <tbody>
            {participants.map(({ team, submission }) => {
              const solved = getOzobotSolved(
                submission?.answer.type === 'ozobot' ? submission.answer : null,
              );
              const solvedIds = solved.map((item) => item.challengeId);
              const open = OZOBOT_CHALLENGES.filter((item) => !solvedIds.includes(item.id));
              const pick = picks[team.id] ?? '';
              return (
                <tr key={team.id}>
                  <th scope="row">{team.displayName}</th>
                  <td>
                    {solved.length === 0 ? (
                      <span className="muted">-</span>
                    ) : (
                      <ul className="ozobot-chips">
                        {solved.map((item) => {
                          const card = findOzobotChallenge(item.challengeId);
                          return (
                            <li key={item.challengeId} className="ozobot-chip">
                              카드 {card?.cardNo ?? item.challengeId} {ozobotStars(item.level)} +
                              {OZOBOT_POINTS[item.level]}
                              {disabledReason === null ? (
                                <button
                                  type="button"
                                  className="rank-stepper__button"
                                  aria-label={`${team.displayName} 카드 ${card?.cardNo ?? ''} 기록 지우기`}
                                  onClick={() =>
                                    setPending({
                                      teamId: team.id,
                                      teamName: team.displayName,
                                      challengeId: item.challengeId,
                                      kind: 'remove',
                                    })
                                  }
                                >
                                  <Icon name="close" size="sm" />
                                </button>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </td>
                  <td className="data-table__num number">{calculateOzobotScore(solved)}</td>
                  <td>
                    <div className="ozobot-board-row">
                      <label htmlFor={`ozobot-pick-${team.id}`} className="visually-hidden">
                        {team.displayName} 성공한 카드
                      </label>
                      <select
                        id={`ozobot-pick-${team.id}`}
                        className="text-input"
                        value={pick}
                        disabled={disabledReason !== null || open.length === 0}
                        onChange={(event) =>
                          setPicks((previous) => ({ ...previous, [team.id]: event.target.value }))
                        }
                      >
                        <option value="">카드 고르기</option>
                        {open.map((item) => (
                          <option key={item.id} value={item.id}>
                            {ozobotStars(item.level)} 카드 {item.cardNo} (
                            {formatOzobotCell(item.start)}→{formatOzobotCell(item.goal)}) ·{' '}
                            {OZOBOT_POINTS[item.level]}점
                          </option>
                        ))}
                      </select>
                      <Button
                        icon="check_circle"
                        disabled={disabledReason !== null || pick === ''}
                        loading={change.isPending && pending?.teamId === team.id}
                        onClick={() =>
                          void run({
                            teamId: team.id,
                            teamName: team.displayName,
                            challengeId: pick,
                            kind: 'add',
                          })
                        }
                      >
                        성공
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={pending?.kind === 'remove'}
        title="이 성공 기록을 지울까요?"
        confirmLabel="기록 지우기"
        confirmIcon="close"
        tone="danger"
        loading={change.isPending}
        onCancel={() => setPending(null)}
        onConfirm={() => (pending ? void run(pending) : undefined)}
      >
        <p>잘못 누른 기록만 지워 주세요. 지우면 그 카드의 점수가 빠져요.</p>
      </ConfirmDialog>
    </section>
  );
}

/** 교사용: 도전 과제 카드 전체(난이도 순). 실물 카드와 맞춰 볼 때 쓴다. */
export function OzobotChallengeGallery() {
  return (
    <section className="stack" aria-labelledby="ozobot-gallery-title">
      <h2 id="ozobot-gallery-title" className="section-title">
        <Icon name="style" /> 도전 과제 카드 {OZOBOT_CHALLENGES.length}장
      </h2>
      <p className="muted">
        학생은 난이도를 고르면 그 난이도의 카드 가운데 하나를 무작위로 받아요. 성공한 카드는 그 팀에
        다시 나오지 않아요.
      </p>
      <div className="ozobot-gallery">
        {OZOBOT_CHALLENGES.map((challenge) => (
          <OzobotChallengeCard key={challenge.id} challenge={challenge} compact />
        ))}
      </div>
    </section>
  );
}
