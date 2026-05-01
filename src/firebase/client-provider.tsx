
'use client';

import React, { useMemo, useEffect, type ReactNode } from 'react';
import { FirebaseProvider } from '@/firebase/provider';
import { initializeFirebase } from '@/firebase';
import { signInAnonymously } from 'firebase/auth';

interface FirebaseClientProviderProps {
  children: ReactNode;
}

export function FirebaseClientProvider({ children }: FirebaseClientProviderProps) {
  // تهيئة الخدمات مرة واحدة فقط
  const services = useMemo(() => {
    return initializeFirebase();
  }, []);

  useEffect(() => {
    // تفعيل تسجيل الدخول المجهول لضمان وجود UID للتعامل مع Firestore
    const authenticate = async () => {
      if (services.auth) {
        try {
          // إذا لم يكن هناك مستخدم حالي، نقوم بتسجيل الدخول
          if (!services.auth.currentUser) {
            await signInAnonymously(services.auth);
            console.log("Firebase: Anonymous login successful.");
          }
        } catch (error) {
          console.error("Firebase: Anonymous login failed. Ensure it's enabled in Console.", error);
        }
      }
    };

    authenticate();
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
