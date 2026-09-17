import type { User } from 'firebase/auth';
import type {
  CollectionReference,
  DocumentData,
  DocumentReference,
  Firestore,
} from 'firebase/firestore';
import type {
  CardAward,
  ClassCardProgress,
  ClassInfo,
  FestivalEvent,
  Grade,
  Mission,
  Team,
  TeacherProfile,
} from '../../domain/types';

/**
 * Firestore 저장소의 기능별 모듈(팀 이동, 최종 미션)이 함께 쓰는 통로.
 * 미션·학급·팀처럼 행사 중에 거의 바뀌지 않는 목록은 메모리에 잠깐 들고 있어
 * 화면을 다시 그릴 때마다 읽지 않는다(무료 사용량 보호).
 */
export interface FirestoreStoreContext {
  db: Firestore;
  sub(eventId: string, name: string): CollectionReference<DocumentData>;
  eventRef(eventId: string): DocumentReference<DocumentData>;
  ensureUser(): Promise<User>;
  serverNow(): number;
  teacher(): TeacherProfile | null;
  requireTeacher(): TeacherProfile;
  requireAdmin(): TeacherProfile;
  /** 총괄 운영자 또는 그 미션 담당(담당이 정해지지 않은 부스 교사 포함) */
  requireStationAccess(missionId: string): TeacherProfile;
  /** 총괄 운영자 또는 그 학급 담임 */
  requireClassAccess(classId: string): TeacherProfile;
  canRunClassFinal(classId: string): boolean;
  /** 구독 중인 행사 상태가 있으면 그것을, 없으면 한 번 읽는다. */
  currentEvent(eventId: string): Promise<FestivalEvent>;
  missions(eventId: string): Promise<Mission[]>;
  classes(eventId: string, grade: Grade): Promise<ClassInfo[]>;
  teams(eventId: string, grade: Grade): Promise<Team[]>;
  getClass(eventId: string, classId: string): Promise<ClassInfo>;
  getTeam(eventId: string, teamId: string): Promise<Team>;
  classAwards(eventId: string, classId: string): Promise<CardAward[]>;
  classProgress(eventId: string, classId: string): Promise<ClassCardProgress>;
}

/**
 * 같은 일을 거의 동시에 두 번 보내면(연타, 같은 팀의 두 기기) 먼저 끝난 쪽이 문서를 바꿔 놓아
 * 늦은 쪽은 보안 규칙에서 거부된다. 이때는 오류로 보지 말고 이미 처리됐는지 다시 확인한다.
 */
export function isPermissionDenied(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'permission-denied';
}

/** 여러 구독의 변화를 한 번으로 묶어 알린다(한 번의 쓰기가 여러 문서를 바꿀 때). */
export class RevisionNotifier {
  private revision = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<(revision: number) => void>();

  add(listener: (revision: number) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get size(): number {
    return this.listeners.size;
  }

  get current(): number {
    return this.revision;
  }

  bump(): void {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.revision += 1;
      for (const listener of this.listeners) listener(this.revision);
    }, 40);
  }

  stop(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.listeners.clear();
  }
}

interface LiveSourceLike {
  readonly ready: Promise<void>;
  stop(): void;
}

/** 화면을 옮겨 다니는 동안 구독을 다시 붙이지 않도록 마지막 사용 뒤 잠깐 유지한다. */
const LINGER_MS = 30_000;

/**
 * 함께 쓰는 실시간 구독 묶음. 보는 화면이 없어지면 잠시 뒤 구독을 끊어
 * 아무도 보지 않는 변화에 읽기를 쓰지 않는다.
 */
export class LiveGroup {
  readonly notifier = new RevisionNotifier();
  private readonly sources: LiveSourceLike[] = [];
  private lingerTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private readonly onIdle: () => void;

  constructor(onIdle: () => void) {
    this.onIdle = onIdle;
  }

  protected track<T extends LiveSourceLike>(source: T): T {
    this.sources.push(source);
    return source;
  }

  protected untrack(source: LiveSourceLike): void {
    const index = this.sources.indexOf(source);
    if (index >= 0) this.sources.splice(index, 1);
    source.stop();
  }

  /** 지금까지 붙인 구독이 모두 첫 결과를 받을 때까지 기다린다. */
  async ready(): Promise<void> {
    await Promise.all(this.sources.map((source) => source.ready));
  }

  get isStopped(): boolean {
    return this.stopped;
  }

  /** 쓰는 화면이 없으면 잠시 뒤 구독을 끊는다. */
  touch(): void {
    if (this.lingerTimer !== null) clearTimeout(this.lingerTimer);
    this.lingerTimer = null;
    if (this.notifier.size > 0 || this.stopped) return;
    this.lingerTimer = setTimeout(() => {
      if (this.notifier.size === 0) this.stop();
    }, LINGER_MS);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.lingerTimer !== null) clearTimeout(this.lingerTimer);
    this.lingerTimer = null;
    this.notifier.stop();
    for (const source of this.sources) source.stop();
    this.onIdle();
  }

  /** 내 쓰기가 구독 캐시에 반영될 때까지 잠깐 기다린다(화면이 옛 값을 다시 그리지 않게). */
  async waitFor(predicate: () => boolean, timeoutMs = 2500): Promise<void> {
    const started = Date.now();
    while (!this.stopped && !predicate() && Date.now() - started < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}
