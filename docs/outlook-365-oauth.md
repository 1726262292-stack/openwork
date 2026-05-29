# Outlook 365 OAuth

## Phase 1 Scope

The initial Outlook 365 extension intentionally uses the smallest Microsoft permission set needed to connect an account and verify Microsoft Graph access:

```text
openid
profile
email
User.Read
```

OpenWork does not request Outlook Mail, Calendar, or OneDrive permissions in this phase.

## Azure App Registration

- Create an Azure App Registration for OpenWork.
- Configure it as a public/native client.
- Add a loopback redirect URI for desktop OAuth.
- Set `OPENWORK_OUTLOOK_365_OAUTH_CLIENT_ID` to the app client ID.
- Optionally set `OPENWORK_OUTLOOK_365_TENANT` to `common`, `organizations`, or a tenant ID. The default is `common`.

## Test Mock

Set these environment variables to exercise the connect/status/test/disconnect flow without a Microsoft app registration or live Microsoft account:

```bash
OPENWORK_OUTLOOK_365_MOCK=1 \
OPENWORK_DEV_MODE=1 \
OPENWORK_OUTLOOK_365_ALLOW_PLAINTEXT_VAULT=1
```

Mock mode is intended for automated tests and local UI verification only.
