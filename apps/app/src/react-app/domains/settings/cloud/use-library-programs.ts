import { useCallback, useEffect, useState } from "react";
import { createDenClient, readDenSettings, type DenLibraryProgramItem } from "@/app/lib/den";
import { denSettingsChangedEvent } from "@/app/lib/den-session-events";

export function useLibraryPrograms() {
  const [programs, setPrograms] = useState<DenLibraryProgramItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const settings = readDenSettings();
    const token = settings.authToken?.trim() ?? "";
    const orgId = settings.activeOrgId?.trim() ?? "";
    if (!token || !orgId) {
      setPrograms([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setPrograms(await createDenClient({ baseUrl: settings.baseUrl, token }).listLibraryPrograms(orgId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Failed to load Programs.");
    } finally {
      setLoading(false);
    }
  }, []);

  const select = useCallback(async (programId: string) => {
    const settings = readDenSettings();
    const token = settings.authToken?.trim() ?? "";
    const orgId = settings.activeOrgId?.trim() ?? "";
    if (!token || !orgId) throw new Error("Sign in to OpenWork Cloud and select an organization first.");
    await createDenClient({ baseUrl: settings.baseUrl, token }).selectLibraryProgram(orgId, programId);
  }, []);

  useEffect(() => {
    void refresh();
    const handleSettings = () => void refresh();
    window.addEventListener(denSettingsChangedEvent, handleSettings);
    return () => window.removeEventListener(denSettingsChangedEvent, handleSettings);
  }, [refresh]);

  return { programs, loading, error, refresh, select };
}
