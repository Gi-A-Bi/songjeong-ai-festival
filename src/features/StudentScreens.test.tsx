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

  it('팀 홈에 팀 이름, 지금 미션과 교실이 보이고, 입장 전에는 미션을 미리 보기만 한다', async () => {
    // 샘플 팀은 아직 교실 QR을 찍지 않았다.
    renderApp(`/team/${DEFAULT_EVENT_ID}/${DEMO_TEAM_ID}`);
    expect(await screen.findByRole('heading', { name: '로봇 길찾기' })).toBeInTheDocument();
    expect(screen.getByText('4학년 2반 3팀 팀 홈')).toBeInTheDocument();
    expect(screen.getByText(/2라운드 · 지금 미션/)).toBeInTheDocument();
    expect(screen.getByText('과학실')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /미션 미리 보기/ })).toHaveAttribute(
      'href',
      `/team/${DEFAULT_EVENT_ID}/${DEMO_TEAM_ID}/mission/ozobot`,
    );
    expect(screen.queryByRole('link', { name: /미션 시작/ })).toBeNull();
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

  it('아직 교실 QR을 찍지 않은 팀의 홈은 교실 QR을 찍어야 입장된다고 알려 준다', async () => {
    renderApp(`/team/${DEFAULT_EVENT_ID}/${DEMO_TEAM_ID}`);
    expect(
      await screen.findByText(/교실 입구의 QR을 디벗 카메라로 찍어야 입장돼요/),
    ).toBeInTheDocument();
    expect(screen.getByText(/이 화면에서 미션을 눌러도 입장되지 않아요/)).toBeInTheDocument();
    // 과학실은 게임 중이라 남은 시간이 흐른다.
    expect(screen.getByRole('timer', { name: /남은 시간/ })).toBeInTheDocument();
  });

  it('교실 QR을 찍은 팀의 홈에는 미션 시작 버튼이 보인다', async () => {
    // 샘플 데이터: 4학년 1반 3팀은 과학실에 입장했다.
    renderApp(`/team/${DEFAULT_EVENT_ID}/${toTeamId(4, 1, 3)}`);
    expect(await screen.findByText(/도착 기록 완료/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /미션 시작/ })).toHaveAttribute(
      'href',
      `/team/${DEFAULT_EVENT_ID}/${toTeamId(4, 1, 3)}/mission/ozobot`,
    );
  });

  it('입장하지 않고 미션 화면을 열면 교실 QR을 찍으라고 알려 준다', async () => {
    renderApp(`/team/${DEFAULT_EVENT_ID}/${DEMO_TEAM_ID}/mission/ozobot`);
    expect(
      await screen.findByText(/아직 입장 기록이 없어요. 과학실 입구의 QR을 디벗 카메라로 찍어/),
    ).toBeInTheDocument();
  });

  it('입장한 팀의 미션 화면에는 QR 안내가 없다', async () => {
    renderApp(`/team/${DEFAULT_EVENT_ID}/${toTeamId(4, 1, 3)}/mission/ozobot`);
    expect(await screen.findByRole('heading', { name: '로봇 길찾기' })).toBeInTheDocument();
    expect(screen.queryByText(/아직 입장 기록이 없어요/)).toBeNull();
  });

  it('라운드만 연 교실의 미션 화면은 입장했는지에 따라 다르게 안내한다', async () => {
    // 샘플 데이터: 도서관은 라운드만 열었다. 1반 4팀은 입장했고 5반 4팀은 아직이다.
    const entered = renderApp(
      `/team/${DEFAULT_EVENT_ID}/${toTeamId(4, 1, 4)}/mission/library-check`,
    );
    expect(await screen.findByText(/입장했어요! 선생님이 게임을 시작하면/)).toBeInTheDocument();
    entered.unmount();

    renderApp(`/team/${DEFAULT_EVENT_ID}/${toTeamId(4, 5, 4)}/mission/library-check`);
    expect(
      await screen.findByText(/도서관 입구의 QR을 디벗 카메라로 찍어야 입장돼요/),
    ).toBeInTheDocument();
  });

  it('입장한 팀의 홈은 선생님이 게임을 시작하기를 기다린다고 알려 준다', async () => {
    // 샘플 데이터: 도서관은 2라운드를 열어 두고 아직 게임을 시작하지 않았다.
    renderApp(`/team/${DEFAULT_EVENT_ID}/${toTeamId(4, 1, 4)}`);
    expect(await screen.findByText(/2라운드 · 다음 미션으로 이동해요/)).toBeInTheDocument();
    expect(
      screen.getByText(/도착 기록 완료 · 선생님이 게임을 시작하면 미션이 열려요/),
    ).toBeInTheDocument();
    expect(screen.getByRole('timer', { name: /게임 대기/ })).toBeInTheDocument();
  });

  it('선생님이 라운드를 종료하면 새로고침 없이 다음 교실 안내로 바뀐다', async () => {
    const repository = new MockEventRepository();
    renderApp(`/team/${DEFAULT_EVENT_ID}/${DEMO_TEAM_ID}`, repository);
    expect(await screen.findByText(/2라운드 · 지금 미션/)).toBeInTheDocument();

    await new Promise((resolve) => setTimeout(resolve, 0));
    await repository.signInTeacher();
    const booth = {
      eventId: DEFAULT_EVENT_ID,
      missionId: 'ozobot',
      grade: 4 as const,
      roundNo: 2 as const,
    };
    const participants = await repository.listMissionParticipants(DEFAULT_EVENT_ID, 'ozobot', 4, 2);
    await repository.finalizeRanking({
      ...booth,
      requestId: 'close-1',
      entries: participants.map((participant, index) => ({
        teamId: participant.team.id,
        score: 100,
        rank: index + 1,
      })),
    });
    await repository.closeStationRound(booth);

    // 3팀의 3라운드 교실은 도서관이고, 도서관은 아직 3라운드를 열지 않았다.
    expect(await screen.findByText(/3라운드 · 다음 미션으로 이동해요/)).toBeInTheDocument();
    expect(screen.getByText('도서관')).toBeInTheDocument();
    expect(
      await screen.findByText(/교실 앞에서 기다려요. 선생님이 라운드를 열면 교실 입구의/),
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
    expect(screen.getByText(/찍은 QR: 시청각실\(AI 골든벨\)/)).toBeInTheDocument();
    expect(screen.getByText(/우리 팀은 지금 2라운드예요/)).toBeInTheDocument();

    const status = await repository.getTeamTourStatus(DEFAULT_EVENT_ID, DEMO_TEAM_ID);
    expect(status.state?.checkedInAt).toBeNull();
    expect(status.state?.alertCodes).toContain('wrong_station');
  });

  it('건너뛴 라운드는 팀 홈과 미션 화면에 건너뛴 미션으로 보인다', async () => {
    const repository = new MockEventRepository();
    await repository.signInTeacher();
    // 도서관이 2라운드를 건너뛰었다. 1반 4팀은 3라운드(시청각실)로 넘어간다.
    await repository.skipStationRound({
      eventId: DEFAULT_EVENT_ID,
      missionId: 'library-check',
      grade: 4,
      roundNo: 2,
    });
    const teamId = toTeamId(4, 1, 4);
    const home = renderApp(`/team/${DEFAULT_EVENT_ID}/${teamId}`, repository);
    expect(await screen.findByText(/3라운드 · 다음 미션으로 이동해요/)).toBeInTheDocument();
    const row = screen.getByRole('link', { name: /AI 오류찾기/ });
    expect(within(row).getByText('건너뜀')).toBeInTheDocument();
    expect(within(row).queryByText('미제출')).toBeNull();
    home.unmount();

    renderApp(`/team/${DEFAULT_EVENT_ID}/${teamId}/mission/library-check`, repository);
    expect(await screen.findByText('이번에는 하지 않고 넘어간 미션이에요.')).toBeInTheDocument();
  });

  it('이미 지나간 미션의 교실 QR을 찍으면 지금 갈 교실을 알려 준다', async () => {
    // 샘플 팀(3팀)의 1라운드 교실은 미술실이었다.
    const { repository } = renderApp(`/team/${DEFAULT_EVENT_ID}/${DEMO_TEAM_ID}/check-in/drawing`);
    expect(
      await screen.findByRole('heading', { name: '이미 지나간 미션이에요' }),
    ).toBeInTheDocument();
    expect(screen.getByText('과학실')).toBeInTheDocument();
    const status = await repository.getTeamTourStatus(DEFAULT_EVENT_ID, DEMO_TEAM_ID);
    expect(status.state?.alertCodes).not.toContain('wrong_station');
  });

  it('순위가 나온 뒤 라운드를 종료하기 전에 다음 교실 QR을 찍으면 기다리라고 알려 준다', async () => {
    const repository = new MockEventRepository();
    await repository.signInTeacher();
    // 과학실(2라운드)의 순위를 확정하고 라운드는 아직 종료하지 않았다.
    const participants = await repository.listMissionParticipants(DEFAULT_EVENT_ID, 'ozobot', 4, 2);
    await repository.finalizeRanking({
      eventId: DEFAULT_EVENT_ID,
      missionId: 'ozobot',
      grade: 4,
      roundNo: 2,
      requestId: 'early-1',
      entries: participants.map((participant, index) => ({
        teamId: participant.team.id,
        score: 100,
        rank: index + 1,
      })),
    });

    // 3팀의 다음(3라운드) 교실은 도서관이다.
    const next = renderApp(
      `/team/${DEFAULT_EVENT_ID}/${DEMO_TEAM_ID}/check-in/library-check`,
      repository,
    );
    expect(await screen.findByRole('heading', { name: '조금만 기다려요' })).toBeInTheDocument();
    expect(screen.getByText(/찍은 QR: 도서관\(AI 오류찾기\)/)).toBeInTheDocument();
    expect(
      screen.getByText(/여기는 다음 미션 교실이 맞아요. 선생님이 3라운드를 열면 들어갈 수 있어요/),
    ).toBeInTheDocument();
    // 예전처럼 앞 교실에 “이미 입장했어요”라고 하지 않는다.
    expect(screen.queryByRole('heading', { name: '이미 입장했어요' })).toBeNull();
    next.unmount();

    // 다음 교실이 아닌 교실의 QR을 찍으면 다음 교실을 알려 준다.
    const other = renderApp(
      `/team/${DEFAULT_EVENT_ID}/${DEMO_TEAM_ID}/check-in/golden-bell`,
      repository,
    );
    expect(
      await screen.findByRole('heading', { name: '다음 교실을 확인해요' }),
    ).toBeInTheDocument();
    expect(screen.getByText('도서관')).toBeInTheDocument();
    other.unmount();

    // 잘못 찍은 기록은 남기지 않는다.
    const status = await repository.getTeamTourStatus(DEFAULT_EVENT_ID, DEMO_TEAM_ID);
    expect(status.state?.alertCodes).not.toContain('wrong_station');

    // 끝낸 교실의 QR을 다시 찍으면 이미 입장한 것으로 알려 준다.
    renderApp(`/team/${DEFAULT_EVENT_ID}/${DEMO_TEAM_ID}/check-in/ozobot`, repository);
    expect(await screen.findByRole('heading', { name: '이미 입장했어요' })).toBeInTheDocument();
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
