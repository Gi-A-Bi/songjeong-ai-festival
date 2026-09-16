import { useRouteError } from 'react-router';
import { AppHeader } from '../components/AppHeader';
import { ButtonLink } from '../components/Button';
import { EmptyView, ErrorView } from '../components/StateViews';

export function NotFoundPage() {
  return (
    <>
      <AppHeader backTo="/" />
      <main className="page">
        <EmptyView
          mascot="mascotHint"
          title="찾는 화면이 없어요"
          description="주소가 바뀌었거나 잘못된 QR일 수 있어요. 처음 화면에서 다시 시작해 주세요."
          action={
            <ButtonLink to="/" size="lg" icon="home">
              처음 화면으로
            </ButtonLink>
          }
        />
      </main>
    </>
  );
}

export function RouteErrorPage() {
  const error = useRouteError();
  return (
    <main className="page">
      <ErrorView
        error={error}
        title="화면을 여는 중 문제가 생겼어요"
        onRetry={() => window.location.reload()}
        retryLabel="새로고침"
      />
    </main>
  );
}

/** 저장소를 만들 수 없을 때(잘못된 환경 변수 등) 보여 주는 화면 */
export function StartupErrorPage({ error }: { error: unknown }) {
  const detail = error instanceof Error ? error.message : String(error);
  return (
    <main className="page">
      <div className="state-view" role="alert">
        <p className="state-view__title">앱 설정을 확인해 주세요</p>
        <p className="state-view__description">{detail}</p>
      </div>
    </main>
  );
}
