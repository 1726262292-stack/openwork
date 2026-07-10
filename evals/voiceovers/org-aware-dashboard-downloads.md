# org-aware-dashboard-downloads — Every workspace member downloads the preconfigured desktop app

Daytona validation uses a single-org Acme deployment and a generic Windows artifact mounted through `OPENWORK_INSTALLER_ARTIFACTS_DIR`. The flow does not require GitHub or other public download egress.

1. Alex opens Acme’s admin dashboard. The download card now sets up OpenWork for Acme instead of offering anonymous files from public releases.

2. Alex chooses Download for this workspace and arrives on Acme’s install page, where the workspace and required sign-in are clear.

3. Riley signs in as an ordinary member and sees the same download action without any administrative distribution controls.

4. Riley opens it and receives Acme’s configured Windows or Mac installer from Acme’s OpenWork server.

5. Alex copies the team link twice. The original link remains valid, so later copies cannot break links already distributed.

6. Possessing the installer still grants no workspace access; Riley must sign in normally.
