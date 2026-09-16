import { useCallback, useState } from 'react';
import { useSettings } from '../../app/SettingsContext';
import type { DrawingUpload } from '../../data/EventRepository';
import { useRepository } from '../../data/RepositoryContext';
import type { SubmissionAnswer } from '../../domain/types';
import { useAction } from '../../hooks/useAction';
import { createRequestId } from '../../lib/random';

/**
 * 미션 답안 제출. 한 화면에서 같은 requestId를 재사용하므로
 * 연결 오류 뒤 다시 눌러도 제출이 두 번 생기지 않는다.
 */
export function useMissionSubmit(
  eventId: string,
  teamId: string,
  missionId: string,
  onSubmitted: () => void,
) {
  const repository = useRepository();
  const { playEffect } = useSettings();
  const [requestId] = useState(createRequestId);

  const save = useCallback(
    (answer: SubmissionAnswer, drawing?: DrawingUpload) =>
      repository.saveSubmission({ eventId, teamId, missionId, answer, requestId, drawing }),
    [repository, eventId, teamId, missionId, requestId],
  );
  const action = useAction(save);
  const { run } = action;

  const submit = useCallback(
    async (answer: SubmissionAnswer, drawing?: DrawingUpload): Promise<boolean> => {
      const result = await run(answer, drawing);
      if (!result) return false;
      if (result.ok) {
        playEffect('success');
        onSubmitted();
        return true;
      }
      playEffect('error');
      return false;
    },
    [run, playEffect, onSubmitted],
  );

  return {
    submit,
    isPending: action.isPending,
    error: action.status === 'error' ? action.error : null,
  };
}
