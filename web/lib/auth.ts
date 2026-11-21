import { getApps, initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';

export const useFirebase = process.env.NEXT_PUBLIC_STUDY_HUB_AUTH_MODE === 'firebase';
const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
};
const app = useFirebase ? (getApps()[0] ?? initializeApp(config)) : null;
const firebaseAuth = app ? getAuth(app) : null;
export { firebaseAuth, onAuthStateChanged };
export async function signIn() { if (!firebaseAuth) return; await signInWithPopup(firebaseAuth, new GoogleAuthProvider()); }
export async function signOutUser() { if (firebaseAuth) await signOut(firebaseAuth); }
export async function idToken(user: User | null) { return user ? user.getIdToken() : null; }
