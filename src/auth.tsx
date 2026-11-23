import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { auth } from './firebase';

interface AuthState {
  user: User | null;
  loading: boolean;
}

const AuthCtx = createContext<AuthState>({ user: null, loading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, loading: true });
  useEffect(() => onAuthStateChanged(auth, (user) => setState({ user, loading: false })), []);
  return <AuthCtx.Provider value={state}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);

export function useUser(): User {
  const { user } = useAuth();
  if (!user) throw new Error('Brak zalogowanego użytkownika');
  return user;
}

export async function signInGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(auth, provider);
      return;
    }
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
    throw e;
  }
}

export const signInEmail = (email: string, password: string) => signInWithEmailAndPassword(auth, email.trim(), password);

export async function registerEmail(email: string, password: string, name: string) {
  const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
  if (name.trim()) await updateProfile(cred.user, { displayName: name.trim() });
  return cred;
}

export const resetPassword = (email: string) => sendPasswordResetEmail(auth, email.trim());

export const logout = () => signOut(auth);

const AUTH_ERRORS: Record<string, string> = {
  'auth/invalid-credential': 'Nieprawidłowy e-mail lub hasło.',
  'auth/wrong-password': 'Nieprawidłowy e-mail lub hasło.',
  'auth/user-not-found': 'Nie ma konta o tym adresie e-mail.',
  'auth/invalid-email': 'Nieprawidłowy adres e-mail.',
  'auth/email-already-in-use': 'Konto z tym adresem już istnieje – zaloguj się.',
  'auth/weak-password': 'Hasło musi mieć co najmniej 6 znaków.',
  'auth/too-many-requests': 'Zbyt wiele prób. Spróbuj za chwilę.',
  'auth/network-request-failed': 'Brak połączenia z internetem.',
  'auth/unauthorized-domain': 'Ta domena nie jest dodana w Firebase (Authentication → Settings → Authorized domains).',
  'auth/operation-not-allowed': 'Ta metoda logowania nie jest włączona w Firebase Console.',
  'auth/missing-password': 'Podaj hasło.',
};

export function authErrorMessage(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  return AUTH_ERRORS[code] ?? (e instanceof Error ? e.message : 'Wystąpił błąd logowania.');
}
