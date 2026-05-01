
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

    // اشتراك لمراقبة حالة المستخدم ومحاولة تسجيل الدخول إذا لم يوجد
    const unsubscribe = onAuthStateChanged(services.auth, async (user) => {
      if (!user) {
        try {
          await signInAnonymously(services.auth);
          console.log("Firebase: Anonymous login successful.");
        } catch (error: any) {
          if (error.code === 'auth/operation-not-allowed') {
            console.error("Firebase: Anonymous Auth is not enabled in the Firebase Console.");
          } else {
            console.error("Firebase: Anonymous login failed:", error);
          }
        }
      }
    });

    return () => unsubscribe();
  }, [services.auth]);

  return (
    <FirebaseProvider
      firebaseApp={services.firebaseApp}
      auth={services.auth}
      firestore={services.firestore}
    >
      {children}
    </FirebaseProvider>
  );
}
