import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
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

beforeEach(() => {
  // 고른 질문은 기기에 남으므로 테스트마다 지운다.
  window.localStorage.clear();
});

describe('학생 도서관 오류찾기: 조사할 답 고르기와 제출 즉시 자동 채점', () => {
  it('AI에게 한 질문 가운데 하나를 고르면 그 글만 보이고, 제출하면 점수가 바로 나온다', async () => {
    const user = userEvent.setup();
    const repository = await startedRepository();
    const first = renderApp(`/team/${EVENT}/${TEAM}/mission/library-check`, repository);

    // 이야기·경고와 고르기 카드가 보이고, 글은 아직 보이지 않는다.
    expect(
      await screen.findByRole('heading', { name: 'AI가 알려 준 정보, 믿어도 될까요?' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/적발되면 이 미션에서 바로 탈락해요/)).toBeInTheDocument();
    expect(screen.getByText(/어느 답을 조사할까요\?/)).toBeInTheDocument();
    expect(screen.queryByText(/꿀벌은 다리가 8개인 곤충이에요/)).toBeNull();
    expect(screen.getByText(/조사할 답을 먼저 골라요/)).toBeInTheDocument();

    // 카드를 고르면 한 번 더 묻고, 확인하면 그 글만 펼쳐진다.
    await user.click(screen.getByRole('button', { name: /꿀벌에 대해 알려 줘/ }));
    const dialog = await screen.findByRole('dialog', { name: '이 답을 조사할까요?' });
    await user.click(within(dialog).getByRole('button', { name: '이 답을 조사할래요' }));
    expect(await screen.findByText(/꿀벌은 다리가 8개인 곤충이에요/)).toBeInTheDocument();
    expect(screen.queryByText(/어느 답을 조사할까요\?/)).toBeNull();
    expect(screen.queryByText(/달은 지구 둘레를 도는 위성이에요/)).toBeNull();
    expect(screen.getByText(/제출하면 바로 채점돼요/)).toBeInTheDocument();

    // 화면을 다시 열어도 고른 질문은 그대로다(한 번 고르면 못 바꿈).
    first.unmount();
    renderApp(`/team/${EVENT}/${TEAM}/mission/library-check`, repository);
    expect(await screen.findByText(/꿀벌은 다리가 8개인 곤충이에요/)).toBeInTheDocument();
    expect(screen.queryByText(/어느 답을 조사할까요\?/)).toBeNull();

    // 빈 채로 내면 알려 주고, 적어서 내면 바로 채점된다.
    await user.click(screen.getByRole('button', { name: '확인 내용 제출' }));
    expect(await screen.findByText('AI 글에서 틀린 부분을 적어 주세요.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('1. 틀린 부분'), '다리가 8개라고 한 것');
    await user.type(
      screen.getByLabelText('2. 책에서 찾은 바른 내용으로 고치기'),
      '꿀벌 다리는 6개',
    );
    // 참고한 책 이름은 채점하지 않지만 적어야 낼 수 있다.
    await user.click(screen.getByRole('button', { name: '확인 내용 제출' }));
    expect(await screen.findByText('참고한 책 이름을 적어 주세요.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('3. 참고한 책 이름'), '딩동~ 곤충 도감');
    await user.click(screen.getByRole('button', { name: '확인 내용 제출' }));

    expect(await screen.findByText(/제출 완료 · 자동 채점 100점 \/ 100점/)).toBeInTheDocument();
    expect(screen.getByText(/제출했어요! 결과 발표를 기다려요/)).toBeInTheDocument();
    const result = screen.getByRole('region', { name: /자동 채점 결과/ });
    const items = within(result).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      '틀린 부분 40점',
      '바르게 고친 내용 60점',
    ]);

    // 교사 순위표에도 자동 점수와 고른 질문이 들어간다.
    await repository.signInTeacher();
    const participants = await repository.listMissionParticipants(EVENT, 'library-check', 4, 2);
    const mine = participants.find((item) => item.team.id === TEAM)?.submission;
    expect(mine?.score).toBe(100);
    expect(mine?.answer).toMatchObject({
      type: 'library_check',
      chosenQuestionId: 'q1',
      answers: { q1: { bookTitle: '딩동~ 곤충 도감' } },
    });
  });

  it('게임 시작 전에는 글을 가리고 이야기·경고와 고르기 안내만 보여 준다', async () => {
    const repository = new MockEventRepository();
    renderApp(`/team/${EVENT}/${TEAM}/mission/library-check`, repository);
    expect(await screen.findByText(/게임이 시작되면 AI가 쓴 글이 나타나요/)).toBeInTheDocument();
    expect(screen.getByText(/AI에게 물어봤더니 그럴듯한 글을 써 줬어요/)).toBeInTheDocument();
    expect(screen.getByText(/적발되면 이 미션에서 바로 탈락해요/)).toBeInTheDocument();
    expect(screen.getByText(/AI에게 한 질문 2개 가운데 하나를 골라 조사해요/)).toBeInTheDocument();
    expect(screen.queryByText(/꿀벌은 다리가 8개인/)).toBeNull();
  });
});

describe('교사 도서관 오류찾기: 문제와 정답 등록', () => {
  it('정답을 고쳐 저장하면 자동 채점 기준이 바뀌고, 한 문제라도 정답을 비우면 선생님 판정이 된다', async () => {
    const user = userEvent.setup();
    const repository = new MockEventRepository();
    await repository.signInTeacher();
    renderApp(`/teacher/${EVENT}/station/library-check`, repository);

    await user.click(await screen.findByRole('button', { name: /문제와 정답 등록 \(자동 채점\)/ }));
    const correction = screen.getByLabelText(/2번 바르게 고친 내용으로 인정하는 말/);
    expect(correction).toHaveValue('운석, 충돌, 부딪');
    await user.type(correction, ', 돌덩이');
    await user.selectOptions(screen.getByLabelText(/2번 틀린 문장/), '2');
    await user.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByText(/이제 제출 즉시 자동으로 채점돼요/)).toBeInTheDocument();
    const second = (await getConfig(repository)).questions[1];
    expect(second.type === 'choose' ? second.answerKey : null).toEqual({
      wrongIndex: 2,
      correctionKeywords: ['운석', '충돌', '부딪', '돌덩이'],
    });

    // 1번 정답을 모두 비우면 선생님이 직접 채점한다.
    await user.clear(screen.getByLabelText(/1번 틀린 부분으로 인정하는 말/));
    await user.clear(screen.getByLabelText(/1번 바르게 고친 내용으로 인정하는 말/));
    expect(screen.getByText('선생님 판정')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByText(/저장했어요\. 선생님이 직접 채점해요/)).toBeInTheDocument();
    const mission = await repository.getMission(EVENT, 'library-check');
    expect(mission.teacherJudged).toBe(true);
    if (mission.config.type === 'library_check') {
      expect(mission.config.questions[0].answerKey).toBeUndefined();
    }

    // 하나만 고르는 방식이면 문제를 더해도 만점은 100점이고, 글이 비어 있으면 저장하지 못한다.
    await user.click(screen.getByRole('button', { name: '선택형 문제 추가' }));
    expect(
      screen.getByText(/공통 문제 3개 · 만점 100점 \(하나만 골라 풀어요\)/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByText(/공통 3번 문제: 글 제목을 적어 주세요/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '3번 문제 삭제' }));

    // 하나만 고르기를 끄면 모든 문제를 풀어 만점이 200점이 된다.
    await user.click(screen.getByRole('checkbox', { name: /학생이 질문 하나만 골라 풀어요/ }));
    expect(screen.getByText(/공통 문제 2개 · 만점 200점/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByText(/저장했어요/)).toBeInTheDocument();
    expect((await getConfig(repository)).pickOne).toBeUndefined();
  });

  it('학년 탭에서 그 학년만의 문제를 넣으면 그 학년은 공통 문제 대신 그 문제를 푼다', async () => {
    const user = userEvent.setup();
    const repository = new MockEventRepository();
    await repository.signInTeacher();
    renderApp(`/teacher/${EVENT}/station/library-check`, repository);

    await user.click(await screen.findByRole('button', { name: /문제와 정답 등록 \(자동 채점\)/ }));
    await user.click(screen.getByRole('button', { name: '3학년 (공통 사용)' }));
    expect(screen.getByText(/3학년은 공통 문제를 풀어요/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '선택형 문제 추가' }));
    expect(screen.getByRole('button', { name: '3학년 (1문제)' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('1번 AI에게 한 질문'), '자석에 대해 알려 줘');
    await user.type(screen.getByLabelText('1번 주제'), '과학');
    await user.type(screen.getByLabelText('1번 글 제목'), 'AI가 쓴 “자석” 소개 글');
    await user.type(
      screen.getByLabelText(/1번 문장\(한 줄에 한 문장/),
      '자석은 철을 끌어당겨요.\n나침반 바늘의 N극은 남쪽을 가리켜요.',
    );
    await user.selectOptions(screen.getByLabelText(/1번 틀린 문장/), '1');
    await user.type(screen.getByLabelText(/1번 바르게 고친 내용으로 인정하는 말/), '북쪽');
    await user.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByText(/이제 제출 즉시 자동으로 채점돼요/)).toBeInTheDocument();

    const config = await getConfig(repository);
    expect(config.questions).toHaveLength(2);
    expect(config.pickOne).toBe(true);
    expect(config.gradeQuestions?.[3]).toEqual([
      {
        id: 'g3q1',
        type: 'choose',
        title: 'AI가 쓴 “자석” 소개 글',
        prompt: '자석에 대해 알려 줘',
        subject: '과학',
        sentences: ['자석은 철을 끌어당겨요.', '나침반 바늘의 N극은 남쪽을 가리켜요.'],
        answerKey: { wrongIndex: 1, correctionKeywords: ['북쪽'] },
      },
    ]);
    expect(config.gradeQuestions?.[4]).toBeUndefined();
  });

  it('문제 파일을 올리면 학년별 문제와 하나만 고르기 설정이 한 번에 바뀐다', async () => {
    const user = userEvent.setup();
    const repository = new MockEventRepository();
    await repository.signInTeacher();
    renderApp(`/teacher/${EVENT}/station/library-check`, repository);
    await user.click(await screen.findByRole('button', { name: /문제와 정답 등록 \(자동 채점\)/ }));

    // 지어낸 문제 파일. 공통 문제가 없으니 네 학년 모두 들어 있어야 한다.
    const magnet = {
      type: 'choose',
      prompt: '자석에 대해 알려 줘',
      subject: '과학',
      title: 'AI가 쓴 “자석” 소개 글',
      sentences: ['자석은 철을 끌어당겨요.', '나침반 바늘의 N극은 남쪽을 가리켜요.'],
      wrong: '②',
      accept: ['북쪽'],
    };
    const proverb = {
      ...magnet,
      prompt: '속담에 대해 알려 줘',
      subject: '우리말',
      title: 'AI가 쓴 “속담” 소개 글',
    };
    const raw = {
      format: 'songjeong-library-questions',
      version: 1,
      pickOne: true,
      sets: [
        { grades: [3], questions: [magnet, proverb] },
        { grades: [4, 5, 6], questions: [magnet] },
      ],
    };
    const file = new File([JSON.stringify(raw)], '도서관-업로드.json', {
      type: 'application/json',
    });
    await user.upload(screen.getByLabelText('도서관 문제 파일(JSON) 고르기'), file);

    const preview = await screen.findByRole('list', { name: '올릴 문제 미리보기' });
    expect(within(preview).getByText('3학년 · 2문제')).toBeInTheDocument();
    expect(within(preview).getByText(/\[우리말\] 속담에 대해 알려 줘 → /)).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: '문제 올리기 (3학년 2문제, 4·5·6학년 1문제)' }),
    );
    const dialog = await screen.findByRole('dialog', { name: '도서관 문제를 올릴까요?' });
    await user.click(within(dialog).getByRole('button', { name: '올리기' }));
    expect(
      await screen.findByText(/문제를 올렸어요\. 3학년 2문제, 4·5·6학년 1문제/),
    ).toBeInTheDocument();

    const config = await getConfig(repository);
    expect(config.pickOne).toBe(true);
    expect(config.questions).toEqual([]);
    expect(config.gradeQuestions?.[3]?.map((question) => question.id)).toEqual(['g3q1', 'g3q2']);
    expect(config.gradeQuestions?.[6]?.[0]).toMatchObject({ id: 'g6q1', subject: '과학' });
    // 편집 칸도 올린 내용으로 바뀐다.
    expect(screen.getByRole('button', { name: '공통 (없음)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '3학년 (2문제)' })).toBeInTheDocument();
    expect(screen.getByText('자동 채점')).toBeInTheDocument();
  });

  it('순위표는 고른 질문과 자동 채점 항목을 보여 주고 점수는 고칠 수 있다', async () => {
    const repository = await startedRepository();
    await repository.saveSubmission({
      eventId: EVENT,
      teamId: TEAM,
      missionId: 'library-check',
      requestId: 'lib-1',
      answer: {
        type: 'library_check',
        chosenQuestionId: 'q2',
        answers: { q2: { choice: 2, correction: '잘 모르겠어요', bookTitle: '지구와 달' } },
      },
    });
    await repository.signInTeacher();
    renderApp(`/teacher/${EVENT}/station/library-check`, repository);

    const score = await screen.findByRole<HTMLInputElement>('textbox', {
      name: '4학년 1반 4팀 점수',
    });
    expect(score.value).toBe('40');
    const row = score.closest('tr');
    if (!row) throw new Error('순위표 행이 없어요');
    expect(within(row).getByText(/고른 질문: 달에 대해 알려 줘 \(과학\)/)).toBeInTheDocument();
    expect(within(row).getByText(/자동 채점 40\/100점/)).toBeInTheDocument();
    expect(within(row).getByText(/1번 바르게 고친 내용 X/)).toBeInTheDocument();
    expect(within(row).getByText(/③ 달 표면의 둥근 구덩이는/)).toBeInTheDocument();
    expect(within(row).getByText('지구와 달')).toBeInTheDocument();
    await waitFor(() => expect(score).toBeEnabled());
    // 부스 운영 화면에 학생 안내와 부정행위 경고가 있다.
    expect(
      screen.getByText(/부정행위가 적발된 팀은 순위표에서 점수를 0점으로/),
    ).toBeInTheDocument();
  });
});
