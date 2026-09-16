import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { paths } from '../../app/paths';
import { AppHeader } from '../../components/AppHeader';
import { AssetImage } from '../../components/AssetImage';
import { Button, ButtonLink } from '../../components/Button';
import { ErrorView, InlineAlert, LoadingView } from '../../components/StateViews';
import { DEV_DEFAULT_TEAM } from '../../config';
import { toUserMessage } from '../../data/errors';
import { useRepository } from '../../data/RepositoryContext';
import { TEAM_NUMBERS } from '../../domain/rotation';
import type { Grade, Team, TeamNo } from '../../domain/types';
import { useAction } from '../../hooks/useAction';
import { useAsyncData } from '../../hooks/useAsyncData';
import './JoinPage.css';

const GRADES: Grade[] = [3, 4, 5, 6];

export function JoinPage() {
  const { eventId = '', teamId } = useParams();
  return (
    <>
      <AppHeader backTo={teamId ? paths.join(eventId) : paths.start()} subtitle="팀 입장" />
      <main className="page join">
        {teamId ? (
          <TeamConfirm key={teamId} eventId={eventId} teamId={teamId} />
        ) : (
          <TeamPicker eventId={eventId} />
        )}
      </main>
    </>
  );
}

/** QR로 들어왔거나 개발용으로 팀을 고른 뒤 보여 주는 확인 화면 */
function TeamConfirm({ eventId, teamId }: { eventId: string; teamId: string }) {
  const repository = useRepository();
  const navigate = useNavigate();
  const loadTeam = useCallback(
    () => repository.getTeam(eventId, teamId),
    [repository, eventId, teamId],
  );
  const team = useAsyncData(loadTeam);
  const joinAction = useCallback(
    () => repository.joinTeam(eventId, teamId),
    [repository, eventId, teamId],
  );
  const join = useAction(joinAction);

  if (team.status === 'loading') return <LoadingView label="팀 정보를 확인하고 있어요" />;
  if (team.status === 'error') return <ErrorView error={team.error} onRetry={team.reload} />;

  const enter = async () => {
    const result = await join.run();
    if (result?.ok) navigate(paths.teamHome(eventId, teamId), { replace: true });
  };

  return (
    <section className="join-confirm" aria-labelledby="join-confirm-title">
      <AssetImage asset="mascotWelcome" decorative className="join-confirm__mascot" />
      <div className="join-confirm__body">
        <h1 id="join-confirm-title" className="join-confirm__question">
          우리 팀이 맞나요?
        </h1>
        <p className="join-confirm__team">{team.data.displayName}</p>
        <p className="muted">이름은 적지 않아요. 팀 번호만 확인해요.</p>
        {join.status === 'error' ? (
          <InlineAlert tone="danger">{toUserMessage(join.error)}</InlineAlert>
        ) : null}
        <div className="join-confirm__actions">
          <Button
            size="xl"
            icon="check_circle"
            onClick={() => void enter()}
            loading={join.isPending}
            loadingLabel="입장하는 중"
          >
            맞아요, 입장하기
          </Button>
          <ButtonLink to={paths.join(eventId)} variant="secondary" size="lg" icon="groups">
            다른 팀 고르기
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}

/** 개발용 팀 선택. 실제 행사에서는 팀 QR로 바로 확인 화면에 들어온다. */
function TeamPicker({ eventId }: { eventId: string }) {
  const repository = useRepository();
  const [grade, setGrade] = useState<Grade>(DEV_DEFAULT_TEAM.grade);
  const [classNo, setClassNo] = useState(DEV_DEFAULT_TEAM.classNo);
  const [teamNo, setTeamNo] = useState<TeamNo>(DEV_DEFAULT_TEAM.teamNo);

  const loadTeams = useCallback(
    () => repository.listTeams(eventId, grade),
    [repository, eventId, grade],
  );
  const teams = useAsyncData(loadTeams);

  const classNumbers = teams.status === 'success' ? uniqueClassNumbers(teams.data) : [];
  const effectiveClassNo = classNumbers.includes(classNo) ? classNo : (classNumbers[0] ?? 1);
  const selected =
    teams.status === 'success'
      ? teams.data.find((team) => team.classNo === effectiveClassNo && team.teamNo === teamNo)
      : undefined;

  return (
    <section className="join-picker" aria-labelledby="join-picker-title">
      <div className="join-picker__intro">
        <h1 id="join-picker-title" className="page__title">
          우리 팀을 골라요
        </h1>
        <InlineAlert tone="info" icon="qr_code_scanner">
          개발용 선택 화면이에요. 행사 날에는 팀 QR을 찍으면 바로 확인 화면이 열려요.
        </InlineAlert>
      </div>

      <ChoiceGroup label="학년">
        {GRADES.map((value) => (
          <ChoiceButton key={value} selected={grade === value} onClick={() => setGrade(value)}>
            {value}학년
          </ChoiceButton>
        ))}
      </ChoiceGroup>

      {teams.status === 'loading' ? <LoadingView label="반 목록을 불러오고 있어요" /> : null}
      {teams.status === 'error' ? <ErrorView error={teams.error} onRetry={teams.reload} /> : null}

      {teams.status === 'success' ? (
        <>
          <ChoiceGroup label="반">
            {classNumbers.map((value) => (
              <ChoiceButton
                key={value}
                selected={effectiveClassNo === value}
                onClick={() => setClassNo(value)}
              >
                {value}반
              </ChoiceButton>
            ))}
          </ChoiceGroup>
          <ChoiceGroup label="팀">
            {TEAM_NUMBERS.map((value) => (
              <ChoiceButton
                key={value}
                selected={teamNo === value}
                onClick={() => setTeamNo(value)}
              >
                {value}팀
              </ChoiceButton>
            ))}
          </ChoiceGroup>
          <div className="join-picker__footer">
            <p className="join-picker__selected" aria-live="polite">
              {selected ? selected.displayName : '팀을 골라 주세요'}
            </p>
            {selected ? (
              <ButtonLink
                to={paths.joinTeam(eventId, selected.id)}
                size="xl"
                iconEnd="arrow_forward"
              >
                이 팀으로 입장
              </ButtonLink>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}

function uniqueClassNumbers(teams: readonly Team[]): number[] {
  return Array.from(new Set(teams.map((team) => team.classNo))).sort((a, b) => a - b);
}

function ChoiceGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <fieldset className="choice-group">
      <legend className="choice-group__label">{label}</legend>
      <div className="choice-group__options">{children}</div>
    </fieldset>
  );
}

function ChoiceButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`choice-button${selected ? ' choice-button--selected' : ''}`}
      aria-pressed={selected}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
