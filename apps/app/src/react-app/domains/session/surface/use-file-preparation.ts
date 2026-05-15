/** @jsxImportSource react */
import { useCallback, useRef, useState } from "react";
import { Effect } from "effect";
import type { OpenworkServerClient } from "../../../../app/lib/openwork-server";
import { isDesktopRuntime } from "../../../../app/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IncomingFile = {
  /** Browser File object (may be empty for desktop-picked files). */
  file: File;
  /** Absolute native path (Electron drag-drop, file picker, or clipboard IPC). */
  nativePath?: string;
};

export type FilePreparationJob = {
  id: string;
  name: string;
  /** The path reference inserted into the composer draft. */
  reference: string;
  status: "preparing" | "ready" | "error";
  error?: string;
};

export type FilePreparationResult = {
  /** References inserted into the draft (either native paths or inbox paths). */
  references: string[];
  /** Jobs that need async work (browser upload). */
  jobs: FilePreparationJob[];
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INBOX_UPLOAD_MAX_BYTES = 50_000_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function filenameFromPath(path: string) {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function parentDirFromPath(path: string) {
  const normalized = path.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash <= 0) return "/";
  return normalized.slice(0, lastSlash);
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function makeJobId() {
  return `fp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Effect-based upload
// ---------------------------------------------------------------------------

function uploadToInbox(
  client: OpenworkServerClient,
  workspaceId: string,
  file: File,
) {
  return Effect.tryPromise({
    try: () => client.uploadInbox(workspaceId, file),
    catch: (error) =>
      error instanceof Error ? error : new Error(String(error)),
  });
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useFilePreparation(options: {
  client: OpenworkServerClient;
  workspaceId: string;
}) {
  const { client, workspaceId } = options;
  const [jobs, setJobs] = useState<FilePreparationJob[]>([]);
  const controllersRef = useRef<Map<string, AbortController>>(new Map());

  const preparing = jobs.some((job) => job.status === "preparing");

  /**
   * Classify and prepare incoming files.
   *
   * Desktop (Electron) with native path:
   *   → insert @/real/path as file mention (instant, no async work)
   *   → the caller should grant permission via patchConfig
   *
   * Browser without native path:
   *   → small file: upload to inbox async, insert mention when done
   *   → large file: reject immediately
   *
   * Returns { references, jobs } where references are the paths to insert
   * as file mentions, and jobs are async uploads that need to finish.
   */
  const prepare = useCallback(
    (files: IncomingFile[]): FilePreparationResult => {
      const references: string[] = [];
      const newJobs: FilePreparationJob[] = [];

      for (const item of files) {
        const name =
          item.file.name ||
          (item.nativePath ? filenameFromPath(item.nativePath) : "") ||
          "file";

        // Desktop path: use real filesystem path directly
        if (item.nativePath) {
          references.push(item.nativePath);
          continue;
        }

        // Browser fallback: check size limit
        if (item.file.size > INBOX_UPLOAD_MAX_BYTES) {
          newJobs.push({
            id: makeJobId(),
            name,
            reference: "",
            status: "error",
            error: `${name} (${formatBytes(item.file.size)}) is too large for browser upload (limit: ${formatBytes(INBOX_UPLOAD_MAX_BYTES)}). Use the desktop file picker or drag from Finder.`,
          });
          continue;
        }

        // Browser upload: create job, start async Effect
        const jobId = makeJobId();
        const inboxRef = `.opencode/openwork/inbox/${name}`;
        const job: FilePreparationJob = {
          id: jobId,
          name,
          reference: inboxRef,
          status: "preparing",
        };
        newJobs.push(job);
        references.push(inboxRef);

        // Fire and forget — the Effect manages the async lifecycle
        const controller = new AbortController();
        controllersRef.current.set(jobId, controller);

        void Effect.runPromise(
          uploadToInbox(client, workspaceId, item.file),
        )
          .then(() => {
            controllersRef.current.delete(jobId);
            if (controller.signal.aborted) return;
            setJobs((current) =>
              current.map((j) =>
                j.id === jobId ? { ...j, status: "ready" } : j,
              ),
            );
          })
          .catch((err) => {
            controllersRef.current.delete(jobId);
            if (controller.signal.aborted) return;
            const message =
              err instanceof Error ? err.message : "Upload failed";
            setJobs((current) =>
              current.map((j) =>
                j.id === jobId
                  ? { ...j, status: "error", error: message }
                  : j,
              ),
            );
          });
      }

      if (newJobs.length) {
        setJobs((current) => [...current, ...newJobs]);
      }

      return { references, jobs: newJobs };
    },
    [client, workspaceId],
  );

  const cancel = useCallback((jobId: string) => {
    controllersRef.current.get(jobId)?.abort();
    controllersRef.current.delete(jobId);
    setJobs((current) => current.filter((j) => j.id !== jobId));
  }, []);

  const cancelAll = useCallback(() => {
    controllersRef.current.forEach((c) => c.abort());
    controllersRef.current.clear();
    setJobs([]);
  }, []);

  const dismiss = useCallback((jobId: string) => {
    setJobs((current) => current.filter((j) => j.id !== jobId));
  }, []);

  const dismissAll = useCallback(() => {
    // Only dismiss completed/errored, cancel preparing
    controllersRef.current.forEach((c) => c.abort());
    controllersRef.current.clear();
    setJobs([]);
  }, []);

  const reset = useCallback(() => {
    controllersRef.current.forEach((c) => c.abort());
    controllersRef.current.clear();
    setJobs([]);
  }, []);

  return {
    jobs,
    preparing,
    prepare,
    cancel,
    cancelAll,
    dismiss,
    dismissAll,
    reset,
  };
}
