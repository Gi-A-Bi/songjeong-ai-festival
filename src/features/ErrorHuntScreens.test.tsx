import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../app/AppProviders';
import { DEFAULT_EVENT_ID } from '../config';
import type { TeamMissionView } from '../data/EventRepository';
import { toTeamId } from '../data/mock/keys';
import { MockEventRepository } from '../data/mock/MockEventRepository';
import { DEMO_TEAM_ID } from '../data/mock/seed';
import { DEFAULT_ERROR_HUNT_PUZZLES } from '../domain/errorHuntPuzzles';
import type { CircleRegion, FestivalEvent, MissionPhase } from '../domain/types';
import { renderApp } from '../test/renderApp';
import { ErrorHuntMission } from './missions/errorHunt/ErrorHuntMission';

const EVENT = DEFAULT_EVENT_ID;
// 샘플 데이터: 4학년 2라운드 틀린그림 찾기는 1팀이 하고, 1반 1팀은 입장했지만 아직 제출하지 않았다.
const TEAM = toTeamId(4, 1, 1);
const PUZZLES = DEFAULT_ERROR_HUNT_PUZZLES.grade4;
const BOARD = { width: 1600, height: 900 };

/** 테스트 화면에는 크기가 없으므로 그림판이 1600×900이라고 알려 준다. */
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: BOARD.width,
    bottom: BOARD.height,
    width: BOARD.width,
    height: BOARD.height,
    toJSON: () => ({}),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function getBoard(): HTMLElement {
  const board = document.querySelector<HTMLElement>('.hunt-board');
  if (!board) throw new Error('그림판이 없어요');
  return board;
}

/** 그림 위의 비율 좌표를 누른다. */
function tap(x: number, y: number) {
  fireEvent.click(getBoard(), { clientX: x * BOARD.width, clientY: y * BOARD.height });
}

const tapRegion = (region: CircleRegion) => tap(region.x, region.y);

describe('학생 틀린그림 찾기: 그림 5장을 차례로', () => {
  it('그 학년의 첫 그림부터 보여 주고, 찾기 전에는 정답 이름을 알려 주지 않는다', async () => {
    renderApp(`/team/${EVENT}/${TEAM}/mission/error-hunt`);
    expect(await screen.findByRole('heading', { name: /1번 그림 · 도서관/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'AI가 만든 도서관 그림' })).toBeInTheDocument();
    expect(screen.getByText('찾은 곳 0/15')).toBeInTheDocument();

    const steps = within(screen.getByRole('navigation', { name: '그림 번호' })).getAllByRole(
      'button',
    );
    expect(steps).toHaveLength(5);
    expect(steps[0]).toHaveAttribute('aria-current', 'step');
    expect(steps[4]).toHaveAccessibleName('5번 그림 캠핑장, 3곳 중 0곳 찾음');

    for (const region of PUZZLES[0].regions) {
      expect(screen.queryByText(region.label)).toBeNull();
    }
    expect(screen.getByText('1번째 곳을 찾아요')).toBeInTheDocument();
  });

  it('이상한 곳을 누르면 찾은 곳으로, 다른 곳을 누르면 오답으로 센다', async () => {
    renderApp(`/team/${EVENT}/${TEAM}/mission/error-hunt`);
    await screen.findByRole('heading', { name: /1번 그림 · 도서관/ });

    tap(0.75, 0.5);
    expect(screen.getByText('오답 1번')).toBeInTheDocument();
    expect(screen.getByText('여기는 아니에요.')).toBeInTheDocument();

    const [bread, shadow, carrot] = PUZZLES[0].regions;
    tapRegion(bread);
    expect(screen.getByText('찾은 곳 1/15')).toBeInTheDocument();
    expect(screen.getByText(`찾았어요! ${bread.label}`)).toBeInTheDocument();
    // 같은 곳을 다시 눌러도 늘지 않고 오답도 아니다.
    tapRegion(bread);
    expect(screen.getByText('찾은 곳 1/15')).toBeInTheDocument();
    expect(screen.getByText('오답 1번')).toBeInTheDocument();
    expect(screen.getByText('이미 찾은 곳이에요.')).toBeInTheDocument();

    // 타원의 가장자리 안쪽을 눌러도 찾은 것이다.
    tap(shadow.x + shadow.r * 0.9, shadow.y);
    tapRegion(carrot);
    expect(screen.getByText('찾은 곳 3/15')).toBeInTheDocument();
    expect(screen.getByText(/이 그림은 다 찾았어요. 다음 그림으로 넘어가요/)).toBeInTheDocument();
    const list = screen.getByRole('region', { name: /1번 그림 · 도서관/ });
    for (const region of PUZZLES[0].regions) {
      expect(within(list).getByText(region.label)).toBeInTheDocument();
    }
  });

  it('그림을 넘기며 찾고, 돌아와도 찾은 곳이 남아 있다', async () => {
    const user = userEvent.setup();
    renderApp(`/team/${EVENT}/${TEAM}/mission/error-hunt`);
    await screen.findByRole('heading', { name: /1번 그림 · 도서관/ });
    expect(screen.getByRole('button', { name: /이전 그림/ })).toBeDisabled();

    tapRegion(PUZZLES[0].regions[0]);
    await user.click(screen.getByRole('button', { name: /다음 그림/ }));
    expect(screen.getByRole('heading', { name: /2번 그림 · 과학실/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'AI가 만든 과학실 그림' })).toBeInTheDocument();
    // 앞 그림의 정답 자리를 눌러도 이 그림에서는 그 그림의 정답으로만 본다.
    tapRegion(PUZZLES[1].regions[2]);
    expect(screen.getByText('찾은 곳 2/15')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /5번 그림 캠핑장/ }));
    expect(screen.getByRole('heading', { name: /5번 그림 · 캠핑장/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /다음 그림/ })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /1번 그림 도서관, 3곳 중 1곳 찾음/ }));
    expect(screen.getByText(PUZZLES[0].regions[0].label)).toBeInTheDocument();
  });

  it('찾은 곳을 모두 합쳐 한 번에 제출하고 자동으로 채점된다', async () => {
    const user = userEvent.setup();
    const repository = new MockEventRepository();
    renderApp(`/team/${EVENT}/${TEAM}/mission/error-hunt`, repository);
    await screen.findByRole('heading', { name: /1번 그림 · 도서관/ });

    tap(0.75, 0.5);
    for (const region of PUZZLES[0].regions) tapRegion(region);
    await user.click(screen.getByRole('button', { name: /다음 그림/ }));
    tapRegion(PUZZLES[1].regions[0]);

    await user.click(screen.getByRole('button', { name: /찾은 결과 제출/ }));
    expect(await screen.findByText(/제출했어요!/)).toBeInTheDocument();

    const [submission] = (await repository.listTeamSubmissions(EVENT, TEAM)).filter(
      (item) => item.missionId === 'error-hunt',
    );
    expect(submission.answer).toMatchObject({
      type: 'error_hunt',
      foundRegionIds: ['g4-1-a', 'g4-1-b', 'g4-1-c', 'g4-2-a'],
      wrongTaps: 1,
    });
    await repository.signInTeacher();
    const participants = await repository.listMissionParticipants(EVENT, 'error-hunt', 4, 2);
    const mine = participants.find((item) => item.team.id === TEAM);
    // 4곳 × 100 − 오답 1번 × 20. 모두 찾지 못해 시간 보너스는 없다.
    expect(mine?.submission?.score).toBe(380);
  });

  it('15곳을 모두 찾으면 제출하라고 알려 준다', async () => {
    const user = userEvent.setup();
    renderApp(`/team/${EVENT}/${TEAM}/mission/error-hunt`);
    await screen.findByRole('heading', { name: /1번 그림 · 도서관/ });

    for (const [index, puzzle] of PUZZLES.entries()) {
      if (index > 0) await user.click(screen.getByRole('button', { name: /다음 그림/ }));
      for (const region of puzzle.regions) tapRegion(region);
    }
    expect(screen.getByText('찾은 곳 15/15')).toBeInTheDocument();
    expect(screen.getByText(/모두 찾았어요. 찾은 결과를 제출해요/)).toBeInTheDocument();
  });

  it('다른 학년은 그 학년의 그림을 푼다', async () => {
    // 샘플 데이터: 3학년은 투어를 마쳐 순위가 확정됐다.
    renderApp(`/team/${EVENT}/${toTeamId(3, 1, 1)}/mission/error-hunt`);
    expect(await screen.findByRole('button', { name: /1번 그림 교실/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /5번 그림 바닷가/ })).toBeInTheDocument();
  });
});

describe('학생 틀린그림 찾기: 게임 시작 전에는 그림을 가린다', () => {
  function expectHidden() {
    expect(screen.getByText('게임이 시작되면 그림이 나타나요')).toBeInTheDocument();
    expect(screen.getByText('그림 5장에서 이상한 곳 15군데를 찾아요.')).toBeInTheDocument();
    // 실제 그림은 화면에 올리지 않는다.
    expect(screen.queryByRole('img', { name: /AI가 만든/ })).toBeNull();
    for (const image of document.querySelectorAll('img')) {
      expect(image.getAttribute('src')).not.toMatch(/hunt-/);
    }
    expect(screen.queryByRole('navigation', { name: '그림 번호' })).toBeNull();
    expect(screen.queryByRole('button', { name: /다음 그림/ })).toBeNull();
    expect(screen.queryByText(/도서관|과학실|미술실/)).toBeNull();
  }

  it('아직 차례가 아닌 미션을 미리 열면 그림이 보이지 않는다', async () => {
    // 샘플 팀(4학년 2반 3팀)은 5라운드에 틀린그림 찾기를 한다.
    renderApp(`/team/${EVENT}/${DEMO_TEAM_ID}/mission/error-hunt`);
    expect(await screen.findByText(/5라운드에 하는 미션이에요/)).toBeInTheDocument();
    expectHidden();
    expect(screen.getByRole('button', { name: /찾은 결과 제출/ })).toBeDisabled();
  });

  it('우리 학년 시간이 아니면 그림이 보이지 않는다', async () => {
    renderApp(`/team/${EVENT}/${toTeamId(5, 1, 1)}/mission/error-hunt`);
    expect(await screen.findByText(/지금은 미션 투어 시간이 아니에요/)).toBeInTheDocument();
    expectHidden();
  });

  /** 미션 화면만 따로 그려 단계가 바뀔 때의 모습을 본다. */
  async function renderMission(patchView: Partial<TeamMissionView> = {}) {
    const repository = new MockEventRepository();
    const loaded = await repository.getTeamMissionView(EVENT, TEAM, 'error-hunt');
    const view = { ...loaded, ...patchView };
    const config = view.mission.config;
    if (config.type !== 'error_hunt') throw new Error('틀린그림 찾기 미션이 아니에요');
    let stop: (() => void) | undefined;
    const event = await new Promise<FestivalEvent>((resolve, reject) => {
      stop = repository.subscribeTeamEvent(EVENT, TEAM, resolve, reject);
    });
    stop?.();
    const ui = (phase: MissionPhase) => (
      <AppProviders repositoryValue={{ repository, devTools: repository }}>
        <MemoryRouter>
          <ErrorHuntMission
            eventId={EVENT}
            view={view}
            event={event}
            phase={phase}
            gate={null}
            onSubmitted={() => undefined}
            config={config}
          />
        </MemoryRouter>
      </AppProviders>
    );
    const result = render(ui('waiting'));
    return { ...result, show: (phase: MissionPhase) => result.rerender(ui(phase)) };
  }

  it('선생님이 게임을 시작하면 새로고침 없이 그림이 나타난다', async () => {
    const { show } = await renderMission();
    expectHidden();

    show('active');
    expect(screen.getByRole('img', { name: 'AI가 만든 도서관 그림' })).toBeInTheDocument();
    expect(screen.queryByText('게임이 시작되면 그림이 나타나요')).toBeNull();
    expect(screen.getByRole('navigation', { name: '그림 번호' })).toBeInTheDocument();
    tapRegion(PUZZLES[0].regions[0]);
    expect(screen.getByText('찾은 곳 1/15')).toBeInTheDocument();
  });

  it('시간이 끝난 미션은 그림을 보여 주되 누를 수 없다', async () => {
    await renderMission({ roundStatus: 'closed' });
    expect(screen.getByRole('img', { name: 'AI가 만든 도서관 그림' })).toBeInTheDocument();
    tapRegion(PUZZLES[0].regions[0]);
    expect(screen.getByText('찾은 곳 0/15')).toBeInTheDocument();
  });
});

describe('교사 틀린그림 찾기: 그림과 정답', () => {
  async function openAnswerSheet() {
    const user = userEvent.setup();
    const repository = new MockEventRepository();
    await repository.signInTeacher();
    renderApp(`/teacher/${EVENT}/station/error-hunt`, repository);
    await user.click(await screen.findByRole('button', { name: /그림과 정답/ }));
    return user;
  }

  it('진행 학년의 그림 5장과 이상한 곳을 보여 준다', async () => {
    await openAnswerSheet();
    expect(screen.getByText(/정답이 보이는 화면이에요/)).toBeInTheDocument();
    const grades = screen.getByRole('group', { name: '그림을 볼 학년' });
    expect(within(grades).getByRole('button', { name: '4학년' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText(/4학년은 그림 5장에서 이상한 곳 15군데를 찾아요/)).toBeInTheDocument();
    for (const [index, puzzle] of PUZZLES.entries()) {
      expect(
        screen.getByRole('heading', { name: `${index + 1}번 그림 · ${puzzle.title}` }),
      ).toBeInTheDocument();
      for (const region of puzzle.regions) {
        expect(screen.getByText(region.label)).toBeInTheDocument();
      }
    }
  });

  it('학년을 바꿔 보고, 정답 표시를 숨길 수 있다', async () => {
    const user = await openAnswerSheet();
    await user.click(screen.getByRole('button', { name: '6학년' }));
    expect(screen.getByRole('heading', { name: '1번 그림 · 미술실' })).toBeInTheDocument();
    expect(screen.getByText('손가락이 6개')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: '정답 표시 숨기기' }));
    expect(screen.queryByText('손가락이 6개')).toBeNull();
    expect(screen.getByRole('img', { name: 'AI가 만든 미술실 그림' })).toBeInTheDocument();
  });

  it('순위표는 그 학년의 그림 기준으로 찾은 수를 보여 준다', async () => {
    const repository = new MockEventRepository();
    await repository.signInTeacher();
    renderApp(`/teacher/${EVENT}/station/error-hunt`, repository);
    const rows = await screen.findAllByText(/찾음 \d+\/15/);
    expect(rows.length).toBeGreaterThan(0);
  });
});
