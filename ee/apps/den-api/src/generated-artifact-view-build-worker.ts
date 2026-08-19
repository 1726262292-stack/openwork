import { parentPort, workerData } from "node:worker_threads"
import {
  buildGeneratedArtifactViewInWorker,
  type GeneratedArtifactViewBuildInput,
} from "@openwork-ee/den-core/generated-artifact-view-builder"

if (!parentPort) throw new Error("Generated Artifact view builder must run in a worker thread.")

const result = await buildGeneratedArtifactViewInWorker(workerData as GeneratedArtifactViewBuildInput)
parentPort.postMessage(result)
