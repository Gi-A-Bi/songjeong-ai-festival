import { useCallback, useState } from 'react';
import { Link } from 'react-router';
import { paths } from '../../app/paths';
import { AssetImage } from '../../components/AssetImage';
import { Button, ButtonLink } from '../../components/Button';
import { ConfirmDialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { EmptyView, InlineAlert } from '../../components/StateViews';
import { toUserMessage } from '../../data/errors';
import { useDevTools, useRepository } from '../../data/RepositoryContext';
import { BOOTH_STEPS } from '../../domain/boothRound';
import { MISSION_TYPE_INFO } from '../../domain/catalog';
import type { Grade } from '../../domain/types';
import { useAction } from '../../hooks/useAction';
import { useAsyncData } from '../../hooks/useAsyncData';
import { OpsBoard } from './dashboard/OpsBoard';
import { useTeacherContext } from './teacherContext';

const GRADES: Grade[] = [3, 4, 5, 6];

export function TeacherDashboardPage() {
  const { eventId, event, teacher } = useTeacherContext();
  const repository = useRepository();
  const devTools = useDevTools();
  const isAdmin = teacher.role === 'admin';
  const liveOps = repository.capabilities.liveOps;
  const [nextGrade, setNextGrade] = useState<Grade | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const grade = event.activeGrade;
  const gameMinutes = Math.round(event.gameDurationMs / 60_000);

  const loadMissions = useCallback(() => repository.listMissions(eventId), [repository, eventId]);
  const missions = useAsyncData(loadMissions);

  const changeGrade = useAction(
    useCallback((value: Grade) => repository.setActiveGrade(eventId, value), [repository, eventId]),
  );

  return (
    <>
      <div className="teacher-title">
        <h1 className="page__title">실시간 운영 대시보드</h1>
      </div>

      <section className="panel control-bar" aria-label="행사 진행">
        <div className="control-bar__grade">
          <h2 className="control-bar__label">진행 학년</h2>
          <div className="segmented" role="group" aria-label="진행 학년">
            {GRADES.map((value) => (
              <button
                key={value}
                type="button"
                className="segmented__button"
                aria-pressed={grade === value}
                disabled={!isAdmin || changeGrade.isPending}
                onClick={() => {
                  if (value !== grade) setNextGrade(value);
                }}
              >
                {value}학년
              </button>
            ))}
          </div>
          <p className="control-bar__fact">
            <Icon name="timer" /> 게임 시간 <strong className="number">{gameMinutes}분</strong>
          </p>
        </div>
        <ol className="flow-guide" aria-label="부스에서 라운드를 진행하는 순서">
          {BOOTH_STEPS.map((step, index) => (
            <li key={step.status}>
              {index > 0 ? <Icon name="arrow_forward" size="sm" /> : null}
              <strong>
                {index + 1}. {step.label}
              </strong>
            </li>
          ))}
        </ol>
        <p className="control-bar__hint muted">
          <Icon name="info" size="sm" /> 라운드는 부스마다 선생님이 진행해요. 아래 “부스 바로
          가기”에서 맡은 부스를 열어 주세요. 5라운드가 끝나면 우리 반으로 돌아가 최종 미션을
          진행해요.
        </p>
        {!isAdmin ? (
          <p className="control-bar__hint muted">
            <Icon name="visibility" size="sm" /> 진행 학년은 총괄 선생님이 골라요.
          </p>
        ) : null}
        {changeGrade.status === 'error' ? (
          <InlineAlert tone="danger">{toUserMessage(changeGrade.error)}</InlineAlert>
        ) : null}
      </section>

      {/* 담당을 나누지 않으므로 누구나 여기서 자기가 맡은 부스로 바로 간다. */}
      {missions.status === 'success' ? (
        <nav className="panel booth-links" aria-label="부스 바로 가기">
          <h2 className="booth-links__title">
            <Icon name="meeting_room" /> 부스 바로 가기
          </h2>
          <ul className="booth-links__list">
            {missions.data.map((mission) => (
              <li key={mission.id}>
                <ButtonLink
                  to={paths.teacherStation(eventId, mission.id)}
                  variant="secondary"
                  icon={MISSION_TYPE_INFO[mission.type].icon}
                >
                  {mission.no}. {mission.title} · {mission.room}
                </ButtonLink>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      {liveOps && grade !== null ? (
        <OpsBoard eventId={eventId} grade={grade} event={event} />
      ) : null}
      {grade === null ? (
        <EmptyView
          title={
            isAdmin
              ? '위에서 진행할 학년을 먼저 골라 주세요'
              : '총괄 선생님이 진행 학년을 고르면 현황이 보여요'
          }
          icon="school"
        />
      ) : null}

      <section className="panel teacher-shortcuts" aria-label="바로 가기">
        <AssetImage asset="sceneFinale" decorative className="teacher-shortcuts__image" />
        <div className="stack">
          <h2 className="section-title">
            <Icon name="trophy" /> 카드 성장과 학급 최종 미션
          </h2>
          <p className="muted">
            학급별 네 조각 카드 진행도를 확인해요. 투어가 끝나면 총괄 선생님이 최종 미션을 열고, 각
            반은 준비되면 전자칠판에서 10문제를 시작해요.
          </p>
          <div className="cluster">
            <Link to={paths.teacherCards(eventId)} className="teacher-shortcuts__link">
              학급 카드 현황 <Icon name="arrow_forward" size="sm" />
            </Link>
            {repository.capabilities.classFinal ? (
              <Link to={paths.finalResults(eventId)} className="teacher-shortcuts__link">
                최종 미션 현황 <Icon name="arrow_forward" size="sm" />
              </Link>
            ) : (
              <span className="muted">최종 미션은 Firebase 연결 뒤 열려요.</span>
            )}
          </div>
        </div>
      </section>

      {devTools ? (
        <section className="panel dev-tools" aria-labelledby="dev-tools-title">
          <h2 id="dev-tools-title" className="section-title">
            <Icon name="settings" /> 개발·리허설 도구 (mock 전용)
          </h2>
          <p className="muted">
            데이터는 이 브라우저 메모리에만 있어요. 새로고침하면 샘플 상태로 돌아가요.
          </p>
          <div className="cluster">
            <Button variant="secondary" icon="wifi_off" onClick={() => devTools.failNextRequest()}>
              다음 요청 실패 흉내
            </Button>
            <Button variant="secondary" icon="restart_alt" onClick={() => setConfirmReset(true)}>
              샘플 데이터 초기화
            </Button>
          </div>
        </section>
      ) : null}

      <ConfirmDialog
        open={nextGrade !== null}
        title={`${nextGrade ?? ''}학년을 진행할까요?`}
        confirmLabel={`${nextGrade ?? ''}학년 진행`}
        confirmIcon="school"
        loading={changeGrade.isPending}
        onCancel={() => setNextGrade(null)}
        onConfirm={async () => {
          if (nextGrade !== null) await changeGrade.run(nextGrade);
          setNextGrade(null);
        }}
      >
        <p>
          부스 화면과 학생 화면이 {nextGrade}학년 기준으로 바뀌어요.
          {grade !== null
            ? ` ${grade}학년에 종료하지 않은 부스 라운드가 있으면 바꿀 수 없어요.`
            : ''}
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmReset}
        title="샘플 데이터로 초기화할까요?"
        confirmLabel="초기화"
        confirmIcon="restart_alt"
        tone="danger"
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => {
          devTools?.resetData();
          setConfirmReset(false);
          missions.reload();
        }}
      >
        <p>이번 접속에서 바꾼 제출·순위·체크인·카드 보상·최종 미션 기록이 모두 지워져요.</p>
      </ConfirmDialog>
    </>
  );
}
