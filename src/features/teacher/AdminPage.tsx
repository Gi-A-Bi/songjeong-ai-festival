import { useCallback, useState } from 'react';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { StatusBadge } from '../../components/StatusBadge';
import { InlineAlert } from '../../components/StateViews';
import type { EventSetupSummary } from '../../data/EventRepository';
import { toUserMessage } from '../../data/errors';
import { useRepository } from '../../data/RepositoryContext';
import { useAction } from '../../hooks/useAction';
import { EVENT_STATUS_BADGES, useTeacherContext } from './teacherContext';

/** 행사 설정 화면. 처음 한 번 행사·학급·팀·미션 문서를 만든다. */
export function AdminPage() {
  const { eventId, event, teacher } = useTeacherContext();
  const repository = useRepository();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [summary, setSummary] = useState<EventSetupSummary | null>(null);

  const setup = useAction(useCallback(() => repository.setupEvent(eventId), [repository, eventId]));

  const statusBadge = EVENT_STATUS_BADGES[event.status];
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim();

  if (teacher.role !== 'admin') {
    return (
      <InlineAlert tone="warning">
        이 화면은 관리자(admin) 권한이 있는 선생님만 쓸 수 있어요.
      </InlineAlert>
    );
  }

  return (
    <>
      <div className="teacher-title">
        <h1 className="page__title">행사 설정</h1>
        <StatusBadge tone={statusBadge.tone} icon={statusBadge.icon} size="lg">
          {statusBadge.label}
        </StatusBadge>
      </div>

      <section className="panel stack" aria-labelledby="admin-event-title">
        <h2 id="admin-event-title" className="section-title">
          <Icon name="school" /> 현재 연결
        </h2>
        <dl className="control-bar__facts">
          <div>
            <dt>행사 ID</dt>
            <dd className="number">{eventId}</dd>
          </div>
          <div>
            <dt>데이터 모드</dt>
            <dd>{repository.mode === 'mock' ? 'mock (샘플 데이터)' : 'firebase (Firestore)'}</dd>
          </div>
          <div>
            <dt>Firebase 프로젝트</dt>
            <dd>{projectId ?? '-'}</dd>
          </div>
          <div>
            <dt>로그인</dt>
            <dd>
              {teacher.displayName} · {teacher.role}
            </dd>
          </div>
        </dl>
      </section>

      <section className="panel stack" aria-labelledby="admin-setup-title">
        <h2 id="admin-setup-title" className="section-title">
          <Icon name="add" /> 행사 기본 구조 만들기
        </h2>
        <p className="muted">
          3학년 4개 반, 4학년 5개 반, 5학년 6개 반, 6학년 5개 반과 학급당 5팀, 미션 5개를 만듭니다.
          이미 있으면 덮어쓰지 않습니다.
        </p>
        {summary ? (
          <InlineAlert tone="success">
            {summary.created ? '행사 구조를 만들었어요.' : '이미 만들어져 있어요.'} 학급{' '}
            {summary.classes}개, 팀 {summary.teams}개, 미션 {summary.missions}개
          </InlineAlert>
        ) : null}
        {setup.status === 'error' ? (
          <InlineAlert tone="danger">{toUserMessage(setup.error)}</InlineAlert>
        ) : null}
        <Button
          size="lg"
          icon="rocket_launch"
          onClick={() => setConfirmOpen(true)}
          loading={setup.isPending}
          loadingLabel="만드는 중"
        >
          행사 구조 만들기
        </Button>
      </section>

      <section className="panel stack" aria-labelledby="admin-teacher-title">
        <h2 id="admin-teacher-title" className="section-title">
          <Icon name="groups" /> 교사 계정 등록 안내
        </h2>
        <ol className="rule-list">
          <li className="rule-list__item">
            <span className="rule-list__no number">1</span>
            선생님이 교사용 로그인 화면에서 학교 Google 계정으로 로그인합니다.
          </li>
          <li className="rule-list__item">
            <span className="rule-list__no number">2</span>
            Firebase 콘솔 → Authentication에서 그 계정의 사용자 UID를 복사합니다.
          </li>
          <li className="rule-list__item">
            <span className="rule-list__no number">3</span>
            Firestore에서 <code>teachers/&#123;UID&#125;</code> 문서를 만들고 displayName, email,
            role(teacher 또는 admin), active(true)를 넣습니다.
          </li>
          <li className="rule-list__item">
            <span className="rule-list__no number">4</span>
            다시 로그인하면 교사 화면을 쓸 수 있습니다. 보안상 앱에서는 교사 등록을 할 수 없습니다.
          </li>
        </ol>
      </section>

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
          if (result?.ok) setSummary(result.value);
        }}
      >
        <p>학급 20개, 팀 100개, 미션 5개 문서를 만듭니다. 기존 데이터는 지우지 않습니다.</p>
      </ConfirmDialog>
    </>
  );
}
