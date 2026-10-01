import { useId, useState, type ChangeEvent, type FormEvent } from 'react';
import { AssetImage } from '../../../components/AssetImage';
import { Button } from '../../../components/Button';
import { FormField } from '../../../components/FormField';
import { Icon } from '../../../components/Icon';
import { MissionShell } from '../../../components/MissionShell';
import { StatusBadge } from '../../../components/StatusBadge';
import {
  hasLibraryCheckAnswerKey,
  LIBRARY_CHECK_ITEM_LABELS,
  LIBRARY_CHECK_ITEMS,
  LIBRARY_CHECK_MAX_SCORE,
  LIBRARY_CHECK_POINTS,
  scoreLibraryCheck,
} from '../../../domain/libraryCheck';
import { canSubmitInPhase } from '../../../domain/missionPhase';
import type { LibraryCheckConfig } from '../../../domain/types';
import { getMissionLock } from '../missionLock';
import { MissionLockedPanel } from '../MissionLockedPanel';
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

/**
 * AI가 쓴 글의 틀린 곳을 찾아 책으로 확인해 적어 낸다.
 * 선생님이 정답을 등록해 두었으면 제출 즉시 자동으로 채점된다. 게임 시작 전에는 글을 가린다.
 */
export function LibraryCheckMission({
  eventId,
  view,
  event,
  phase,
  gate,
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

  const lock = getMissionLock(view, event, phase);
  const editable = canSubmitInPhase(phase) && saved === null && lock === null;
  const autoScored = hasLibraryCheckAnswerKey(config);
  const result = saved ? scoreLibraryCheck(config, saved) : null;
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
      gate={gate}
      actions={
        saved ? (
          result ? (
            <StatusBadge tone="success" icon="task_alt" size="lg">
              제출 완료 · 자동 채점 {result.total}점 / {LIBRARY_CHECK_MAX_SCORE}점
            </StatusBadge>
          ) : (
            <StatusBadge tone="info" icon="lock" size="lg">
              제출 완료 · 선생님이 확인해요
            </StatusBadge>
          )
        ) : lock !== null ? (
          <>
            <p className="mission-actions__hint">
              <Icon name="info" />
              {lock === 'not-entered'
                ? '인증코드를 넣고 입장하면 글을 읽을 수 있어요'
                : '게임이 시작되면 글을 읽고 확인할 수 있어요'}
            </p>
            <Button size="xl" icon="send" disabled>
              확인 내용 제출
            </Button>
          </>
        ) : (
          <>
            {autoScored ? (
              <p className="mission-actions__hint">
                <Icon name="bolt" />
                제출하면 바로 채점돼요 · 한 번만 낼 수 있어요
              </p>
            ) : null}
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
          </>
        )
      }
    >
      {lock !== null ? (
        // 글 본문은 화면에 올리지 않는다. 무엇을 적어 내는지만 알려 준다.
        <MissionLockedPanel mission={mission} reason={lock} subject="AI가 찾은 정보가">
          <p>AI가 쓴 글에서 틀린 곳을 찾고, 도서관 책에서 바른 내용을 확인해요.</p>
          <p>적어 낼 것: 틀린 부분 · 올바른 내용 · 책 제목 · 쪽수</p>
        </MissionLockedPanel>
      ) : (
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

          <div className="stack">
            {result ? (
              <section className="library-result" aria-labelledby="library-result-title">
                <AssetImage
                  asset={result.total === LIBRARY_CHECK_MAX_SCORE ? 'mascotCorrect' : 'mascotHint'}
                  decorative
                  className="library-result__mascot"
                />
                <div className="library-result__body">
                  <h2 id="library-result-title" className="library-result__title">
                    자동 채점 결과{' '}
                    <strong className="number">
                      {result.total} / {LIBRARY_CHECK_MAX_SCORE}점
                    </strong>
                  </h2>
                  <ul className="library-result__items">
                    {LIBRARY_CHECK_ITEMS.map((item) => (
                      <li
                        key={item}
                        className={`library-result__item${
                          result.items[item] ? ' library-result__item--ok' : ''
                        }`}
                      >
                        <Icon name={result.items[item] ? 'check_circle' : 'close'} />
                        {LIBRARY_CHECK_ITEM_LABELS[item]}{' '}
                        <span className="number">
                          {result.items[item] ? LIBRARY_CHECK_POINTS[item] : 0}점
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="library-result__note">
                    점수는 선생님이 확인한 뒤 고칠 수 있어요. 3위 안에 들면 카드 조각을 받아요.
                  </p>
                </div>
              </section>
            ) : null}

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
        </div>
      )}
    </MissionShell>
  );
}
