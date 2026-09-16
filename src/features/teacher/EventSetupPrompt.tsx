import { useCallback, useState } from 'react';
import { AssetImage } from '../../components/AssetImage';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/Dialog';
import { InlineAlert } from '../../components/StateViews';
import type { EventSetupSummary } from '../../data/EventRepository';
import { toUserMessage } from '../../data/errors';
import { useRepository } from '../../data/RepositoryContext';
import { useAction } from '../../hooks/useAction';

interface EventSetupPromptProps {
  eventId: string;
  /** 관리자(admin)만 행사 구조를 만들 수 있다. */
  canSetup: boolean;
  onCreated: () => void;
}

/** 행사 문서가 아직 없을 때 보여 주는 첫 준비 화면. */
export function EventSetupPrompt({ eventId, canSetup, onCreated }: EventSetupPromptProps) {
  const repository = useRepository();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [summary, setSummary] = useState<EventSetupSummary | null>(null);
  const setup = useAction(useCallback(() => repository.setupEvent(eventId), [repository, eventId]));

  return (
    <section className="panel state-view" aria-labelledby="event-setup-title">
      <AssetImage asset="mascotWelcome" decorative className="state-view__mascot" />
      <p id="event-setup-title" className="state-view__title">
        아직 행사 데이터가 없어요
      </p>
      <p className="state-view__description">
        행사, 학급 20개, 팀 100개, 미션 5개 문서를 먼저 만들어야 운영 화면을 쓸 수 있어요. 행사 ID는{' '}
        <strong>{eventId}</strong>입니다.
      </p>
      {summary ? (
        <InlineAlert tone="success">
          행사 구조를 만들었어요. 학급 {summary.classes}개, 팀 {summary.teams}개, 미션{' '}
          {summary.missions}개
        </InlineAlert>
      ) : null}
      {setup.status === 'error' ? (
        <InlineAlert tone="danger">{toUserMessage(setup.error)}</InlineAlert>
      ) : null}
      {canSetup ? (
        <Button
          size="xl"
          icon="rocket_launch"
          onClick={() => setConfirmOpen(true)}
          loading={setup.isPending}
          loadingLabel="만드는 중"
        >
          행사 구조 만들기
        </Button>
      ) : (
        <InlineAlert tone="warning">
          관리자(admin) 권한이 있는 선생님이 행사를 먼저 만들어야 해요.
        </InlineAlert>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="행사 기본 구조를 만들까요?"
        confirmLabel="만들기"
        confirmIcon="rocket_launch"
        loading={setup.isPending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={async () => {
          const result = await setup.run();
          setConfirmOpen(false);
          if (result?.ok) {
            setSummary(result.value);
            onCreated();
          }
        }}
      >
        <p>3학년 4개 반, 4학년 5개 반, 5학년 6개 반, 6학년 5개 반과 학급당 5팀을 만듭니다.</p>
      </ConfirmDialog>
    </section>
  );
}
