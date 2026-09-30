import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_EVENT_ID } from '../config';
import { toTeamId } from '../data/mock/keys';
import { MockEventRepository } from '../data/mock/MockEventRepository';
import { renderApp } from '../test/renderApp';

const EVENT = DEFAULT_EVENT_ID;
// 샘플 데이터: 4학년 2라운드 과학실(로봇 길찾기)은 게임 중이고, 1반 3팀은 입장했고 아직 성공 기록이 없다.
const TEAM = toTeamId(4, 1, 3);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('학생 로봇 길찾기', () => {
  it('난이도를 고르면 그 난이도의 카드가 무작위로 나오고, 선생님이 성공을 기록하면 점수가 오른다', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const user = userEvent.setup();
    const repository = new MockEventRepository();
    renderApp(`/team/${EVENT}/${TEAM}/mission/ozobot`, repository);

    const levels = await screen.findByRole('group', { name: '난이도 고르기' });
    expect(within(levels).getAllByRole('button')).toHaveLength(3);
    expect(screen.getByText(/우리 팀 0점/)).toBeInTheDocument();

    // 별 2개(10점) 카드 3장 가운데 첫 카드(도전 과제 6: E6 → A4)가 나온다.
    await user.click(within(levels).getByRole('button', { name: /별 2개, 10점, 남은 카드 3장/ }));
    const card = screen.getByRole('figure', { name: /도전 과제 6, 별 2개, 출발 E6, 도착 A4/ });
    expect(within(card).getByText('출발')).toBeInTheDocument();
    expect(within(card).getByText('도착')).toBeInTheDocument();
    expect(within(card).getByText('직선 5개')).toBeInTheDocument();
    expect(within(card).getByText('꺾인 길 6개')).toBeInTheDocument();

    // 선생님이 오조봇으로 확인하고 성공을 기록한다.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await repository.signInTeacher();
    await repository.recordOzobotSuccess({
      eventId: EVENT,
      missionId: 'ozobot',
      teamId: TEAM,
      challengeId: 'card-6',
    });

    expect(await screen.findByText(/도전 과제 6 성공! \+10점/)).toBeInTheDocument();
    expect(screen.getByText(/우리 팀 10점/)).toBeInTheDocument();
    // 성공한 카드는 다시 나오지 않는다.
    const again = screen.getByRole('group', { name: '난이도 고르기' });
    expect(
      within(again).getByRole('button', { name: /별 2개, 10점, 남은 카드 2장/ }),
    ).toBeEnabled();
  });

  it('게임 시작 전에는 카드를 고를 수 없게 가린다', async () => {
    // 4학년 2반 5팀의 로봇 길찾기는 5라운드다.
    renderApp(`/team/${EVENT}/${toTeamId(4, 2, 5)}/mission/ozobot`);
    expect(
      await screen.findByText('게임이 시작되면 도전 과제 카드가 나타나요'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: '난이도 고르기' })).toBeNull();
  });
});

describe('교사 로봇 길찾기', () => {
  it('팀이 받은 카드를 골라 성공을 기록하면 점수가 순위표에 바로 들어간다', async () => {
    const user = userEvent.setup();
    const repository = new MockEventRepository();
    await repository.signInTeacher();
    renderApp(`/teacher/${EVENT}/station/ozobot`, repository);

    const board = await screen.findByRole('region', { name: '도전 과제 성공 기록' });
    await user.selectOptions(
      within(board).getByLabelText('4학년 1반 3팀 성공한 카드'),
      '★★★ 카드 15 (A6→F1) · 20점',
    );
    const row = within(board).getByRole('rowheader', { name: '4학년 1반 3팀' }).closest('tr');
    if (!row) throw new Error('팀 줄이 없어요');
    await user.click(within(row).getByRole('button', { name: '성공' }));

    expect(await screen.findByText(/4학년 1반 3팀 도전 과제 15 성공 \+20점/)).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLInputElement>('textbox', { name: '4학년 1반 3팀 점수' }).value,
      ).toBe('20'),
    );
    // 기록은 지울 수 있다.
    await user.click(
      within(board).getByRole('button', { name: '4학년 1반 3팀 카드 15 기록 지우기' }),
    );
    const dialog = await screen.findByRole('dialog', { name: '이 성공 기록을 지울까요?' });
    await user.click(within(dialog).getByRole('button', { name: '기록 지우기' }));
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLInputElement>('textbox', { name: '4학년 1반 3팀 점수' }).value,
      ).toBe('0'),
    );
  });

  it('도전 과제 카드 탭에서 8장을 모두 볼 수 있다', async () => {
    const user = userEvent.setup();
    const repository = new MockEventRepository();
    await repository.signInTeacher();
    renderApp(`/teacher/${EVENT}/station/ozobot`, repository);
    await user.click(await screen.findByRole('button', { name: /도전 과제 카드/ }));
    expect(screen.getAllByRole('figure', { name: /^도전 과제 \d+/ })).toHaveLength(8);
    expect(
      screen.getByRole('figure', { name: /도전 과제 12, 별 3개, 출발 E3, 도착 C1/ }),
    ).toBeInTheDocument();
  });
});
