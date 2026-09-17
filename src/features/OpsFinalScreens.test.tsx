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
 * - 4학년: 2라운드 진행 중. 2반 3팀(과학실)·4반 5팀은 미도착, 5반 4팀은 다른 교실 QR을 찍었다.
 * - 3학년: 최종 미션이 열려 있다. 1반은 4번 문제를 푸는 중(힌트 5개 중 1개 사용),
 *   2·3반은 제출 완료, 4반은 시작 전이다. 결과는 아직 공개 전이다.
 */
const EVENT = DEFAULT_EVENT_ID;

async function repositoryAs(
  role: TeacherRole = 'admin',
  assignment: { missionId?: string; classId?: string } = {},
) {
  const repository = new MockEventRepository();
  if (role === 'admin') await repository.signInTeacher();
  else repository.signInAs(role, assignment);
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
    expect(screen.getByRole('button', { name: '라운드 종료' })).toBeEnabled();
  });

  it('부스 선생님에게 전체 현황은 읽기 전용이다', async () => {
    renderApp(
      `/teacher/${EVENT}/dashboard`,
      await repositoryAs('station_teacher', { missionId: 'ozobot' }),
    );
    expect(await screen.findByText(/전체 현황은 읽기 전용이에요/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '라운드 종료' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '일시정지' })).toBeDisabled();
    expect(await screen.findByRole('region', { name: '미션 교실별 현황' })).toBeInTheDocument();
  });
});

describe('부스 교사 화면', () => {
  it('미도착 팀을 직접 입장 처리하고 미션 시작을 누르면 입장한 팀이 진행 중이 된다', async () => {
    const user = userEvent.setup();
    const repository = await repositoryAs('station_teacher', { missionId: 'ozobot' });
    renderApp(`/teacher/${EVENT}/station/ozobot`, repository);

    expect(await screen.findByRole('heading', { name: /2라운드 입장 현황/ })).toBeInTheDocument();
    const demoRow = () => within(screen.getByRole('region', { name: /입장 현황/ }));
    await user.click(demoRow().getByRole('button', { name: '입장 처리' }));
    await waitFor(() =>
      expect(demoRow().queryByRole('button', { name: '입장 처리' })).not.toBeInTheDocument(),
    );
    const status = await repository.getTeamTourStatus(EVENT, DEMO_TEAM_ID);
    expect(status.state?.checkedInAt).toEqual(expect.any(Number));

    await user.click(screen.getByRole('button', { name: '미션 시작' }));
    expect(await screen.findByRole('button', { name: /시작함/ })).toBeDisabled();
    await waitFor(() => expect(demoRow().getAllByText('진행 중').length).toBeGreaterThan(1));
    expect(screen.getByText(new RegExp(`/check-in/${EVENT}/ozobot`))).toBeInTheDocument();
  });

  it('다른 미션을 맡은 부스 선생님은 미션을 시작할 수 없다', async () => {
    const user = userEvent.setup();
    const repository = await repositoryAs('station_teacher', { missionId: 'drawing' });
    renderApp(`/teacher/${EVENT}/station/ozobot`, repository);

    await user.click(await screen.findByRole('button', { name: '미션 시작' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    const booth = await repository.getMissionRoundState(EVENT, 'ozobot', 4, 2);
    expect(booth.startedAt).toBeNull();
  });
});

describe('학급 화면의 최종 미션 시작', () => {
  it('총괄 선생님이 열기 전에는 담임 선생님의 시작 버튼이 꺼져 있다', async () => {
    const classId = toClassId(4, 1);
    renderApp(
      `/teacher/${EVENT}/class/${classId}`,
      await repositoryAs('homeroom_teacher', { classId }),
    );
    expect(await screen.findByRole('button', { name: '최종 미션 시작' })).toBeDisabled();
    expect(screen.getByText(/총괄 선생님이 최종 미션을 열면 시작할 수 있어요/)).toBeInTheDocument();
  });

  it('다른 반 담임 선생님은 시작할 수 없다', async () => {
    renderApp(
      `/teacher/${EVENT}/class/${toClassId(3, 4)}`,
      await repositoryAs('homeroom_teacher', { classId: toClassId(3, 3) }),
    );
    expect(await screen.findByRole('button', { name: '최종 미션 시작' })).toBeDisabled();
    expect(screen.getByText(/담당 학급의 최종 미션만 시작할 수 있어요/)).toBeInTheDocument();
  });

  it('확인과 3, 2, 1 카운트다운 뒤 한 번만 시작되고 새로고침해도 시작 시각이 그대로다', async () => {
    const user = userEvent.setup();
    const classId = toClassId(3, 4);
    const repository = await repositoryAs('homeroom_teacher', { classId });
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
    const repository = await repositoryAs('homeroom_teacher', { classId });
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
    const repository = await repositoryAs('homeroom_teacher', { classId });
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

  it('다른 반 담임 선생님에게는 보기 전용이다', async () => {
    renderApp(
      `/teacher/${EVENT}/class/${toClassId(3, 1)}/final`,
      await repositoryAs('homeroom_teacher', { classId: toClassId(3, 2) }),
    );
    expect(await screen.findByText(/지금은 보기 전용이에요/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /구역을 나누어 차례로 비교한다/ })).toBeDisabled();
  });

  it('제출한 반의 화면은 결과 공개 전까지 점수와 순위를 숨긴다', async () => {
    const classId = toClassId(3, 2);
    renderApp(
      `/teacher/${EVENT}/class/${classId}/final`,
      await repositoryAs('homeroom_teacher', { classId }),
    );
    expect(await screen.findByText('10문제 제출 완료')).toBeInTheDocument();
    expect(screen.getByText(/점수와 순위는 같은 학년의 모든 반이 끝난 뒤/)).toBeInTheDocument();
    expect(screen.getByText('06:10')).toBeInTheDocument();
    expect(screen.queryByText(/\d위/)).toBeNull();
  });
});

describe('최종 미션 현황과 결과', () => {
  it('진행 중에는 담임 선생님에게 상태·문제 번호·시간·남은 힌트만 보이고 점수와 순위는 숨긴다', async () => {
    const user = userEvent.setup();
    renderApp(
      `/teacher/${EVENT}/final-results`,
      await repositoryAs('homeroom_teacher', { classId: toClassId(3, 4) }),
    );
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
    renderApp(
      `/class/${EVENT}/${classId}/final`,
      await repositoryAs('homeroom_teacher', { classId }),
    );
    expect(await screen.findByText('10문제 제출 완료')).toBeInTheDocument();
  });

  it('학생 기기의 예전 팀 결승 주소는 학급 카드 현황으로 이동한다', async () => {
    renderApp(`/team/${EVENT}/${toTeamId(3, 2, 1)}/final`);
    expect(await screen.findByRole('heading', { name: '3학년 2반 카드' })).toBeInTheDocument();
  });
});
