# owner-desktop-policy-api — Workspace owners can manage desktop policies through the connected API

1. I'm signed in as the workspace owner. I ask OpenWork to show our desktop policies, and the connected API returns the current policy names, settings, and assignments.

2. I ask OpenWork to create a desktop policy for a team. The policy is created through the connected API and the result confirms its settings and assignments.

3. I ask OpenWork to update that policy. The connected API applies the change, and a follow-up read shows the saved configuration.

4. When an admin or regular member tries the same create or update action, the API rejects it because desktop policy changes are restricted to the workspace owner; read-only effective desktop config remains available to members.
