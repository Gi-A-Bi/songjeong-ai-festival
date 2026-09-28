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
  it('빗금으로 나눠 적은 이메일 여러 개를 총괄로 등록하면 로그인 전 상태로 목록에 나온다', async () => {
    const user = userEvent.setup();
    const { repository, panel } = await openAsAdmin();

    await user.type(
      within(panel).getByLabelText('Google 계정 이메일'),
      'One@example.com / two@example.com / three@example.com',
    );
    await user.click(within(panel).getByRole('radio', { name: '총괄 운영자' }));
    await user.click(within(panel).getByRole('button', { name: '3개 계정 등록' }));

    const dialog = await screen.findByRole('dialog', {
      name: '3개 계정을 총괄 운영자로 등록할까요?',
    });
    expect(within(dialog).getByText(/이메일 주소가 맞는지 한 번 더 확인/)).toBeInTheDocument();
    expect(within(dialog).getByText('one@example.com')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '등록' }));

    expect(
      await within(panel).findByText('3개 계정을 총괄 운영자로 등록했어요.'),
    ).toBeInTheDocument();
    const row = within(panel).getByRole('row', { name: /two@example\.com/ });
    expect(within(row).getByText('총괄 운영자')).toBeInTheDocument();
    expect(within(row).getByText('로그인 전')).toBeInTheDocument();
    expect(within(panel).getByLabelText('Google 계정 이메일')).toHaveValue('');

    const registry = await repository.getTeacherRegistry();
    expect(registry.invites.map((invite) => [invite.email, invite.role])).toEqual(
      expect.arrayContaining([
        ['one@example.com', 'admin'],
        ['two@example.com', 'admin'],
        ['three@example.com', 'admin'],
      ]),
    );
  });

  it('부스 교사는 담당 미션을, 담임교사는 담당 학급을 고른다', async () => {
    const user = userEvent.setup();
    const { repository, panel } = await openAsAdmin();

    await user.type(within(panel).getByLabelText('Google 계정 이메일'), 'booth@example.com');
    await user.selectOptions(within(panel).getByLabelText('담당 미션'), 'golden-bell');
    await user.click(within(panel).getByRole('button', { name: '1개 계정 등록' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: '등록' }),
    );
    expect(await within(panel).findByRole('row', { name: /booth@example\.com/ })).toHaveTextContent(
      'AI 골든벨',
    );

    await user.click(within(panel).getByRole('radio', { name: '담임교사' }));
    await user.type(within(panel).getByLabelText('Google 계정 이메일'), 'homeroom@example.com');
    // 학급을 고르기 전에는 등록할 수 없다.
    expect(within(panel).getByText('담임교사는 담당 학급을 골라 주세요.')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: '1개 계정 등록' })).toBeDisabled();
    await user.selectOptions(within(panel).getByLabelText('담당 학급'), 'g5-c3');
    await user.click(within(panel).getByRole('button', { name: '1개 계정 등록' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: '등록' }),
    );
    expect(
      await within(panel).findByRole('row', { name: /homeroom@example\.com/ }),
    ).toHaveTextContent('5학년 3반');

    const registry = await repository.getTeacherRegistry();
    expect(registry.invites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          email: 'booth@example.com',
          role: 'station_teacher',
          missionId: 'golden-bell',
          classId: null,
        }),
        expect.objectContaining({
          email: 'homeroom@example.com',
          role: 'homeroom_teacher',
          missionId: null,
          classId: 'g5-c3',
        }),
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
      'homeroom.sample@example.com new@example.com',
    );
    expect(
      within(panel).getByText(/이미 교사로 등록된 계정은 빼고 등록해요: homeroom\.sample/),
    ).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: '1개 계정 등록' })).toBeEnabled();
  });

  it('로그인 전인 등록은 취소할 수 있다', async () => {
    const user = userEvent.setup();
    const { repository, panel } = await openAsAdmin();

    await user.click(
      within(panel).getByRole('button', { name: 'booth.sample@example.com 등록 취소' }),
    );
    const dialog = await screen.findByRole('dialog', { name: '등록을 취소할까요?' });
    await user.click(within(dialog).getByRole('button', { name: '등록 취소' }));

    expect(
      await within(panel).findByText('booth.sample@example.com 등록을 취소했어요.'),
    ).toBeInTheDocument();
    expect(within(panel).queryByRole('row', { name: /booth\.sample/ })).toBeNull();
    expect((await repository.getTeacherRegistry()).invites).toEqual([]);
  });

  it('다른 교사 계정은 사용 중지했다가 다시 쓰게 할 수 있고, 내 계정은 바꿀 수 없다', async () => {
    const user = userEvent.setup();
    const { panel } = await openAsAdmin();

    const mine = within(panel).getByRole('row', { name: /admin\.sample@example\.com/ });
    expect(within(mine).getByText('내 계정')).toBeInTheDocument();
    expect(within(mine).queryByRole('button')).toBeNull();

    await user.click(
      within(panel).getByRole('button', { name: 'homeroom.sample@example.com 사용 중지' }),
    );
    await user.click(
      within(await screen.findByRole('dialog', { name: '이 계정을 사용 중지할까요?' })).getByRole(
        'button',
        { name: '사용 중지' },
      ),
    );
    const row = await within(panel).findByRole('row', { name: /homeroom\.sample.*사용 중지/ });
    expect(within(row).getByRole('button', { name: /다시 사용/ })).toBeInTheDocument();

    await user.click(within(row).getByRole('button', { name: /다시 사용/ }));
    await user.click(
      within(await screen.findByRole('dialog', { name: '이 계정을 다시 쓰게 할까요?' })).getByRole(
        'button',
        { name: '다시 사용' },
      ),
    );
    expect(
      await within(panel).findByText('homeroom.sample@example.com 계정을 다시 쓸 수 있어요.'),
    ).toBeInTheDocument();
  });

  it('총괄이 아닌 교사는 행사 설정과 교사 등록을 볼 수 없다', async () => {
    const repository = new MockEventRepository();
    repository.signInAs('station_teacher');
    renderApp(adminPath, repository);

    expect(await screen.findByText(/관리자\(admin\) 권한이 있는 선생님만/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /교사 계정 등록/ })).toBeNull();
    await expect(repository.getTeacherRegistry()).rejects.toThrow();
  });
});
