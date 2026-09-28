import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EVENT_ID } from '../config';
import { MockEventRepository } from '../data/mock/MockEventRepository';
import { renderApp } from '../test/renderApp';

const adminPath = `/teacher/${DEFAULT_EVENT_ID}/admin`;

async function openAsAdmin() {
  const repository = new MockEventRepository();
  await repository.signInTeacher();
  renderApp(adminPath, repository);
  const panel = (await screen.findByRole('heading', { name: /교사 계정 등록/ })).closest('section');
  if (!panel) throw new Error('교사 계정 등록 영역이 없어요');
  await within(panel).findByRole('table');
  return { repository, panel };
}

describe('교사 계정 등록', () => {
  it('역할은 교사와 총괄 운영자 둘이고, 처음에는 교사가 골라져 있다', async () => {
    const { panel } = await openAsAdmin();
    const roles = within(panel).getAllByRole('radio');
    expect(roles.map((role) => role.textContent)).toEqual(['교사', '총괄 운영자']);
    expect(within(panel).getByRole('radio', { name: '교사' })).toBeChecked();
    // 담당 미션이나 학급은 묻지 않는다.
    expect(within(panel).queryByLabelText('담당 미션')).toBeNull();
    expect(within(panel).queryByLabelText('담당 학급')).toBeNull();
  });

  it('빗금으로 나눠 적은 이메일 여러 개를 교사로 등록하면 로그인 전 상태로 목록에 나온다', async () => {
    const user = userEvent.setup();
    const { repository, panel } = await openAsAdmin();

    await user.type(
      within(panel).getByLabelText('Google 계정 이메일'),
      'One@example.com / two@example.com / three@example.com',
    );
    await user.click(within(panel).getByRole('button', { name: '3개 계정 등록' }));

    const dialog = await screen.findByRole('dialog', { name: '3개 계정을 교사로 등록할까요?' });
    expect(within(dialog).getByText(/모든 부스를 운영·채점하고/)).toBeInTheDocument();
    expect(within(dialog).getByText('one@example.com')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '등록' }));

    expect(await within(panel).findByText('3개 계정을 교사로 등록했어요.')).toBeInTheDocument();
    const row = within(panel).getByRole('row', { name: /two@example\.com/ });
    expect(within(row).getByText('교사')).toBeInTheDocument();
    expect(within(row).getByText('로그인 전')).toBeInTheDocument();
    expect(within(panel).getByLabelText('Google 계정 이메일')).toHaveValue('');

    const registry = await repository.getTeacherRegistry();
    expect(registry.invites.map((invite) => [invite.email, invite.role])).toEqual(
      expect.arrayContaining([
        ['one@example.com', 'teacher'],
        ['two@example.com', 'teacher'],
        ['three@example.com', 'teacher'],
      ]),
    );
  });

  it('총괄 운영자로 등록할 때는 권한을 알려 주고 한 번 더 묻는다', async () => {
    const user = userEvent.setup();
    const { repository, panel } = await openAsAdmin();

    await user.type(within(panel).getByLabelText('Google 계정 이메일'), 'head@example.com');
    await user.click(within(panel).getByRole('radio', { name: '총괄 운영자' }));
    await user.click(within(panel).getByRole('button', { name: '1개 계정 등록' }));

    const dialog = await screen.findByRole('dialog', {
      name: '1개 계정을 총괄 운영자로 등록할까요?',
    });
    expect(within(dialog).getByText(/행사 설정과 교사 등록까지 할 수 있어요/)).toBeInTheDocument();
    expect(within(dialog).getByText(/이메일 주소가 맞는지 한 번 더 확인/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '등록' }));

    expect(
      await within(panel).findByText('1개 계정을 총괄 운영자로 등록했어요.'),
    ).toBeInTheDocument();
    const registry = await repository.getTeacherRegistry();
    expect(registry.invites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ email: 'head@example.com', role: 'admin' }),
      ]),
    );
  });

  it('이메일이 아닌 글이 있으면 알려 주고 등록하지 않는다', async () => {
    const user = userEvent.setup();
    const { panel } = await openAsAdmin();

    await user.type(within(panel).getByLabelText('Google 계정 이메일'), 'ok@example.com, 홍길동');
    expect(within(panel).getByText(/이메일 주소가 아닌 글이 있어요: 홍길동/)).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: '1개 계정 등록' })).toBeDisabled();
  });

  it('이미 교사인 계정은 빼고 등록한다', async () => {
    const user = userEvent.setup();
    const { panel } = await openAsAdmin();

    await user.type(
      within(panel).getByLabelText('Google 계정 이메일'),
      'teacher.sample@example.com new@example.com',
    );
    expect(
      within(panel).getByText(/이미 교사로 등록된 계정은 빼고 등록해요: teacher\.sample/),
    ).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: '1개 계정 등록' })).toBeEnabled();
  });

  it('로그인 전인 등록은 취소할 수 있다', async () => {
    const user = userEvent.setup();
    const { repository, panel } = await openAsAdmin();

    await user.click(
      within(panel).getByRole('button', { name: 'waiting.sample@example.com 등록 취소' }),
    );
    const dialog = await screen.findByRole('dialog', { name: '등록을 취소할까요?' });
    await user.click(within(dialog).getByRole('button', { name: '등록 취소' }));

    expect(
      await within(panel).findByText('waiting.sample@example.com 등록을 취소했어요.'),
    ).toBeInTheDocument();
    expect(within(panel).queryByRole('row', { name: /waiting\.sample/ })).toBeNull();
    expect((await repository.getTeacherRegistry()).invites).toEqual([]);
  });

  it('다른 교사 계정은 사용 중지했다가 다시 쓰게 할 수 있고, 내 계정은 바꿀 수 없다', async () => {
    const user = userEvent.setup();
    const { panel } = await openAsAdmin();

    const mine = within(panel).getByRole('row', { name: /admin\.sample@example\.com/ });
    expect(within(mine).getByText('내 계정')).toBeInTheDocument();
    expect(within(mine).queryByRole('button')).toBeNull();

    await user.click(
      within(panel).getByRole('button', { name: 'teacher.sample@example.com 사용 중지' }),
    );
    await user.click(
      within(await screen.findByRole('dialog', { name: '이 계정을 사용 중지할까요?' })).getByRole(
        'button',
        { name: '사용 중지' },
      ),
    );
    const row = await within(panel).findByRole('row', { name: /teacher\.sample.*사용 중지/ });
    expect(within(row).getByRole('button', { name: /다시 사용/ })).toBeInTheDocument();

    await user.click(within(row).getByRole('button', { name: /다시 사용/ }));
    await user.click(
      within(await screen.findByRole('dialog', { name: '이 계정을 다시 쓰게 할까요?' })).getByRole(
        'button',
        { name: '다시 사용' },
      ),
    );
    expect(
      await within(panel).findByText('teacher.sample@example.com 계정을 다시 쓸 수 있어요.'),
    ).toBeInTheDocument();
  });

  it('교사는 행사 설정과 교사 등록을 쓸 수 없다', async () => {
    const repository = new MockEventRepository();
    repository.signInAs('teacher');
    renderApp(adminPath, repository);

    expect(await screen.findByText(/행사 설정은 총괄 선생님만 쓸 수 있어요/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /교사 계정 등록/ })).toBeNull();
    await expect(repository.getTeacherRegistry()).rejects.toThrow();
  });
});
