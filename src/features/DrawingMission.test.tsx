import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_EVENT_ID } from '../config';
import { toTeamId } from '../data/mock/keys';
import { MockEventRepository } from '../data/mock/MockEventRepository';
import { renderApp } from '../test/renderApp';
import type * as DrawingModule from './missions/drawing/drawing';

// 테스트 환경에는 카메라와 Canvas가 없어 사진을 읽고 줄이는 부분만 가짜로 바꾼다.
vi.mock('./missions/drawing/drawing', async (importOriginal) => {
  const original = await importOriginal<typeof DrawingModule>();
  const canvas = { width: 1280, height: 960 } as HTMLCanvasElement;
  return {
    ...original,
    loadPhotoFile: vi.fn(async () => ({ naturalWidth: 1280, naturalHeight: 960 })),
    renderPhoto: vi.fn(() => canvas),
    compressDrawing: vi.fn(async () => ({
      ok: true,
      drawing: {
        blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/webp' }),
        width: 1280,
        height: 960,
      },
    })),
  };
});

// 4학년 2반 2팀은 2라운드(진행 중)에 그리기 미션을 하고 아직 제출하지 않았다.
const TEAM_ID = toTeamId(4, 2, 2);
const missionPath = (teamId: string) => `/team/${DEFAULT_EVENT_ID}/${teamId}/mission/drawing`;

describe('그리기 미션 학생 화면', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:photo');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('학년에 맞는 명화 프롬프트와 심사 기준, 그리는 순서를 보여 준다', async () => {
    renderApp(missionPath(TEAM_ID));

    expect(await screen.findByText('반 고흐 〈별이 빛나는 밤〉')).toBeInTheDocument();
    expect(screen.getByText(/노란 별 11개와 오른쪽 위에 초승달 1개/)).toBeInTheDocument();
    const rubric = screen.getByRole('list', { name: 'AI 심사위원이 보는 것' });
    expect(within(rubric).getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getByText('종이에 그려요')).toBeInTheDocument();
    expect(screen.getByText('팀에서 1장을 골라요')).toBeInTheDocument();
    // 사진이 없으면 제출할 수 없다.
    expect(screen.getByRole('button', { name: /이 사진으로 제출/ })).toBeDisabled();
    // 화면 그림판은 더 이상 없다.
    expect(screen.queryByRole('toolbar', { name: '그리기 도구' })).toBeNull();
  });

  it('선생님이 고른 프롬프트가 학생 화면에 나온다', async () => {
    const repository = new MockEventRepository();
    await repository.signInTeacher();
    const mission = await repository.getMission(DEFAULT_EVENT_ID, 'drawing');
    if (mission.config.type !== 'drawing') throw new Error('그리기 미션이 아니에요');
    await repository.updateMissionConfig(DEFAULT_EVENT_ID, 'drawing', {
      ...mission.config,
      selectedPromptIds: { 4: 'gleaners' },
    });
    await repository.signOutTeacher();

    renderApp(missionPath(TEAM_ID), repository);
    expect(await screen.findByText('밀레 〈이삭 줍는 여인들〉')).toBeInTheDocument();
    expect(screen.getByText(/바구니를 든 로봇 세 대/)).toBeInTheDocument();
  });

  it('카메라를 쓸 수 없는 기기에서는 사진 파일을 골라 제출한다', async () => {
    const user = userEvent.setup();
    const repository = new MockEventRepository();
    renderApp(missionPath(TEAM_ID), repository);

    await screen.findByText('반 고흐 〈별이 빛나는 밤〉');
    expect(screen.queryByRole('button', { name: '사진 찍기' })).toBeNull();
    const file = new File([new Uint8Array([9, 9])], 'drawing.jpg', { type: 'image/jpeg' });
    await user.upload(screen.getByLabelText('그림 사진 파일'), file);

    expect(await screen.findByRole('img', { name: '제출할 그림 사진' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '돌리기' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: /이 사진으로 제출/ }));
    const dialog = await screen.findByRole('dialog', { name: '이 사진으로 제출할까요?' });
    expect(within(dialog).getByText(/이름과 얼굴이 나오지 않았나요/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '제출하기' }));

    expect(await screen.findByText(/제출 완료 · 선생님이 순위를 정해요/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '우리 팀이 제출한 그림 사진' })).toBeInTheDocument();
    await repository.signInTeacher();
    const files = await repository.listDrawingFiles(DEFAULT_EVENT_ID, 'drawing', 4, 2);
    const mine = files.find((item) => item.teamId === TEAM_ID);
    expect(mine).toMatchObject({
      promptId: 'starry-night',
      mimeType: 'image/webp',
      width: 1280,
      height: 960,
    });
    expect(Array.from(mine?.bytes ?? [])).toEqual([1, 2, 3, 4]);
  });

  it('카메라가 있는 기기에서는 사진 찍기 버튼으로 카메라를 연다', async () => {
    const user = userEvent.setup();
    const stop = vi.fn();
    const getUserMedia = vi.fn(async () => ({
      getTracks: () => [{ stop }],
      getVideoTracks: () => [{ getSettings: () => ({ deviceId: 'back' }) }],
    }));
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia, enumerateDevices: vi.fn(async () => []) },
    });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);

    try {
      renderApp(missionPath(TEAM_ID));
      await user.click(await screen.findByRole('button', { name: '사진 찍기' }));

      expect(await screen.findByLabelText('카메라 화면')).toBeInTheDocument();
      expect(getUserMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          audio: false,
          video: expect.objectContaining({ facingMode: { ideal: 'environment' } }),
        }),
      );
      const shoot = await screen.findByRole('button', { name: /찰칵! 찍기/ });
      await vi.waitFor(() => expect(shoot).toBeEnabled());
      await user.click(shoot);

      expect(await screen.findByRole('img', { name: '제출할 그림 사진' })).toBeInTheDocument();
      // 찍고 나면 카메라를 끈다.
      expect(stop).toHaveBeenCalled();
      expect(screen.getByRole('button', { name: '다시 찍기' })).toBeEnabled();
    } finally {
      Reflect.deleteProperty(navigator, 'mediaDevices');
    }
  });
});
