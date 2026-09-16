/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** mock(기본) 또는 firebase. 비워 두면 mock을 사용한다. */
  readonly VITE_DATA_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
