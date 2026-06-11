
'use client';

import React, { useMemo, useEffect, type ReactNode } from 'react';
import { FirebaseProvider } from '@/firebase/provider';
import { initializeFirebase } from '@/firebase';
import { signInAnonymously, onAuthStateChanged } from 'firebase/auth';

interface FirebaseClientProviderProps {
  children: ReactNode;
}

export function FirebaseClientProvider({ children }: FirebaseClientProviderProps) {
  const services = useMemo(() => {
    return initializeFirebase();
  }, []);

  useEffect(() => {
    if (!services.auth) return;

    // Firebase can briefly fire onAuthStateChanged(null) during its async
    // IndexedDB session read even when a real user is persisted (e.g. after a
    // locale-switch tree remount). Delaying sign-in gives Firebase ~600 ms to
    // resolve the persisted session before falling back to anonymous auth.
    let anonTimer: ReturnType<typeof setTimeout> | null = null;

    const unsubscribe = onAuthStateChanged(services.auth, async (user) => {
      // Cancel any pending anonymous sign-in if auth just resolved
      if (anonTimer) {
        clearTimeout(anonTimer);
        anonTimer = null;
      }

      if (!user) {
        anonTimer = setTimeout(async () => {
          // Only sign in anonymously when no real user has appeared
          if (!services.auth.currentUser) {
            try {
              await signInAnonymously(services.auth);
            } catch (error: any) {
              if (error.code === 'auth/operation-not-allowed') {
                console.error("Firebase: Anonymous Auth is not enabled in the Firebase Console.");
              } else {
                console.error("Firebase: Anonymous login failed:", error);
              }
            }
          }
        }, 600);
      }
    });

    return () => {
      unsubscribe();
      if (anonTimer) clearTimeout(anonTimer);
    };
  }, [services.auth]);

  return (
    <FirebaseProvider
      firebaseApp={services.firebaseApp}
      auth={services.auth}
      firestore={services.firestore}
      storage={services.storage}
    >
      {children}
    </FirebaseProvider>
  );
}
