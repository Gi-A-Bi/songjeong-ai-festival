import { useCallback, useState } from 'react';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { InlineAlert } from '../../components/StateViews';
import { StatusBadge } from '../../components/StatusBadge';
import { toUserMessage } from '../../data/errors';
import { useRepository } from '../../data/RepositoryContext';
import {
  formatMissionRoom,
  getMissionInfoError,
  GRADE_PLACEHOLDER,
  normalizeMissionInfo,
  type MissionInfoInput,
} from '../../domain/missionRoom';
import type { FestivalEvent, Mission } from '../../domain/types';
import { useAction } from '../../hooks/useAction';
import { useAsyncData } from '../../hooks/useAsyncData';

interface MissionInfoPanelProps {
  eventId: string;
  event: FestivalEvent;
}

type Drafts = Record<string, MissionInfoInput>;

function toDrafts(missions: readonly Mission[]): Drafts {
  return Object.fromEntries(
    missions.map((mission) => [
      mission.id,
      { title: mission.title, room: mission.room, summary: mission.summary },
    ]),
  );
}

function isSame(a: MissionInfoInput, b: MissionInfoInput): boolean {
  const left = normalizeMissionInfo(a);
  const right = normalizeMissionInfo(b);
  return left.title === right.title && left.room === right.room && left.summary === right.summary;
}

/**
 * 행사 설정의 "미션 이름과 교실". 학생 화면, 부스 화면, 인쇄물에 그대로 나온다.
 * 교실 이름에 {학년}을 적으면 학년에 맞춰 "4학년 1반 교실"처럼 보인다.
 */
export function MissionInfoPanel({ eventId, event }: MissionInfoPanelProps) {
  const repository = useRepository();
  const load = useCallback(() => repository.listMissions(eventId), [repository, eventId]);
  const missions = useAsyncData(load);
  const [drafts, setDrafts] = useState<Drafts | null>(null);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const previewGrade = event.activeGrade ?? 3;

  const save = useAction(
    useCallback(
      async (changes: { missionId: string; info: MissionInfoInput }[]) => {
        for (const change of changes) {
          await repository.updateMissionInfo(eventId, change.missionId, change.info);
        }
        return changes.length;
      },
      [repository, eventId],
    ),
  );

  if (missions.status !== 'success') {
    return (
      <section className="panel stack" aria-labelledby="admin-missions-title">
        <h2 id="admin-missions-title" className="section-title">
          <Icon name="meeting_room" /> 미션 이름과 교실
        </h2>
        {missions.status === 'loading' ? (
          <p className="muted">불러오는 중이에요.</p>
        ) : (
          <InlineAlert tone="danger">{toUserMessage(missions.error)}</InlineAlert>
        )}
      </section>
    );
  }

  const stored = toDrafts(missions.data);
  const values = drafts ?? stored;
  const changes = missions.data
    .filter((mission) => !isSame(values[mission.id], stored[mission.id]))
    .map((mission) => ({ missionId: mission.id, info: normalizeMissionInfo(values[mission.id]) }));
  const inputError = missions.data
    .map((mission) => {
      const error = getMissionInfoError(values[mission.id]);
      return error ? `미션 ${mission.no}: ${error}` : null;
    })
    .find((error) => error !== null);

  const update = (missionId: string, patch: Partial<MissionInfoInput>) => {
    setDrafts({ ...values, [missionId]: { ...values[missionId], ...patch } });
    setSavedCount(null);
    save.reset();
  };

  const handleSave = async () => {
    if (inputError || changes.length === 0) return;
    const result = await save.run(changes);
    if (result?.ok) {
      setDrafts(null);
      setSavedCount(result.value);
      missions.reload();
    }
  };

  return (
    <section className="panel stack" aria-labelledby="admin-missions-title">
      <h2 id="admin-missions-title" className="section-title">
        <Icon name="meeting_room" /> 미션 이름과 교실
        {changes.length > 0 ? (
          <StatusBadge tone="warning" icon="edit">
            저장 안 됨 {changes.length}개
          </StatusBadge>
        ) : null}
      </h2>
      <p className="muted">
        학생 화면, 부스 화면, 인쇄물에 그대로 나옵니다. 교실 이름에 <code>{GRADE_PLACEHOLDER}</code>
        을 적으면 학년에 맞춰 보입니다(예: <code>{GRADE_PLACEHOLDER} 1반 교실</code> →{' '}
        {previewGrade}학년에게는 “{previewGrade}학년 1반 교실”).
      </p>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">미션</th>
              <th scope="col">이름</th>
              <th scope="col">교실</th>
              <th scope="col">학생 화면({previewGrade}학년)</th>
              <th scope="col">한 줄 소개</th>
            </tr>
          </thead>
          <tbody>
            {missions.data.map((mission) => {
              const draft = values[mission.id];
              return (
                <tr key={mission.id}>
                  <th scope="row">미션 {mission.no}</th>
                  <td>
                    <input
                      className="text-input"
                      aria-label={`미션 ${mission.no} 이름`}
                      value={draft.title}
                      onChange={(change) => update(mission.id, { title: change.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="text-input"
                      aria-label={`미션 ${mission.no} 교실`}
                      value={draft.room}
                      onChange={(change) => update(mission.id, { room: change.target.value })}
                    />
                  </td>
                  <td>{formatMissionRoom(draft.room, previewGrade)}</td>
                  <td>
                    <input
                      className="text-input"
                      aria-label={`미션 ${mission.no} 한 줄 소개`}
                      value={draft.summary}
                      onChange={(change) => update(mission.id, { summary: change.target.value })}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {inputError ? <InlineAlert tone="danger">{inputError}</InlineAlert> : null}
      {save.status === 'error' ? (
        <InlineAlert tone="danger">{toUserMessage(save.error)}</InlineAlert>
      ) : null}
      {savedCount !== null && changes.length === 0 ? (
        <InlineAlert tone="success">미션 {savedCount}개의 이름·교실을 저장했어요.</InlineAlert>
      ) : null}

      <div className="teacher-actions">
        <Button
          variant="ghost"
          size="lg"
          icon="undo"
          disabled={changes.length === 0}
          onClick={() => {
            setDrafts(null);
            save.reset();
          }}
        >
          변경 취소
        </Button>
        <Button
          size="lg"
          icon="save"
          disabled={changes.length === 0 || inputError !== undefined}
          loading={save.isPending}
          onClick={() => void handleSave()}
        >
          이름·교실 저장
        </Button>
      </div>
    </section>
  );
}
