import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EVENT_ID } from '../config';
import { toTeamId } from '../data/mock/keys';
import { MockEventRepository } from '../data/mock/MockEventRepository';
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
    expect(screen.getByRole('link', { name: /우리 반 카드 보기/ })).toBeInTheDocument();
    expect(screen.getByText(/고를 카드 보상/)).toHaveTextContent('1개');
    expect(screen.getByRole('link', { name: /카드 보상 고르기/ })).toHaveAttribute(
      'href',
      `/team/${DEFAULT_EVENT_ID}/${DEMO_TEAM_ID}/reward`,
    );
  });

  it('선생님이 순위를 확정하면 새로고침 없이 팀 홈에 카드 보상 고르기 버튼이 나타난다', async () => {
    const repository = new MockEventRepository();
    // 2라운드 골든벨은 5팀. 4학년 2반 5팀은 아직 보상이 없다.
    const teamId = toTeamId(4, 2, 5);
    renderApp(`/team/${DEFAULT_EVENT_ID}/${teamId}`, repository);
    expect(
      await screen.findByText('미션 순위가 확정되면 카드 조각을 하나씩 받아요.'),
    ).toBeInTheDocument();

    // 화면의 실시간 구독이 등록될 때까지 한 틱 기다린다.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await repository.signInTeacher();
    const participants = await repository.listMissionParticipants(
      DEFAULT_EVENT_ID,
      'golden-bell',
      4,
      2,
    );
    await repository.finalizeRanking({
      eventId: DEFAULT_EVENT_ID,
      missionId: 'golden-bell',
      grade: 4,
      roundNo: 2,
      requestId: 'live-1',
      // 2반 5팀을 1위로 두어 고르기 전 보상이 생기게 한다.
      entries: participants.map((participant, index) => ({
        teamId: participant.team.id,
        score: participant.team.id === teamId ? 900 : 100,
        rank: participant.team.id === teamId ? 1 : index + 2,
      })),
    });
    expect(await screen.findByRole('link', { name: /카드 보상 고르기/ })).toBeInTheDocument();
  });

  it('5라운드를 모두 마친 팀의 홈은 교실로 돌아가 최종 미션을 준비하라고 안내한다', async () => {
    renderApp(`/team/${DEFAULT_EVENT_ID}/${toTeamId(3, 2, 1)}`);
    expect(await screen.findByText('모든 미션이 끝났어요')).toBeInTheDocument();
    expect(screen.getByText('5/5')).toBeInTheDocument();
    expect(screen.getByText('우리 교실로 돌아가 최종 미션을 준비해요')).toBeInTheDocument();
    // 최종 미션은 교실 전자칠판에서 하므로 팀 기기에는 결승 입장 버튼이 없다.
    expect(screen.queryByRole('link', { name: /결승/ })).toBeNull();
  });

  it('아직 교실 QR을 찍지 않은 팀의 홈은 도착하면 QR을 찍으라고 알려 준다', async () => {
    renderApp(`/team/${DEFAULT_EVENT_ID}/${DEMO_TEAM_ID}`);
    expect(
      await screen.findByText(/교실에 도착하면 교실 QR을 찍어 도착을 알려요/),
    ).toBeInTheDocument();
  });

  it('다른 교실 QR을 찍은 팀의 홈은 가야 할 교실을 다시 알려 준다', async () => {
    // 샘플 데이터: 4학년 5반 4팀은 도서관 대신 과학실 QR을 찍었다.
    renderApp(`/team/${DEFAULT_EVENT_ID}/${toTeamId(4, 5, 4)}`);
    expect(await screen.findByText(/다른 교실 QR을 찍었어요/)).toBeInTheDocument();
    expect(screen.getByText('도서관')).toBeInTheDocument();
  });

  it('예정된 교실 QR을 찍으면 입장 완료가 기록되고 다시 찍어도 기록은 하나다', async () => {
    const { repository } = renderApp(`/team/${DEFAULT_EVENT_ID}/${DEMO_TEAM_ID}/check-in/ozobot`);
    expect(await screen.findByRole('heading', { name: '입장 완료!' })).toBeInTheDocument();
    expect(screen.getByText(/2라운드 · 과학실/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /미션 화면으로/ })).toHaveAttribute(
      'href',
      `/team/${DEFAULT_EVENT_ID}/${DEMO_TEAM_ID}/mission/ozobot`,
    );

    const first = await repository.getTeamTourStatus(DEFAULT_EVENT_ID, DEMO_TEAM_ID);
    expect(first.state?.checkedInAt).toEqual(expect.any(Number));
    const again = await repository.checkInStation({
      eventId: DEFAULT_EVENT_ID,
      teamId: DEMO_TEAM_ID,
      stationId: 'ozobot',
    });
    expect(again.kind).toBe('already_checked_in');
    expect(again.state.checkedInAt).toBe(first.state?.checkedInAt);
  });

  it('다른 교실 QR을 찍으면 올바른 교실을 안내하고 입장은 기록하지 않는다', async () => {
    const { repository } = renderApp(
      `/team/${DEFAULT_EVENT_ID}/${DEMO_TEAM_ID}/check-in/golden-bell`,
    );
    expect(
      await screen.findByRole('heading', { name: '다른 교실로 가야 해요' }),
    ).toBeInTheDocument();
    expect(screen.getByText('과학실')).toBeInTheDocument();
    expect(screen.getByText(/여기는 시청각실이에요/)).toBeInTheDocument();

    const status = await repository.getTeamTourStatus(DEFAULT_EVENT_ID, DEMO_TEAM_ID);
    expect(status.state?.checkedInAt).toBeNull();
    expect(status.state?.alertCodes).toContain('wrong_station');
  });

  it('교실 QR 주소는 기기에 입장한 팀의 체크인 화면으로 이어진다', async () => {
    const repository = new MockEventRepository();
    await repository.joinTeam(DEFAULT_EVENT_ID, DEMO_TEAM_ID);
    renderApp(`/check-in/${DEFAULT_EVENT_ID}/ozobot`, repository);
    expect(await screen.findByRole('heading', { name: '입장 완료!' })).toBeInTheDocument();
  });

  it('팀에 입장하지 않은 기기로 교실 QR을 찍으면 팀 입장부터 안내한다', async () => {
    renderApp(`/check-in/${DEFAULT_EVENT_ID}/ozobot`);
    expect(
      await screen.findByRole('heading', { name: '먼저 팀으로 입장해 주세요' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /팀 입장하기/ })).toBeInTheDocument();
  });

  it('1위 카드 보상은 학급 진행도를 보고 3종 중 하나를 고르며, 고르면 다음 조각이 열린다', async () => {
    const user = userEvent.setup();
    const { repository } = renderApp(`/team/${DEFAULT_EVENT_ID}/${DEMO_TEAM_ID}/reward`);
    expect(
      await screen.findByRole('heading', { name: '카드 3종 중 하나를 골라요' }),
    ).toBeInTheDocument();
    // 고르기 전에 학급 카드 5종 진행도를 볼 수 있다.
    const strip = screen.getByRole('list', { name: '우리 반 카드 진행도' });
    expect(within(strip).getAllByRole('img')).toHaveLength(5);
    expect(screen.getAllByRole('button', { name: /고르기, 지금/ })).toHaveLength(3);

    await user.click(screen.getByRole('button', { name: '생각 카드 고르기, 지금 2/4' }));
    const dialog = await screen.findByRole('dialog', { name: '생각 카드를 받을까요?' });
    expect(within(dialog).getByText('2/4 → 3/4')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /이 카드 받기/ }));

    expect(
      await screen.findByRole('heading', { name: '생각 카드 조각 3/4가 열렸어요!' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '생각 카드 조각 3/4' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /고르기, 지금/ })).not.toBeInTheDocument();
    const view = await repository.getTeamRewardView(DEFAULT_EVENT_ID, DEMO_TEAM_ID);
    expect(view.awards.every((award) => award.status === 'claimed')).toBe(true);
  });

  it('학급 카드 현황에 조각 진행도, 완성 표시, 중복 수, 최종 미션 힌트 수가 보인다', async () => {
    renderApp(`/team/${DEFAULT_EVENT_ID}/${toTeamId(3, 1, 2)}/cards`);
    expect(await screen.findByRole('heading', { name: '3학년 1반 카드' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '관찰 카드 조각 4/4, 완성' })).toBeInTheDocument();
    expect(screen.getAllByText('완성')).toHaveLength(5);
    expect(screen.getAllByText(/중복 \+1/)).toHaveLength(5);
    // 완성 카드 5종 → 공통 힌트 5개. 중복 카드는 힌트를 늘리지 않는다.
    expect(screen.getByRole('heading', { name: '최종 미션 힌트 5개' })).toBeInTheDocument();
    expect(
      screen.getByText(/5종 모두 완성! 정답 수가 같으면 우리 반이 앞서요/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/찬스/)).toBeNull();
  });

  it('완성하지 못한 카드는 조각 수와 남은 조각을 보여 주고 5종 완성 안내는 없다', async () => {
    renderApp(`/team/${DEFAULT_EVENT_ID}/${toTeamId(3, 4, 5)}/cards`);
    expect(await screen.findByRole('img', { name: '검증 카드 조각 0/4' })).toBeInTheDocument();
    expect(screen.getByText('4조각 더')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /최종 미션 힌트 \d개/ })).toBeInTheDocument();
    expect(screen.queryByText(/5종 모두 완성/)).toBeNull();
    expect(screen.queryByText(/찬스/)).toBeNull();
  });

  it('예전 카드 뽑기 주소로 들어오면 학급 카드 현황으로 이동한다', async () => {
    renderApp(`/team/${DEFAULT_EVENT_ID}/${DEMO_TEAM_ID}/draw`);
    expect(await screen.findByRole('heading', { name: '4학년 2반 카드' })).toBeInTheDocument();
  });

  it('지금 라운드가 아닌 미션은 살펴보기만 하고 제출할 수 없다', async () => {
    renderApp(`/team/${DEFAULT_EVENT_ID}/${DEMO_TEAM_ID}/mission/golden-bell`);
    expect(await screen.findByText(/4라운드에 하는 미션이에요/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /정답 제출/ })).toBeDisabled();
  });

  it('골든벨은 여러 문제를 풀고 확인한 뒤 한 번에 제출한다', async () => {
    const user = userEvent.setup();
    // 2라운드 골든벨은 5팀이 한다.
    renderApp(`/team/${DEFAULT_EVENT_ID}/${toTeamId(4, 2, 5)}/mission/golden-bell`);
    expect(await screen.findByText('문제 1 / 7')).toBeInTheDocument();
    await user.click(
      screen.getByRole('radio', { name: /책이나 믿을 만한 자료로 사실인지 확인한다/ }),
    );
    await user.click(screen.getByRole('button', { name: /다음 문제/ }));
    expect(screen.getByText('문제 2 / 7')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /우리 집 주소와 전화번호/ }));

    await user.click(screen.getByRole('button', { name: /정답 제출/ }));
    const dialog = await screen.findByRole('dialog', { name: '답을 제출할까요?' });
    expect(within(dialog).getByText(/5개/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /제출하기/ }));
    expect(await screen.findByText(/제출했어요!/)).toBeInTheDocument();
    expect(screen.getByText('제출한 답은 바꿀 수 없어요')).toBeInTheDocument();
  });
});
