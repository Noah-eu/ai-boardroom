import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import { Auth, getAuth } from 'firebase/auth';
import { Firestore, getFirestore } from 'firebase/firestore';
import { FirebaseStorage, getStorage } from 'firebase/storage';

type FirebaseClient = {
  app: FirebaseApp;
  auth: Auth;
  firestore: Firestore;
  storage: FirebaseStorage;
};

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

let firebaseClient: FirebaseClient | null = null;
let firebaseInitError: string | null = null;

function formatInitError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unknown Firebase initialization error.';
}

function getMissingConfigKeys(): string[] {
  const requiredEntries: Array<[string, string | undefined]> = [
    ['NEXT_PUBLIC_FIREBASE_API_KEY', firebaseConfig.apiKey],
    ['NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN', firebaseConfig.authDomain],
    ['NEXT_PUBLIC_FIREBASE_PROJECT_ID', firebaseConfig.projectId],
    ['NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET', firebaseConfig.storageBucket],
    ['NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID', firebaseConfig.messagingSenderId],
    ['NEXT_PUBLIC_FIREBASE_APP_ID', firebaseConfig.appId],
  ];

  return requiredEntries
    .filter(([, value]) => !value)
    .map(([key]) => key);
}

export function getFirebaseClient(): FirebaseClient | null {
  if (firebaseClient) {
    return firebaseClient;
  }

  if (firebaseInitError) {
    return null;
  }

  const missingKeys = getMissingConfigKeys();
  if (missingKeys.length > 0) {
    firebaseInitError = `Missing Firebase config: ${missingKeys.join(', ')}`;
    return null;
  }

  try {
    const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const firestore = getFirestore(app);
    const storage = getStorage(app);

    firebaseClient = { app, auth, firestore, storage };
    return firebaseClient;
  } catch (error) {
    firebaseInitError = formatInitError(error);
    return null;
  }
}

export function getFirebaseInitError(): string | null {
  if (!firebaseClient && !firebaseInitError) {
    getFirebaseClient();
  }
  return firebaseInitError;
}
