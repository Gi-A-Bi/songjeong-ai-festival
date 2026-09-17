import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_EVENT_ID } from '../config';
import { toTeamId } from '../data/mock/keys';
import { MockEventRepository } from '../data/mock/MockEventRepository';
import { renderApp } from '../test/renderApp';

async function signedInRepository() {
  const repository = new MockEventRepository();
  await repository.signInTeacher();
  return repository;
}

describe('교사 미션 운영 화면', () => {
  it('골든벨 문제를 등록하면 저장소에 반영된다', async () => {
    const user = userEvent.setup();
    const repository = await signedInRepository();
    renderApp(`/teacher/${DEFAULT_EVENT_ID}/station/golden-bell`, repository);

    await user.click(await screen.findByRole('button', { name: /문제 등록 \(7문항\)/ }));
    await user.click(screen.getByRole('button', { name: /문제 추가/ }));
    await user.click(screen.getByRole('button', { name: /문제 저장/ }));
    // 빈 문제는 저장하지 않고 이유를 알려 준다.
    expect(await screen.findByText(/8번 문제: 문제를 적어 주세요/)).toBeInTheDocument();

    const card = screen.getByRole('heading', { name: '8번 문제' }).closest('li');
    if (!card) throw new Error('문제 카드가 없어요');
    await user.type(within(card).getByLabelText('문제'), '로봇은 무엇으로 움직일까요?');
    await user.type(within(card).getByLabelText('8번 문제 보기 1'), '명령');
    await user.type(within(card).getByLabelText('8번 문제 보기 2'), '기분');
    await user.click(screen.getByRole('button', { name: /문제 저장/ }));

    expect(await screen.findByText('문제를 저장했어요.')).toBeInTheDocument();
    const mission = await repository.getMission(DEFAULT_EVENT_ID, 'golden-bell');
    expect(mission.config.type === 'golden_bell' && mission.config.questions).toHaveLength(8);
  });

  it('그리기 미션에서 AI 평가 요청문을 그림 설명과 파일 이름으로 만든다', async () => {
    const repository = await signedInRepository();
    renderApp(`/teacher/${DEFAULT_EVENT_ID}/station/drawing`, repository);

    const prompt = await screen.findByRole<HTMLTextAreaElement>('textbox', {
      name: 'AI 평가 요청문',
    });
    expect(prompt.value).toContain('초록 언덕 위에 빨간 지붕 집');
    // 샘플 데이터에서 2라운드 그리기는 1·3·5반 2팀이 제출했다.
    expect(prompt.value).toContain('1. 4학년-1반-2팀_2라운드.webp');
    expect(prompt.value).toContain('3. 4학년-5반-2팀_2라운드.webp');
    expect(screen.getByRole('button', { name: /요청문 복사/ })).toBeEnabled();
  });

  it('확정 전 제출은 되돌릴 수 있다', async () => {
    const user = userEvent.setup();
    const repository = await signedInRepository();
    renderApp(`/teacher/${DEFAULT_EVENT_ID}/station/drawing`, repository);

    const [reopen] = await screen.findAllByRole('button', { name: /재제출 허용/ });
    await user.click(reopen);
    const dialog = await screen.findByRole('dialog', { name: /제출을 되돌릴까요/ });
    await user.click(within(dialog).getByRole('button', { name: /재제출 허용/ }));
    expect(await screen.findByText(/다시 제출할 수 있어요/)).toBeInTheDocument();
    expect(screen.getByText('재제출 대기')).toBeInTheDocument();
  });
});

describe('부스 화면의 실시간 제출과 라운드 따라가기', () => {
  // 샘플 데이터: 4학년 2라운드 골든벨은 5팀이 오고 3팀이 제출했다. 2반 5팀은 아직 제출 전이다.
  const stationPath = `/teacher/${DEFAULT_EVENT_ID}/station/golden-bell`;
  const submitLate = (repository: MockEventRepository) =>
    repository.saveSubmission({
      eventId: DEFAULT_EVENT_ID,
      missionId: 'golden-bell',
      teamId: toTeamId(4, 2, 5),
      answer: { type: 'golden_bell', selections: { q1: 1, q2: 2 } },
      requestId: 'late-submit',
    });

  it('학생이 제출하면 새로고침 없이 목록에 나타나고, 입력하던 점수는 지워지지 않는다', async () => {
    const user = userEvent.setup();
    const repository = await signedInRepository();
    renderApp(stationPath, repository);

    expect(await screen.findByText('제출 3/5')).toBeInTheDocument();
    const score = screen.getByRole<HTMLInputElement>('textbox', { name: '4학년 5반 5팀 점수' });
    await user.clear(score);
    await user.type(score, '150');

    await submitLate(repository);

    expect(await screen.findByText('제출 4/5')).toBeInTheDocument();
    expect(
      screen.getByRole<HTMLInputElement>('textbox', { name: '4학년 5반 5팀 점수' }).value,
    ).toBe('150');
    expect(
      screen.getByRole<HTMLInputElement>('textbox', { name: '4학년 2반 5팀 점수' }).value,
    ).toBe('200');
  });

  it('화면이 받지 못한 제출이 있으면 순위를 확정하지 않고 목록을 다시 불러온다', async () => {
    const user = userEvent.setup();
    const repository = await signedInRepository();
    // 구독이 끊긴 상황: 제출 알림이 화면에 오지 않는다.
    vi.spyOn(repository, 'subscribeStationSubmissions').mockReturnValue(() => undefined);
    renderApp(stationPath, repository);

    expect(await screen.findByText('제출 3/5')).toBeInTheDocument();
    await submitLate(repository);
    expect(screen.getByText('제출 3/5')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '순위 확정' }));
    const dialog = await screen.findByRole('dialog', { name: /순위를 확정할까요/ });
    await user.click(within(dialog).getByRole('button', { name: '순위 확정' }));

    expect(await screen.findByText(/새 제출이 들어와서 확정하지 않았어요/)).toBeInTheDocument();
    expect(await screen.findByText('제출 4/5')).toBeInTheDocument();
    const participants = await repository.listMissionParticipants(
      DEFAULT_EVENT_ID,
      'golden-bell',
      4,
      2,
    );
    expect(participants.every((participant) => participant.result === null)).toBe(true);
  });

  it('순위를 확정한 뒤 라운드가 끝나면 다음 라운드 화면으로 저절로 넘어간다', async () => {
    const user = userEvent.setup();
    const repository = await signedInRepository();
    renderApp(stationPath, repository);

    await user.click(await screen.findByRole('button', { name: '순위 확정' }));
    const dialog = await screen.findByRole('dialog', { name: /순위를 확정할까요/ });
    await user.click(within(dialog).getByRole('button', { name: '순위 확정' }));
    expect(await screen.findByText(/순위를 확정했어요/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /2라운드 참가 팀/ })).toBeInTheDocument();

    await repository.controlRound(DEFAULT_EVENT_ID, 'end');

    expect(await screen.findByRole('heading', { name: /3라운드 참가 팀/ })).toBeInTheDocument();
    expect(screen.queryByText(/지금 팀이 들어오는 라운드는/)).not.toBeInTheDocument();
  });

  it('확정 전에 라운드가 끝나면 화면을 옮기지 않고 안내를 띄운다', async () => {
    const user = userEvent.setup();
    const repository = await signedInRepository();
    renderApp(stationPath, repository);
    expect(await screen.findByRole('heading', { name: /2라운드 참가 팀/ })).toBeInTheDocument();

    await repository.controlRound(DEFAULT_EVENT_ID, 'end');

    expect(await screen.findByText(/지금 팀이 들어오는 라운드는/)).toBeInTheDocument();
    expect(
      screen.getByText(/2라운드 순위를 확정하면 3라운드로 자동으로 넘어가요/),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /2라운드 참가 팀/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /3라운드로 이동/ }));
    expect(await screen.findByRole('heading', { name: /3라운드 참가 팀/ })).toBeInTheDocument();
    expect(screen.queryByText(/지금 팀이 들어오는 라운드는/)).not.toBeInTheDocument();
  });

  it('지난 라운드를 직접 고르면 확정된 라운드여도 그대로 머문다', async () => {
    const user = userEvent.setup();
    const repository = await signedInRepository();
    renderApp(stationPath, repository);
    await screen.findByRole('heading', { name: /2라운드 참가 팀/ });

    await user.click(screen.getByRole('button', { name: '1' }));

    expect(await screen.findByRole('heading', { name: /1라운드 참가 팀/ })).toBeInTheDocument();
    expect(await screen.findByText(/순위 확정됨/)).toBeInTheDocument();
    expect(screen.getByText(/지금 팀이 들어오는 라운드는/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /1라운드 참가 팀/ })).toBeInTheDocument();
  });
});
