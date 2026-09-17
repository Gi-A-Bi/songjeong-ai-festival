import {
  onSnapshot,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Query,
} from 'firebase/firestore';
import type { Unsubscribe } from '../EventRepository';

/**
 * 실시간 구독 결과를 메모리에 들고 있는 작은 캐시.
 * 화면이 바뀔 때마다 문서를 다시 읽지 않고, 서버가 보내 준 "바뀐 문서"만 읽기로 센다
 * (Firebase 무료 사용량 보호).
 */
abstract class LiveSource {
  private resolveFirst: () => void = () => undefined;
  private rejectFirst: (error: unknown) => void = () => undefined;
  private received = false;
  private detach: Unsubscribe = () => undefined;
  /** 첫 결과를 받을 때까지 기다린다. 구독이 거부되면 실패한다. */
  readonly ready: Promise<void>;

  constructor() {
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveFirst = resolve;
      this.rejectFirst = reject;
    });
    // 기다리는 쪽이 없어도 처리되지 않은 거부 경고가 나지 않게 한다.
    this.ready.catch(() => undefined);
  }

  protected attach(start: () => Unsubscribe): void {
    this.detach = start();
  }

  /** 첫 결과는 방금 읽은 것과 같으므로 알리지 않고, 그 뒤의 변화만 알린다. */
  protected deliver(onChange: () => void): void {
    if (!this.received) {
      this.received = true;
      this.resolveFirst();
      return;
    }
    onChange();
  }

  protected fail(error: unknown, onError: (error: unknown) => void): void {
    if (!this.received) this.rejectFirst(error);
    onError(error);
  }

  stop(): void {
    this.detach();
  }
}

export class LiveQuery<T> extends LiveSource {
  private items: T[] = [];

  constructor(
    source: Query<DocumentData>,
    map: (snapshot: DocumentSnapshot<DocumentData>, data: DocumentData) => T,
    onChange: () => void,
    onError: (error: unknown) => void,
  ) {
    super();
    this.attach(() =>
      onSnapshot(
        source,
        (snapshot) => {
          // 서버 시각이 아직 확정되지 않은 내 쓰기도 추정 시각으로 바로 보여 준다.
          this.items = snapshot.docs.map((item) =>
            map(item, item.data({ serverTimestamps: 'estimate' })),
          );
          this.deliver(onChange);
        },
        (error) => this.fail(error, onError),
      ),
    );
  }

  get docs(): readonly T[] {
    return this.items;
  }
}

export class LiveDoc<T> extends LiveSource {
  private current: T | null = null;

  constructor(
    source: DocumentReference<DocumentData>,
    map: (snapshot: DocumentSnapshot<DocumentData>, data: DocumentData) => T,
    onChange: () => void,
    onError: (error: unknown) => void,
  ) {
    super();
    this.attach(() =>
      onSnapshot(
        source,
        (snapshot) => {
          const data = snapshot.data({ serverTimestamps: 'estimate' });
          this.current = data ? map(snapshot, data) : null;
          this.deliver(onChange);
        },
        (error) => this.fail(error, onError),
      ),
    );
  }

  /** 문서가 없으면 null */
  get value(): T | null {
    return this.current;
  }
}
