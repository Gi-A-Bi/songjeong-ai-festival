import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EVENT_ID } from '../config';
import { toClassId, toTeamId } from '../data/mock/keys';
import { MockEventRepository } from '../data/mock/MockEventRepository';
import { renderApp } from '../test/renderApp';

const EVENT = DEFAULT_EVENT_ID;
const SITE = 'https://songjeong-ai-festival.web.app';

async function adminRepository() {
  const repository = new MockEventRepository();
  await repository.signInTeacher();
  return repository;
}

const qrValue = (element: HTMLElement) => element.getAttribute('data-qr-value');

describe('QR 인쇄 화면', () => {
  it('미션 교실 도착 QR 다섯 장을 교실 이름과 함께 만든다', async () => {
    const user = userEvent.setup();
    renderApp(`/teacher/${EVENT}/qr`, await adminRepository());

    const sheets = await screen.findByLabelText('미션 교실 QR');
    expect(within(sheets).getAllByRole('img')).toHaveLength(5);
    expect(within(sheets).getByRole('heading', { name: '과학실' })).toBeInTheDocument();
    // 개발 주소로는 학생 기기가 열 수 없으므로 알려 준다.
    expect(screen.getByText(/이 컴퓨터에서만 열려요/)).toBeInTheDocument();

    const address = screen.getByLabelText('QR에 넣을 사이트 주소');
    await user.clear(address);
    await user.type(address, `${SITE}/`);
    expect(qrValue(screen.getByRole('img', { name: '과학실 도착 QR' }))).toBe(
      `${SITE}/check-in/${EVENT}/ozobot`,
    );
    expect(screen.queryByText(/이 컴퓨터에서만 열려요/)).toBeNull();
    expect(screen.getByRole('button', { name: '인쇄하기' })).toBeEnabled();
  });

  it('주소가 올바르지 않으면 인쇄할 수 없다', async () => {
    const user = userEvent.setup();
    renderApp(`/teacher/${EVENT}/qr`, await adminRepository());
    const address = await screen.findByLabelText('QR에 넣을 사이트 주소');
    await user.clear(address);
    await user.type(address, 'songjeong');
    expect(screen.getByText(/https:\/\/로 시작하는 사이트 주소/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '인쇄하기' })).toBeDisabled();
    expect(screen.queryByLabelText('미션 교실 QR')).toBeNull();
  });

  it('팀 입장 QR은 반마다 한 장에 다섯 팀이 들어가고 팀 입장 주소를 담는다', async () => {
    const user = userEvent.setup();
    renderApp(`/teacher/${EVENT}/qr`, await adminRepository());
    await user.click(await screen.findByRole('button', { name: /팀 입장 QR/ }));

    // 샘플 행사는 4학년이 진행 중이라 4학년 5개 반이 먼저 보인다.
    const sheets = await screen.findByLabelText('팀 입장 QR');
    await waitFor(() => expect(within(sheets).getAllByRole('img')).toHaveLength(25));

    await user.selectOptions(screen.getByLabelText('학급'), toClassId(4, 2));
    expect(within(sheets).getAllByRole('img')).toHaveLength(5);
    expect(
      within(sheets).getByRole('heading', { name: '4학년 2반 팀 입장 QR' }),
    ).toBeInTheDocument();
    expect(qrValue(screen.getByRole('img', { name: '4학년 2반 3팀 입장 QR' }))).toMatch(
      new RegExp(`/join/${EVENT}/${toTeamId(4, 2, 3)}$`),
    );

    // 학년을 바꾸면 그 학년의 모든 반(3학년은 4개 반)을 다시 만든다.
    await user.selectOptions(screen.getByLabelText('학년'), '3');
    await waitFor(() =>
      expect(within(screen.getByLabelText('팀 입장 QR')).getAllByRole('img')).toHaveLength(20),
    );
  });

  it('부스 화면에서 넘어오면 그 교실 QR 한 장만 보여 준다', async () => {
    renderApp(`/teacher/${EVENT}/qr?station=ozobot`, await adminRepository());
    const sheets = await screen.findByLabelText('미션 교실 QR');
    expect(within(sheets).getAllByRole('img')).toHaveLength(1);
    expect(within(sheets).getByRole('heading', { name: '과학실' })).toBeInTheDocument();
  });

  it('부스 화면은 교실 QR을 화면에 띄우고 인쇄 화면으로 이어 준다', async () => {
    renderApp(`/teacher/${EVENT}/station/ozobot`, await adminRepository());
    const qr = await screen.findByRole('img', { name: '과학실 도착 QR' });
    expect(qrValue(qr)).toMatch(new RegExp(`/check-in/${EVENT}/ozobot$`));
    expect(screen.getByRole('link', { name: /이 교실 QR 인쇄하기/ })).toHaveAttribute(
      'href',
      `/teacher/${EVENT}/qr?station=ozobot`,
    );
  });
});

describe('기기 잠금 해제', () => {
  it('다른 팀에 묶인 기기는 어느 팀인지와 기기 번호를 보여 준다', async () => {
    const user = userEvent.setup();
    const repository = new MockEventRepository();
    await repository.joinTeam(EVENT, toTeamId(4, 2, 4));
    renderApp(`/join/${EVENT}/${toTeamId(4, 2, 3)}`, repository);

    await user.click(await screen.findByRole('button', { name: /맞아요, 입장하기/ }));
    const title = await screen.findByText(/4학년 2반 4팀으로 입장해\s+있어요/);
    const notice = title.closest('[role="alert"]');
    if (!(notice instanceof HTMLElement)) throw new Error('잠금 안내가 없어요');
    const { code } = await repository.getMyDevice(EVENT);
    expect(within(notice).getByText(code)).toBeInTheDocument();
    expect(
      within(notice).getByRole('link', { name: /4학년 2반 4팀 화면으로 가기/ }),
    ).toHaveAttribute('href', `/team/${EVENT}/${toTeamId(4, 2, 4)}`);
  });

  it('교사가 학급 화면에서 잠금을 풀면 그 기기는 올바른 팀으로 입장할 수 있다', async () => {
    const user = userEvent.setup();
    const repository = new MockEventRepository();
    await repository.joinTeam(EVENT, toTeamId(4, 2, 4));
    const { code } = await repository.getMyDevice(EVENT);
    await repository.signInTeacher();
    renderApp(`/teacher/${EVENT}/class/${toClassId(4, 2)}`, repository);

    // 기기 목록은 버튼을 눌렀을 때만 읽는다.
    const panel = await screen.findByRole('region', { name: /팀 기기 잠금 해제/ });
    expect(within(panel).queryByRole('table')).toBeNull();
    await user.click(within(panel).getByRole('button', { name: '입장한 기기 보기' }));

    const cell = await within(panel).findByText(code);
    const row = cell.closest('tr');
    if (!row) throw new Error('기기 줄이 없어요');
    expect(within(row).getByRole('rowheader', { name: '4학년 2반 4팀' })).toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: '잠금 해제' }));

    const dialog = await screen.findByRole('dialog', { name: `기기 ${code}의 잠금을 풀까요?` });
    expect(within(dialog).getByText(/제출과 카드, 도착 기록은 그대로 남아요/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '잠금 해제' }));

    expect(
      await within(panel).findByText(new RegExp(`기기 ${code}의 잠금을 풀었어요`)),
    ).toBeInTheDocument();
    await waitFor(() => expect(within(panel).queryByText(code)).toBeNull());
    await expect(repository.joinTeam(EVENT, toTeamId(4, 2, 3))).resolves.toMatchObject({
      teamId: toTeamId(4, 2, 3),
    });
  });
});
