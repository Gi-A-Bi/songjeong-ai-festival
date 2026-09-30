import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_EVENT_ID } from '../config';
import { toTeamId } from '../data/mock/keys';
import { MockEventRepository } from '../data/mock/MockEventRepository';
import { labelPhoto } from '../lib/photoLabel';
import { renderApp } from '../test/renderApp';

// 테스트 환경에는 Canvas가 없어 팀 이름표 붙이기만 가짜로 바꾼다.
vi.mock('../lib/photoLabel', () => ({ labelPhoto: vi.fn(async () => null) }));

async function signedInRepository() {
  const repository = new MockEventRepository();
  await repository.signInTeacher();
  return repository;
}

/** 4학년 2반 2팀(2라운드 그리기, 아직 제출 전)이 그림 사진을 낸 상태의 저장소 */
async function repositoryWithPhoto() {
  const repository = new MockEventRepository();
  await repository.saveSubmission({
    eventId: DEFAULT_EVENT_ID,
    missionId: 'drawing',
    teamId: toTeamId(4, 2, 2),
    answer: {
      type: 'drawing',
      promptId: 'starry-night',
      mimeType: 'image/webp',
      byteSize: 3,
      width: 1280,
      height: 960,
    },
    requestId: 'photo-1',
    drawing: {
      promptId: 'starry-night',
      mimeType: 'image/webp',
      width: 1280,
      height: 960,
      bytes: new Uint8Array([1, 2, 3]),
    },
  });
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

  it('그리기 미션에서 AI 심사 요청문을 그 학년의 프롬프트와 파일 이름으로 만든다', async () => {
    const repository = await signedInRepository();
    renderApp(`/teacher/${DEFAULT_EVENT_ID}/station/drawing`, repository);

    const prompt = await screen.findByRole<HTMLTextAreaElement>('textbox', {
      name: 'AI 심사 요청문',
    });
    // 4학년은 3~4학년 ① 〈별이 빛나는 밤〉이 기본이다.
    expect(screen.getByText('① 반 고흐 〈별이 빛나는 밤〉')).toBeInTheDocument();
    expect(prompt.value).toContain('[제시 문장] : 반 고흐의 〈별이 빛나는 밤〉처럼');
    expect(prompt.value).toContain('10점 만점');
    // 답변 맨 위에 팀별 점수표가 나오게 한다.
    expect(prompt.value).toContain('[팀별 점수표]');
    expect(prompt.value).toContain('| 팀 | 요소·수량(3점) |');
    // 샘플 데이터에서 2라운드 그리기는 1·3·5반 2팀이 제출했다.
    expect(prompt.value).toContain('첨부한 그림은 모두 3장');
    expect(prompt.value).toContain('1. 4학년 1반 2팀');
    expect(prompt.value).toContain('3. 4학년 5반 2팀');
    expect(screen.getByRole('button', { name: /요청문 복사/ })).toBeEnabled();
  });

  it('제출한 그림이 없어도 AI 심사 요청문을 복사할 수 있다', async () => {
    const user = userEvent.setup();
    const repository = await signedInRepository();
    renderApp(`/teacher/${DEFAULT_EVENT_ID}/station/drawing`, repository);

    // 3라운드는 아직 열지 않아 제출한 그림이 없다.
    await user.click(await screen.findByRole('button', { name: '3라운드 열기 전' }));
    const gallery = await screen.findByRole('region', { name: /제출한 그림 사진/ });
    expect(await within(gallery).findByText('제출 0/5')).toBeInTheDocument();
    const prompt = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'AI 심사 요청문' });
    expect(prompt.value).toContain('[제시 문장] : 반 고흐의 〈별이 빛나는 밤〉처럼');
    expect(prompt.value).toContain('10점 만점');
    expect(prompt.value).not.toContain('[첨부한 그림]');
    expect(screen.getByText(/아직 제출한 그림 사진이 없어 팀 이름 없이/)).toBeInTheDocument();

    const copy = screen.getByRole('button', { name: /요청문 복사/ });
    expect(copy).toBeEnabled();
    await user.click(copy);
    expect(await screen.findByText('복사했어요')).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe(prompt.value);
    // 불러올 그림이 없으므로 그림 불러오기는 꺼져 있다.
    expect(screen.getByRole('button', { name: '그림 불러오기' })).toBeDisabled();
  });

  it('요청문이 바뀌면 복사했다는 표시를 지운다', async () => {
    const user = userEvent.setup();
    const repository = await signedInRepository();
    renderApp(`/teacher/${DEFAULT_EVENT_ID}/station/drawing`, repository);

    await user.click(await screen.findByRole('button', { name: /요청문 복사/ }));
    expect(await screen.findByText('복사했어요')).toBeInTheDocument();
    // 그림을 불러오면 사진 파일이 있는 팀만 남아 요청문이 달라진다.
    await user.click(screen.getByRole('button', { name: '그림 불러오기' }));
    await screen.findByRole('button', { name: '그림 다시 불러오기' });
    expect(screen.queryByText('복사했어요')).toBeNull();
  });

  it('그림을 불러오면 팀 이름표를 붙인 사진을 내려받고, 요청문에는 사진이 있는 팀만 적는다', async () => {
    const user = userEvent.setup();
    vi.mocked(labelPhoto).mockResolvedValueOnce({
      bytes: new Uint8Array([7, 7, 7, 7]),
      mimeType: 'image/jpeg',
      width: 1280,
      height: 1037,
    });
    const repository = await repositoryWithPhoto();
    renderApp(`/teacher/${DEFAULT_EVENT_ID}/station/drawing`, repository);

    await user.click(await screen.findByRole('button', { name: '그림 불러오기' }));
    const photo = await screen.findByRole('img', { name: '4학년 2반 2팀 그림' });
    expect(photo).toHaveAttribute('src', expect.stringContaining('data:image/jpeg'));
    expect(labelPhoto).toHaveBeenCalledWith(expect.any(Uint8Array), 'image/webp', '4학년 2반 2팀');
    expect(screen.getByRole('link', { name: /내려받기/ })).toHaveAttribute(
      'download',
      '4학년-2반-2팀_2라운드.jpg',
    );
    expect(screen.getByRole('button', { name: /모두 내려받기 \(ZIP 1개\)/ })).toBeEnabled();

    const prompt = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'AI 심사 요청문' });
    // 샘플 팀은 사진 파일이 없어 요청문에서 빠진다.
    expect(prompt.value).toContain('첨부한 그림은 모두 1장');
    expect(prompt.value).toContain('그림 아래쪽 흰 띠에 적힌 글자는 팀 이름표야.');
    expect(prompt.value).toMatch(/\[첨부한 그림\]\n1\. 4학년 2반 2팀$/);
    expect(screen.queryByText(/팀 이름표를 붙이지 못했어요/)).toBeNull();
  });

  it('팀 이름표를 붙이지 못하면 원래 사진을 쓰고 첨부 순서로 팀을 알아보게 한다', async () => {
    const user = userEvent.setup();
    const repository = await repositoryWithPhoto();
    renderApp(`/teacher/${DEFAULT_EVENT_ID}/station/drawing`, repository);

    await user.click(await screen.findByRole('button', { name: '그림 불러오기' }));
    expect(await screen.findByText(/팀 이름표를 붙이지 못했어요/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /내려받기/ })).toHaveAttribute(
      'download',
      '4학년-2반-2팀_2라운드.webp',
    );
    const prompt = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'AI 심사 요청문' });
    expect(prompt.value).toContain('1. 4학년 2반 2팀 (파일 이름: 4학년-2반-2팀_2라운드.webp)');
    expect(prompt.value).not.toContain('이름표');
  });

  it('명화 크게 보기는 원작 그림과 표현 기법, 프롬프트를 보여 준다', async () => {
    const user = userEvent.setup();
    const repository = await signedInRepository();
    renderApp(`/teacher/${DEFAULT_EVENT_ID}/station/drawing`, repository);

    await user.click(await screen.findByRole('button', { name: /명화 크게 보기/ }));
    const dialog = await screen.findByRole('dialog', { name: '반 고흐 〈별이 빛나는 밤〉' });
    expect(within(dialog).getByRole('img', { name: /별이 빛나는 밤/ })).toBeInTheDocument();
    expect(within(dialog).getByText('소용돌이치는 굵은 붓 터치')).toBeInTheDocument();
    expect(within(dialog).getByText(/노란 별 11개/)).toBeInTheDocument();
  });

  it('학년별 그림 프롬프트를 고르면 저장되고 요청문도 바뀐다', async () => {
    const user = userEvent.setup();
    const repository = await signedInRepository();
    renderApp(`/teacher/${DEFAULT_EVENT_ID}/station/drawing`, repository);

    await user.click(await screen.findByRole('button', { name: /프롬프트 고르기/ }));
    const grade3 = screen.getByRole('radiogroup', { name: '3학년 그림 프롬프트' });
    expect(within(grade3).getByRole('radio', { name: /별이 빛나는 밤/ })).toBeChecked();
    expect(screen.getByRole('button', { name: '프롬프트 저장' })).toBeDisabled();

    await user.click(within(grade3).getByRole('radio', { name: /이삭 줍는 여인들/ }));
    await user.click(screen.getByRole('button', { name: '프롬프트 저장' }));
    expect(await screen.findByText('학년별 그림 프롬프트를 저장했어요.')).toBeInTheDocument();

    const mission = await repository.getMission(DEFAULT_EVENT_ID, 'drawing');
    expect(mission.config.type === 'drawing' && mission.config.selectedPromptIds[3]).toBe(
      'gleaners',
    );
  });

  it('진행 중인 학년의 프롬프트를 바꿀 때는 한 번 더 묻는다', async () => {
    const user = userEvent.setup();
    const repository = await signedInRepository();
    renderApp(`/teacher/${DEFAULT_EVENT_ID}/station/drawing`, repository);

    await user.click(await screen.findByRole('button', { name: /프롬프트 고르기/ }));
    const grade4 = screen.getByRole('radiogroup', { name: '4학년 그림 프롬프트' });
    await user.click(within(grade4).getByRole('radio', { name: /이삭 줍는 여인들/ }));
    await user.click(screen.getByRole('button', { name: '프롬프트 저장' }));

    const dialog = await screen.findByRole('dialog', {
      name: '진행 중인 학년의 프롬프트를 바꿀까요?',
    });
    await user.click(within(dialog).getByRole('button', { name: '바꿔서 저장' }));
    expect(await screen.findByText('학년별 그림 프롬프트를 저장했어요.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /운영·채점/ }));
    const prompt = await screen.findByRole<HTMLTextAreaElement>('textbox', {
      name: 'AI 심사 요청문',
    });
    expect(prompt.value).toContain('[제시 문장] : 밀레의 〈이삭 줍는 여인들〉');
  });

  it('그리기 채점은 영역별 점수를 고르면 합계가 들어가고 10점을 넘으면 확정할 수 없다', async () => {
    const user = userEvent.setup();
    const repository = await signedInRepository();
    renderApp(`/teacher/${DEFAULT_EVENT_ID}/station/drawing`, repository);

    const team = '4학년 1반 2팀';
    await user.selectOptions(
      await screen.findByRole('combobox', { name: `${team} 요소·수량 점수(3점 만점)` }),
      '2',
    );
    await user.selectOptions(
      screen.getByRole('combobox', { name: `${team} 화풍 표현 점수(2점 만점)` }),
      '1',
    );
    const score = screen.getByRole<HTMLInputElement>('textbox', { name: `${team} 점수` });
    expect(score.value).toBe('3');

    await user.clear(score);
    await user.type(score, '70');
    expect(screen.getByText('점수는 0~10점으로 입력해 주세요.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '순위 확정' })).toBeDisabled();
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

    await user.click(screen.getByRole('button', { name: '정답 공개하고 순위 확정' }));
    const dialog = await screen.findByRole('dialog', { name: /순위를 확정할까요/ });
    await user.click(within(dialog).getByRole('button', { name: '정답 공개하고 순위 확정' }));

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

  it('다른 기기에서 라운드를 종료하면 다음 라운드 화면으로 저절로 넘어간다', async () => {
    const user = userEvent.setup();
    const repository = await signedInRepository();
    renderApp(stationPath, repository);

    await user.click(await screen.findByRole('button', { name: '정답 공개하고 순위 확정' }));
    const dialog = await screen.findByRole('dialog', { name: /순위를 확정할까요/ });
    await user.click(within(dialog).getByRole('button', { name: '정답 공개하고 순위 확정' }));
    expect(await screen.findByText(/정답을 공개하고 순위를 확정했어요/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /2라운드 참가 팀/ })).toBeInTheDocument();
    // 확정과 함께 학생 화면에 정답이 공개된다.
    expect(await repository.isAnswerRevealed(DEFAULT_EVENT_ID, 'golden-bell', 4, 2)).toBe(true);

    await repository.closeStationRound({
      eventId: DEFAULT_EVENT_ID,
      missionId: 'golden-bell',
      grade: 4,
      roundNo: 2,
    });

    expect(await screen.findByRole('heading', { name: /3라운드 참가 팀/ })).toBeInTheDocument();
    expect(screen.queryByText(/이 부스가 지금 진행할 라운드는/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '3라운드 열기' })).toBeEnabled();
  });

  it('지난 라운드를 직접 고르면 그 라운드에 머물고 지금 라운드로 돌아갈 수 있다', async () => {
    const user = userEvent.setup();
    const repository = await signedInRepository();
    renderApp(stationPath, repository);
    await screen.findByRole('heading', { name: /2라운드 참가 팀/ });

    await user.click(screen.getByRole('button', { name: '1라운드 라운드 종료' }));

    expect(await screen.findByRole('heading', { name: /1라운드 참가 팀/ })).toBeInTheDocument();
    expect(await screen.findByText(/순위 확정됨/)).toBeInTheDocument();
    expect(screen.getByText(/이 부스가 지금 진행할 라운드는/)).toBeInTheDocument();
    // 종료한 라운드에는 진행 버튼이 없다.
    const panel = within(screen.getByRole('region', { name: /1라운드 진행/ }));
    expect(panel.getByText(/1라운드를 종료했어요/)).toBeInTheDocument();
    expect(panel.queryByRole('button')).toBeNull();

    await user.click(screen.getByRole('button', { name: /2라운드로 이동/ }));
    expect(await screen.findByRole('heading', { name: /2라운드 참가 팀/ })).toBeInTheDocument();
    expect(screen.queryByText(/이 부스가 지금 진행할 라운드는/)).not.toBeInTheDocument();
  });

  it('아직 열지 않은 라운드를 미리 열 수 없고 이유를 알려 준다', async () => {
    const user = userEvent.setup();
    const repository = await signedInRepository();
    renderApp(stationPath, repository);
    await screen.findByRole('heading', { name: /2라운드 참가 팀/ });

    await user.click(screen.getByRole('button', { name: '3라운드 열기 전' }));

    expect(await screen.findByRole('heading', { name: /3라운드 진행/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '3라운드 열기' })).toBeDisabled();
    expect(
      screen.getByText(/앞 라운드를 종료한 뒤에 다음 라운드를 열 수 있어요/),
    ).toBeInTheDocument();
  });
});

describe('게임 시간 설정', () => {
  it('총괄은 행사 설정에서 게임 시간을 바꾼다', async () => {
    const user = userEvent.setup();
    const repository = await signedInRepository();
    renderApp(`/teacher/${DEFAULT_EVENT_ID}/admin`, repository);

    const field = await screen.findByRole<HTMLInputElement>('spinbutton', {
      name: '게임 시간(분)',
    });
    expect(field.value).toBe('10');
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled();

    await user.clear(field);
    await user.type(field, '45');
    expect(screen.getByText(/게임 시간은 3~30분으로 정해 주세요/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled();

    await user.clear(field);
    await user.type(field, '12');
    await user.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByText('게임 시간을 12분으로 바꿨어요.')).toBeInTheDocument();
    expect((await repository.getEvent(DEFAULT_EVENT_ID)).gameDurationMs).toBe(12 * 60_000);
  });
});

describe('미션 이름과 교실 설정', () => {
  it('총괄이 교실 이름을 바꾸면 학생 화면에는 학년이 붙어 보인다', async () => {
    const user = userEvent.setup();
    const repository = await signedInRepository();
    const admin = renderApp(`/teacher/${DEFAULT_EVENT_ID}/admin`, repository);

    // 기본값: 미션 1~4는 각 학년의 1~4반 교실, 미션 5는 도서관
    const room = await screen.findByRole<HTMLInputElement>('textbox', { name: '미션 4 교실' });
    expect(room.value).toBe('{학년} 4반 교실');
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: '미션 5 교실' }).value).toBe(
      '도서관',
    );
    expect(screen.getByRole('button', { name: '이름·교실 저장' })).toBeDisabled();

    await user.clear(room);
    expect(screen.getByText(/미션 4: 교실 이름을 적어 주세요/)).toBeInTheDocument();
    // user-event에서 여는 중괄호는 두 번 적어야 글자로 들어간다.
    await user.type(room, '{{학년} 과학실');
    expect(screen.getByRole('cell', { name: '4학년 과학실' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '이름·교실 저장' }));
    expect(await screen.findByText(/미션 1개의 이름·교실을 저장했어요/)).toBeInTheDocument();
    admin.unmount();

    const mission = await repository.getMission(DEFAULT_EVENT_ID, 'ozobot');
    expect(mission.room).toBe('{학년} 과학실');

    // 학생 화면(4학년 2반 3팀의 2라운드 과학실)에는 학년이 붙는다.
    await repository.signOutTeacher();
    renderApp(`/team/${DEFAULT_EVENT_ID}/${toTeamId(4, 2, 3)}`, repository);
    expect(await screen.findByText('4학년 과학실')).toBeInTheDocument();
  });

  it('교사는 미션 이름을 바꿀 수 있지만 행사 설정 화면은 열 수 없다', async () => {
    const repository = new MockEventRepository();
    repository.signInAs('teacher');
    const saved = await repository.updateMissionInfo(DEFAULT_EVENT_ID, 'golden-bell', {
      title: ' AI 골든벨 ',
      room: '{학년} 1반 교실',
      summary: '팀이 함께 AI 퀴즈를 풀어요',
    });
    expect(saved.title).toBe('AI 골든벨');
    await expect(
      repository.updateMissionInfo(DEFAULT_EVENT_ID, 'golden-bell', {
        title: '',
        room: '{학년} 1반 교실',
        summary: '',
      }),
    ).rejects.toThrow(/미션 이름/);
  });
});
