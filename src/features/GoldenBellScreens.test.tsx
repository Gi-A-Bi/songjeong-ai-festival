import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EVENT_ID } from '../config';
import { toTeamId } from '../data/mock/keys';
import { MockEventRepository } from '../data/mock/MockEventRepository';
import { getGoldenBellQuestions } from '../domain/goldenBell';
import { applyGoldenBellUpload, parseGoldenBellUpload } from '../domain/goldenBellUpload';
import type { GoldenBellConfig, GoldenBellQuestion } from '../domain/types';
import { createGoldenUploadFixture } from '../test/goldenUploadFixture';
import { renderApp } from '../test/renderApp';

const EVENT = DEFAULT_EVENT_ID;
// 샘플 데이터: 4학년 2라운드 골든벨은 5팀이 하고, 2반 5팀은 아직 제출하지 않았다.
const TEAM = toTeamId(4, 2, 5);

const GRADE4_QUESTIONS: GoldenBellQuestion[] = [
  {
    id: 'g4-q1',
    kind: 'ox',
    question: '로봇은 밥을 먹어야 움직인다.',
    choices: ['O', 'X'],
    answerIndex: 1,
    level: 'low',
    area: 'AI 이해',
    explanation: '로봇은 전기로 움직여요.',
  },
  {
    id: 'g4-q2',
    kind: 'choice',
    question: '로봇에게 일을 시키는 방법은?',
    choices: ['명령을 입력한다', '간식을 준다', '노래를 불러 준다', '칭찬한다'],
    answerIndex: 0,
    level: 'mid',
    area: 'AI 활용',
    explanation: '',
  },
  {
    id: 'g4-q3',
    kind: 'short',
    question: '글자를 입력하는 판의 이름은?',
    choices: [],
    answerIndex: 0,
    answers: ['키보드', '자판'],
    hint: '초성 ㅋㅂㄷ',
    level: 'high',
    area: 'AI 활용',
    explanation: '',
  },
];

async function teacherRepository() {
  const repository = new MockEventRepository();
  await repository.signInTeacher();
  return repository;
}

async function getConfig(repository: MockEventRepository): Promise<GoldenBellConfig> {
  const mission = await repository.getMission(EVENT, 'golden-bell');
  if (mission.config.type !== 'golden_bell') throw new Error('골든벨 설정이 아니에요');
  return mission.config;
}

/** 4학년 문제를 O/X·객관식·단답형 세 문제로 바꾼 저장소 */
async function repositoryWithGrade4Questions() {
  const repository = await teacherRepository();
  const config = await getConfig(repository);
  await repository.updateMissionConfig(EVENT, 'golden-bell', {
    ...config,
    gradeQuestions: { 4: GRADE4_QUESTIONS },
  });
  await repository.signOutTeacher();
  return repository;
}

describe('학생 골든벨: O/X, 객관식, 단답형', () => {
  it('그 학년의 문제를 형식에 맞게 풀고 제출하면 자동으로 채점된다', async () => {
    const user = userEvent.setup();
    const repository = await repositoryWithGrade4Questions();
    renderApp(`/team/${EVENT}/${TEAM}/mission/golden-bell`, repository);

    // 1번: O/X
    expect(await screen.findByText('문제 1 / 3')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: '로봇은 밥을 먹어야 움직인다.' }),
    ).toBeInTheDocument();
    expect(screen.getByText('난이도 하')).toBeInTheDocument();
    expect(screen.getByText('AI 이해')).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    await user.click(screen.getByRole('radio', { name: 'X 아니에요' }));
    expect(screen.getByRole('radio', { name: 'X 아니에요' })).toBeChecked();

    // 2번: 객관식
    await user.click(screen.getByRole('button', { name: /다음 문제/ }));
    expect(screen.getByText('문제 2 / 3')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /명령을 입력한다/ }));

    // 3번: 단답형. 띄어쓰기가 달라도 맞게 채점한다.
    await user.click(screen.getByRole('button', { name: /다음 문제/ }));
    expect(screen.getByText('문제 3 / 3')).toBeInTheDocument();
    expect(screen.getByText(/힌트: 초성 ㅋㅂㄷ/)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/답을 적어요/), '키 보드');
    expect(screen.getByText(/답한 문제 3\/3/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /정답 제출/ }));
    const dialog = await screen.findByRole('dialog', { name: '답을 제출할까요?' });
    expect(within(dialog).getByText('3문제 모두 답했어요.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /제출하기/ }));
    expect(await screen.findByText(/제출했어요!/)).toBeInTheDocument();

    const [submission] = (await repository.listTeamSubmissions(EVENT, TEAM)).filter(
      (item) => item.missionId === 'golden-bell',
    );
    expect(submission.answer).toEqual({
      type: 'golden_bell',
      selections: { 'g4-q1': 1, 'g4-q2': 0 },
      texts: { 'g4-q3': '키 보드' },
    });
    await repository.signInTeacher();
    const participants = await repository.listMissionParticipants(EVENT, 'golden-bell', 4, 2);
    const mine = participants.find((item) => item.team.id === TEAM);
    expect(mine?.submission?.score).toBe(300);
  });

  it('문제를 넘겼다가 돌아와도 적어 둔 단답형 답이 남아 있다', async () => {
    const user = userEvent.setup();
    const repository = await repositoryWithGrade4Questions();
    renderApp(`/team/${EVENT}/${TEAM}/mission/golden-bell`, repository);

    await user.click(await screen.findByRole('button', { name: '3번 문제, 아직 안 풂' }));
    await user.type(screen.getByLabelText(/답을 적어요/), '자판');
    await user.click(screen.getByRole('button', { name: /이전 문제/ }));
    expect(screen.getByText('문제 2 / 3')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '3번 문제, 답함' }));
    expect(screen.getByLabelText(/답을 적어요/)).toHaveValue('자판');
  });

  it('학년별 문제가 없는 학년은 공통 문제를 푼다', async () => {
    const repository = await teacherRepository();
    const config = await getConfig(repository);
    await repository.updateMissionConfig(EVENT, 'golden-bell', {
      ...config,
      gradeQuestions: { 5: GRADE4_QUESTIONS },
    });
    await repository.signOutTeacher();
    renderApp(`/team/${EVENT}/${TEAM}/mission/golden-bell`, repository);
    expect(await screen.findByText('문제 1 / 7')).toBeInTheDocument();
  });
});

describe('교사 골든벨 문제 등록', () => {
  it('학년을 골라 O/X와 단답형 문제를 등록한다', async () => {
    const user = userEvent.setup();
    const repository = await teacherRepository();
    renderApp(`/teacher/${EVENT}/station/golden-bell`, repository);

    await user.click(await screen.findByRole('button', { name: /문제 등록 \(7문항\)/ }));
    const scopes = screen.getByRole('group', { name: '문제를 고칠 학년' });
    expect(within(scopes).getByRole('button', { name: /공통 \(7\)/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(within(scopes).getByRole('button', { name: /3학년 \(공통 사용\)/ }));
    expect(screen.getByText(/3학년은 지금 공통 문제를 써요/)).toBeInTheDocument();

    // 1번: O/X
    await user.click(screen.getByRole('button', { name: /문제 추가/ }));
    const first = screen.getByRole('heading', { name: '1번 문제' }).closest('li');
    if (!first) throw new Error('문제 카드가 없어요');
    await user.selectOptions(within(first).getByLabelText('형식'), 'O/X');
    await user.type(within(first).getByLabelText('문제'), '로봇은 사람이 만들었다.');
    await user.click(within(first).getByRole('radio', { name: '1번 문제 정답 O' }));

    // 2번: 단답형. 정답을 비우면 저장하지 않는다.
    await user.click(screen.getByRole('button', { name: /문제 추가/ }));
    const second = screen.getByRole('heading', { name: '2번 문제' }).closest('li');
    if (!second) throw new Error('문제 카드가 없어요');
    await user.selectOptions(within(second).getByLabelText('형식'), '단답형');
    await user.selectOptions(within(second).getByLabelText('난이도'), '상');
    await user.type(within(second).getByLabelText('문제'), '글자를 입력하는 판은?');
    await user.click(screen.getByRole('button', { name: /문제 저장/ }));
    expect(await screen.findByText('2번 문제: 정답을 적어 주세요.')).toBeInTheDocument();

    await user.type(within(second).getByLabelText('정답'), '키보드');
    await user.type(within(second).getByLabelText('함께 인정하는 답'), '자판, Key Board');
    await user.type(within(second).getByLabelText(/힌트/), '초성 ㅋㅂㄷ');
    await user.click(screen.getByRole('button', { name: /문제 저장/ }));
    expect(await screen.findByText('문제를 저장했어요.')).toBeInTheDocument();

    const config = await getConfig(repository);
    expect(config.questions).toHaveLength(7);
    const saved = getGoldenBellQuestions(config, 3);
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({ kind: 'ox', choices: ['O', 'X'], answerIndex: 0 });
    expect(saved[1]).toMatchObject({
      kind: 'short',
      answers: ['키보드', '자판', 'Key Board'],
      hint: '초성 ㅋㅂㄷ',
      level: 'high',
    });
    expect(within(scopes).getByRole('button', { name: /3학년 \(2\)/ })).toBeInTheDocument();
  });

  it('고치는 동안에는 다른 학년으로 넘어가지 않고 문제 파일도 올리지 않는다', async () => {
    const user = userEvent.setup();
    const repository = await teacherRepository();
    renderApp(`/teacher/${EVENT}/station/golden-bell`, repository);

    await user.click(await screen.findByRole('button', { name: /문제 등록 \(7문항\)/ }));
    await user.click(screen.getByRole('button', { name: /문제 추가/ }));
    const scopes = screen.getByRole('group', { name: '문제를 고칠 학년' });
    expect(within(scopes).getByRole('button', { name: /3학년/ })).toBeDisabled();
    expect(screen.getByLabelText('골든벨 문제 파일(JSON) 고르기')).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /변경 취소/ }));
    expect(within(scopes).getByRole('button', { name: /3학년/ })).toBeEnabled();
    expect(screen.getByLabelText('골든벨 문제 파일(JSON) 고르기')).toBeEnabled();
  });

  it('문제 파일을 올리면 파일에 있는 학년의 문제가 한 번에 바뀐다', async () => {
    const user = userEvent.setup();
    const repository = await teacherRepository();
    renderApp(`/teacher/${EVENT}/station/golden-bell`, repository);

    await user.click(await screen.findByRole('button', { name: /문제 등록 \(7문항\)/ }));
    const file = new File([JSON.stringify(createGoldenUploadFixture())], '골든벨-업로드.json', {
      type: 'application/json',
    });
    await user.upload(screen.getByLabelText('골든벨 문제 파일(JSON) 고르기'), file);

    const preview = await screen.findByRole('list', { name: '올릴 문제 미리보기' });
    expect(
      within(preview).getByRole('heading', {
        name: '3학년 · 3문항 (O/X 1, 객관식 1, 단답형 1)',
      }),
    ).toBeInTheDocument();
    expect(
      within(preview).getByRole('heading', {
        name: '5·6학년 · 2문항 (O/X 1, 객관식 0, 단답형 1)',
      }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /문제 올리기 \(3학년, 5·6학년\)/ }));
    const dialog = await screen.findByRole('dialog', { name: '골든벨 문제를 올릴까요?' });
    await user.click(within(dialog).getByRole('button', { name: /올리기/ }));
    expect(
      await screen.findByText(/문제를 올렸어요. 3학년 3문항, 5·6학년 2문항/),
    ).toBeInTheDocument();

    const config = await getConfig(repository);
    expect(getGoldenBellQuestions(config, 3)).toHaveLength(3);
    expect(getGoldenBellQuestions(config, 4)).toHaveLength(7);
    expect(getGoldenBellQuestions(config, 5)).toHaveLength(2);
    expect(getGoldenBellQuestions(config, 6)).toHaveLength(2);
    const scopes = screen.getByRole('group', { name: '문제를 고칠 학년' });
    await waitFor(() =>
      expect(within(scopes).getByRole('button', { name: /5학년 \(2\)/ })).toBeInTheDocument(),
    );
  });

  it('잘못된 파일은 고칠 곳을 알려 주고 올리지 않는다', async () => {
    const user = userEvent.setup();
    const repository = await teacherRepository();
    renderApp(`/teacher/${EVENT}/station/golden-bell`, repository);

    await user.click(await screen.findByRole('button', { name: /문제 등록 \(7문항\)/ }));
    const raw = createGoldenUploadFixture();
    raw.sets[0].questions[0].answer = '';
    const file = new File([JSON.stringify(raw)], '골든벨-업로드.json', {
      type: 'application/json',
    });
    await user.upload(screen.getByLabelText('골든벨 문제 파일(JSON) 고르기'), file);
    expect(await screen.findByText('3학년 1번 문제: 정답은 O나 X여야 해요.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /문제 올리기/ })).toBeNull();
  });

  it('순위표에 틀린 단답형 답을 그대로 보여 주어 선생님이 판단할 수 있다', async () => {
    const repository = await repositoryWithGrade4Questions();
    await repository.joinTeam(EVENT, TEAM);
    await repository.saveSubmission({
      eventId: EVENT,
      teamId: TEAM,
      missionId: 'golden-bell',
      requestId: 'short-1',
      answer: {
        type: 'golden_bell',
        selections: { 'g4-q1': 1, 'g4-q2': 0 },
        texts: { 'g4-q3': '키보두' },
      },
    });
    await repository.signInTeacher();
    renderApp(`/teacher/${EVENT}/station/golden-bell`, repository);

    const score = await screen.findByRole<HTMLInputElement>('textbox', {
      name: '4학년 2반 5팀 점수',
    });
    expect(score.value).toBe('200');
    const row = score.closest('tr');
    if (!row) throw new Error('순위표 행이 없어요');
    expect(within(row).getByText(/맞힘 2\/3/)).toBeInTheDocument();
    expect(within(row).getByText(/3번 “키보두” · 정답 키보드/)).toBeInTheDocument();
  });
});

describe('골든벨 문제 파일과 설정', () => {
  it('올린 문제는 저장소 검사를 통과한다', async () => {
    const repository = await teacherRepository();
    const { sets, errors } = parseGoldenBellUpload(createGoldenUploadFixture());
    expect(errors).toEqual([]);
    const next = applyGoldenBellUpload(await getConfig(repository), sets);
    await expect(repository.updateMissionConfig(EVENT, 'golden-bell', next)).resolves.toMatchObject(
      { id: 'golden-bell' },
    );
  });

  it('어느 학년도 풀 문제가 없게 되는 설정은 저장하지 않는다', async () => {
    const repository = await teacherRepository();
    await expect(
      repository.updateMissionConfig(EVENT, 'golden-bell', {
        type: 'golden_bell',
        questions: [],
        gradeQuestions: { 3: GRADE4_QUESTIONS },
      }),
    ).rejects.toThrow(/4학년, 5학년, 6학년이 풀 문제가 없어요/);
  });
});
