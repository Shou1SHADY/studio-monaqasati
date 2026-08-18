'use client';

import { useState, useEffect } from 'react';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';

/**
 * An invisible component that listens for globally emitted 'permission-error' events
 * and throws them to be caught by Next.js's global-error.tsx — a loud dev-time signal
 * for real Firestore rules bugs. In production this same crash is also reachable by a
 * routine race (e.g. a subcollection listener still mounted the instant its parent doc
 * is deleted, a moment before the page navigates away) that isn't a real bug, so there
 * we log instead of crashing the page out from under the user.
 */
export function FirebaseErrorListener() {
  // Use the specific error type for the state for type safety.
  const [error, setError] = useState<FirestorePermissionError | null>(null);

  useEffect(() => {
    // The callback now expects a strongly-typed error, matching the event payload.
    const handleError = (error: FirestorePermissionError) => {
      // A company/role switch commits a write that flips getOrganizationId() under
      // every org-scoped listener still mounted during the instant before the full
      // navigation lands — a known, benign teardown race, not a rules bug. The
      // switch handlers raise this flag just before their write; the page that
      // follows is a fresh load, so the flag can never suppress a real error.
      if (typeof window !== 'undefined' && (window as unknown as { __companySwitchInFlight?: boolean }).__companySwitchInFlight) {
        console.warn('Suppressed transient permission error during company switch:', error.message);
        return;
      }
      if (process.env.NODE_ENV !== 'production') {
        // Set error in state to trigger a re-render that throws it (dev-only, see above).
        setError(error);
      } else {
        console.error('Firestore permission error:', error);
      }
    };

    // The typed emitter will enforce that the callback for 'permission-error'
    // matches the expected payload type (FirestorePermissionError).
    errorEmitter.on('permission-error', handleError);

    // Unsubscribe on unmount to prevent memory leaks.
    return () => {
      errorEmitter.off('permission-error', handleError);
    };
  }, []);

  // On re-render, if an error exists in state, throw it.
  if (error) {
    throw error;
  }

  // This component renders nothing.
  return null;
}
