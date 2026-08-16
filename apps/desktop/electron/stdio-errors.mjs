const guardedStreams = new WeakSet();

export function isBrokenPipeError(error) {
  return Boolean(error && typeof error === "object" && error.code === "EPIPE");
}

export function installStdioErrorHandlers({ stdout = process.stdout, stderr = process.stderr } = {}) {
  for (const stream of [stdout, stderr]) {
    if (!stream || typeof stream.on !== "function" || guardedStreams.has(stream)) continue;

    stream.on("error", (error) => {
      if (isBrokenPipeError(error)) return;
      throw error;
    });
    guardedStreams.add(stream);
  }
}
