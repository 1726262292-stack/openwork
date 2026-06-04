# Den Marketplace Guided Onboarding Flow

## Goal

Validate the first-run Den-to-desktop Marketplace onboarding journey for a new
organization.

The flow must teach a new org owner what Marketplaces and extensions are, show
the default marketplaces that were created for them, and make the desktop
handoff explicit: install OpenWork Desktop, sign in, then access organization
marketplaces from the app.

## Preconditions

- Run Den Web and Den API from a fresh Daytona server sandbox or a clean local DB.
- Use `OPENWORK_DEV_MODE=1` for local/Daytona email-password sign-up without email delivery.
- If Den Web runs behind a Daytona preview URL in `next dev`, set
  `DEN_WEB_ALLOWED_DEV_ORIGINS` to the preview host before starting Den Web.
- Use a fresh browser profile so no previous Den session or org state is reused.

## Server Expectations

After a signed-in user can list active marketplaces with
`GET /v1/marketplaces?status=active&limit=100`, Den lazily provisions:

- `OpenWork Marketplace`
  - Description explains built-in OpenWork AI capabilities available in desktop after sign-in.
  - Contains first-party built-ins such as Browser, Computer Use, OpenAI Image Gen, Google Workspace, and Ollama.
  - Has org-wide viewer access.
- `Anthropic-Compatible Plugins`
  - Description references `https://github.com/anthropics/knowledge-work-plugins`.
  - Has org-wide viewer access.

## Browser Flow

1. Open Den Web in Chrome.
2. Create a new account with email/password.
3. Confirm sign-up does not stop on a verification-code screen when verification is disabled.
4. Create a new organization.
5. Confirm the browser lands on `/dashboard/onboarding`.
6. Confirm the onboarding screen includes:
   - `Your team extension hub is ready.`
   - A plain-language explanation that Marketplaces share extensions with the team.
   - Extension examples: skills, agents, MCP servers, commands/hooks, and Anthropic-compatible plugins.
   - Desktop guidance: download OpenWork Desktop, sign in with the same account, then open Marketplace.
   - A visible `OpenWork Marketplace` card.
   - A visible `Anthropic-Compatible Plugins` card.
   - A link or visible reference to `anthropics/knowledge-work-plugins`.
   - OpenWork MCP install config using `npx -y openwork-ui-mcp`.
   - Example prompt: `Package this skill as a plugin, put it on a marketplace, and assign it to my team.`
7. Open `View marketplaces` and confirm both default marketplaces are listed.

## Desktop Flow

1. Start OpenWork Desktop in dev mode pointed at the fresh Den Web/API URLs.
2. Open Settings -> Extensions -> Marketplace while signed out.
3. Confirm signed-out copy says OpenWork is usable without an account and sign-in unlocks Marketplace/built-ins/org marketplaces.
4. Sign in to OpenWork Cloud with the same Den account.
5. Return to Marketplace and refresh if needed.
6. Confirm:
   - `OpenWork Marketplace` appears as a marketplace source/filter.
   - Built-ins render as `Built-in` with no install/remove action.
   - `Anthropic-Compatible Plugins` appears as an assigned org marketplace, even if empty.

## Pass Criteria

- New org creation routes to `/dashboard/onboarding`.
- The onboarding page explains the Marketplace model without requiring docs.
- The two default marketplaces exist server-side for the org.
- The desktop Marketplace requires no manual server setup beyond sign-in to see assigned marketplaces.
- Evidence clearly separates any Daytona-specific proxy/auth bridge from product behavior.

## Failure Modes To Watch

- Den Web form is not interactive behind Daytona preview URL.
  - Check Den Web logs for `Blocked cross-origin request to Next.js dev resource`.
  - Fix by setting `DEN_WEB_ALLOWED_DEV_ORIGINS=<3005 preview host>` and restarting Den Web.
- Sign-up returns `token: null` while verification is disabled.
  - Den Web should immediately attempt email/password sign-in before showing verification UI.
- Marketplace list shows only `OpenWork Marketplace`.
  - Confirm the active org requested `/v1/marketplaces` after this change and that default provisioning ran.
- Desktop shows no org marketplaces after sign-in.
  - Confirm desktop Den base/API URLs match the fresh server sandbox and the user has an active org.
