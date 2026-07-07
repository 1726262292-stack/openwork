# org-google-workspace-scopes — Org Google Workspace covers the desktop permission set, and admins can pick more

The org-level Google Workspace connection in OpenWork Cloud previously
requested only `openid email gmail.compose`. This feature brings its default
scopes to parity with the desktop extension's base set (Calendar read, Gmail
drafts, selected Drive files) and lets the org admin opt into the same
optional permissions the desktop offers (read Gmail, full Drive, create
calendar events, Google Chat). Picks are stored on the org's OAuth client row
and reflected in the authorize URL members are sent to.

1. As the workspace admin, I open Connections in the OpenWork Cloud dashboard and tap Google Workspace. The setup now spells out what my team's AI gets out of the box — reading calendars, drafting Gmail, and working with selected Drive files — the same permissions the desktop app asks for.

2. Under "Optional permissions", I can grant more when my team needs it: reading Gmail, full Drive access, creating calendar events, and Google Chat. I check Read Gmail and Create calendar events, paste my client ID and secret, and save.

3. Reopening the setup shows Google Workspace is configured with my two extra permissions still checked — I can adjust my picks any time without retyping the client.

4. When a teammate connects their Google account, the Google consent screen asks for exactly the base permissions plus the two I picked — nothing more.

5. After approving, their card flips to Connected and the connection records those granted permissions — ready for Gmail, Calendar, and Drive work through OpenWork.
