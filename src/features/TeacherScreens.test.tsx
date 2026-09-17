import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EVENT_ID } from '../config';
import { MockEventRepository } from '../data/mock/MockEventRepository';
import { renderApp } from '../test/renderApp';

async function signedInRepository() {
  const repository = new MockEventRepository();
  await repository.signInTeacher();
  return repository;
}

describe('교사 미션 운영 화면', () => {
  it('골든벨 문제를 등록하면 저장소에 반영된다', async () => {
    const user = userEvent.setup();
    const repository = await signedInRepository();
    renderApp(`/teacher/${DEFAULT_EVENT_ID}/station/golden-bell`, repository);

    await user.click(await screen.findByRole('button', { name: /문제 등록 \(7문항\)/ }));
    await user.click(screen.getByRole('button', { name: /문제 추가/ }));
    await user.click(screen.getByRole('button', { name: /문제 저장/ }));
    // 빈 문제는 저장하지 않고 이유를 알려 준다.
    expect(await screen.findByText(/8번 문제: 문제를 적어 주세요/)).toBeInTheDocument();

    const card = screen.getByRole('heading', { name: '8번 문제' }).closest('li');
    if (!card) throw new Error('문제 카드가 없어요');
    await user.type(within(card).getByLabelText('문제'), '로봇은 무엇으로 움직일까요?');
    await user.type(within(card).getByLabelText('8번 문제 보기 1'), '명령');
    await user.type(within(card).getByLabelText('8번 문제 보기 2'), '기분');
    await user.click(screen.getByRole('button', { name: /문제 저장/ }));

    expect(await screen.findByText('문제를 저장했어요.')).toBeInTheDocument();
    const mission = await repository.getMission(DEFAULT_EVENT_ID, 'golden-bell');
    expect(mission.config.type === 'golden_bell' && mission.config.questions).toHaveLength(8);
  });

  it('그리기 미션에서 AI 평가 요청문을 그림 설명과 파일 이름으로 만든다', async () => {
    const repository = await signedInRepository();
    renderApp(`/teacher/${DEFAULT_EVENT_ID}/station/drawing`, repository);

    const prompt = await screen.findByRole<HTMLTextAreaElement>('textbox', {
      name: 'AI 평가 요청문',
    });
    expect(prompt.value).toContain('초록 언덕 위에 빨간 지붕 집');
    // 샘플 데이터에서 2라운드 그리기는 1·3·5반 2팀이 제출했다.
    expect(prompt.value).toContain('1. 4학년-1반-2팀_2라운드.webp');
    expect(prompt.value).toContain('3. 4학년-5반-2팀_2라운드.webp');
    expect(screen.getByRole('button', { name: /요청문 복사/ })).toBeEnabled();
  });

  it('확정 전 제출은 되돌릴 수 있다', async () => {
    const user = userEvent.setup();
    const repository = await signedInRepository();
    renderApp(`/teacher/${DEFAULT_EVENT_ID}/station/drawing`, repository);

    const [reopen] = await screen.findAllByRole('button', { name: /재제출 허용/ });
    await user.click(reopen);
    const dialog = await screen.findByRole('dialog', { name: /제출을 되돌릴까요/ });
    await user.click(within(dialog).getByRole('button', { name: /재제출 허용/ }));
    expect(await screen.findByText(/다시 제출할 수 있어요/)).toBeInTheDocument();
    expect(screen.getByText('재제출 대기')).toBeInTheDocument();
  });
});
