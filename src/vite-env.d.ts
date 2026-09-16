/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** mock(기본) 또는 firebase. 비워 두면 mock을 사용한다. */
  readonly VITE_DATA_MODE?: string;
  /** Firebase 웹 앱 설정. firebase 모드에서만 필요하다. */
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  /** 1이면 로컬 에뮬레이터에 연결한다. */
  readonly VITE_USE_FIREBASE_EMULATORS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
