import { useCallback, useId, useState } from 'react';
import { Button } from '../../../components/Button';
import { FormField } from '../../../components/FormField';
import { Icon } from '../../../components/Icon';
import { InlineAlert } from '../../../components/StateViews';
import { StatusBadge } from '../../../components/StatusBadge';
import { toUserMessage } from '../../../data/errors';
import { useRepository } from '../../../data/RepositoryContext';
import {
  emptyLibraryCheckAnswerKey,
  getLibraryCheckConfigError,
  hasLibraryCheckAnswerKey,
  LIBRARY_CHECK_ITEM_LABELS,
  LIBRARY_CHECK_MAX_SCORE,
  LIBRARY_CHECK_POINTS,
  normalizeLibraryCheckConfig,
  splitKeywords,
} from '../../../domain/libraryCheck';
import type { LibraryCheckConfig, Mission } from '../../../domain/types';
import { useAction } from '../../../hooks/useAction';

interface LibraryCheckEditorProps {
  eventId: string;
  mission: Mission;
  config: LibraryCheckConfig;
  onSaved: () => void;
}

interface Draft {
  passageTitle: string;
  passage: string;
  wrongPart: string;
  correction: string;
  bookTitles: string;
  pageFrom: string;
  pageTo: string;
}

function toDraft(config: LibraryCheckConfig): Draft {
  const key = config.answerKey ?? emptyLibraryCheckAnswerKey();
  return {
    passageTitle: config.passageTitle,
    passage: config.passage,
    wrongPart: key.wrongPartKeywords.join(', '),
    correction: key.correctionKeywords.join(', '),
    bookTitles: key.bookTitles.join(', '),
    pageFrom: key.pageFrom === null ? '' : String(key.pageFrom),
    pageTo: key.pageTo === null ? '' : String(key.pageTo),
  };
}

function toNumberOrNull(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : Number.NaN;
}

function toConfig(draft: Draft): LibraryCheckConfig {
  const answerKey = {
    wrongPartKeywords: splitKeywords(draft.wrongPart),
    correctionKeywords: splitKeywords(draft.correction),
    bookTitles: splitKeywords(draft.bookTitles),
    pageFrom: toNumberOrNull(draft.pageFrom),
    pageTo: toNumberOrNull(draft.pageTo),
  };
  return normalizeLibraryCheckConfig({
    type: 'library_check',
    passageTitle: draft.passageTitle,
    passage: draft.passage,
    answerKey,
  });
}

/**
 * 도서관 오류찾기의 글과 정답 등록. 정답을 등록하면 학생이 제출하는 순간 자동으로 채점된다.
 * 인정하는 말은 쉼표로 나눠 여러 개 적을 수 있고, 학생 답에 그 말이 들어 있으면 맞은 것으로 본다.
 */
export function LibraryCheckEditor({ eventId, mission, config, onSaved }: LibraryCheckEditorProps) {
  const repository = useRepository();
  const ids = useId();
  const [draft, setDraft] = useState(() => toDraft(config));
  const [dirty, setDirty] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = useAction(
    useCallback(
      (next: LibraryCheckConfig) => repository.updateMissionConfig(eventId, mission.id, next),
      [repository, eventId, mission.id],
    ),
  );

  const update = (patch: Partial<Draft>) => {
    setDraft((previous) => ({ ...previous, ...patch }));
    setDirty(true);
    setSaved(false);
  };

  const next = toConfig(draft);
  const error = getLibraryCheckConfigError(next);
  const autoScored = hasLibraryCheckAnswerKey(next);

  const handleSave = async () => {
    setShowErrors(true);
    if (error) return;
    const result = await save.run(next);
    if (result?.ok) {
      setDraft(toDraft(next));
      setDirty(false);
      setShowErrors(false);
      setSaved(true);
      onSaved();
    }
  };

  const field = (key: keyof Draft) => `${ids}-${key}`;

  return (
    <section className="stack" aria-labelledby="library-editor-title">
      <div className="teacher-title">
        <h2 id="library-editor-title" className="section-title">
          <Icon name="menu_book" /> 글과 정답 등록
          {autoScored ? (
            <StatusBadge tone="success" icon="bolt">
              자동 채점
            </StatusBadge>
          ) : (
            <StatusBadge tone="warning" icon="school">
              선생님 판정
            </StatusBadge>
          )}
          {dirty ? (
            <StatusBadge tone="warning" icon="edit">
              저장 안 됨
            </StatusBadge>
          ) : null}
        </h2>
      </div>

      <InlineAlert tone="info">
        정답을 등록하면 학생이 제출하는 순간 네 항목을 따로 채점해요(틀린 부분{' '}
        {LIBRARY_CHECK_POINTS.wrongPart}점 · 올바른 내용 {LIBRARY_CHECK_POINTS.correction}점 · 책
        제목 {LIBRARY_CHECK_POINTS.bookTitle}점 · 쪽수 {LIBRARY_CHECK_POINTS.page}점, 모두{' '}
        {LIBRARY_CHECK_MAX_SCORE}점). 학생 답에 인정하는 말이 하나라도 들어 있으면 그 항목은 맞은
        것으로 봐요. 자동 점수는 순위표에서 언제든 고칠 수 있어요.
      </InlineAlert>

      <div className="panel stack">
        <FormField
          id={field('passageTitle')}
          label="글 제목"
          error={showErrors && !draft.passageTitle.trim() ? '글 제목을 적어 주세요.' : undefined}
        >
          {(control) => (
            <input
              {...control}
              className="text-input"
              value={draft.passageTitle}
              onChange={(change) => update({ passageTitle: change.target.value })}
            />
          )}
        </FormField>
        <FormField
          id={field('passage')}
          label="AI가 쓴 글(일부러 틀린 내용을 넣은 글)"
          error={showErrors && !draft.passage.trim() ? '글 본문을 적어 주세요.' : undefined}
        >
          {(control) => (
            <textarea
              {...control}
              className="text-input"
              rows={5}
              value={draft.passage}
              onChange={(change) => update({ passage: change.target.value })}
            />
          )}
        </FormField>
      </div>

      <div className="panel stack">
        <h3 className="section-title">
          <Icon name="fact_check" /> 정답(자동 채점 기준)
        </h3>
        <p className="muted">
          인정하는 말이 여러 개면 쉼표로 나눠 적어요. 띄어쓰기, 대소문자, 문장 부호는 달라도 맞은
          것으로 봐요. 모두 비워 두면 선생님이 직접 채점해요.
        </p>
        <FormField
          id={field('wrongPart')}
          label={`1. ${LIBRARY_CHECK_ITEM_LABELS.wrongPart}으로 인정하는 말 (${LIBRARY_CHECK_POINTS.wrongPart}점)`}
          hint="예: 다리가 8개, 8개"
        >
          {(control) => (
            <input
              {...control}
              className="text-input"
              value={draft.wrongPart}
              onChange={(change) => update({ wrongPart: change.target.value })}
            />
          )}
        </FormField>
        <FormField
          id={field('correction')}
          label={`2. ${LIBRARY_CHECK_ITEM_LABELS.correction}으로 인정하는 말 (${LIBRARY_CHECK_POINTS.correction}점)`}
          hint="예: 6개, 여섯 개"
        >
          {(control) => (
            <input
              {...control}
              className="text-input"
              value={draft.correction}
              onChange={(change) => update({ correction: change.target.value })}
            />
          )}
        </FormField>
        <FormField
          id={field('bookTitles')}
          label={`3. 확인할 수 있는 ${LIBRARY_CHECK_ITEM_LABELS.bookTitle} (${LIBRARY_CHECK_POINTS.bookTitle}점)`}
          hint="여러 책이면 쉼표로 나눠요. 부제가 붙어도 인정해요."
        >
          {(control) => (
            <input
              {...control}
              className="text-input"
              value={draft.bookTitles}
              onChange={(change) => update({ bookTitles: change.target.value })}
            />
          )}
        </FormField>
        <div className="library-editor__pages">
          <FormField
            id={field('pageFrom')}
            label={`4. ${LIBRARY_CHECK_ITEM_LABELS.page} (${LIBRARY_CHECK_POINTS.page}점) · 첫 쪽`}
          >
            {(control) => (
              <input
                {...control}
                className="text-input number"
                inputMode="numeric"
                value={draft.pageFrom}
                onChange={(change) => update({ pageFrom: change.target.value })}
              />
            )}
          </FormField>
          <FormField id={field('pageTo')} label="마지막 쪽(비우면 한 쪽만 인정)">
            {(control) => (
              <input
                {...control}
                className="text-input number"
                inputMode="numeric"
                value={draft.pageTo}
                onChange={(change) => update({ pageTo: change.target.value })}
              />
            )}
          </FormField>
        </div>
      </div>

      {showErrors && error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      {save.status === 'error' ? (
        <InlineAlert tone="danger">{toUserMessage(save.error)}</InlineAlert>
      ) : null}
      {saved ? (
        <InlineAlert tone="success">
          저장했어요. {autoScored ? '이제 제출 즉시 자동으로 채점돼요.' : '선생님이 직접 채점해요.'}
        </InlineAlert>
      ) : null}

      <div className="teacher-actions">
        <Button
          variant="ghost"
          size="lg"
          icon="undo"
          disabled={!dirty}
          onClick={() => {
            setDraft(toDraft(config));
            setDirty(false);
            setShowErrors(false);
            save.reset();
          }}
        >
          변경 취소
        </Button>
        <Button
          size="lg"
          icon="save"
          disabled={!dirty}
          loading={save.isPending}
          onClick={() => void handleSave()}
        >
          저장
        </Button>
      </div>
    </section>
  );
}
