import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EVENT_ID } from '../config';
import { toTeamId } from '../data/mock/keys';
import { DEMO_TEAM_ID } from '../data/mock/seed';
import { renderApp } from '../test/renderApp';

describe('학생 홈 버튼과 순위 공개', () => {
  it('미션·카드 화면 머리줄의 홈 버튼은 팀 홈으로 간다', async () => {
    renderApp(`/team/${DEFAULT_EVENT_ID}/${DEMO_TEAM_ID}/mission/ozobot`);
    expect(await screen.findByRole('heading', { name: '로봇 길찾기' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /홈/ })).toHaveAttribute(
      'href',
      `/team/${DEFAULT_EVENT_ID}/${DEMO_TEAM_ID}`,
    );
    expect(screen.queryByRole('link', { name: /뒤로/ })).toBeNull();
  });

  it('순위가 확정된 미션 화면에 등수와 카드 고르기 버튼이 나온다', async () => {
    // 샘플 팀(4학년 2반 3팀)은 1라운드 그리기에서 1위이고 카드 보상을 아직 고르지 않았다.
    renderApp(`/team/${DEFAULT_EVENT_ID}/${DEMO_TEAM_ID}/mission/drawing`);
    const reveal = await screen.findByRole('status', { name: /우리 팀 1위/ });
    expect(within(reveal).getByText(/카드 3종 중에서 하나를 골라요/)).toBeInTheDocument();
    expect(within(reveal).getByRole('link', { name: /카드 고르기/ })).toHaveAttribute(
      'href',
      `/team/${DEFAULT_EVENT_ID}/${DEMO_TEAM_ID}/reward`,
    );
    expect(within(reveal).getByRole('link', { name: /홈으로/ })).toHaveAttribute(
      'href',
      `/team/${DEFAULT_EVENT_ID}/${DEMO_TEAM_ID}`,
    );
  });

  it('4위부터는 카드 보상이 없다고 알리고 고르기 버튼을 보여 주지 않는다', async () => {
    // 샘플 순위에서 4학년 1반 3팀은 1라운드 그리기 5위다.
    const teamId = toTeamId(4, 1, 3);
    renderApp(`/team/${DEFAULT_EVENT_ID}/${teamId}/mission/drawing`);
    const reveal = await screen.findByRole('status', { name: /우리 팀 5위/ });
    expect(within(reveal).getByText(/카드 보상이 없어요/)).toBeInTheDocument();
    expect(within(reveal).queryByRole('link', { name: /카드 고르기|카드 받기/ })).toBeNull();
  });

  it('팀 홈의 미션 지도에 확정된 등수가 보인다', async () => {
    renderApp(`/team/${DEFAULT_EVENT_ID}/${DEMO_TEAM_ID}`);
    expect(await screen.findByRole('heading', { name: '로봇 길찾기' })).toBeInTheDocument();
    // 1라운드 그리기(1위)는 등수로, 아직 순위가 없는 라운드는 등수 없이 보인다.
    expect(screen.getByText('1위')).toBeInTheDocument();
    expect(screen.queryByText('2위')).toBeNull();
  });

  it('이미 받은 카드는 이름을 한 번만 적어 알린다', async () => {
    // 샘플 순위에서 4학년 4반 3팀은 1라운드 그리기 3위라 카드 한 장을 무작위로 받았다.
    const teamId = toTeamId(4, 4, 3);
    renderApp(`/team/${DEFAULT_EVENT_ID}/${teamId}/mission/drawing`);
    const reveal = await screen.findByRole('status', { name: /우리 팀 3위/ });
    expect(within(reveal).getByText(/ 카드를 받았어요\./)).toBeInTheDocument();
    expect(within(reveal).queryByText(/카드 카드/)).toBeNull();
    expect(within(reveal).queryByRole('link', { name: /카드 고르기|카드 받기/ })).toBeNull();
  });
});
