import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EVENT_ID } from '../config';
import { MockEventRepository } from '../data/mock/MockEventRepository';
import { countRehearsalRecords } from '../domain/rehearsal';
import { renderApp } from '../test/renderApp';

const adminPath = `/teacher/${DEFAULT_EVENT_ID}/admin`;

async function adminRepository() {
  const repository = new MockEventRepository();
  await repository.signInTeacher();
  return repository;
}

const panel = () => within(screen.getByRole('region', { name: /연습 기록 지우기/ }));

describe('행사 설정의 연습 기록 지우기', () => {
  it('진행 학년에 남은 기록 수를 보여 준다', async () => {
    renderApp(adminPath, await adminRepository());

    const counts = within(await screen.findByLabelText('4학년에 남은 기록'));
    expect(counts.getByText('제출').nextElementSibling).toHaveTextContent('34건');
    expect(counts.getByText('순위').nextElementSibling).toHaveTextContent('25건');
    expect(counts.getByText('부스 라운드').nextElementSibling).toHaveTextContent('10건');
    expect(counts.getByText('최종 미션').nextElementSibling).toHaveTextContent('열기 전');
    expect(panel().getByText(/4학년은 지금 진행 학년이에요/)).toBeInTheDocument();
    expect(panel().getByRole('button', { name: '4학년 기록 지우기' })).toBeEnabled();
  });

  it('기록이 없는 학년은 지울 것이 없다고 알려 주고 버튼을 끈다', async () => {
    const user = userEvent.setup();
    renderApp(adminPath, await adminRepository());
    await screen.findByLabelText('4학년에 남은 기록');

    await user.click(panel().getByRole('button', { name: '5학년' }));
    expect(await panel().findByText('5학년에는 지울 기록이 없어요.')).toBeInTheDocument();
    expect(panel().getByRole('button', { name: '5학년 기록 지우기' })).toBeDisabled();
  });

  it('확인 창에 학년을 적어야 지울 수 있다', async () => {
    const user = userEvent.setup();
    const repository = await adminRepository();
    renderApp(adminPath, repository);
    await screen.findByLabelText('4학년에 남은 기록');

    await user.click(panel().getByRole('button', { name: '4학년 기록 지우기' }));
    const dialog = within(
      await screen.findByRole('dialog', { name: '4학년의 기록을 모두 지울까요?' }),
    );
    expect(dialog.getByText(/지운 기록은 되살릴 수 없어요/)).toBeInTheDocument();
    const confirm = dialog.getByRole('button', { name: '4학년 기록 지우기' });
    expect(confirm).toBeDisabled();

    const field = dialog.getByLabelText(/4학년”이라고 적어 주세요/);
    await user.type(field, '3학년');
    expect(confirm).toBeDisabled();
    await user.clear(field);
    await user.type(field, '4학년');
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    expect(await panel().findByText('4학년 기록을 지웠어요.')).toBeInTheDocument();
    expect(panel().getByRole('button', { name: '4학년 기록 지우기' })).toBeDisabled();
    const summary = await repository.getRehearsalSummary(DEFAULT_EVENT_ID, 4);
    expect(countRehearsalRecords(summary.counts)).toBe(0);
    // 다른 학년의 기록은 그대로다.
    expect((await repository.getRehearsalSummary(DEFAULT_EVENT_ID, 3)).counts.results).toBe(100);
  });

  it('취소하면 아무것도 지우지 않는다', async () => {
    const user = userEvent.setup();
    const repository = await adminRepository();
    renderApp(adminPath, repository);
    await screen.findByLabelText('4학년에 남은 기록');

    await user.click(panel().getByRole('button', { name: '4학년 기록 지우기' }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByRole('textbox'), '4학년');
    await user.click(dialog.getByRole('button', { name: '취소' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect((await repository.getRehearsalSummary(DEFAULT_EVENT_ID, 4)).counts.results).toBe(25);
  });
});
