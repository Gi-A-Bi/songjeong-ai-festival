import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { paths } from '../../app/paths';
import { AppHeader } from '../../components/AppHeader';
import { AssetImage } from '../../components/AssetImage';
import { Button, ButtonLink } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { ErrorView, InlineAlert, LoadingView } from '../../components/StateViews';
import { DEV_DEFAULT_TEAM } from '../../config';
import { isRepositoryError, toUserMessage } from '../../data/errors';
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
          isRepositoryError(join.error, 'device-locked') ? (
            <LockedDeviceNotice eventId={eventId} />
          ) : (
            <InlineAlert tone="danger">{toUserMessage(join.error)}</InlineAlert>
          )
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

/**
 * 이 기기가 이미 다른 팀에 묶여 있을 때의 안내. 어느 팀인지와 기기 번호를 보여 줘서
 * 선생님이 학급 화면에서 같은 번호의 기기를 찾아 잠금을 풀 수 있게 한다.
 */
function LockedDeviceNotice({ eventId }: { eventId: string }) {
  const repository = useRepository();
  const load = useCallback(() => repository.getMyDevice(eventId), [repository, eventId]);
  const device = useAsyncData(load);

  if (device.status !== 'success') {
    return (
      <InlineAlert tone="danger">
        이 기기는 다른 팀으로 입장했어요. 선생님께 잠금 해제를 요청해 주세요.
      </InlineAlert>
    );
  }
  const { team, code } = device.data;
  return (
    <div className="join-locked" role="alert">
      <p className="join-locked__title">
        <Icon name="lock" /> 이 기기는 {team ? `${team.displayName}으로` : '다른 팀으로'} 입장해
        있어요
      </p>
      <p>
        우리 팀이 아니면 선생님께 이 기기 번호를 보여 주세요. 선생님이 잠금을 풀면 다시 입장할 수
        있어요.
      </p>
      <p>
        기기 번호 <strong className="join-locked__code">{code}</strong>
      </p>
      {team ? (
        <ButtonLink to={paths.teamHome(eventId, team.id)} variant="secondary" size="lg" icon="home">
          {team.displayName} 화면으로 가기
        </ButtonLink>
      ) : null}
    </div>
  );
}

/** 팀 QR이 없을 때 쓰는 팀 선택. 실제 행사에서는 팀 QR로 바로 확인 화면에 들어온다. */
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
          팀 QR을 찍으면 바로 확인 화면이 열려요. QR이 없을 때만 여기에서 팀을 골라요.
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
