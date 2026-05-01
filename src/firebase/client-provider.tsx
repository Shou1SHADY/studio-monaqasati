'use client';

import React, { useMemo, useEffect, type ReactNode } from 'react';
import { FirebaseProvider } from '@/firebase/provider';
import { initializeFirebase } from '@/firebase';
import { signInAnonymously } from 'firebase/auth';

interface FirebaseClientProviderProps {
  children: ReactNode;
}

export function FirebaseClientProvider({ children }: FirebaseClientProviderProps) {
  const services = useMemo(() => {
    return initializeFirebase();
  }, []);

  useEffect(() => {
    // تفعيل تسجيل الدخول المجهول تلقائياً لضمان وجود UID للتعامل مع Firestore
    if (services.auth) {
      signInAnonymously(services.auth).catch((error) => {
        console.error("Auth initialization error:", error);
      });
    }
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
