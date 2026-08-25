export function connectionCanListMcpApps(connection: {
  connectedForMe: boolean;
  credentialHealth?: "unknown" | "ready" | "reconnect_required";
  needsReconnect?: boolean;
  setupRequired?: boolean;
}): boolean {
  return connection.connectedForMe
    && connection.needsReconnect !== true
    && connection.credentialHealth !== "reconnect_required"
    && connection.setupRequired !== true;
}

export function mcpAppCatalogIsLoading(appCount: number, hasPendingConnection: boolean): boolean {
  return appCount === 0 && hasPendingConnection;
}
