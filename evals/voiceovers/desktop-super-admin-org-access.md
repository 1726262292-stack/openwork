# Promoting a teammate never costs them their workspace

A customer hit this live: their teammate was being set up as Organization Owner, and the moment the role changed the desktop app stopped seeing the organization at all. Agent access went Degraded, the first issue read "Select an organization", and both buttons were dead — with no organization left to select. Signing out, signing back in, and rebooting changed nothing, because the desktop was discarding the organization every time the server described the new role. This demo follows that teammate through the promotion and shows the workspace holding steady.

1. Our teammate opens Connect in the desktop app. Their organization is right there, and agent access to the connected services is ready — this is the workspace they have been using every day.

2. Over in the organization dashboard, the owner starts the handoff and promotes that same teammate to super-admin. The dashboard confirms the new role immediately.

3. Back on the desktop, the teammate's session refreshes against the server. Their organization is still here, and their privileged role came across intact — the promotion changed what they can do, not whether they have a workspace.

4. Agent access is still ready, and Test now and Repair and test are both live. Nothing reads Degraded, and nothing asks them to select an organization.

5. Even when the server describes a role this build has never seen before, the desktop keeps the organization instead of throwing it away. An unfamiliar role is treated as an ordinary member, and the stored organization survives — so a future role can never strand someone the way this promotion did.
