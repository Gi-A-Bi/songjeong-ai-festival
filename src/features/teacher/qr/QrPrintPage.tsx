import { useCallback, useId, useState } from 'react';
import { useSearchParams } from 'react-router';
import { paths } from '../../../app/paths';
import { Button } from '../../../components/Button';
import { Icon } from '../../../components/Icon';
import { QrCode } from '../../../components/QrCode';
import { ErrorView, InlineAlert, LoadingView } from '../../../components/StateViews';
import type { StationCodeList } from '../../../data/EventRepository';
import { useRepository } from '../../../data/RepositoryContext';
import { missionRoom } from '../../../domain/missionRoom';
import type { ClassInfo, Grade, Mission, Team } from '../../../domain/types';
import { useAsyncData } from '../../../hooks/useAsyncData';
import { useTeacherContext } from '../teacherContext';
import './QrPrint.css';

const GRADES: Grade[] = [3, 4, 5, 6];
type Kind = 'teams' | 'codes';

/** 지금 열어 둔 사이트 주소(경로 앞부분 포함). QR에는 학생 기기가 열 수 있는 주소가 들어가야 한다. */
function currentSiteAddress(): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${window.location.origin}${base}`;
}

function isLocalAddress(address: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(address);
}

/** 팀 입장 QR과 교실 인증코드 안내문을 A4로 인쇄하는 화면 */
export function QrPrintPage() {
  const { eventId, event } = useTeacherContext();
  const repository = useRepository();
  const [searchParams] = useSearchParams();
  const onlyStation = searchParams.get('station');
  const addressId = useId();
  const gradeId = useId();
  const classFieldId = useId();

  const [kind, setKind] = useState<Kind>(onlyStation ? 'codes' : 'teams');
  const [grade, setGrade] = useState<Grade>(event.activeGrade ?? 3);
  const [classId, setClassId] = useState('all');
  const [address, setAddress] = useState(currentSiteAddress);

  const load = useCallback(async () => {
    const [missions, classes, teams, codes] = await Promise.all([
      repository.listMissions(eventId),
      repository.listClasses(eventId, grade),
      repository.listTeams(eventId, grade),
      repository.listStationCodes(eventId),
    ]);
    return { missions, classes, teams, codes };
  }, [repository, eventId, grade]);
  const data = useAsyncData(load);

  const site = address.trim().replace(/\/+$/, '');
  const validAddress = /^https?:\/\/[^\s/]+/.test(site);
  const deployedGuess =
    repository.mode === 'firebase' && import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim()
      ? `https://${import.meta.env.VITE_FIREBASE_PROJECT_ID.trim()}.web.app`
      : null;
  const printable = kind === 'codes' || validAddress;

  return (
    <div className="qr-print">
      <div className="qr-print__controls">
        <div className="teacher-title">
          <h1 className="page__title">QR·인증코드 인쇄</h1>
          <Button size="lg" icon="print" disabled={!printable} onClick={() => window.print()}>
            인쇄하기
          </Button>
        </div>

        <section className="panel stack" aria-label="인쇄 설정">
          <div className="segmented" role="group" aria-label="인쇄할 것">
            <button
              type="button"
              className="segmented__button"
              aria-pressed={kind === 'teams'}
              onClick={() => setKind('teams')}
            >
              <Icon name="groups" /> 팀 입장 QR
            </button>
            <button
              type="button"
              className="segmented__button"
              aria-pressed={kind === 'codes'}
              onClick={() => setKind('codes')}
            >
              <Icon name="login" /> 교실 인증코드 안내문(5장)
            </button>
          </div>

          {kind === 'teams' ? (
            <>
              <div className="cluster">
                <div>
                  <label htmlFor={gradeId} className="form-field__label">
                    학년
                  </label>
                  <select
                    id={gradeId}
                    className="text-input"
                    value={grade}
                    onChange={(change) => {
                      setGrade(Number(change.target.value) as Grade);
                      setClassId('all');
                    }}
                  >
                    {GRADES.map((value) => (
                      <option key={value} value={value}>
                        {value}학년
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor={classFieldId} className="form-field__label">
                    학급
                  </label>
                  <select
                    id={classFieldId}
                    className="text-input"
                    value={classId}
                    onChange={(change) => setClassId(change.target.value)}
                  >
                    <option value="all">모든 반(반마다 한 장)</option>
                    {data.status === 'success'
                      ? data.data.classes.map((classInfo) => (
                          <option key={classInfo.id} value={classInfo.id}>
                            {classInfo.displayName}
                          </option>
                        ))
                      : null}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor={addressId} className="form-field__label">
                  QR에 넣을 사이트 주소
                </label>
                <input
                  id={addressId}
                  className="text-input qr-print__address"
                  inputMode="url"
                  value={address}
                  aria-invalid={!validAddress || undefined}
                  onChange={(change) => setAddress(change.target.value)}
                />
              </div>
              {!validAddress ? (
                <InlineAlert tone="danger">
                  https://로 시작하는 사이트 주소를 넣어 주세요.
                </InlineAlert>
              ) : null}
              {validAddress && isLocalAddress(site) ? (
                <InlineAlert tone="warning">
                  지금 주소는 이 컴퓨터에서만 열려요. 학생 기기로 찍으려면 배포한 사이트 주소로 바꿔
                  주세요.
                  {deployedGuess ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="teacher-shortcuts__link"
                        onClick={() => setAddress(deployedGuess)}
                      >
                        {deployedGuess} 넣기
                      </button>
                    </>
                  ) : null}
                </InlineAlert>
              ) : null}
              <p className="muted">
                <Icon name="info" size="sm" /> 인쇄 창에서 용지 A4 세로, 배율 100%, “머리글과
                바닥글” 끄기를 권해요. 인쇄한 뒤 디벗 카메라로 한 장 찍어 열리는지 먼저 확인해
                주세요.
              </p>
            </>
          ) : (
            <p className="muted">
              <Icon name="info" size="sm" /> 교실 안 선생님 자리처럼 <strong>교실 안에서만</strong>{' '}
              보이는 곳에 붙여 주세요. 학생은 미션 화면에서 이 숫자를 넣고 입장해요. 인증코드는 행사
              설정에서 바꿀 수 있어요.
            </p>
          )}
        </section>
      </div>

      {data.status === 'loading' ? <LoadingView label="인쇄물을 만들고 있어요" /> : null}
      {data.status === 'error' ? <ErrorView error={data.error} onRetry={data.reload} /> : null}
      {data.status === 'success' && kind === 'codes' ? (
        <CodeSheets
          missions={data.data.missions.filter(
            (mission) => onlyStation === null || mission.id === onlyStation,
          )}
          codes={data.data.codes}
        />
      ) : null}
      {data.status === 'success' && kind === 'teams' && validAddress ? (
        <TeamSheets
          eventId={eventId}
          site={site}
          classes={data.data.classes.filter(
            (classInfo) => classId === 'all' || classInfo.id === classId,
          )}
          teams={data.data.teams}
        />
      ) : null}
    </div>
  );
}

/** 교실 인증코드 안내문. 교실마다 한 장, 교실 안에 붙인다. */
function CodeSheets({ missions, codes }: { missions: readonly Mission[]; codes: StationCodeList }) {
  return (
    <div className="qr-sheets" aria-label="교실 인증코드 안내문">
      {missions.map((mission) => {
        const code = codes.find((item) => item.missionId === mission.id)?.code ?? null;
        return (
          <section key={mission.id} className="qr-sheet qr-sheet--station">
            <p className="qr-sheet__kicker">미션 {mission.no} · 교실 인증코드</p>
            <h2 className="qr-sheet__title">{missionRoom(mission, null)}</h2>
            <p className="qr-sheet__subtitle">{mission.title}</p>
            <p
              className="qr-sheet__code-value number"
              aria-label={`${missionRoom(mission, null)} 인증코드`}
            >
              {code ?? '미정'}
            </p>
            {code === null ? (
              <p className="qr-sheet__warning">
                아직 인증코드를 정하지 않았어요. 행사 설정에서 정한 뒤 다시 인쇄해 주세요.
              </p>
            ) : null}
            <ol className="qr-sheet__steps">
              <li>팀 디벗에서 “미션 시작” 또는 “인증코드 넣고 입장”을 눌러요.</li>
              <li>위 숫자 네 자리를 넣고 “입장하기”를 눌러요.</li>
              <li>“입장 완료!”가 보이면 선생님이 게임을 시작할 때까지 기다려요.</li>
            </ol>
          </section>
        );
      })}
    </div>
  );
}

/** 팀 입장 QR. 한 반(다섯 팀)이 한 장에 들어가며 잘라서 팀에 나눠 준다. */
function TeamSheets({
  eventId,
  site,
  classes,
  teams,
}: {
  eventId: string;
  site: string;
  classes: readonly ClassInfo[];
  teams: readonly Team[];
}) {
  return (
    <div className="qr-sheets" aria-label="팀 입장 QR">
      {classes.map((classInfo) => (
        <section key={classInfo.id} className="qr-sheet qr-sheet--teams">
          <h2 className="qr-sheet__class">{classInfo.displayName} 팀 입장 QR</h2>
          <ul className="qr-team-grid">
            {teams
              .filter((team) => team.classId === classInfo.id)
              .sort((a, b) => a.teamNo - b.teamNo)
              .map((team) => (
                <li key={team.id} className="qr-team-card">
                  <p className="qr-team-card__name">{team.displayName}</p>
                  <QrCode
                    value={`${site}${paths.joinTeam(eventId, team.id)}`}
                    label={`${team.displayName} 입장 QR`}
                    className="qr-sheet__code"
                  />
                  <p className="qr-team-card__hint">
                    디벗 카메라로 찍고 “맞아요, 입장하기”를 눌러요
                  </p>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
