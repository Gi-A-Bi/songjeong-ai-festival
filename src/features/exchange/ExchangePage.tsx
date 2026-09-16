import { useCallback, useState } from 'react';
import { cardImageKeys } from '../../assets/manifest';
import { AssetImage } from '../../components/AssetImage';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/Dialog';
import { FormField } from '../../components/FormField';
import { Icon } from '../../components/Icon';
import { StatusBadge } from '../../components/StatusBadge';
import { ErrorView, InlineAlert, LoadingView } from '../../components/StateViews';
import type { ClassCardRow } from '../../data/EventRepository';
import { toUserMessage } from '../../data/errors';
import { useRepository } from '../../data/RepositoryContext';
import { CARD_TYPES, emptyCardCounts, isCollectionComplete, totalCards } from '../../domain/cards';
import { CARD_INFO } from '../../domain/catalog';
import { EXCHANGE_ERROR_MESSAGES, previewExchange, validateExchange } from '../../domain/exchange';
import type { CardType, Exchange, Grade } from '../../domain/types';
import { useAction } from '../../hooks/useAction';
import { useAsyncData } from '../../hooks/useAsyncData';
import { createRequestId } from '../../lib/random';
import { formatTimeOfDay } from '../../lib/time';
import { useTeacherContext } from '../teacher/teacherContext';
import '../teacher/Teacher.css';

const GRADES: Grade[] = [3, 4, 5, 6];

export function ExchangePage() {
  const { eventId, event } = useTeacherContext();
  const repository = useRepository();
  const [grade, setGrade] = useState<Grade>(event.activeGrade ?? 4);

  const load = useCallback(async () => {
    const [rows, exchanges] = await Promise.all([
      repository.listClassCardRows(eventId, grade),
      repository.listExchanges(eventId, grade),
    ]);
    return { rows, exchanges };
  }, [repository, eventId, grade]);
  const data = useAsyncData(load);

  return (
    <>
      <div className="teacher-title">
        <h1 className="page__title">학급 카드와 교환</h1>
        <div className="round-picker" role="group" aria-label="학년 선택">
          {GRADES.map((value) => (
            <button
              key={value}
              type="button"
              className="round-picker__button"
              aria-pressed={grade === value}
              onClick={() => setGrade(value)}
            >
              {value}학년
            </button>
          ))}
        </div>
      </div>

      {data.status === 'loading' ? <LoadingView label="학급 카드를 불러오고 있어요" /> : null}
      {data.status === 'error' ? <ErrorView error={data.error} onRetry={data.reload} /> : null}
      {data.status === 'success' ? (
        <div className="exchange-layout">
          <div className="stack">
            <ClassCardTable grade={grade} rows={data.data.rows} />
            <ExchangeLog rows={data.data.rows} exchanges={data.data.exchanges} />
          </div>
          <ExchangeForm
            key={grade}
            eventId={eventId}
            rows={data.data.rows}
            onExchanged={data.reload}
          />
        </div>
      ) : null}
    </>
  );
}

function ClassCardTable({ grade, rows }: { grade: Grade; rows: ClassCardRow[] }) {
  const empty = rows.every((row) => totalCards(row.counts) === 0);
  return (
    <section className="stack" aria-labelledby="class-card-table-title">
      <h2 id="class-card-table-title" className="section-title">
        <Icon name="style" /> {grade}학년 학급별 카드
      </h2>
      {empty ? (
        <InlineAlert tone="info">
          이 학년은 아직 카드가 없어요. 미션 순위가 확정되고 카드를 뽑으면 여기에 쌓여요.
        </InlineAlert>
      ) : null}
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">학급</th>
              {CARD_TYPES.map((cardType) => (
                <th key={cardType} scope="col" className="data-table__num">
                  {CARD_INFO[cardType].name.replace(' 카드', '')}
                </th>
              ))}
              <th scope="col" className="data-table__num">
                합계
              </th>
              <th scope="col">완성</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.classInfo.id}>
                <th scope="row">{row.classInfo.displayName}</th>
                {CARD_TYPES.map((cardType) => (
                  <td key={cardType} className="data-table__num">
                    <span
                      className={`card-cell${row.counts[cardType] === 0 ? ' card-cell--zero' : ''}`}
                    >
                      <AssetImage
                        asset={cardImageKeys[cardType]}
                        decorative
                        className="card-cell__thumb"
                      />
                      <span className="number">{row.counts[cardType]}</span>
                    </span>
                  </td>
                ))}
                <td className="data-table__num number">{totalCards(row.counts)}</td>
                <td>
                  {isCollectionComplete(row.counts) ? (
                    <StatusBadge tone="success" icon="trophy">
                      완성
                    </StatusBadge>
                  ) : (
                    <StatusBadge tone="neutral" icon="lock">
                      미완성
                    </StatusBadge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ExchangeLog({ rows, exchanges }: { rows: ClassCardRow[]; exchanges: Exchange[] }) {
  const nameOf = (classId: string) =>
    rows.find((row) => row.classInfo.id === classId)?.classInfo.displayName ?? classId;
  return (
    <section className="panel stack" aria-labelledby="exchange-log-title">
      <h2 id="exchange-log-title" className="section-title">
        <Icon name="format_list_numbered" /> 교환 기록
      </h2>
      {exchanges.length === 0 ? (
        <p className="muted">아직 교환 기록이 없어요.</p>
      ) : (
        <ul className="exchange-log">
          {exchanges.map((exchange) => (
            <li key={exchange.id} className="exchange-log__item">
              <strong>{nameOf(exchange.fromClassId)}</strong>
              <Icon name="arrow_forward" size="sm" />
              <strong>{nameOf(exchange.toClassId)}</strong>
              <span>
                {CARD_INFO[exchange.cardType].name} {exchange.quantity}장
              </span>
              <span className="muted number">{formatTimeOfDay(exchange.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface ExchangeFormProps {
  eventId: string;
  rows: ClassCardRow[];
  onExchanged: () => void;
}

function ExchangeForm({ eventId, rows, onExchanged }: ExchangeFormProps) {
  const repository = useRepository();
  const [fromClassId, setFromClassId] = useState(rows[0]?.classInfo.id ?? '');
  const [toClassId, setToClassId] = useState(rows[1]?.classInfo.id ?? '');
  const [cardType, setCardType] = useState<CardType>('thinking');
  const [quantityText, setQuantityText] = useState('1');
  const [requestId, setRequestId] = useState(createRequestId);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const quantity = /^\d+$/.test(quantityText.trim()) ? Number(quantityText.trim()) : Number.NaN;
  const draft = { fromClassId, toClassId, cardType, quantity };
  const fromRow = rows.find((row) => row.classInfo.id === fromClassId);
  const toRow = rows.find((row) => row.classInfo.id === toClassId);
  const fromCounts = fromRow?.counts ?? emptyCardCounts();
  const toCounts = toRow?.counts ?? emptyCardCounts();
  const validationError = validateExchange(draft, fromCounts);
  const preview = previewExchange(draft, fromCounts, toCounts);

  const exchange = useAction(
    useCallback(
      () =>
        repository.createExchange({
          eventId,
          requestId,
          fromClassId,
          toClassId,
          cardType,
          quantity,
        }),
      [repository, eventId, requestId, fromClassId, toClassId, cardType, quantity],
    ),
  );

  if (rows.length < 2) {
    return (
      <InlineAlert tone="info">교환하려면 같은 학년에 학급이 두 개 이상 있어야 해요.</InlineAlert>
    );
  }

  const confirm = async () => {
    const result = await exchange.run();
    setConfirmOpen(false);
    if (result?.ok) {
      setDone(
        `${fromRow?.classInfo.displayName} → ${toRow?.classInfo.displayName} ${CARD_INFO[cardType].name} ${quantity}장 교환을 기록했어요.`,
      );
      setRequestId(createRequestId());
      setQuantityText('1');
      onExchanged();
    }
  };

  return (
    <section className="panel exchange-form" aria-labelledby="exchange-form-title">
      <AssetImage asset="sceneCardExchange" decorative className="teacher-shortcuts__image" />
      <h2 id="exchange-form-title" className="section-title">
        <Icon name="swap_horiz" /> 카드 보내기
      </h2>
      <div className="exchange-form__row">
        <FormField id="exchange-from" label="보내는 학급">
          {(control) => (
            <select
              {...control}
              className="text-input"
              value={fromClassId}
              onChange={(change) => {
                setFromClassId(change.target.value);
                setDone(null);
              }}
            >
              {rows.map((row) => (
                <option key={row.classInfo.id} value={row.classInfo.id}>
                  {row.classInfo.displayName}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FormField id="exchange-to" label="받는 학급">
          {(control) => (
            <select
              {...control}
              className="text-input"
              value={toClassId}
              onChange={(change) => {
                setToClassId(change.target.value);
                setDone(null);
              }}
            >
              {rows.map((row) => (
                <option key={row.classInfo.id} value={row.classInfo.id}>
                  {row.classInfo.displayName}
                </option>
              ))}
            </select>
          )}
        </FormField>
      </div>
      <div className="exchange-form__row">
        <FormField id="exchange-card" label="카드">
          {(control) => (
            <select
              {...control}
              className="text-input"
              value={cardType}
              onChange={(change) => {
                setCardType(change.target.value as CardType);
                setDone(null);
              }}
            >
              {CARD_TYPES.map((value) => (
                <option key={value} value={value}>
                  {CARD_INFO[value].name} (보유 {fromCounts[value]}장)
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FormField
          id="exchange-quantity"
          label="수량"
          error={
            validationError === 'invalid-quantity'
              ? EXCHANGE_ERROR_MESSAGES['invalid-quantity']
              : undefined
          }
        >
          {(control) => (
            <input
              {...control}
              className="text-input number"
              inputMode="numeric"
              value={quantityText}
              onChange={(change) => {
                setQuantityText(change.target.value);
                setDone(null);
              }}
            />
          )}
        </FormField>
      </div>

      <div className="exchange-preview" aria-live="polite">
        <div className="exchange-preview__side">
          <p className="muted">{fromRow?.classInfo.displayName ?? '보내는 학급'}</p>
          <p
            className={`exchange-preview__value number${preview.from.after < 0 ? ' exchange-preview__value--negative' : ''}`}
          >
            {preview.from.before} <Icon name="arrow_forward" size="sm" /> {preview.from.after}
          </p>
        </div>
        <div className="exchange-preview__side">
          <p className="muted">{toRow?.classInfo.displayName ?? '받는 학급'}</p>
          <p className="exchange-preview__value number">
            {preview.to.before} <Icon name="arrow_forward" size="sm" /> {preview.to.after}
          </p>
        </div>
      </div>

      {validationError && validationError !== 'invalid-quantity' ? (
        <InlineAlert tone="danger">{EXCHANGE_ERROR_MESSAGES[validationError]}</InlineAlert>
      ) : null}
      {exchange.status === 'error' ? (
        <InlineAlert tone="danger">{toUserMessage(exchange.error)}</InlineAlert>
      ) : null}
      {done ? <InlineAlert tone="success">{done}</InlineAlert> : null}

      <Button
        size="lg"
        icon="swap_horiz"
        fullWidth
        disabled={validationError !== null}
        onClick={() => setConfirmOpen(true)}
      >
        교환 확정
      </Button>

      <ConfirmDialog
        open={confirmOpen}
        title="이 교환을 확정할까요?"
        confirmLabel="교환 확정"
        confirmIcon="swap_horiz"
        loading={exchange.isPending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void confirm()}
      >
        <p>
          <strong>{fromRow?.classInfo.displayName}</strong>이(가){' '}
          <strong>{toRow?.classInfo.displayName}</strong>에{' '}
          <strong>
            {CARD_INFO[cardType].name} {quantity}장
          </strong>
          을 보내요.
        </p>
        <p className="muted">잘못 기록하면 삭제하지 않고 반대 방향 교환으로 바로잡아요.</p>
      </ConfirmDialog>
    </section>
  );
}
