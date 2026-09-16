import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AppProviders } from '../app/AppProviders';
import { appRoutes } from '../app/routes';
import { MockEventRepository } from '../data/mock/MockEventRepository';

/** 실제 라우트와 mock 저장소로 화면을 렌더링한다. */
export function renderApp(initialPath: string, repository = new MockEventRepository()) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [initialPath] });
  const result = render(
    <AppProviders repositoryValue={{ repository, devTools: repository }}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { ...result, router, repository };
}
