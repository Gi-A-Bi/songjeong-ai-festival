import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EVENT_ID } from '../config';
import { toClassId } from '../data/mock/keys';
import { MockEventRepository } from '../data/mock/MockEventRepository';
import { parseFinalQuestionUpload } from '../domain/finalQuestionUpload';
import { buildUploadFile } from '../test/finalUploadFixture';
import { renderApp } from '../test/renderApp';

const EVENT = DEFAULT_EVENT_ID;

async function adminRepository() {
  const repository = new MockEventRepository();
  await repository.signInTeacher();
  return repository;
}

function rowOf(table: HTMLElement, name: string): HTMLElement {
  const row = within(table).getByRole('rowheader', { name }).closest('tr');
  if (!row) throw new Error(`${name} 행이 없어요`);
  return row;
}

describe('총괄 설정의 최종 미션 문제 올리기', () => {
  it('JSON 파일을 고르면 미리보기가 보이고, 올리면 진행 중인 학년은 건너뛴다', async () => {
    const user = userEvent.setup();
    const repository = await adminRepository();
    renderApp(`/teacher/${EVENT}/admin`, repository);

    const table = await screen.findByRole('table', { name: '지금 들어 있는 문제' });
    expect(within(rowOf(table, '4학년')).getByText('샘플 문제')).toBeInTheDocument();
    expect(within(rowOf(table, '4학년')).getByText('가능')).toBeInTheDocument();
    // 3학년은 최종 미션이 열려 있다.
    expect(within(rowOf(table, '3학년')).getByText(/이미 열려 있어/)).toBeInTheDocument();

    const file = new File([JSON.stringify(buildUploadFile([3, 4]))], '최종미션-업로드.json', {
      type: 'application/json',
    });
    await user.upload(screen.getByLabelText('문제 파일(JSON) 고르기'), file);

    const preview = await screen.findByRole('list', { name: '올릴 문제 미리보기' });
    expect(
      within(preview).getByRole('heading', { name: /4학년 · 문제 10개 · 그림 1개/ }),
    ).toBeInTheDocument();
    expect(
      within(preview).getByText(/3학년 최종 미션이 이미 열려 있어.*건너뜁니다/),
    ).toBeInTheDocument();
    expect(
      within(preview).getByText(/\[4학년 유형 3\] 4학년 3번 문제입니다\./),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '문제 올리기 (4학년)' }));
    const dialog = await screen.findByRole('dialog', { name: '최종 미션 문제를 올릴까요?' });
    expect(within(dialog).getByText(/3학년은\(는\) 진행 중이라 건너뜁니다/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /올리기/ }));

    expect(await screen.findByText(/문제를 올렸어요/)).toBeInTheDocument();
    const summaries = await repository.listFinalQuestionSets(EVENT);
    expect(summaries.find((item) => item.grade === 4)).toMatchObject({
      source: 'upload',
      imageCount: 1,
    });
    expect(summaries.find((item) => item.grade === 3)?.source).toBe('sample');
    expect(within(rowOf(table, '4학년')).getByText('올린 문제')).toBeInTheDocument();
  });

  it('형식이 어긋난 파일은 고칠 곳을 알려 주고 올리지 않는다', async () => {
    const user = userEvent.setup();
    renderApp(`/teacher/${EVENT}/admin`, await adminRepository());

    const broken = buildUploadFile([5]);
    broken.sets[0].questions[1].choices = ['하나', '둘'];
    const file = new File([JSON.stringify(broken)], 'broken.json', { type: 'application/json' });
    await user.upload(await screen.findByLabelText('문제 파일(JSON) 고르기'), file);
    expect(
      await screen.findByText('5학년 2번 문제: 보기는 4개를 모두 적어야 해요.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /문제 올리기/ })).toBeNull();

    const notJson = new File(['안녕'], 'memo.json', { type: 'application/json' });
    await user.upload(screen.getByLabelText('문제 파일(JSON) 고르기'), notJson);
    expect(await screen.findByText(/JSON 파일이 아니거나 읽지 못했어요/)).toBeInTheDocument();
  });
});

describe('전자칠판의 올린 문제', () => {
  it('유형 배지와 그림을 보여 주고 그림 문제의 보기 순서는 원고 그대로다', async () => {
    const user = userEvent.setup();
    const repository = await adminRepository();
    const classId = toClassId(4, 1);
    await repository.uploadFinalQuestionSets({
      eventId: EVENT,
      sets: parseFinalQuestionUpload(buildUploadFile([4])).sets,
    });
    await repository.openFinal({ eventId: EVENT, grade: 4, force: true, reason: '리허설' });
    await repository.startClassFinal({ eventId: EVENT, classId, requestId: 'start' });
    renderApp(`/teacher/${EVENT}/class/${classId}/final`, repository);

    expect(await screen.findByText('4학년 유형 1')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /그림/ })).toBeNull();

    for (const step of [1, 2]) {
      await user.click(screen.getByRole('button', { name: new RegExp(`보기 나 ${step}`) }));
      await user.click(screen.getByRole('button', { name: /답 확정하고 다음 문제로/ }));
      expect(await screen.findByText(`문제 ${step + 1} / 10`)).toBeInTheDocument();
    }
    expect(screen.getByText('4학년 유형 3')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '4학년 3번 그림' })).toBeInTheDocument();
    const choices = screen.getAllByRole('button', { name: /보기 [가나다라] 3/ });
    expect(choices.map((button) => button.textContent)).toEqual([
      '1보기 가 3',
      '2보기 나 3',
      '3보기 다 3',
      '4보기 라 3',
    ]);
  });
});
