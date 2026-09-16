import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EVENT_ID } from '../config';
import { DEMO_TEAM_ID } from '../data/mock/seed';
import { renderApp } from '../test/renderApp';

describe('학생 화면', () => {
  it('시작 화면에 투어 시작 버튼과 교사용 링크가 있다', () => {
    renderApp('/');
    expect(screen.getByRole('link', { name: /AI 미션 투어 시작/ })).toHaveAttribute(
      'href',
      `/join/${DEFAULT_EVENT_ID}`,
    );
    expect(screen.getByRole('link', { name: /교사용/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /페스티벌 장면/ })).toBeInTheDocument();
  });

  it('팀 홈에 팀 이름, 지금 미션과 교실, 미션 시작 버튼이 보인다', async () => {
    renderApp(`/team/${DEFAULT_EVENT_ID}/${DEMO_TEAM_ID}`);
    expect(await screen.findByRole('heading', { name: '로봇 길찾기' })).toBeInTheDocument();
    expect(screen.getByText('4학년 2반 3팀 팀 홈')).toBeInTheDocument();
    expect(screen.getByText(/2라운드 · 지금 미션/)).toBeInTheDocument();
    expect(screen.getByText('과학실')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /미션 시작/ })).toHaveAttribute(
      'href',
      `/team/${DEFAULT_EVENT_ID}/${DEMO_TEAM_ID}/mission/ozobot`,
    );
    expect(screen.getByRole('link', { name: /내 카드 보기/ })).toBeInTheDocument();
    expect(screen.getByText(/뽑기권/)).toHaveTextContent('3장');
  });

  it('카드를 뒤집으면 카드가 공개되고 같은 뽑기권은 다시 누를 수 없다', async () => {
    const user = userEvent.setup();
    renderApp(`/team/${DEFAULT_EVENT_ID}/${DEMO_TEAM_ID}/draw`);
    const first = await screen.findByRole('button', { name: '뽑기권 1 뒤집기' });
    await user.click(first);
    const dialog = await screen.findByRole('dialog', { name: '카드 획득!' }, { timeout: 3000 });
    expect(within(dialog).getByText(/카드$/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /계속 뽑기/ }));
    const revealed = screen.getByRole('button', { name: /을 얻었어요$/ });
    expect(revealed).toBeDisabled();
    expect(screen.getByText(/남은 뽑기권/)).toHaveTextContent('2장');
  });
});
