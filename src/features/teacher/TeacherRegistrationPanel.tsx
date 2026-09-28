import { useCallback, useState } from 'react';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/Dialog';
import { FormField } from '../../components/FormField';
import { Icon } from '../../components/Icon';
import { InlineAlert, LoadingView } from '../../components/StateViews';
import { StatusBadge } from '../../components/StatusBadge';
import type { TeacherRegistry } from '../../data/EventRepository';
import { toUserMessage } from '../../data/errors';
import { useRepository } from '../../data/RepositoryContext';
import {
  getTeacherInviteError,
  MAX_INVITES_PER_SAVE,
  parseInviteEmails,
} from '../../domain/teacherInvites';
import type { TeacherRole } from '../../domain/types';
import { useAction } from '../../hooks/useAction';
import { useAsyncData } from '../../hooks/useAsyncData';
import { TEACHER_ROLE_LABELS } from './teacherContext';

interface TeacherRegistrationPanelProps {
  /** 지금 로그인한 총괄 운영자. 자기 계정은 사용 중지할 수 없다. */
  currentUid: string;
}

/** 교사를 먼저 둔다. 대부분의 선생님은 교사로 등록한다. */
const ROLES: readonly TeacherRole[] = ['teacher', 'admin'];

const ROLE_HINTS: Record<TeacherRole, string> = {
  teacher:
    '모든 부스를 운영·채점하고 모든 학급의 최종 미션을 진행할 수 있어요. 라운드 제어와 행사 설정은 할 수 없어요.',
  admin:
    '교사가 하는 일에 더해 라운드 제어, 최종 미션 열기·결과 공개, 행사 설정과 교사 등록까지 할 수 있어요.',
};

type RowStatus = 'waiting' | 'active' | 'stopped';

interface RegistryRow {
  key: string;
  email: string;
  displayName: string;
  role: TeacherRole;
  status: RowStatus;
  uid: string | null;
}

/** 로그인한 계정을 먼저, 아직 로그인하지 않은 등록 이메일을 그다음에 둔다. */
function toRows(registry: TeacherRegistry): RegistryRow[] {
  const accountEmails = new Set(registry.accounts.map((account) => account.email));
  return [
    ...registry.accounts.map((account): RegistryRow => ({
      key: `account-${account.uid}`,
      email: account.email,
      displayName: account.displayName,
      role: account.role,
      status: account.active ? 'active' : 'stopped',
      uid: account.uid,
    })),
    ...registry.invites
      .filter((invite) => !accountEmails.has(invite.email))
      .map((invite): RegistryRow => ({
        key: `invite-${invite.email}`,
        email: invite.email,
        displayName: invite.displayName,
        role: invite.role,
        status: 'waiting',
        uid: null,
      })),
  ];
}

type PendingAction =
  | { type: 'cancel'; row: RegistryRow }
  | { type: 'stop'; row: RegistryRow }
  | { type: 'resume'; row: RegistryRow };

/**
 * 총괄 운영자가 Google 계정 이메일로 교사를 등록한다.
 * 등록된 계정은 교사용 로그인에서 처음 로그인할 때 바로 교사가 된다.
 */
export function TeacherRegistrationPanel({ currentUid }: TeacherRegistrationPanelProps) {
  const repository = useRepository();
  const [text, setText] = useState('');
  const [role, setRole] = useState<TeacherRole>('teacher');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** 등록·취소 뒤에 저장소가 돌려준 최신 목록 */
  const [latest, setLatest] = useState<TeacherRegistry | null>(null);

  const loadRegistry = useCallback(() => repository.getTeacherRegistry(), [repository]);
  const registryData = useAsyncData(loadRegistry);

  const save = useAction(
    useCallback(
      (emails: string[], picked: TeacherRole) =>
        repository.saveTeacherInvites({ emails, role: picked }),
      [repository],
    ),
  );
  const change = useAction(
    useCallback(
      (action: PendingAction) =>
        action.type === 'cancel'
          ? repository.deleteTeacherInvite(action.row.email)
          : repository.setTeacherActive(action.row.uid ?? '', action.type === 'resume'),
      [repository],
    ),
  );

  const registry = latest ?? (registryData.status === 'success' ? registryData.data : null);
  const rows = registry ? toRows(registry) : [];

  const parsed = parseInviteEmails(text);
  const registeredEmails = new Set(registry?.accounts.map((account) => account.email) ?? []);
  /** 이미 로그인해 교사가 된 계정은 다시 등록해도 바뀌지 않아 뺀다. */
  const already = parsed.emails.filter((email) => registeredEmails.has(email));
  const emails = parsed.emails.filter((email) => !registeredEmails.has(email));
  const draftError = text.trim() === '' ? null : getTeacherInviteError({ emails, role });
  const canSave =
    registry !== null && emails.length > 0 && parsed.invalid.length === 0 && draftError === null;

  const handleSave = async () => {
    const result = await save.run(emails, role);
    setConfirmOpen(false);
    if (!result?.ok) return;
    setLatest(result.value);
    setNotice(`${emails.length}개 계정을 ${TEACHER_ROLE_LABELS[role]}로 등록했어요.`);
    setText('');
  };

  const handleChange = async () => {
    if (!pending) return;
    const result = await change.run(pending);
    const done = pending;
    setPending(null);
    if (!result?.ok) return;
    setLatest(result.value);
    setNotice(
      done.type === 'cancel'
        ? `${done.row.email} 등록을 취소했어요.`
        : done.type === 'stop'
          ? `${done.row.email} 계정을 사용 중지했어요.`
          : `${done.row.email} 계정을 다시 쓸 수 있어요.`,
    );
  };

  return (
    <section className="panel stack" aria-labelledby="admin-teacher-title">
      <h2 id="admin-teacher-title" className="section-title">
        <Icon name="groups" /> 교사 계정 등록
      </h2>
      <p className="muted">
        선생님의 Google 계정 이메일을 등록하면, 그 계정으로 교사용 로그인에서 로그인하자마자 교사
        화면이 열려요. 등록하지 않은 계정은 로그인해도 들어올 수 없어요.
      </p>

      <FormField
        id="teacher-emails"
        label="Google 계정 이메일"
        hint={`여러 개는 줄바꿈, 쉼표, 빗금(/)으로 나눠 적어요. 한 번에 ${MAX_INVITES_PER_SAVE}개까지 등록할 수 있어요.`}
        error={
          parsed.invalid.length > 0
            ? `이메일 주소가 아닌 글이 있어요: ${parsed.invalid.join(', ')}`
            : (draftError ?? undefined)
        }
      >
        {(control) => (
          <textarea
            {...control}
            className="text-input"
            rows={4}
            value={text}
            placeholder="teacher1@example.com / teacher2@example.com"
            onChange={(event) => {
              setText(event.target.value);
              setNotice(null);
            }}
          />
        )}
      </FormField>

      <fieldset className="teacher-roles">
        <legend className="form-field__label">역할</legend>
        <div className="segmented" role="radiogroup" aria-label="역할">
          {ROLES.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              className="segmented__button"
              aria-checked={role === value}
              aria-pressed={role === value}
              onClick={() => setRole(value)}
            >
              {TEACHER_ROLE_LABELS[value]}
            </button>
          ))}
        </div>
        <p className="muted">{ROLE_HINTS[role]}</p>
      </fieldset>

      {already.length > 0 ? (
        <InlineAlert tone="info">
          이미 교사로 등록된 계정은 빼고 등록해요: {already.join(', ')}
        </InlineAlert>
      ) : null}
      {notice ? <InlineAlert tone="success">{notice}</InlineAlert> : null}
      {save.status === 'error' ? (
        <InlineAlert tone="danger">{toUserMessage(save.error)}</InlineAlert>
      ) : null}
      {change.status === 'error' ? (
        <InlineAlert tone="danger">{toUserMessage(change.error)}</InlineAlert>
      ) : null}

      <div className="teacher-actions">
        <Button size="lg" icon="add" disabled={!canSave} onClick={() => setConfirmOpen(true)}>
          {emails.length > 0 ? `${emails.length}개 계정 등록` : '계정 등록'}
        </Button>
      </div>

      <h3 className="section-title">
        <Icon name="fact_check" /> 등록 현황
        {registry ? (
          <StatusBadge tone="info" icon="groups">
            {rows.length}개
          </StatusBadge>
        ) : null}
      </h3>
      {registryData.status === 'loading' ? (
        <LoadingView label="등록 현황을 불러오고 있어요" />
      ) : null}
      {registryData.status === 'error' && latest === null ? (
        <InlineAlert
          tone="danger"
          action={
            <Button variant="secondary" icon="refresh" onClick={registryData.reload}>
              다시 시도
            </Button>
          }
        >
          {toUserMessage(registryData.error)}
        </InlineAlert>
      ) : null}
      {registry && rows.length === 0 ? <p className="muted">아직 등록한 계정이 없어요.</p> : null}
      {registry && rows.length > 0 ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Google 계정</th>
                <th scope="col">역할</th>
                <th scope="col">상태</th>
                <th scope="col">관리</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <th scope="row">
                    {row.email || '(이메일 없음)'}
                    {row.displayName ? <div className="muted">{row.displayName}</div> : null}
                  </th>
                  <td>{TEACHER_ROLE_LABELS[row.role]}</td>
                  <td>
                    {row.status === 'waiting' ? (
                      <StatusBadge tone="warning" icon="hourglass_top">
                        로그인 전
                      </StatusBadge>
                    ) : row.status === 'active' ? (
                      <StatusBadge tone="success" icon="check_circle">
                        사용 중
                      </StatusBadge>
                    ) : (
                      <StatusBadge tone="neutral" icon="do_not_disturb_on">
                        사용 중지
                      </StatusBadge>
                    )}
                  </td>
                  <td>
                    {row.status === 'waiting' ? (
                      <Button
                        variant="secondary"
                        icon="delete"
                        aria-label={`${row.email} 등록 취소`}
                        onClick={() => setPending({ type: 'cancel', row })}
                      >
                        등록 취소
                      </Button>
                    ) : row.uid === currentUid ? (
                      <span className="muted">내 계정</span>
                    ) : row.status === 'active' ? (
                      <Button
                        variant="secondary"
                        icon="do_not_disturb_on"
                        aria-label={`${row.email} 사용 중지`}
                        onClick={() => setPending({ type: 'stop', row })}
                      >
                        사용 중지
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        icon="restart_alt"
                        aria-label={`${row.email} 다시 사용`}
                        onClick={() => setPending({ type: 'resume', row })}
                      >
                        다시 사용
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        title={`${emails.length}개 계정을 ${TEACHER_ROLE_LABELS[role]}로 등록할까요?`}
        confirmLabel="등록"
        confirmIcon="add"
        tone={role === 'admin' ? 'danger' : 'primary'}
        loading={save.isPending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void handleSave()}
      >
        <p>{ROLE_HINTS[role]}</p>
        <p>이메일 주소가 맞는지 한 번 더 확인해 주세요.</p>
        <ul className="confirm-list">
          {emails.map((email) => (
            <li key={email} className="confirm-list__item">
              {email}
            </li>
          ))}
        </ul>
      </ConfirmDialog>

      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.type === 'cancel'
            ? '등록을 취소할까요?'
            : pending?.type === 'stop'
              ? '이 계정을 사용 중지할까요?'
              : '이 계정을 다시 쓰게 할까요?'
        }
        confirmLabel={
          pending?.type === 'cancel'
            ? '등록 취소'
            : pending?.type === 'stop'
              ? '사용 중지'
              : '다시 사용'
        }
        confirmIcon={pending?.type === 'resume' ? 'restart_alt' : 'do_not_disturb_on'}
        cancelLabel="닫기"
        tone={pending?.type === 'resume' ? 'primary' : 'danger'}
        loading={change.isPending}
        onCancel={() => setPending(null)}
        onConfirm={() => void handleChange()}
      >
        <p>
          <strong>{pending?.row.email}</strong>
        </p>
        <p className="muted">
          {pending?.type === 'cancel'
            ? '이 계정은 로그인해도 교사 화면에 들어올 수 없어요.'
            : pending?.type === 'stop'
              ? '이 계정은 교사 화면을 쓸 수 없게 돼요. 이미 열어 둔 화면에서도 저장과 채점이 막혀요.'
              : '이 계정이 다시 교사 화면을 쓸 수 있어요.'}
        </p>
      </ConfirmDialog>
    </section>
  );
}
