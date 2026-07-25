# generic-installer-release-contract — A release link is proven by downloading it

1. A collision-proof prerelease built from the exact pull-request commit exposes its generic Mac installer anonymously, and the downloaded disk image mounts to reveal the signed, notarized installer app at its root.

2. The releases/latest URL that den-api hands to an organization without a pinned installer release downloads real bytes, passes disk image integrity, and contains a Gatekeeper-accepted installer at the disk image root.

3. Stable publication builds every required generic asset and stamps the release version into each one, and the download route resolves both a pinned release and the latest release by those exact asset names.
