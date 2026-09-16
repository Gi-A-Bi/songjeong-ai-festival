import { useId, useState, type ChangeEvent, type FormEvent } from 'react';
import { Button } from '../../../components/Button';
import { FormField } from '../../../components/FormField';
import { Icon } from '../../../components/Icon';
import { MissionShell } from '../../../components/MissionShell';
import { StatusBadge } from '../../../components/StatusBadge';
import { canSubmitInPhase } from '../../../domain/missionPhase';
import type { LibraryCheckConfig } from '../../../domain/types';
import { MissionNotice } from '../MissionNotice';
import type { MissionScreenProps } from '../missionTypes';
import { useMissionSubmit } from '../useMissionSubmit';
import '../Missions.css';

interface LibraryCheckMissionProps extends MissionScreenProps {
  config: LibraryCheckConfig;
}

interface FormState {
  wrongPart: string;
  correction: string;
  bookTitle: string;
  page: string;
}

type FieldKey = keyof FormState;
type FieldErrors = Partial<Record<FieldKey, string>>;

const FIELD_ORDER: FieldKey[] = ['wrongPart', 'correction', 'bookTitle', 'page'];

function validate(form: FormState): FieldErrors {
  const errors: FieldErrors = {};
  if (!form.wrongPart.trim()) errors.wrongPart = 'AI 글에서 틀린 부분을 적어 주세요.';
  if (!form.correction.trim()) errors.correction = '책에서 찾은 올바른 내용을 적어 주세요.';
  if (!form.bookTitle.trim()) errors.bookTitle = '확인한 책 제목을 적어 주세요.';
  const page = form.page.trim();
  if (!/^\d+$/.test(page) || Number(page) < 1) errors.page = '쪽수는 1 이상의 숫자로 적어 주세요.';
  return errors;
}

export function LibraryCheckMission({
  eventId,
  view,
  event,
  phase,
  onSubmitted,
  config,
}: LibraryCheckMissionProps) {
  const { team, mission, submission, roundNo } = view;
  const previous = submission?.answer.type === 'library_check' ? submission.answer : null;
  const saved = submission && submission.status !== 'draft' ? previous : null;
  // 재제출 허용이면 지난번 입력을 채워 두고 고칠 수 있게 한다.
  const [form, setForm] = useState<FormState>(() =>
    previous
      ? {
          wrongPart: previous.wrongPart,
          correction: previous.correction,
          bookTitle: previous.bookTitle,
          page: String(previous.page),
        }
      : { wrongPart: '', correction: '', bookTitle: '', page: '' },
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const formId = useId();
  const { submit, isPending, error } = useMissionSubmit(eventId, team.id, mission.id, onSubmitted);

  const editable = canSubmitInPhase(phase) && saved === null;
  const fieldId = (key: FieldKey) => `${formId}-${key}`;

  const update =
    (key: FieldKey) => (change: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = change.target.value;
      setForm((previous) => ({ ...previous, [key]: value }));
    };

  const handleSubmit = (submitEvent: FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    if (!editable || isPending) return;
    const nextErrors = validate(form);
    setErrors(nextErrors);
    const firstInvalid = FIELD_ORDER.find((key) => nextErrors[key]);
    if (firstInvalid) {
      document.getElementById(fieldId(firstInvalid))?.focus();
      return;
    }
    void submit({
      type: 'library_check',
      wrongPart: form.wrongPart.trim(),
      correction: form.correction.trim(),
      bookTitle: form.bookTitle.trim(),
      page: Number(form.page.trim()),
    });
  };

  return (
    <MissionShell
      mission={mission}
      team={team}
      roundNo={roundNo}
      event={event}
      phase={phase}
      notice={<MissionNotice phase={phase} event={event} view={view} error={error} />}
      actions={
        saved ? (
          <StatusBadge tone="info" icon="lock" size="lg">
            제출 완료 · 선생님이 확인해요
          </StatusBadge>
        ) : (
          <Button
            type="submit"
            form={formId}
            size="xl"
            icon="send"
            disabled={!editable}
            loading={isPending}
            loadingLabel="제출하는 중"
          >
            확인 내용 제출
          </Button>
        )
      }
    >
      <div className="library">
        <section className="library__passage" aria-labelledby="library-passage-title">
          <p className="library__label">
            <Icon name="smart_toy" />
            AI가 찾은 정보
          </p>
          <h2 id="library-passage-title" className="library__title">
            {config.passageTitle}
          </h2>
          <p className="library__text">{config.passage}</p>
          <p className="library__tip">
            <Icon name="menu_book" />
            인터넷 말고 도서관 책에서 사실을 확인해요.
          </p>
        </section>

        <form id={formId} className="panel library__form" onSubmit={handleSubmit} noValidate>
          <FormField id={fieldId('wrongPart')} label="1. 잘못된 부분" error={errors.wrongPart}>
            {(control) => (
              <textarea
                {...control}
                className="text-input"
                rows={2}
                value={form.wrongPart}
                onChange={update('wrongPart')}
                readOnly={!editable}
              />
            )}
          </FormField>
          <FormField
            id={fieldId('correction')}
            label="2. 책에서 찾은 올바른 내용"
            error={errors.correction}
          >
            {(control) => (
              <textarea
                {...control}
                className="text-input"
                rows={2}
                value={form.correction}
                onChange={update('correction')}
                readOnly={!editable}
              />
            )}
          </FormField>
          <div className="library__row">
            <FormField id={fieldId('bookTitle')} label="3. 책 제목" error={errors.bookTitle}>
              {(control) => (
                <input
                  {...control}
                  className="text-input"
                  value={form.bookTitle}
                  onChange={update('bookTitle')}
                  readOnly={!editable}
                />
              )}
            </FormField>
            <FormField id={fieldId('page')} label="4. 쪽수" error={errors.page}>
              {(control) => (
                <input
                  {...control}
                  className="text-input library__page"
                  inputMode="numeric"
                  value={form.page}
                  onChange={update('page')}
                  readOnly={!editable}
                />
              )}
            </FormField>
          </div>
        </form>
      </div>
    </MissionShell>
  );
}
