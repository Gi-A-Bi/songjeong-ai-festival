import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EVENT_ID } from '../config';
import { toClassId, toTeamId } from '../data/mock/keys';
import { MockEventRepository } from '../data/mock/MockEventRepository';
import { DEMO_TEAM_ID } from '../data/mock/seed';
import type { TeacherRole } from '../domain/types';
import { renderApp } from '../test/renderApp';

/*
 * 샘플 데이터
 * - 4학년: 2라운드. 네 부스는 게임 중이고 도서관은 라운드만 열어 두었다.
 *   2반 3팀(과학실)·4반 5팀은 미도착, 5반 4팀은 도서관 대신 다른 교실 QR을 찍었다.
 * - 3학년: 최종 미션이 열려 있다. 1반은 4번 문제를 푸는 중(힌트 5개 중 1개 사용),
 *   2·3반은 제출 완료, 4반은 시작 전이다. 결과는 아직 공개 전이다.
 */
const EVENT = DEFAULT_EVENT_ID;

async function repositoryAs(role: TeacherRole = 'admin') {
  const repository = new MockEventRepository();
  if (role === 'admin') await repository.signInTeacher();
  else repository.signInAs(role);
  return repository;
}

function rowOf(name: string): HTMLElement {
  const row = screen.getByRole('rowheader', { name }).closest('tr');
  if (!row) throw new Error(`${name} 행이 없어요`);
  return row;
}

describe('실시간 운영 대시보드', () => {
  it('현재 학년의 부스 5곳, 학급·팀 표, 확인이 필요한 팀을 한 화면에 보여 준다', async () => {
    renderApp(`/teacher/${EVENT}/dashboard`, await repositoryAs());

    const alerts = await screen.findByRole('region', { name: /확인 필요 \(\d+건\)/ });
    expect(within(alerts).getAllByText('미도착').length).toBeGreaterThanOrEqual(2);
    expect(within(alerts).getByText('잘못된 교실')).toBeInTheDocument();
    expect(within(alerts).getAllByText('4학년 2반 3팀').length).toBeGreaterThan(0);
    expect(within(alerts).getAllByText('4학년 5반 4팀').length).toBeGreaterThan(0);

    const stations = screen.getByRole('region', { name: '미션 교실별 현황' });
    expect(within(stations).getAllByRole('heading', { level: 3 })).toHaveLength(5);
    expect(screen.getByRole('region', { name: '학급·팀별 현황' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '최근 활동' })).toBeInTheDocument();
    // 부스마다 자기 라운드와 단계를 보여 준다.
    expect(within(stations).getAllByText('2라운드 · 게임 중')).toHaveLength(4);
    expect(within(stations).getByText('2라운드 · 입장 중')).toBeInTheDocument();
    expect(within(stations).getAllByRole('timer')).toHaveLength(4);

    // 총괄은 진행 학년을 고른다. 라운드는 부스에서 진행하므로 여기에는 라운드 버튼이 없다.
    const grades = screen.getByRole('group', { name: '진행 학년' });
    expect(within(grades).getByRole('button', { name: '4학년' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(grades).getByRole('button', { name: '5학년' })).toBeEnabled();
    expect(screen.getByText(/게임 시간/)).toHaveTextContent('10분');
    expect(screen.queryByRole('button', { name: /라운드 종료|일시정지/ })).toBeNull();
  });

  it('종료하지 않은 부스 라운드가 있으면 진행 학년을 바꾸지 못하고 이유를 알려 준다', async () => {
    const user = userEvent.setup();
    const repository = await repositoryAs();
    renderApp(`/teacher/${EVENT}/dashboard`, repository);
    const grades = await screen.findByRole('group', { name: '진행 학년' });
    await user.click(within(grades).getByRole('button', { name: '5학년' }));
    const dialog = await screen.findByRole('dialog', { name: '5학년을 진행할까요?' });
    await user.click(within(dialog).getByRole('button', { name: '5학년 진행' }));
    expect(
      await screen.findByText(/4학년에 아직 종료하지 않은 부스 라운드가 있어요/),
    ).toBeInTheDocument();
    expect((await repository.getEvent(EVENT)).activeGrade).toBe(4);
  });

  it('교사에게는 같은 화면이 보이고 진행 학년 고르기만 꺼져 있다', async () => {
    renderApp(`/teacher/${EVENT}/dashboard`, await repositoryAs('teacher'));
    expect(await screen.findByText(/라운드는 부스마다 선생님이 진행해요/)).toBeInTheDocument();
    expect(screen.getByText(/진행 학년은 총괄 선생님이 골라요/)).toBeInTheDocument();
    // 메뉴는 총괄과 같고 행사 설정만 없다.
    expect(screen.getByRole('link', { name: 'QR 인쇄' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '행사 설정' })).toBeNull();
    const booths = await screen.findByRole('navigation', { name: '부스 바로 가기' });
    expect(within(booths).getAllByRole('link')).toHaveLength(5);
    const grades = screen.getByRole('group', { name: '진행 학년' });
    for (const button of within(grades).getAllByRole('button')) expect(button).toBeDisabled();
    expect(await screen.findByRole('region', { name: '미션 교실별 현황' })).toBeInTheDocument();
  });
});

describe('부스 교사 화면', () => {
  const steps = () => within(screen.getByRole('list', { name: '라운드 진행 순서' }));
  const currentStep = () =>
    steps()
      .getAllByRole('listitem')
      .find((item) => item.getAttribute('aria-current') === 'step')?.textContent;

  it('미도착 팀을 직접 입장 처리할 수 있다', async () => {
    const user = userEvent.setup();
    const repository = await repositoryAs('teacher');
    renderApp(`/teacher/${EVENT}/station/ozobot`, repository);

    expect(await screen.findByRole('heading', { name: /2라운드 입장 현황/ })).toBeInTheDocument();
    const demoRow = () => within(screen.getByRole('region', { name: /입장 현황/ }));
    await user.click(demoRow().getByRole('button', { name: '입장 처리' }));
    await waitFor(() =>
      expect(demoRow().queryByRole('button', { name: '입장 처리' })).not.toBeInTheDocument(),
    );
    const status = await repository.getTeamTourStatus(EVENT, DEMO_TEAM_ID);
    expect(status.state?.checkedInAt).toEqual(expect.any(Number));
    // 과학실은 게임 중이라 입장하면 바로 진행 중이 된다.
    await waitFor(() => expect(demoRow().getAllByText('진행 중')).toHaveLength(5));
    expect(screen.getByText(new RegExp(`/check-in/${EVENT}/ozobot`))).toBeInTheDocument();
  });

  it('게임 중인 부스는 남은 시간을 보여 주고, 순위를 확정하기 전에는 라운드를 종료할 수 없다', async () => {
    renderApp(`/teacher/${EVENT}/station/golden-bell`, await repositoryAs('teacher'));

    const panel = within(await screen.findByRole('region', { name: /2라운드 진행/ }));
    expect(panel.getByText('게임 중')).toBeInTheDocument();
    expect(panel.getByRole('timer', { name: /남은 시간/ })).toBeInTheDocument();
    expect(currentStep()).toMatch(/순위 매기기/);
    expect(panel.getByRole('button', { name: '2라운드 종료' })).toBeDisabled();
    expect(panel.getByText(/순위를 확정한 뒤에 라운드를 종료할 수 있어요/)).toBeInTheDocument();
    expect(panel.getByRole('button', { name: '순위표로 이동' })).toBeInTheDocument();
  });

  it('라운드 열기 → 게임 시작 → 순위 매기기 → 라운드 종료 순서로 진행한다', async () => {
    const user = userEvent.setup();
    const repository = await repositoryAs('teacher');
    // 도서관은 2라운드를 열어 두고 아직 게임을 시작하지 않았다. 5반 4팀은 아직 오지 않았다.
    renderApp(`/teacher/${EVENT}/station/library-check`, repository);

    const panel = () => within(screen.getByRole('region', { name: /라운드 진행/ }));
    expect(await screen.findByRole('heading', { name: /2라운드 진행/ })).toBeInTheDocument();
    expect(currentStep()).toMatch(/게임 시작/);
    expect(await panel().findByText('4 / 5팀')).toBeInTheDocument();

    // 아직 오지 않은 팀이 있으면 한 번 더 묻는다.
    await user.click(panel().getByRole('button', { name: '게임 시작' }));
    const startDialog = await screen.findByRole('dialog', {
      name: /아직 1팀이 입장하지 않았어요/,
    });
    await user.click(within(startDialog).getByRole('button', { name: '게임 시작' }));
    expect(await screen.findByText(/2라운드: 게임을 시작했어요/)).toBeInTheDocument();
    expect(panel().getByText('게임 중')).toBeInTheDocument();
    expect(currentStep()).toMatch(/순위 매기기/);
    expect(panel().getByRole('button', { name: '2라운드 종료' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: '순위 확정' }));
    const rankDialog = await screen.findByRole('dialog', { name: /순위를 확정할까요/ });
    await user.click(within(rankDialog).getByRole('button', { name: '순위 확정' }));
    expect(await screen.findByText(/2라운드: 순위를 확정했어요/)).toBeInTheDocument();
    await waitFor(() => expect(currentStep()).toMatch(/라운드 종료/));
    // 순위표 옆에서도 라운드를 종료해야 한다고 알려 준다.
    expect(screen.getByText(/눌러야 팀이 다음 교실에 들어갈 수 있어요/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2라운드 종료하러 가기' })).toBeInTheDocument();

    await user.click(panel().getByRole('button', { name: '2라운드 종료' }));
    const closeDialog = await screen.findByRole('dialog', { name: '2라운드를 종료할까요?' });
    await user.click(within(closeDialog).getByRole('button', { name: '2라운드 종료' }));

    // 종료하면 화면이 다음 라운드로 넘어가 다시 "라운드 열기"부터 시작한다.
    expect(await screen.findByRole('heading', { name: /3라운드 진행/ })).toBeInTheDocument();
    expect(screen.getByText(/2라운드: 라운드를 종료했어요/)).toBeInTheDocument();
    expect(currentStep()).toMatch(/라운드 열기/);
    await user.click(panel().getByRole('button', { name: '3라운드 열기' }));
    expect(await panel().findByText('입장 중')).toBeInTheDocument();

    const rounds = await repository.getStationRounds(EVENT, 'library-check', 4);
    expect(rounds.map((round) => round.status)).toEqual([
      'completed',
      'completed',
      'open',
      'ready',
      'ready',
    ]);
  });

  it('라운드 건너뛰기는 한 번 더 묻고, 건너뛰면 다음 라운드로 넘어간다', async () => {
    const user = userEvent.setup();
    const repository = await repositoryAs('teacher');
    renderApp(`/teacher/${EVENT}/station/library-check`, repository);

    const panel = () => within(screen.getByRole('region', { name: /라운드 진행/ }));
    expect(await screen.findByRole('heading', { name: /2라운드 진행/ })).toBeInTheDocument();
    await user.click(panel().getByRole('button', { name: '2라운드 건너뛰기' }));
    const dialog = within(await screen.findByRole('dialog', { name: '2라운드를 건너뛸까요?' }));
    expect(dialog.getByText(/건너뛴 라운드는 다시 열 수 없어요/)).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: '2라운드 건너뛰기' }));

    expect(await screen.findByRole('heading', { name: /3라운드 진행/ })).toBeInTheDocument();
    expect(screen.getByText(/2라운드: 라운드를 건너뛰었어요/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2라운드 건너뜀' })).toBeInTheDocument();
    expect(panel().getByRole('button', { name: '3라운드 열기' })).toBeEnabled();

    // 건너뛴 라운드를 다시 보면 진행 버튼이 없다.
    await user.click(screen.getByRole('button', { name: '2라운드 건너뜀' }));
    expect(await panel().findByText('건너뜀')).toBeInTheDocument();
    expect(panel().getByText(/2라운드를 건너뛰었어요/)).toBeInTheDocument();
    expect(panel().queryByRole('button')).toBeNull();
    expect(screen.queryByRole('list', { name: '라운드 진행 순서' })).toBeNull();
  });

  it('순위를 확정한 라운드에는 건너뛰기 버튼이 없다', async () => {
    const user = userEvent.setup();
    renderApp(`/teacher/${EVENT}/station/golden-bell`, await repositoryAs('teacher'));
    const panel = () => within(screen.getByRole('region', { name: /라운드 진행/ }));
    expect(await screen.findByRole('heading', { name: /2라운드 진행/ })).toBeInTheDocument();
    expect(panel().getByRole('button', { name: '2라운드 건너뛰기' })).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: '순위 확정' }));
    const dialog = await screen.findByRole('dialog', { name: /순위를 확정할까요/ });
    await user.click(within(dialog).getByRole('button', { name: '순위 확정' }));
    await waitFor(() => expect(currentStep()).toMatch(/라운드 종료/));
    expect(panel().queryByRole('button', { name: '2라운드 건너뛰기' })).toBeNull();
    expect(panel().getByRole('button', { name: '2라운드 종료' })).toBeEnabled();
  });

  it('교사는 담당을 나누지 않고 어느 부스든 운영한다', async () => {
    const repository = await repositoryAs('teacher');
    renderApp(`/teacher/${EVENT}/station/drawing`, repository);
    expect(await screen.findByRole('heading', { name: /2라운드 진행/ })).toBeInTheDocument();
    // 같은 계정으로 다른 부스도 운영할 수 있다.
    await expect(
      repository.startStationRound({
        eventId: EVENT,
        missionId: 'library-check',
        grade: 4,
        roundNo: 2,
      }),
    ).resolves.toMatchObject({ status: 'active' });
  });
});

describe('학급 화면의 최종 미션 시작', () => {
  it('총괄 선생님이 열기 전에는 교사의 시작 버튼이 꺼져 있다', async () => {
    const classId = toClassId(4, 1);
    renderApp(`/teacher/${EVENT}/class/${classId}`, await repositoryAs('teacher'));
    expect(await screen.findByRole('button', { name: '최종 미션 시작' })).toBeDisabled();
    expect(screen.getByText(/총괄 선생님이 최종 미션을 열면 시작할 수 있어요/)).toBeInTheDocument();
  });

  it('교사는 어느 반이든 최종 미션을 시작할 수 있다', async () => {
    renderApp(`/teacher/${EVENT}/class/${toClassId(3, 4)}`, await repositoryAs('teacher'));
    expect(await screen.findByRole('button', { name: '최종 미션 시작' })).toBeEnabled();
  });

  it('확인과 3, 2, 1 카운트다운 뒤 한 번만 시작되고 새로고침해도 시작 시각이 그대로다', async () => {
    const user = userEvent.setup();
    const classId = toClassId(3, 4);
    const repository = await repositoryAs('teacher');
    const first = renderApp(`/teacher/${EVENT}/class/${classId}`, repository);

    await user.click(await screen.findByRole('button', { name: '최종 미션 시작' }));
    const dialog = await screen.findByRole('dialog', { name: '3학년 4반 최종 미션을 시작할까요?' });
    expect(
      within(dialog).getByText('시작하면 시간이 측정되며 다시 시작할 수 없습니다.'),
    ).toBeInTheDocument();
    // 확인 전에는 시작이 기록되지 않는다.
    expect((await repository.getClassFinalView(EVENT, classId)).state.startedAt).toBeNull();

    await user.click(within(dialog).getByRole('button', { name: /시작하기/ }));
    expect(await screen.findByRole('alertdialog', { name: '시작 카운트다운' })).toBeInTheDocument();
    expect(await screen.findByText('문제 1 / 10', {}, { timeout: 8000 })).toBeInTheDocument();

    const started = await repository.getClassFinalView(EVENT, classId);
    expect(started.state.startedAt).not.toBeNull();
    expect(started.state.hintTotal).toBe(started.state.completedCardTypeCountSnapshot);

    // 새로고침: 같은 저장소로 화면을 다시 열어도 시작 시각과 문제가 그대로다.
    first.unmount();
    renderApp(`/teacher/${EVENT}/class/${classId}/final`, repository);
    expect(await screen.findByText('문제 1 / 10')).toBeInTheDocument();
    const again = await repository.getClassFinalView(EVENT, classId);
    expect(again.state.startedAt).toBe(started.state.startedAt);
  }, 20_000);
});

describe('전자칠판 최종 미션', () => {
  it('보기를 고르고 바꾸고 힌트를 쓴 뒤 확정하면 다음 문제로 가며 정답 여부는 보이지 않는다', async () => {
    const user = userEvent.setup();
    const classId = toClassId(3, 1);
    const repository = await repositoryAs('teacher');
    renderApp(`/teacher/${EVENT}/class/${classId}/final`, repository);

    expect(await screen.findByText('문제 4 / 10')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /두 그림에서 서로 다른 곳을/ })).toBeInTheDocument();
    expect(screen.getByText('4 / 5')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /답 확정하고 다음 문제로/ })).toBeDisabled();

    // 확정 전에는 답을 바꿀 수 있다.
    await user.click(screen.getByRole('button', { name: /한 번 훑어보고 끝낸다/ }));
    await user.click(screen.getByRole('button', { name: /구역을 나누어 차례로 비교한다/ }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /구역을 나누어 차례로 비교한다/ })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );
    expect(screen.getByRole('button', { name: /한 번 훑어보고 끝낸다/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    // 힌트: 틀린 보기 하나가 사라지고 남은 힌트가 줄어든다.
    await user.click(screen.getByRole('button', { name: '힌트 사용 (남은 4개)' }));
    const hintDialog = await screen.findByRole('dialog', { name: '힌트를 쓸까요?' });
    await user.click(within(hintDialog).getByRole('button', { name: /힌트 쓰기/ }));
    expect(await screen.findByText('3 / 5')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /눈을 감고 떠올려 본다/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: '이 문제는 힌트 사용함' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /답 확정하고 다음 문제로/ }));
    expect(await screen.findByText('문제 5 / 10')).toBeInTheDocument();
    expect(screen.queryByText(/정답이에요|틀렸어요|오답/)).toBeNull();

    const view = await repository.getClassFinalView(EVENT, classId);
    expect(view.state.currentQuestionIndex).toBe(4);
    expect(view.state.hintUsed).toBe(2);
    // 진행 중에는 정답 수를 내려 주지 않는다.
    expect(view.state.correctCount).toBeNull();
  });

  it('새로고침해도 현재 문제와 고른 답, 남은 힌트가 복구된다', async () => {
    const user = userEvent.setup();
    const classId = toClassId(3, 1);
    const repository = await repositoryAs('teacher');
    const first = renderApp(`/teacher/${EVENT}/class/${classId}/final`, repository);

    await user.click(await screen.findByRole('button', { name: /구역을 나누어 차례로 비교한다/ }));
    await waitFor(async () => {
      const view = await repository.getClassFinalView(EVENT, classId);
      expect(view.response?.selectedChoiceId).toBe('b');
    });

    first.unmount();
    renderApp(`/teacher/${EVENT}/class/${classId}/final`, repository);
    expect(await screen.findByText('문제 4 / 10')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /구역을 나누어 차례로 비교한다/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('4 / 5')).toBeInTheDocument();
  });

  it('교사는 어느 반의 최종 미션이든 진행할 수 있다', async () => {
    renderApp(`/teacher/${EVENT}/class/${toClassId(3, 1)}/final`, await repositoryAs('teacher'));
    expect(
      await screen.findByRole('button', { name: /구역을 나누어 차례로 비교한다/ }),
    ).toBeEnabled();
    expect(screen.queryByText(/지금은 보기 전용이에요/)).toBeNull();
  });

  it('제출한 반의 화면은 결과 공개 전까지 점수와 순위를 숨긴다', async () => {
    const classId = toClassId(3, 2);
    renderApp(`/teacher/${EVENT}/class/${classId}/final`, await repositoryAs('teacher'));
    expect(await screen.findByText('10문제 제출 완료')).toBeInTheDocument();
    expect(screen.getByText(/점수와 순위는 같은 학년의 모든 반이 끝난 뒤/)).toBeInTheDocument();
    expect(screen.getByText('06:10')).toBeInTheDocument();
    expect(screen.queryByText(/\d위/)).toBeNull();
  });
});

describe('최종 미션 현황과 결과', () => {
  it('진행 중에는 교사에게 상태·문제 번호·시간·남은 힌트만 보이고 점수와 순위는 숨긴다', async () => {
    const user = userEvent.setup();
    renderApp(`/teacher/${EVENT}/final-results`, await repositoryAs('teacher'));
    await user.selectOptions(await screen.findByLabelText('학년'), '3');

    const active = within(await waitFor(() => rowOf('3학년 1반')));
    expect(active.getByText('풀이 중')).toBeInTheDocument();
    expect(active.getByText('4 / 10')).toBeInTheDocument();
    expect(active.getByText('4 / 5')).toBeInTheDocument();
    expect(within(rowOf('3학년 2반')).getByText('06:10')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: '순위' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: '정답' })).toBeNull();
    expect(screen.queryByRole('button', { name: '결과 공개' })).toBeNull();
    expect(screen.getByText(/점수와 순위는 모든 반이 제출한 뒤/)).toBeInTheDocument();
  });

  it('총괄 선생님은 모든 반이 제출한 뒤에만 결과를 공개할 수 있고 공개하면 순위가 보인다', async () => {
    const user = userEvent.setup();
    const repository = await repositoryAs();
    renderApp(`/teacher/${EVENT}/final-results`, repository);
    await user.selectOptions(await screen.findByLabelText('학년'), '3');

    const publish = await screen.findByRole('button', { name: '결과 공개' });
    expect(publish).toBeDisabled();

    // 남은 두 반을 마감하면 실시간으로 공개 버튼이 켜진다.
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (const classNo of [1, 4]) {
      await repository.forceCloseClassFinal({
        eventId: EVENT,
        classId: toClassId(3, classNo),
        reason: '테스트 마감',
      });
    }
    await waitFor(() => expect(screen.getByRole('button', { name: '결과 공개' })).toBeEnabled());

    await user.click(screen.getByRole('button', { name: '결과 공개' }));
    const dialog = await screen.findByRole('dialog', { name: '3학년 최종 결과를 공개할까요?' });
    await user.click(within(dialog).getByRole('button', { name: '결과 공개' }));

    expect(await screen.findByRole('columnheader', { name: '순위' })).toBeInTheDocument();
    const board = await repository.getFinalBoard(EVENT, 3);
    expect(board.session.status).toBe('results_published');
    for (const row of board.rows) {
      expect(
        within(rowOf(row.classInfo.displayName)).getByText(`${row.state.finalRank}위`),
      ).toBeInTheDocument();
    }
    // 정답 3개인 1반이 3위, 시작하지 못한 4반이 4위다.
    expect(within(rowOf('3학년 1반')).getByText('3위')).toBeInTheDocument();
    expect(within(rowOf('3학년 4반')).getByText('4위')).toBeInTheDocument();
  });

  it('조건을 채우지 못한 학년은 사유를 남겨야 강제로 열 수 있다', async () => {
    const user = userEvent.setup();
    const repository = await repositoryAs();
    renderApp(`/teacher/${EVENT}/final-results`, repository);

    await user.click(await screen.findByRole('button', { name: '4학년 최종 미션 열기' }));
    const dialog = await screen.findByRole('dialog', { name: '4학년 최종 미션을 열까요?' });
    expect(within(dialog).getByText(/5라운드가 아직 끝나지 않았어요/)).toBeInTheDocument();
    const force = within(dialog).getByRole('button', { name: '사유를 남기고 강제로 열기' });
    expect(force).toBeDisabled();

    await user.type(within(dialog).getByLabelText('강제로 여는 사유'), '리허설 확인');
    await user.click(force);
    expect(await screen.findByText('진행 중(반별 시작)')).toBeInTheDocument();
    const board = await repository.getFinalBoard(EVENT, 4);
    expect(board.session.status).toBe('open');
    expect(board.session.forceOpenReason).toBe('리허설 확인');
  });

  it('결과 보정은 사유가 있어야 저장되고 보정 기록이 남는다', async () => {
    const user = userEvent.setup();
    const repository = await repositoryAs();
    renderApp(`/teacher/${EVENT}/final-results`, repository);
    await user.selectOptions(await screen.findByLabelText('학년'), '3');

    const row = within(await waitFor(() => rowOf('3학년 2반')));
    await user.click(row.getByRole('button', { name: '보정' }));
    const dialog = await screen.findByRole('dialog', { name: '3학년 2반 결과 보정' });
    const save = within(dialog).getByRole('button', { name: '보정 저장' });
    expect(save).toBeDisabled();

    await user.type(within(dialog).getByLabelText(/정답 수/), '9');
    await user.type(within(dialog).getByLabelText(/사유/), '채점 입력 오류');
    await user.click(save);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const board = await repository.getFinalBoard(EVENT, 3);
    const adjusted = board.rows.find((item) => item.classInfo.id === toClassId(3, 2));
    expect(adjusted?.state.correctCount).toBe(9);
    expect(adjusted?.state.manualOverride).toBe(true);
    expect(adjusted?.state.overrideReason).toBe('채점 입력 오류');
  });
});

describe('예전 주소', () => {
  it('예전 교사 미션·결승 주소는 새 화면으로 이동한다', async () => {
    const repository = await repositoryAs();
    const first = renderApp(`/teacher/${EVENT}/mission/ozobot`, repository);
    expect(await screen.findByRole('heading', { name: /2라운드 입장 현황/ })).toBeInTheDocument();
    first.unmount();

    renderApp(`/teacher/${EVENT}/final`, repository);
    expect(await screen.findByRole('heading', { name: '학급 최종 미션' })).toBeInTheDocument();
  });

  it('예전 학급 결승 주소는 학급 최종 미션 화면으로 이동한다', async () => {
    const classId = toClassId(3, 2);
    renderApp(`/class/${EVENT}/${classId}/final`, await repositoryAs('teacher'));
    expect(await screen.findByText('10문제 제출 완료')).toBeInTheDocument();
  });

  it('학생 기기의 예전 팀 결승 주소는 학급 카드 현황으로 이동한다', async () => {
    renderApp(`/team/${EVENT}/${toTeamId(3, 2, 1)}/final`);
    expect(await screen.findByRole('heading', { name: '3학년 2반 카드' })).toBeInTheDocument();
  });
});
