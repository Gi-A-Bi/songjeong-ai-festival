import { useCallback, useId, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { paths } from '../../app/paths';
import { AppHeader } from '../../components/AppHeader';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { InlineAlert } from '../../components/StateViews';
import { DEFAULT_EVENT_ID } from '../../config';
import type { DevTools } from '../../data/EventRepository';
import { toUserMessage } from '../../data/errors';
import { useDevTools, useRepository } from '../../data/RepositoryContext';
import type { Grade } from '../../domain/types';
import { useAction } from '../../hooks/useAction';
import { useAsyncData } from '../../hooks/useAsyncData';
import './Teacher.css';

const GRADES: Grade[] = [3, 4, 5, 6];

/** 교사 로그인. 목업 모드에서는 실제 로그인 대신 역할을 골라 들어간다. */
export function TeacherLoginPage() {
  const repository = useRepository();
  const devTools = useDevTools();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const signIn = useCallback(() => repository.signInTeacher(), [repository]);
  const login = useAction(signIn);

  const next = searchParams.get('next');
  const destination = next?.startsWith('/teacher/')
    ? next
    : paths.teacherDashboard(DEFAULT_EVENT_ID);

  const enter = async () => {
    const result = await login.run();
    if (result?.ok) navigate(destination, { replace: true });
  };

  return (
    <>
      <AppHeader backTo={paths.start()} variant="teacher" />
      <main className="page teacher-login">
        <section className="panel teacher-login__panel" aria-labelledby="teacher-login-title">
          <span className="teacher-login__icon">
            <Icon name="school" size="xl" />
          </span>
          <h1 id="teacher-login-title" className="page__title">
            교사용 로그인
          </h1>
          <p className="muted">
            {repository.mode === 'mock'
              ? '지금은 로컬 목업이라 실제 로그인 없이 개발용 교사로 들어갑니다.'
              : '등록된 학교 Google 계정으로 로그인하세요. 등록되지 않은 계정은 교사 화면을 쓸 수 없습니다.'}
          </p>
          {login.status === 'error' ? (
            <InlineAlert tone="danger">{toUserMessage(login.error)}</InlineAlert>
          ) : null}
          <Button
            size="xl"
            icon="login"
            fullWidth
            onClick={() => void enter()}
            loading={login.isPending}
            loadingLabel="입장하는 중"
          >
            {repository.mode === 'mock' ? '총괄 선생님으로 입장' : 'Google 계정으로 로그인'}
          </Button>
          {devTools ? (
            <RehearsalRolePicker
              devTools={devTools}
              onSignedIn={(path) => navigate(path, { replace: true })}
            />
          ) : null}
        </section>
      </main>
    </>
  );
}

/** 리허설용: 부스·담임 선생님 화면이 어떻게 보이는지 역할을 골라 확인한다. */
function RehearsalRolePicker({
  devTools,
  onSignedIn,
}: {
  devTools: DevTools;
  onSignedIn: (path: string) => void;
}) {
  const repository = useRepository();
  const missionFieldId = useId();
  const gradeFieldId = useId();
  const classFieldId = useId();
  const [grade, setGrade] = useState<Grade>(3);
  const [missionId, setMissionId] = useState('');
  const [classId, setClassId] = useState('');

  const load = useCallback(async () => {
    const [missions, classes] = await Promise.all([
      repository.listMissions(DEFAULT_EVENT_ID),
      repository.listClasses(DEFAULT_EVENT_ID, grade),
    ]);
    return { missions, classes };
  }, [repository, grade]);
  const options = useAsyncData(load);
  if (options.status !== 'success') return null;

  const { missions, classes } = options.data;
  const pickedMissionId = missions.some((mission) => mission.id === missionId)
    ? missionId
    : (missions[0]?.id ?? '');
  const pickedClassId = classes.some((classInfo) => classInfo.id === classId)
    ? classId
    : (classes[0]?.id ?? '');

  return (
    <details className="teacher-login__rehearsal">
      <summary>
        <Icon name="groups" size="sm" /> 다른 역할로 미리 보기 (리허설용)
      </summary>
      <div className="stack">
        <div className="teacher-login__role">
          <label htmlFor={missionFieldId} className="form-field__label">
            부스 선생님: 담당 미션
          </label>
          <select
            id={missionFieldId}
            className="text-input"
            value={pickedMissionId}
            onChange={(change) => setMissionId(change.target.value)}
          >
            {missions.map((mission) => (
              <option key={mission.id} value={mission.id}>
                미션 {mission.no} · {mission.title}
              </option>
            ))}
          </select>
          <Button
            variant="secondary"
            icon="meeting_room"
            disabled={pickedMissionId === ''}
            onClick={() => {
              devTools.signInAs('station_teacher', { missionId: pickedMissionId });
              onSignedIn(paths.teacherStation(DEFAULT_EVENT_ID, pickedMissionId));
            }}
          >
            부스 선생님으로 입장
          </Button>
        </div>
        <div className="teacher-login__role">
          <label htmlFor={gradeFieldId} className="form-field__label">
            담임 선생님: 학년과 반
          </label>
          <div className="cluster">
            <select
              id={gradeFieldId}
              className="text-input"
              aria-label="학년"
              value={grade}
              onChange={(change) => setGrade(Number(change.target.value) as Grade)}
            >
              {GRADES.map((value) => (
                <option key={value} value={value}>
                  {value}학년
                </option>
              ))}
            </select>
            <select
              id={classFieldId}
              className="text-input"
              aria-label="반"
              value={pickedClassId}
              onChange={(change) => setClassId(change.target.value)}
            >
              {classes.map((classInfo) => (
                <option key={classInfo.id} value={classInfo.id}>
                  {classInfo.displayName}
                </option>
              ))}
            </select>
          </div>
          <Button
            variant="secondary"
            icon="school"
            disabled={pickedClassId === ''}
            onClick={() => {
              devTools.signInAs('homeroom_teacher', { classId: pickedClassId });
              onSignedIn(paths.teacherClass(DEFAULT_EVENT_ID, pickedClassId));
            }}
          >
            담임 선생님으로 입장
          </Button>
        </div>
      </div>
    </details>
  );
}
