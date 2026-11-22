import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { firebaseConfig } from './config';

export function firebaseApp(): FirebaseApp {
  return getApps().length ? getApp() : initializeApp(firebaseConfig);
}
