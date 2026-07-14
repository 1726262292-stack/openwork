# guided-org-desktop-setup — Den guides a normal OpenWork app into an organization

This is organization onboarding, not a separate desktop edition. The public
download keeps its existing local-first behavior; the guided setup appears only
after a member chooses an organization download in Den. The same flow supports
hosted and self-hosted Den deployments whose connect-link signing key is trusted
by the desktop.

1. A member opens their organization in Den and chooses Download for this workspace, and Den gives them a clear three-step setup: download and install, open in OpenWork, then sign in.

2. In step one they download the normal signed OpenWork installer directly, while Den keeps the setup page open and clearly tells them to install it and return here for step two.

3. After installation they return to the unchanged Den page, where step one is visibly complete and step two explains that Open OpenWork will launch the app and connect it to this organization.

4. Back in Den, step two is ready. They click Open OpenWork, the signed link opens the desktop app, and OpenWork shows the exact organization and server it is being asked to use before anything is saved.

5. They confirm the organization, Den advances to step three, and OpenWork asks them to complete the organization's normal sign-in before showing organization resources.

6. Someone who already has the normal OpenWork app can skip the download and use Open OpenWork directly, while retry, refresh, and an expired link all keep the three steps understandable without changing public landing-page downloads.
