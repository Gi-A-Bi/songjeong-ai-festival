import { query, where } from 'firebase/firestore';
import type { Grade, RoundNo, Submission } from '../../domain/types';
import type { Unsubscribe } from '../EventRepository';
import { LiveGroup, type FirestoreStoreContext } from './firestoreContext';
import { LiveQuery } from './liveQuery';
import { mapSubmission } from './mappers';

/**
 * 한 부스·한 학년·한 라운드의 제출 구독. 문서는 학급 수만큼뿐이고,
 * 팀이 제출하거나 교사가 되돌릴 때만 바뀌므로 구독으로 받는 읽기가 작다.
 */
class StationLive extends LiveGroup {
  readonly submissions: LiveQuery<Submission>;

  constructor(
    ctx: FirestoreStoreContext,
    eventId: string,
    missionId: string,
    grade: Grade,
    roundNo: RoundNo,
    onIdle: () => void,
  ) {
    super(onIdle);
    this.submissions = this.track(
      new LiveQuery(
        // 부스 화면이 한 번 읽을 때 쓰던 것과 같은 조건이라 색인을 새로 만들지 않는다.
        query(
          ctx.sub(eventId, 'submissions'),
          where('grade', '==', grade),
          where('roundNo', '==', roundNo),
          where('missionId', '==', missionId),
        ),
        (snapshot) => mapSubmission(snapshot),
        () => this.notifier.bump(),
        () => undefined,
      ),
    );
  }
}

/** 부스 화면이 학생 제출을 새로고침 없이 받게 하는 Firestore 구현 */
export class FirestoreStationStore {
  private readonly ctx: FirestoreStoreContext;
  private readonly lives = new Map<string, StationLive>();

  constructor(ctx: FirestoreStoreContext) {
    this.ctx = ctx;
  }

  private key(eventId: string, missionId: string, grade: Grade, roundNo: RoundNo): string {
    return `${eventId}|${missionId}|${grade}|${roundNo}`;
  }

  private use(eventId: string, missionId: string, grade: Grade, roundNo: RoundNo): StationLive {
    const key = this.key(eventId, missionId, grade, roundNo);
    let live = this.lives.get(key);
    if (!live) {
      live = new StationLive(this.ctx, eventId, missionId, grade, roundNo, () =>
        this.lives.delete(key),
      );
      this.lives.set(key, live);
    }
    live.touch();
    return live;
  }

  subscribe(
    eventId: string,
    missionId: string,
    grade: Grade,
    roundNo: RoundNo,
    onChange: (revision: number) => void,
    onError: (error: unknown) => void,
  ): Unsubscribe {
    let stopped = false;
    let remove: () => void = () => undefined;
    void this.ctx
      .ensureUser()
      .then(async () => {
        if (stopped) return;
        this.ctx.requireTeacher();
        const live = this.use(eventId, missionId, grade, roundNo);
        try {
          await live.ready();
        } catch (error) {
          live.stop();
          throw error;
        }
        if (stopped) {
          live.touch();
          return;
        }
        remove = live.notifier.add(onChange);
        live.touch();
        onChange(live.notifier.current);
      })
      .catch(onError);
    return () => {
      stopped = true;
      remove();
      this.lives.get(this.key(eventId, missionId, grade, roundNo))?.touch();
    };
  }

  /** 구독 중인 부스면 캐시의 제출 목록을, 아니면 null을 돌려준다(그때는 서버에서 읽는다). */
  async cachedSubmissions(
    eventId: string,
    missionId: string,
    grade: Grade,
    roundNo: RoundNo,
  ): Promise<Submission[] | null> {
    const live = this.lives.get(this.key(eventId, missionId, grade, roundNo));
    if (!live || live.isStopped) return null;
    try {
      await live.ready();
    } catch {
      return null;
    }
    return live.isStopped ? null : [...live.submissions.docs];
  }

  /** 로그아웃처럼 권한이 바뀔 때 모든 구독을 끊는다. */
  stopAll(): void {
    for (const live of [...this.lives.values()]) live.stop();
  }
}
