import { useState, useEffect, useCallback, useRef } from "react";
import type { BackendJobStatus } from "../../types/contracts.ts";
import type { InspectionJob } from "../../types/dashboard.ts";
import { loadInspectionJobsWithFallback } from "../adapters.ts";

export interface UseInspectionJobsResult {
  jobs: InspectionJob[];
  loading: boolean;
  error: string | null;
  isLiveBackend: boolean;
  refresh: () => void;
  retry: () => void;
}

export function useInspectionJobs(params?: {
  status?: BackendJobStatus;
  limit?: number;
  offset?: number;
}): UseInspectionJobsResult {
  const [jobs, setJobs] = useState<InspectionJob[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isLiveBackend, setIsLiveBackend] = useState<boolean>(false);
  const [reloadTrigger, setReloadTrigger] = useState<number>(0);

  const activeAbortRef = useRef<AbortController | null>(null);

  const status = params?.status;
  const limit = params?.limit;
  const offset = params?.offset;

  const fetchJobs = useCallback(async () => {
    // Abort previous in-flight request if any
    if (activeAbortRef.current) {
      activeAbortRef.current.abort();
    }

    const controller = new AbortController();
    activeAbortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const result = await loadInspectionJobsWithFallback({
        status,
        limit,
        offset,
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;

      setJobs(result.jobs);
      setIsLiveBackend(result.isLiveBackend);
    } catch (err: unknown) {
      if (controller.signal.aborted) return;
      const msg = err instanceof Error ? err.message : "Failed to load inspection jobs";
      setError(msg);
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [status, limit, offset]);

  useEffect(() => {
    fetchJobs();

    return () => {
      if (activeAbortRef.current) {
        activeAbortRef.current.abort();
      }
    };
  }, [fetchJobs, reloadTrigger]);

  const refresh = useCallback(() => {
    setReloadTrigger((v) => v + 1);
  }, []);

  return {
    jobs,
    loading,
    error,
    isLiveBackend,
    refresh,
    retry: refresh,
  };
}
