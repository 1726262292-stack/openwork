# Office Chat Attachments

Daytona-only bug-fix proof for real Word and PowerPoint uploads in the session composer. Voiceover approval is explicitly bypassed for this continuation task.

1. “We start on Daytona with a deterministic OpenAI-compatible mock provider selected through the real workspace config and engine reload path. The fresh task composer is ready before anything is sent.”

2. “I attach a valid Word document and a valid PowerPoint deck. These are real OOXML packages, not fake ZIP headers, and both stay accepted in the composer without unsupported-format warnings.”

3. “Now I send the prompt. The request crosses Electron, the OpenWork proxy, OpenCode, and the provider boundary; the mock extracts both Office files, verifies their hashes and hidden facts, then uses the real bash tool to create the workspace artifacts, and I download the sent DOCX card to verify its hash.”

4. “The generated Word artifact is collected in the side panel as a document. OpenWork intentionally shows Preview unavailable, while Download, Open externally, and Show in folder remain available; the downloaded file hash matches the original bytes.”

5. “The generated PowerPoint deck remains a slides artifact. It uses the same safe external-file controls and does not try to launch a native Office app in the proof.”

6. “Finally, I reload and reopen the same session, then send a follow-up. The Office history replays safely, the sent attachment cards still show DOCX and PPTX download actions, and the mock confirms the replay did not poison the session.”
