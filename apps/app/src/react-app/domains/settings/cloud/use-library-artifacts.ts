import { useCallback, useEffect, useState } from "react";
import { createDenClient, readDenSettings, type DenLibraryArtifactItem } from "@/app/lib/den";
import { denSettingsChangedEvent } from "@/app/lib/den-session-events";

export function useLibraryArtifacts() {
  const [artifacts, setArtifacts] = useState<DenLibraryArtifactItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const settings = readDenSettings();
    const token = settings.authToken?.trim() ?? "";
    const orgId = settings.activeOrgId?.trim() ?? "";
    if (!token || !orgId) {
      setArtifacts([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setArtifacts(await createDenClient({ baseUrl: settings.baseUrl, token }).listLibraryArtifacts(orgId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Failed to load Dynamic Artifacts.");
    } finally {
      setLoading(false);
    }
  }, []);

  const select = useCallback(async (artifactId: string) => {
    const settings = readDenSettings();
    const token = settings.authToken?.trim() ?? "";
    const orgId = settings.activeOrgId?.trim() ?? "";
    if (!token || !orgId) throw new Error("Sign in to OpenWork Cloud and select an organization first.");
    await createDenClient({ baseUrl: settings.baseUrl, token }).selectLibraryArtifact(orgId, artifactId);
  }, []);

  useEffect(() => {
    void refresh();
    const handleSettings = () => void refresh();
    window.addEventListener(denSettingsChangedEvent, handleSettings);
    return () => window.removeEventListener(denSettingsChangedEvent, handleSettings);
  }, [refresh]);

  return { artifacts, loading, error, refresh, select };
}
