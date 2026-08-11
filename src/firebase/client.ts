import { getApp, getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInAnonymously, type Auth, type User } from 'firebase/auth';
import { getDatabase, type Database } from 'firebase/database';

export interface FirebaseServices { readonly app: FirebaseApp; readonly auth: Auth; readonly database: Database }

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

export const isFirebaseConfigured = (): boolean => Boolean(config.apiKey && config.authDomain && config.databaseURL && config.projectId);

export const firebaseServices = (): FirebaseServices | null => {
  if (!isFirebaseConfigured()) return null;
  const options: FirebaseOptions = {
    apiKey: config.apiKey!, authDomain: config.authDomain!, databaseURL: config.databaseURL!, projectId: config.projectId!,
    ...(config.appId ? { appId: config.appId } : {}),
  };
  const app = getApps().length > 0 ? getApp() : initializeApp(options);
  return { app, auth: getAuth(app), database: getDatabase(app) };
};

export const ensureAnonymousUser = async (): Promise<User> => {
  const services = firebaseServices();
  if (!services) throw new Error('Firebase no está configurado. Revisa las variables VITE_FIREBASE_*');
  if (services.auth.currentUser) return services.auth.currentUser;
  await Promise.race([
    signInAnonymously(services.auth),
    new Promise<never>((_, reject) => globalThis.setTimeout(() => reject(new Error('Firebase tardó demasiado en autenticar el dispositivo.')), 15_000)),
  ]);
  return await new Promise<User>((resolve, reject) => {
    let settled = false;
    const timeout = globalThis.setTimeout(() => {
      if (settled) return;
      settled = true;
      unsubscribe();
      reject(new Error('No se pudo confirmar la identidad anónima.'));
    }, 15_000);
    const unsubscribe = onAuthStateChanged(services.auth, (user) => {
      if (!user || settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      unsubscribe();
      resolve(user);
    }, (error) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      unsubscribe();
      reject(error);
    });
  });
};
