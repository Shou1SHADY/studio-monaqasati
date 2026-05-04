'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Query,
  onSnapshot,
  DocumentData,
  FirestoreError,
  QuerySnapshot,
  CollectionReference,
  startAfter,
  limit,
  query,
  DocumentSnapshot,
} from 'firebase/firestore';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';

/** Utility type to add an 'id' field to a given type T. */
export type WithId<T> = T & { id: string };

/**
 * Interface for the return value of the useCollectionPaginated hook.
 */
export interface UseCollectionPaginatedResult<T> {
  data: WithId<T>[] | null;
  isLoading: boolean;
  error: FirestoreError | Error | null;
  hasMore: boolean;
  loadMore: () => void;
  reset: () => void;
}

const PAGE_SIZE = 20;

/**
 * React hook to subscribe to a Firestore collection or query in real-time with pagination.
 * Handles nullable references/queries.
 * 
 * IMPORTANT! YOU MUST MEMOIZE the inputted memoizedTargetRefOrQuery or BAD THINGS WILL HAPPEN
 * use useMemo to memoize it per React guidence. Also make sure that it's dependencies are stable
 * references
 *  
 * @template T Optional type for document data. Defaults to any.
 * @param {CollectionReference<DocumentData> | Query<DocumentData> | null | undefined} targetRefOrQuery - 
 *        The Firestore collection reference or query to subscribe to.
 * @param {number} pageSize - Optional page size (default 20).
 */
export function useCollectionPaginated<T = any>(
  targetRefOrQuery: CollectionReference<DocumentData> | Query<DocumentData> | null | undefined,
  pageSize: number = PAGE_SIZE
): UseCollectionPaginatedResult<T> {
  const [data, setData] = useState<WithId<T>[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<FirestoreError | Error | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const lastDocRef = useRef<DocumentSnapshot | null>(null);
  const allDataRef = useRef<WithId<T>[]>([]);

  const loadMore = useCallback(() => {
    if (!targetRefOrQuery || !hasMore) return;

    setIsLoading(true);
    
    let paginatedQuery = query(targetRefOrQuery, limit(pageSize));
    if (lastDocRef.current) {
      paginatedQuery = query(paginatedQuery, startAfter(lastDocRef.current));
    }

    const unsubscribe = onSnapshot(
      paginatedQuery,
      (snapshot: QuerySnapshot) => {
        const newDocs = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data() as T,
        }));

        allDataRef.current = [...allDataRef.current, ...newDocs];
        setData([...allDataRef.current]);
        
        lastDocRef.current = snapshot.docs[snapshot.docs.length - 1] || null;
        setHasMore(snapshot.docs.length === pageSize);
        setIsLoading(false);
      },
      (err: FirestoreError) => {
        if (err.code === 'permission-denied' || err.code === 'unauthenticated') {
          errorEmitter.emit(new FirestorePermissionError(err));
        }
        setError(err);
        setIsLoading(false);
      }
    );

    return unsubscribe;
  }, [targetRefOrQuery, pageSize, hasMore]);

  useEffect(() => {
    allDataRef.current = [];
    lastDocRef.current = null;
    setHasMore(true);
    
    if (!targetRefOrQuery) {
      setData(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    loadMore();
  }, [targetRefOrQuery]);

  const reset = useCallback(() => {
    allDataRef.current = [];
    lastDocRef.current = null;
    setHasMore(true);
    setData(null);
    loadMore();
  }, [loadMore]);

  return {
    data,
    isLoading,
    error,
    hasMore,
    loadMore,
    reset,
  };
}
