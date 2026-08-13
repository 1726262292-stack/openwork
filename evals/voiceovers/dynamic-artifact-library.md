# dynamic-artifact-library — Discover, inspect, and use a saved result

Cast is Avery, a member of an organization with Code Mode Scripts enabled. Avery has just saved a useful Script and wants it to feel like a durable product object rather than something hidden inside a chat transcript.

1. As soon as Avery saves the Script, its Dynamic Artifact appears in My Library alongside Skills, MCPs, Connections, and Plugins. It remains visible before the first run, clearly marked Not run yet instead of being hidden or presented as broken.

2. The Library row shows who it came from, whether its dependencies are ready, the freshness of retained data, the last successful run, its active generated-view state, and how many Automations use it. Searching and the Artifacts kind filter find it directly.

3. Opening the Artifact lands on its canonical Den detail. Overview explains readiness, ownership, the pinned Script version, and lifecycle. Preview & Data keeps the safe Markdown, structured JSON, and Lineage views. Script preserves test-before-save immutable versioning. Runs retain receipts and content-deleted states.

4. Views lists every generated view and immutable revision with build state, diagnostics, compiler and React versions, byte size, digests, CSP, and exact versioned `ui://` URI. A manager can activate an older ready revision to roll back or retire the custom view. Den never executes the generated MCP App and does not expose a React or CSS editor.

5. Automate opens an unsaved form prefilled with the exact immutable Script version and its validated example input. Nothing is scheduled until Avery explicitly chooses a cadence and creates it. Access explains that Script, retained data, and views share one grant boundary.

6. Desktop shows the same Artifact in its Library with a compact lifecycle summary. Open in Den reaches the canonical detail. Use in chat persists Avery's selected Artifact, refreshes the Cloud MCP catalog, creates a task, and seeds a short request to render the selected Artifact.

7. The agent searches metadata, selects one Artifact, and only then receives `run_selected_dynamic_artifact` and `render_selected_dynamic_artifact`. The render definition names the exact active immutable resource in nested `_meta.ui.resourceUri`; live data arrives only through `structuredContent`.

8. Creating many accessible Artifacts does not grow the model-visible catalog. Revoked access clears selection and visibility. A missing result returns Not run yet, and a retired or schema-incompatible custom view falls back to the generic safe renderer. Exact older resource URIs remain readable without depending on the first discovery page.
