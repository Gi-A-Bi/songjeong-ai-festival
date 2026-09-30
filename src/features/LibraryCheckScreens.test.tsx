import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EVENT_ID } from '../config';
import { toTeamId } from '../data/mock/keys';
import { MockEventRepository } from '../data/mock/MockEventRepository';
import type { LibraryCheckConfig } from '../domain/types';
import { renderApp } from '../test/renderApp';

const EVENT = DEFAULT_EVENT_ID;
// 샘플 데이터: 4학년 2라운드 도서관은 라운드만 열었고, 1반 4팀은 입장했다.
const TEAM = toTeamId(4, 1, 4);
const BOOTH = {
  eventId: EVENT,
  missionId: 'library-check',
  grade: 4 as const,
  roundNo: 2 as const,
};

async function startedRepository() {
  const repository = new MockEventRepository();
  await repository.signInTeacher();
  await repository.startStationRound(BOOTH);
  await repository.signOutTeacher();
  return repository;
}

async function getConfig(repository: MockEventRepository): Promise<LibraryCheckConfig> {
  const mission = await repository.getMission(EVENT, 'library-check');
  if (mission.config.type !== 'library_check') throw new Error('오류찾기 설정이 아니에요');
  return mission.config;
}

describe('학생 도서관 오류찾기: 제출 즉시 자동 채점', () => {
  it('게임이 시작되면 글이 보이고, 제출하면 항목별 점수가 바로 나온다', async () => {
    const user = userEvent.setup();
    const repository = await startedRepository();
    renderApp(`/team/${EVENT}/${TEAM}/mission/library-check`, repository);

    expect(await screen.findByText(/꿀벌은 다리가 8개인 곤충이에요/)).toBeInTheDocument();
    expect(screen.getByText(/제출하면 바로 채점돼요/)).toBeInTheDocument();
    // 정답을 등록한 미션은 선생님 판정이 아니다.
    expect(screen.queryByText('선생님 판정')).toBeNull();

    await user.type(screen.getByLabelText('1. 잘못된 부분'), '다리가 8개라고 한 것');
    await user.type(screen.getByLabelText('2. 책에서 찾은 올바른 내용'), '꿀벌 다리는 6개');
    await user.type(screen.getByLabelText('3. 책 제목'), '곤충 이야기');
    await user.type(screen.getByLabelText('4. 쪽수'), '23');
    await user.click(screen.getByRole('button', { name: '확인 내용 제출' }));

    expect(await screen.findByText(/제출 완료 · 자동 채점 80점 \/ 100점/)).toBeInTheDocument();
    expect(screen.getByText(/제출했어요! 결과 발표를 기다려요/)).toBeInTheDocument();
    const result = screen.getByRole('region', { name: /자동 채점 결과/ });
    expect(within(result).getByText(/틀린 부분/)).toHaveTextContent('30점');
    expect(within(result).getByText(/올바른 내용/)).toHaveTextContent('40점');
    expect(within(result).getByText(/책 제목/)).toHaveTextContent('0점');
    expect(within(result).getByText(/쪽수/)).toHaveTextContent('10점');

    // 교사 순위표에도 자동 점수가 들어간다.
    await repository.signInTeacher();
    const participants = await repository.listMissionParticipants(EVENT, 'library-check', 4, 2);
    expect(participants.find((item) => item.team.id === TEAM)?.submission?.score).toBe(80);
  });
});

describe('교사 도서관 오류찾기: 글과 정답 등록', () => {
  it('정답을 고쳐 저장하면 자동 채점 기준이 바뀌고, 모두 비우면 선생님 판정이 된다', async () => {
    const user = userEvent.setup();
    const repository = new MockEventRepository();
    await repository.signInTeacher();
    renderApp(`/teacher/${EVENT}/station/library-check`, repository);

    await user.click(await screen.findByRole('button', { name: /글과 정답 등록 \(자동 채점\)/ }));
    const bookTitles = screen.getByLabelText(/3\. 확인할 수 있는 책 제목/);
    expect(bookTitles).toHaveValue('신기한 곤충 백과');
    await user.type(bookTitles, ', 곤충 이야기');
    await user.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByText(/이제 제출 즉시 자동으로 채점돼요/)).toBeInTheDocument();
    expect((await getConfig(repository)).answerKey?.bookTitles).toEqual([
      '신기한 곤충 백과',
      '곤충 이야기',
    ]);

    // 정답을 모두 비우면 선생님이 직접 채점한다.
    for (const label of [
      /1\. 틀린 부분/,
      /2\. 올바른 내용/,
      /3\. 확인할 수 있는 책 제목/,
      /첫 쪽/,
      /마지막 쪽/,
    ]) {
      await user.clear(screen.getByLabelText(label));
    }
    expect(screen.getByText('선생님 판정')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByText(/저장했어요\. 선생님이 직접 채점해요/)).toBeInTheDocument();
    const mission = await repository.getMission(EVENT, 'library-check');
    expect(mission.teacherJudged).toBe(true);
    if (mission.config.type === 'library_check') expect(mission.config.answerKey).toBeUndefined();
  });

  it('순위표는 자동 채점 항목을 보여 주고 점수는 고칠 수 있다', async () => {
    const repository = await startedRepository();
    await repository.saveSubmission({
      eventId: EVENT,
      teamId: TEAM,
      missionId: 'library-check',
      requestId: 'lib-1',
      answer: {
        type: 'library_check',
        wrongPart: '다리가 8개',
        correction: '다리는 여섯 개',
        bookTitle: '신기한 곤충 백과',
        page: 99,
      },
    });
    await repository.signInTeacher();
    renderApp(`/teacher/${EVENT}/station/library-check`, repository);

    const score = await screen.findByRole<HTMLInputElement>('textbox', {
      name: '4학년 1반 4팀 점수',
    });
    expect(score.value).toBe('90');
    const row = score.closest('tr');
    if (!row) throw new Error('순위표 행이 없어요');
    expect(within(row).getByText(/자동 채점 90\/100점/)).toBeInTheDocument();
    expect(within(row).getByText(/쪽수 X/)).toBeInTheDocument();
    await waitFor(() => expect(score).toBeEnabled());
  });
});
