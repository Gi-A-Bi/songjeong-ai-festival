import { initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';

export interface FirebaseHandles {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
}

interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

/** 에뮬레이터는 실제 키가 필요 없다. 프로젝트 ID는 demo-로 시작해야 실제 자원에 닿지 않는다. */
const EMULATOR_CONFIG: FirebaseWebConfig = {
  apiKey: 'demo-api-key',
  authDomain: 'localhost',
  projectId: 'demo-songjeong',
  appId: 'demo-app-id',
};

const AUTH_EMULATOR_URL = 'http://127.0.0.1:9099';
const FIRESTORE_EMULATOR_HOST = '127.0.0.1';
const FIRESTORE_EMULATOR_PORT = 8080;

export function isEmulatorMode(): boolean {
  return import.meta.env.VITE_USE_FIREBASE_EMULATORS === '1';
}

function readWebConfig(): FirebaseWebConfig {
  const env = import.meta.env;
  const config = {
    apiKey: env.VITE_FIREBASE_API_KEY ?? '',
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
    projectId: env.VITE_FIREBASE_PROJECT_ID ?? '',
    appId: env.VITE_FIREBASE_APP_ID ?? '',
  };
  const missing = Object.entries(config)
    .filter(([, value]) => value.trim() === '')
    .map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(
      `Firebase 설정이 비어 있습니다: ${missing.join(', ')}. .env 파일에 값을 채우거나 VITE_DATA_MODE를 mock으로 두세요.`,
    );
  }
  return config;
}

let handles: FirebaseHandles | null = null;

/** 앱 전체에서 하나의 Firebase 연결만 사용한다. */
export function getFirebase(): FirebaseHandles {
  if (handles) return handles;

  const emulated = isEmulatorMode();
  const config = emulated
    ? {
        ...EMULATOR_CONFIG,
        projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim() || EMULATOR_CONFIG.projectId,
      }
    : readWebConfig();

  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app);

  if (emulated) {
    connectAuthEmulator(auth, AUTH_EMULATOR_URL, { disableWarnings: true });
    connectFirestoreEmulator(db, FIRESTORE_EMULATOR_HOST, FIRESTORE_EMULATOR_PORT);
  }

  handles = { app, auth, db };
  return handles;
}
