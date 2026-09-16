import { useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { paths } from '../../app/paths';
import { AppHeader } from '../../components/AppHeader';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { InlineAlert } from '../../components/StateViews';
import { DEFAULT_EVENT_ID } from '../../config';
import { toUserMessage } from '../../data/errors';
import { useRepository } from '../../data/RepositoryContext';
import { useAction } from '../../hooks/useAction';
import './Teacher.css';

/** 1단계 목업: 실제 Google 로그인 대신 개발용 교사로 입장한다. */
export function TeacherLoginPage() {
  const repository = useRepository();
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
            {repository.mode === 'mock' ? '개발용 교사로 입장' : 'Google 계정으로 로그인'}
          </Button>
        </section>
      </main>
    </>
  );
}
