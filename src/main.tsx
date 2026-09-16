// 전역 스타일을 화면별 CSS보다 먼저 불러와야 화면별 규칙이 전역 규칙을 덮어쓸 수 있다.
import './styles/tokens.css';
import './styles/global.css';
import './styles/accents.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { AppProviders } from './app/AppProviders';
import { appRoutes } from './app/routes';
import { StartupErrorPage } from './app/SystemPages';
import { createRepository } from './data/createRepository';

const container = document.getElementById('root');
if (!container) throw new Error('#root 요소가 없습니다.');
const root = createRoot(container);

async function start() {
  const repositoryValue = await createRepository();
  const router = createBrowserRouter(appRoutes, { basename: import.meta.env.BASE_URL });
  root.render(
    <StrictMode>
      <AppProviders repositoryValue={repositoryValue}>
        <RouterProvider router={router} />
      </AppProviders>
    </StrictMode>,
  );
}

void start().catch((error: unknown) => {
  root.render(
    <StrictMode>
      <StartupErrorPage error={error} />
    </StrictMode>,
  );
});
