import { render, renderHook, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SettingsContext } from '../app/SettingsContext';
import { Timer } from '../components/Timer';
import { DEFAULT_EVENT_ID } from '../config';
import { toClassId } from '../data/mock/keys';
import { MockEventRepository } from '../data/mock/MockEventRepository';
import { RepositoryContext } from '../data/RepositoryContext';
import { DEMO_TEAM_ID } from '../data/mock/seed';
import type { MissionPhase } from '../domain/types';
import { useCountdownSound } from '../hooks/useCountdownSound';
import type { SoundEffect } from '../lib/sound';
import { renderApp } from '../test/renderApp';
import { GameStartSplash } from './missions/GameStartSplash';

const EVENT = DEFAULT_EVENT_ID;

function withSound(playEffect: (effect: SoundEffect) => void) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <SettingsContext.Provider
        value={{ soundEnabled: true, toggleSound: () => undefined, playEffect }}
      >
        {children}
      </SettingsContext.Provider>
    );
  };
}

describe('무대 테마', () => {
  it('학생 화면은 무대 테마로 보이고, 화면을 떠나면 기본 테마로 돌아간다', async () => {
    const view = renderApp(`/team/${EVENT}/${DEMO_TEAM_ID}`);
    expect(await screen.findByRole('heading', { name: '로봇 길찾기' })).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe('stage');
    view.unmount();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('교사 운영 화면은 밝은 기본 테마를 쓴다', async () => {
    const repository = new MockEventRepository();
    await repository.signInTeacher();
    renderApp(`/teacher/${EVENT}/dashboard`, repository);
    expect(
      await screen.findByRole('heading', { name: '실시간 운영 대시보드' }),
    ).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(screen.getByRole('navigation', { name: '교사 메뉴' })).toBeInTheDocument();
  });

  it('전자칠판 최종 미션은 무대 테마로 보이고 교사 메뉴 대신 학급 화면으로 가는 뒤로 버튼만 둔다', async () => {
    const repository = new MockEventRepository();
    await repository.signInTeacher();
    const classId = toClassId(3, 1);
    renderApp(`/teacher/${EVENT}/class/${classId}/final`, repository);
    expect(await screen.findByText('문제 4 / 10')).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe('stage');
    expect(screen.queryByRole('navigation', { name: '교사 메뉴' })).toBeNull();
    expect(screen.getByRole('link', { name: '뒤로' })).toHaveAttribute(
      'href',
      `/teacher/${EVENT}/class/${classId}`,
    );
    expect(screen.getByRole('timer', { name: /남은 시간/ })).toBeInTheDocument();
  });
});

describe('팀 홈의 미션 지도', () => {
  it('다섯 라운드의 미션과 교실을 순서대로 보여 주고 지금 갈 곳을 표시한다', async () => {
    renderApp(`/team/${EVENT}/${DEMO_TEAM_ID}`);
    const map = await screen.findByRole('region', { name: /미션 지도/ });
    const rows = within(map).getAllByRole('link');
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent('AI 설명대로 그려라');
    expect(rows[0]).toHaveTextContent('1라운드 · 4학년 3반 교실');
    expect(rows[0]).toHaveTextContent('완료');
    expect(rows[1]).toHaveTextContent('로봇 길찾기');
    expect(rows[1]).toHaveTextContent('2라운드 · 4학년 4반 교실');
    expect(rows[1]).toHaveTextContent('지금');
    expect(rows[2]).toHaveTextContent('3라운드 · 도서관');
    expect(rows[2]).toHaveTextContent('예정');
  });

  it('우리 반 카드 다섯 종류의 조각 수를 함께 보여 준다', async () => {
    renderApp(`/team/${EVENT}/${DEMO_TEAM_ID}`);
    const strip = await screen.findByRole('list', { name: '우리 반 카드 진행도' });
    expect(within(strip).getAllByRole('listitem')).toHaveLength(5);
    expect(within(strip).getByRole('img', { name: '생각 카드 조각 2/4' })).toBeInTheDocument();
  });
});

describe('게임 시작 연출', () => {
  function renderSplash(phase: MissionPhase | null, playEffect = vi.fn()) {
    const view = render(<GameStartSplash phase={phase} />, { wrapper: withSound(playEffect) });
    return { ...view, playEffect };
  }

  it('기다리던 미션이 열리면 “게임 시작!”을 보여 주고 소리를 낸다', () => {
    const { rerender, playEffect } = renderSplash('waiting');
    expect(screen.queryByText('게임 시작!')).toBeNull();
    rerender(<GameStartSplash phase="active" />);
    expect(screen.getByText('게임 시작!')).toBeInTheDocument();
    expect(playEffect).toHaveBeenCalledWith('go');
  });

  it('화면을 열었을 때 이미 게임 중이면 보여 주지 않는다', () => {
    const { rerender, playEffect } = renderSplash(null);
    rerender(<GameStartSplash phase="active" />);
    expect(screen.queryByText('게임 시작!')).toBeNull();
    expect(playEffect).not.toHaveBeenCalled();
  });

  it('잠깐 보였다가 사라진다', () => {
    vi.useFakeTimers();
    try {
      const { rerender } = renderSplash('waiting');
      rerender(<GameStartSplash phase="active" />);
      expect(screen.getByText('게임 시작!')).toBeInTheDocument();
      vi.advanceTimersByTime(2000);
      rerender(<GameStartSplash phase="active" />);
      expect(screen.queryByText('게임 시작!')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('남은 시간 효과음', () => {
  it('마지막 10초에는 1초마다, 0초가 되면 종료 소리를 낸다', () => {
    const playEffect = vi.fn();
    const { rerender } = renderHook(({ seconds }) => useCountdownSound(seconds), {
      initialProps: { seconds: 12 as number | null },
      wrapper: withSound(playEffect),
    });
    rerender({ seconds: 11 });
    expect(playEffect).not.toHaveBeenCalled();
    rerender({ seconds: 10 });
    expect(playEffect).toHaveBeenLastCalledWith('tick');
    rerender({ seconds: 1 });
    rerender({ seconds: 0 });
    expect(playEffect).toHaveBeenLastCalledWith('timeup');
    expect(playEffect).toHaveBeenCalledTimes(3);
  });

  it('화면을 열었을 때 이미 끝난 시간에는 소리를 내지 않는다', () => {
    const playEffect = vi.fn();
    const { rerender } = renderHook(({ seconds }) => useCountdownSound(seconds), {
      initialProps: { seconds: 0 as number | null },
      wrapper: withSound(playEffect),
    });
    rerender({ seconds: 0 });
    expect(playEffect).not.toHaveBeenCalled();
  });

  it('소리를 켜 달라고 하지 않은 타이머는 조용하다', () => {
    const playEffect = vi.fn();
    const { rerender } = renderHook(({ seconds }) => useCountdownSound(seconds, false), {
      initialProps: { seconds: 5 as number | null },
      wrapper: withSound(playEffect),
    });
    rerender({ seconds: 4 });
    expect(playEffect).not.toHaveBeenCalled();
  });
});

describe('타이머 모양', () => {
  function renderTimer(ui: ReactNode, now: number) {
    const repository = new MockEventRepository();
    vi.spyOn(repository, 'serverNow').mockReturnValue(now);
    return render(
      <RepositoryContext.Provider value={{ repository, devTools: repository }}>
        {ui}
      </RepositoryContext.Provider>,
    );
  }

  it('막대 타이머는 마지막 1분에 긴박한 문구를 보여 주되 낭독기 이름은 그대로 둔다', () => {
    const now = 1_000_000;
    renderTimer(
      <Timer status="active" endsAt={now + 48_000} variant="bar" totalMs={600_000} />,
      now,
    );
    const timer = screen.getByRole('timer', { name: '남은 시간 48초' });
    expect(timer).toHaveTextContent('마지막 1분!');
    expect(timer).toHaveTextContent('00:48');
  });

  it('원형 타이머는 게임을 시작하기 전에 게임 대기로 보인다', () => {
    renderTimer(<Timer status="ready" endsAt={null} variant="ring" totalMs={600_000} />, 1_000_000);
    expect(screen.getByRole('timer', { name: '게임 대기' })).toHaveTextContent('--:--');
  });
});
