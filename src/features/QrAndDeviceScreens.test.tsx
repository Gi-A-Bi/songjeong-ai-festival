import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EVENT_ID } from '../config';
import { toClassId, toTeamId } from '../data/mock/keys';
import { MockEventRepository } from '../data/mock/MockEventRepository';
import { SAMPLE_STATION_CODES } from '../data/mock/seed';
import { renderApp } from '../test/renderApp';

const EVENT = DEFAULT_EVENT_ID;
const SITE = 'https://songjeong-ai-festival.web.app';

async function adminRepository() {
  const repository = new MockEventRepository();
  await repository.signInTeacher();
  return repository;
}

const qrValue = (element: HTMLElement) => element.getAttribute('data-qr-value');

/** 화면에 그린 QR(SVG)을 카메라로 찍은 것처럼 흑백 그림으로 바꿔 해독기로 읽는다. */
function decodeQr(element: HTMLElement): string | null {
  const size = Number(element.getAttribute('viewBox')?.split(' ')[2]);
  const path = element.querySelector('path')?.getAttribute('d') ?? '';
  const scale = 6;
  const width = size * scale;
  const data = new Uint8ClampedArray(width * width * 4).fill(255);
  for (const match of path.matchAll(/M(\d+),(\d+)h(\d+)v1h-\d+z/g)) {
    const [left, top, length] = [Number(match[1]), Number(match[2]), Number(match[3])];
    for (let y = top * scale; y < (top + 1) * scale; y += 1) {
      for (let x = left * scale; x < (left + length) * scale; x += 1) {
        data.set([0, 0, 0, 255], (y * width + x) * 4);
      }
    }
  }
  return jsQR(data, width, width)?.data ?? null;
}

describe('QR·인증코드 인쇄 화면', () => {
  it('팀 입장 QR을 먼저 보여 주고 개발 주소는 학생 기기가 열 수 없다고 알려 준다', async () => {
    const user = userEvent.setup();
    renderApp(`/teacher/${EVENT}/qr`, await adminRepository());

    const sheets = await screen.findByLabelText('팀 입장 QR');
    await waitFor(() => expect(within(sheets).getAllByRole('img')).toHaveLength(25));
    // 개발 주소로는 학생 기기가 열 수 없으므로 알려 준다.
    expect(screen.getByText(/이 컴퓨터에서만 열려요/)).toBeInTheDocument();

    const address = screen.getByLabelText('QR에 넣을 사이트 주소');
    await user.clear(address);
    await user.type(address, `${SITE}/`);
    expect(qrValue(screen.getByRole('img', { name: '4학년 2반 3팀 입장 QR' }))).toBe(
      `${SITE}/join/${EVENT}/${toTeamId(4, 2, 3)}`,
    );
    expect(screen.queryByText(/이 컴퓨터에서만 열려요/)).toBeNull();
    expect(screen.getByRole('button', { name: '인쇄하기' })).toBeEnabled();
  });

  it('팀 입장 QR을 해독하면 그 팀의 입장 주소가 나온다', async () => {
    const user = userEvent.setup();
    renderApp(`/teacher/${EVENT}/qr`, await adminRepository());
    const address = await screen.findByLabelText('QR에 넣을 사이트 주소');
    await user.clear(address);
    await user.type(address, SITE);
    await user.selectOptions(screen.getByLabelText('학급'), toClassId(4, 2));

    const decoded = [1, 2, 3, 4, 5].map((teamNo) =>
      decodeQr(screen.getByRole('img', { name: `4학년 2반 ${teamNo}팀 입장 QR` })),
    );
    expect(decoded).toEqual(
      [1, 2, 3, 4, 5].map((teamNo) => `${SITE}/join/${EVENT}/${toTeamId(4, 2, teamNo as 1)}`),
    );
    expect(new Set(decoded).size).toBe(5);
  });

  it('주소가 올바르지 않으면 팀 QR을 인쇄할 수 없다', async () => {
    const user = userEvent.setup();
    renderApp(`/teacher/${EVENT}/qr`, await adminRepository());
    const address = await screen.findByLabelText('QR에 넣을 사이트 주소');
    await user.clear(address);
    await user.type(address, 'songjeong');
    expect(screen.getByText(/https:\/\/로 시작하는 사이트 주소/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '인쇄하기' })).toBeDisabled();
    expect(screen.queryByLabelText('팀 입장 QR')).toBeNull();
  });

  it('팀 입장 QR은 반마다 한 장에 다섯 팀이 들어가고 학년을 바꾸면 그 학년의 반을 만든다', async () => {
    const user = userEvent.setup();
    renderApp(`/teacher/${EVENT}/qr`, await adminRepository());

    // 샘플 행사는 4학년이 진행 중이라 4학년 5개 반이 먼저 보인다.
    const sheets = await screen.findByLabelText('팀 입장 QR');
    await waitFor(() => expect(within(sheets).getAllByRole('img')).toHaveLength(25));

    await user.selectOptions(screen.getByLabelText('학급'), toClassId(4, 2));
    expect(within(sheets).getAllByRole('img')).toHaveLength(5);
    expect(
      within(sheets).getByRole('heading', { name: '4학년 2반 팀 입장 QR' }),
    ).toBeInTheDocument();

    // 학년을 바꾸면 그 학년의 모든 반(3학년은 4개 반)을 다시 만든다.
    await user.selectOptions(screen.getByLabelText('학년'), '3');
    await waitFor(() =>
      expect(within(screen.getByLabelText('팀 입장 QR')).getAllByRole('img')).toHaveLength(20),
    );
  });

  it('교실 인증코드 안내문은 교실마다 한 장이며 코드를 크게 적는다', async () => {
    const user = userEvent.setup();
    renderApp(`/teacher/${EVENT}/qr`, await adminRepository());
    await user.click(await screen.findByRole('button', { name: /교실 인증코드 안내문/ }));

    const sheets = await screen.findByLabelText('교실 인증코드 안내문');
    expect(within(sheets).getAllByRole('heading', { level: 2 })).toHaveLength(5);
    expect(within(sheets).getByLabelText('각 학년 4반 교실 인증코드')).toHaveTextContent(
      SAMPLE_STATION_CODES.ozobot,
    );
    expect(within(sheets).getByLabelText('도서관 인증코드')).toHaveTextContent(
      SAMPLE_STATION_CODES['library-check'],
    );
    // 안내문에는 QR이 없고, 주소가 없어도 인쇄할 수 있다.
    expect(within(sheets).queryByRole('img')).toBeNull();
    expect(screen.getByRole('button', { name: '인쇄하기' })).toBeEnabled();
  });

  it('부스 화면에서 넘어오면 그 교실 안내문 한 장만 보여 준다', async () => {
    renderApp(`/teacher/${EVENT}/qr?station=ozobot`, await adminRepository());
    const sheets = await screen.findByLabelText('교실 인증코드 안내문');
    expect(within(sheets).getAllByRole('heading', { level: 2 })).toHaveLength(1);
    expect(within(sheets).getByRole('heading', { name: '각 학년 4반 교실' })).toBeInTheDocument();
  });

  it('총괄은 행사 설정에서 교실 인증코드를 정하고, 부스 화면은 그 코드를 크게 보여 준다', async () => {
    const user = userEvent.setup();
    const repository = await adminRepository();
    const admin = renderApp(`/teacher/${EVENT}/admin`, repository);

    const field = await screen.findByRole<HTMLInputElement>('textbox', {
      name: '각 학년 4반 교실 인증코드',
    });
    expect(field.value).toBe(SAMPLE_STATION_CODES.ozobot);
    expect(screen.getByRole('button', { name: '인증코드 저장' })).toBeDisabled();

    // 같은 코드를 두 교실에 쓰면 저장할 수 없다.
    await user.clear(field);
    await user.type(field, SAMPLE_STATION_CODES.drawing);
    expect(await screen.findByText(/인증코드가 같아요/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '인증코드 저장' })).toBeDisabled();

    await user.clear(field);
    await user.type(field, '90 81');
    expect(field.value).toBe('9081');
    await user.click(screen.getByRole('button', { name: '인증코드 저장' }));
    expect(await screen.findByText(/인증코드를 저장했어요/)).toBeInTheDocument();
    const codes = await repository.listStationCodes(EVENT);
    expect(codes.find((item) => item.missionId === 'ozobot')?.code).toBe('9081');
    admin.unmount();

    renderApp(`/teacher/${EVENT}/station/ozobot`, repository);
    await waitFor(() =>
      expect(screen.getByLabelText('4학년 4반 교실 인증코드')).toHaveTextContent('9081'),
    );
    // 학생은 새 코드로만 들어갈 수 있다.
    await repository.signOutTeacher();
    await expect(
      repository.checkInStation({
        eventId: EVENT,
        teamId: toTeamId(4, 2, 3),
        stationId: 'ozobot',
        accessCode: SAMPLE_STATION_CODES.ozobot,
      }),
    ).rejects.toThrow(/인증코드가 달라요/);
  });

  it('교사는 인증코드를 바꿀 수 없고 행사 설정도 열 수 없다', async () => {
    const repository = new MockEventRepository();
    repository.signInAs('teacher');
    await expect(repository.saveStationCodes(EVENT, { ...SAMPLE_STATION_CODES })).rejects.toThrow(
      /총괄 선생님만/,
    );
    renderApp(`/teacher/${EVENT}/admin`, repository);
    expect(await screen.findByText(/행사 설정은 총괄 선생님만 쓸 수 있어요/)).toBeInTheDocument();
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
