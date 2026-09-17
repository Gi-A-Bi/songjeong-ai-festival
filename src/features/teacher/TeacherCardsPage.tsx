import { useCallback, useState } from 'react';
import { Link } from 'react-router';
import { paths } from '../../app/paths';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { ErrorView, LoadingView } from '../../components/StateViews';
import { useRepository } from '../../data/RepositoryContext';
import { CARD_TYPES } from '../../domain/cards';
import { CARD_INFO } from '../../domain/catalog';
import type { CardProgress, Grade } from '../../domain/types';
import { useAsyncData } from '../../hooks/useAsyncData';
import { formatPieces } from '../cards/cardText';
import { useTeacherContext } from './teacherContext';

const GRADES: Grade[] = [3, 4, 5, 6];

/** 학년의 학급별 카드 5종 진행도를 한눈에 본다. */
export function TeacherCardsPage() {
  const { eventId, event } = useTeacherContext();
  const repository = useRepository();
  const [grade, setGrade] = useState<Grade>(event.activeGrade ?? 3);
  const load = useCallback(
    () => repository.listClassCardBoards(eventId, grade),
    [repository, eventId, grade],
  );
  const boards = useAsyncData(load);

  return (
    <>
      <div className="teacher-title">
        <h1 className="page__title">학급 카드 현황</h1>
        <div className="cluster">
          <label htmlFor="cards-grade" className="visually-hidden">
            학년
          </label>
          <select
            id="cards-grade"
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
          <Button variant="secondary" icon="refresh" onClick={boards.reload}>
            새로고침
          </Button>
        </div>
      </div>
      <p className="muted">
        카드 진행도는 학생이 받은 카드 보상 기록으로 계산해요. 4조각을 넘는 카드는 중복 +N으로만
        기록돼요.
      </p>

      {boards.status === 'loading' ? <LoadingView /> : null}
      {boards.status === 'error' ? (
        <ErrorView error={boards.error} onRetry={boards.reload} />
      ) : null}
      {boards.status === 'success' ? (
        <div className="table-wrap panel">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">학급</th>
                {CARD_TYPES.map((cardType) => (
                  <th key={cardType} scope="col">
                    {CARD_INFO[cardType].name}
                  </th>
                ))}
                <th scope="col">완성(= 힌트 수)</th>
                <th scope="col">자세히</th>
              </tr>
            </thead>
            <tbody>
              {boards.data.map(({ classInfo, progress }) => (
                <tr key={classInfo.id}>
                  <th scope="row">{classInfo.displayName}</th>
                  {CARD_TYPES.map((cardType) => (
                    <td key={cardType}>
                      <ProgressCell card={progress.cards[cardType]} />
                    </td>
                  ))}
                  <td>
                    <strong className="number">{progress.completedCount}/5</strong>
                    {progress.allComplete ? (
                      <span className="progress-cell__master">
                        <Icon name="workspace_premium" size="sm" /> 5종 완성
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <Link
                      to={paths.teacherClass(eventId, classInfo.id)}
                      className="teacher-shortcuts__link"
                    >
                      팀·카드 기록 <Icon name="arrow_forward" size="sm" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}

function ProgressCell({ card }: { card: CardProgress }) {
  return (
    <span className={`progress-cell${card.complete ? ' progress-cell--complete' : ''}`}>
      {card.complete ? <Icon name="check_circle" size="sm" label="완성" /> : null}
      <span className="number">{formatPieces(card)}</span>
      {card.duplicates > 0 ? (
        <span className="progress-cell__dup number">+{card.duplicates}</span>
      ) : null}
    </span>
  );
}
