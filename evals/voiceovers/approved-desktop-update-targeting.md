# approved-desktop-update-targeting — Automatic update checks select the highest organization-approved published release

Rashmi uses an organization-managed Windows desktop where administrators approve which OpenWork releases members can install.

1. Rashmi is running OpenWork 0.17.22. Den shows the actual published versions 0.17.22, 0.17.23, and 0.17.24; her administrator approves 0.17.23, but not 0.17.24.

2. Rashmi enables automatic checks. OpenWork first sees the normal stable latest release, then reads Den's published release inventory after her organization's policy blocks that latest version.

3. OpenWork performs an exact-target check for the highest approved published version newer than Rashmi's installation. It offers 0.17.23—not the unapproved latest release, 0.17.24.

4. After Rashmi reaches 0.17.23, another check explains: “OpenWork 0.17.24 is available, but your organization has not approved it yet. Ask an organization administrator to enable this version.”

5. When an administrator approves 0.17.24, the next manual check sees the change immediately and offers the update without waiting for the hourly policy refresh.

6. Organizations without version restrictions continue receiving the latest compatible release normally. Older approved versions never cause a downgrade.
