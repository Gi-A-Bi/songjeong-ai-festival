import { useCallback, useState } from 'react';
import { paths } from '../../app/paths';
import { Button, ButtonLink } from '../../components/Button';
import { ConfirmDialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { StatusBadge } from '../../components/StatusBadge';
import { InlineAlert } from '../../components/StateViews';
import type { EventSetupSummary } from '../../data/EventRepository';
import { toUserMessage } from '../../data/errors';
import { useRepository } from '../../data/RepositoryContext';
import { useAction } from '../../hooks/useAction';
import { FinalQuestionUploadPanel } from './FinalQuestionUploadPanel';
import { TeacherRegistrationPanel } from './TeacherRegistrationPanel';
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
    return <InlineAlert tone="warning">행사 설정은 총괄 선생님만 쓸 수 있어요.</InlineAlert>;
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
          이미 있으면 덮어쓰지 않습니다. 학년별 최종 미션 문제가 없으면 샘플 10문제도 함께 넣습니다.
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

      <FinalQuestionUploadPanel eventId={eventId} />

      <section className="panel stack" aria-labelledby="admin-qr-title">
        <h2 id="admin-qr-title" className="section-title">
          <Icon name="qr_code_scanner" /> QR 인쇄
        </h2>
        <p className="muted">
          미션 교실 입구에 붙일 도착 QR 5장과 팀 입장 QR(반마다 한 장)을 A4로 인쇄합니다. QR은 이
          기기 안에서 만들며 외부 서비스에 주소를 보내지 않습니다.
        </p>
        <ButtonLink to={paths.qrPrint(eventId)} variant="secondary" size="lg" icon="print">
          QR 인쇄 화면 열기
        </ButtonLink>
      </section>

      <TeacherRegistrationPanel currentUid={teacher.uid} />

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
