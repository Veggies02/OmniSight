import { useState, useEffect, useCallback, useRef } from "react";
import type { InspectionJob } from "../../types/dashboard.ts";
import { loadJobDetailsWithFallback } from "../adapters.ts";

export interface UseInspectionJobDetailsResult {
  job: InspectionJob | undefined;
  loading: boolean;
  error: string | null;
  isLiveBackend: boolean;
  refresh: () => void;
  retry: () => void;
}

/**
 * Custom React hook for fetching and managing inspection job details with:
 * - Stale request rejection (race condition protection when switching jobs quickly)
 * - AbortController cleanup on unmount or ID change
 * - Seamless fallback to typed demo data when backend is offline
 * - Status reporting for loading, error, and live vs demo backend states
 */
export function useInspectionJobDetails(jobId: string | undefined): UseInspectionJobDetailsResult {
  const [job, setJob] = useState<InspectionJob | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(Boolean(jobId));
  const [error, setError] = useState<string | null>(null);
  const [isLiveBackend, setIsLiveBackend] = useState<boolean>(false);
  const [reloadTrigger, setReloadTrigger] = useState<number>(0);

  const activeAbortRef = useRef<AbortController | null>(null);
  const currentJobIdRef = useRef<string | undefined>(jobId);

  // Keep track of the most current jobId to prevent race conditions
  useEffect(() => {
    currentJobIdRef.current = jobId;
  }, [jobId]);

  const fetchJobDetails = useCallback(async () => {
    if (!jobId) {
      return;
    }

    // Abort previous in-flight request if any
    if (activeAbortRef.current) {
      activeAbortRef.current.abort();
    }

    const controller = new AbortController();
    activeAbortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const result = await loadJobDetailsWithFallback(jobId, { signal: controller.signal });

      // Check if aborted or if user has navigated to another job in the meantime
      if (controller.signal.aborted || currentJobIdRef.current !== jobId) {
        return;
      }

      setJob(result.job);
      setIsLiveBackend(result.isLiveBackend);
      if (result.error && !result.job) {
        setError(result.error);
      }
    } catch (err: unknown) {
      if (controller.signal.aborted || currentJobIdRef.current !== jobId) {
        return;
      }
      const msg = err instanceof Error ? err.message : `Failed to load job #${jobId}`;
      setError(msg);
    } finally {
      if (!controller.signal.aborted && currentJobIdRef.current === jobId) {
        setLoading(false);
      }
    }
  }, [jobId]);

  useEffect(() => {
    if (!jobId) {
      setJob(undefined);
      setLoading(false);
      setError(null);
      setIsLiveBackend(false);
      return;
    }

    fetchJobDetails();

    return () => {
      if (activeAbortRef.current) {
        activeAbortRef.current.abort();
      }
    };
  }, [jobId, fetchJobDetails, reloadTrigger]);

  const refresh = useCallback(() => {
    setReloadTrigger((v) => v + 1);
  }, []);

  return {
    job,
    loading,
    error,
    isLiveBackend,
    refresh,
    retry: refresh,
  };
}
