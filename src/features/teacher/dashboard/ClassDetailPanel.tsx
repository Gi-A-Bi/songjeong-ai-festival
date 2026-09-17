import { useCallback } from 'react';
import { paths } from '../../../app/paths';
import { ButtonLink } from '../../../components/Button';
import { Icon } from '../../../components/Icon';
import { StatusBadge } from '../../../components/StatusBadge';
import { ErrorView, LoadingView } from '../../../components/StateViews';
import type { ClassOpsDetail } from '../../../data/EventRepository';
import { useRepository } from '../../../data/RepositoryContext';
import { CARD_TYPES } from '../../../domain/cards';
import { CARD_INFO } from '../../../domain/catalog';
import { TEAM_MISSION_STATUS_LABELS } from '../../../domain/tour';
import type { CardType } from '../../../domain/types';
import { useAsyncData } from '../../../hooks/useAsyncData';
import { formatPieces } from '../../cards/cardText';
import { TEAM_STATUS_BADGES } from './tourBadges';

/** 대시보드에서 학급을 골랐을 때 보여 주는 상세(읽기 전용) */
export function ClassDetailPanel({ eventId, classId }: { eventId: string; classId: string }) {
  const repository = useRepository();
  const load = useCallback(
    () => repository.getClassOpsDetail(eventId, classId),
    [repository, eventId, classId],
  );
  const detail = useAsyncData(load);

  if (detail.status === 'loading') return <LoadingView label="학급 상세를 불러오고 있어요" />;
  if (detail.status === 'error') return <ErrorView error={detail.error} onRetry={detail.reload} />;
  return (
    <section className="panel stack" aria-labelledby="class-detail-title">
      <div className="teacher-title">
        <h2 id="class-detail-title" className="section-title">
          <Icon name="school" /> {detail.data.classInfo.displayName} 상세
        </h2>
        <ButtonLink
          to={paths.teacherClass(eventId, classId)}
          variant="secondary"
          iconEnd="arrow_forward"
        >
          학급 화면 열기
        </ButtonLink>
      </div>
      <ClassTeamsTable detail={detail.data} />
      <ClassCardSummary detail={detail.data} />
    </section>
  );
}

/** “생각 2, 관찰 1”처럼 팀이 받은 카드 종류별 개수 */
function describeEarned(earnedTypes: readonly CardType[]): string {
  return CARD_TYPES.filter((cardType) => earnedTypes.includes(cardType))
    .map((cardType) => {
      const count = earnedTypes.filter((item) => item === cardType).length;
      return `${CARD_INFO[cardType].name} ${count}`;
    })
    .join(', ');
}

/** 팀별 현재·다음 미션, 완료 미션 수, 미션별 순위, 획득 카드 */
export function ClassTeamsTable({ detail }: { detail: ClassOpsDetail }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">팀</th>
            <th scope="col">현재 미션</th>
            <th scope="col">다음 미션</th>
            <th scope="col">완료</th>
            <th scope="col">라운드별 순위</th>
            <th scope="col">획득 카드</th>
          </tr>
        </thead>
        <tbody>
          {detail.teams.map((row) => {
            const badge = row.state ? TEAM_STATUS_BADGES[row.state.status] : null;
            return (
              <tr key={row.team.id}>
                <th scope="row">{row.team.teamNo}팀</th>
                <td>
                  {row.currentMission ? (
                    <span className="ops-cell">
                      <span>{row.currentMission.title}</span>
                      {badge && row.state ? (
                        <StatusBadge tone={badge.tone} icon={badge.icon}>
                          {TEAM_MISSION_STATUS_LABELS[row.state.status]}
                        </StatusBadge>
                      ) : null}
                    </span>
                  ) : (
                    <span className="muted">투어 시간 아님</span>
                  )}
                </td>
                <td>{row.nextMission?.title ?? <span className="muted">-</span>}</td>
                <td className="number">{row.completedCount}/5</td>
                <td className="number">
                  {row.results
                    .map((result) => (result.rank === null ? '-' : `${result.rank}위`))
                    .join(' · ')}
                </td>
                <td>
                  {row.earnedTypes.length === 0 ? (
                    <span className="muted">없음</span>
                  ) : (
                    describeEarned(row.earnedTypes)
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 카드 5종 진행도, 완성 카드 종류 수, 최종 미션 힌트 예상 수 */
export function ClassCardSummary({ detail }: { detail: ClassOpsDetail }) {
  const { progress } = detail;
  return (
    <ul className="ops-card-summary">
      {CARD_TYPES.map((cardType) => {
        const card = progress.cards[cardType];
        return (
          <li
            key={cardType}
            className={`progress-cell${card.complete ? ' progress-cell--complete' : ''}`}
          >
            {card.complete ? <Icon name="check_circle" size="sm" label="완성" /> : null}
            <span>{CARD_INFO[cardType].name}</span>
            <span className="number">{formatPieces(card)}</span>
            {card.duplicates > 0 ? (
              <span className="progress-cell__dup number">+{card.duplicates}</span>
            ) : null}
          </li>
        );
      })}
      <li className="ops-card-summary__hint">
        <Icon name="lightbulb" size="sm" /> 완성 {progress.completedCount}종 → 최종 미션 힌트{' '}
        <strong className="number">{detail.hintPreview}개</strong>
      </li>
    </ul>
  );
}
