# debug-nuke-fresh-start — Debug nuke returns Windows to a clean sign-in

This user-facing proof drives a packaged Windows OpenWork app over CDP and uses Daytona filesystem witnesses to show the debug-only nuke deletes local state, preserves only the sanitized organization bootstrap, and records retry evidence for locked paths.

1. A tester's machine starts out full of real local state. We attach to the running Windows desktop app, seed every local OpenWork and OpenCode state root with recognizable fixtures and bootstrap secrets, then show the app is alive while the filesystem and localStorage witnesses prove the state is present.

2. In Debug settings, the tester opens the Danger zone. The dialog says exactly what will be deleted, what will survive, and asks for the typed word NUKE before the destructive button can run.

3. One typed word wipes the machine. After NUKE is entered, OpenWork relaunches; because the bootstrap kept require-sign-in, the app comes back on the branded sign-in screen, and the seeded browser storage keys are gone.

4. Nothing stateful survived except the organization's provisioning file. The Windows filesystem witnesses show OpenCode and token roots removed, the local OpenWork config folder reduced to desktop-bootstrap.json, and that file keeps baseUrl, requireSignin, and brandAppName while stripping the handoff and claim-link secrets.

5. Even a locked database cannot silently survive. We lock a runtime database with an exclusive Windows handle, run the nuke again through the same Debug UI, verify the retry receipt or pending file names the locked path, kill the locker, relaunch once more, and require the boot guard to remove both the pending marker and the locked file.
