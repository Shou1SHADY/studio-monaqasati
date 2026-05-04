'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Query,
  onSnapshot,
  DocumentData,
  FirestoreError,
  QuerySnapshot,
  CollectionReference,
  limit,
  query,
} from 'firebase/firestore';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';

/** Utility type to add an 'id' field to a given type T. */
type WithId<T> = T & { id: string };

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
  
  const [queryState, setQueryState] = useState({ 
    target: targetRefOrQuery, 
    limitCount: pageSize 
  });

  useEffect(() => {
    setQueryState(prev => {
      if (prev.target !== targetRefOrQuery) {
        return { target: targetRefOrQuery, limitCount: pageSize };
      }
      return prev;
    });
  }, [targetRefOrQuery, pageSize]);

  useEffect(() => {
    if (!queryState.target) {
      setData(null);
      setIsLoading(false);
      setHasMore(false);
      return;
    }

    setIsLoading(true);
    
    const paginatedQuery = query(queryState.target, limit(queryState.limitCount));

    const unsubscribe = onSnapshot(
      paginatedQuery,
      (snapshot: QuerySnapshot) => {
        const newDocs = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data() as T,
        }));

        setData(newDocs);
        
        // If the number of docs returned is less than the limit we requested,
        // it means there are no more docs to load.
        setHasMore(snapshot.docs.length === queryState.limitCount);
        setIsLoading(false);
      },
      (err: FirestoreError) => {
        if (err.code === 'permission-denied' || err.code === 'unauthenticated') {
          const target = queryState.target;
          // Extract the path from the CollectionReference or Query
          const path = target ? (function(t: any): string {
            // Firestore Reference/Query has a .path property
            return t.path;
          })(target) : '';
          
          errorEmitter.emit('permission-error', new FirestorePermissionError({
            operation: 'list',
            path,
          }));
        }
        setError(err);
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [queryState]);

  const loadMore = useCallback(() => {
    setQueryState(prev => ({ ...prev, limitCount: prev.limitCount + pageSize }));
  }, [pageSize]);

  const reset = useCallback(() => {
    setQueryState(prev => ({ ...prev, limitCount: pageSize }));
    setData(null);
  }, [pageSize]);

  return {
    data,
    isLoading,
    error,
    hasMore,
    loadMore,
    reset,
  };
}
