# Initial Administrator Bootstrap

Private OpenWork Den deployments often disable public signup before anyone has an account. Configuring an owner or bootstrap administrator email authorizes that person after an account exists; it does not create the account and it does not make knowing the email sufficient to claim the deployment.

Use the initial-administrator bootstrap flow to create the first account without enabling public signup and without requiring SMTP.

## How It Works

1. The deployment must have zero Better Auth users.
2. The initial-admin claim must not already be consumed.
3. The submitted email must be eligible.
4. The submitted one-time setup code must match the server-side SHA-256 digest.
5. The server issues a short-lived, email-bound bootstrap grant.
6. The final account creation goes through Better Auth email/password signup.
7. OpenWork creates or reuses the singleton organization, grants owner membership, adds platform-admin authorization, signs the admin in, and consumes the claim.

After consumption, rotating or re-adding the setup-code digest cannot reopen bootstrap. Existing users are never deleted or mutated to recover setup.

## Eligible Emails

For `single_org` deployments:

1. If `DEN_SINGLE_ORG_OWNER_EMAILS` is set, those normalized emails are eligible to claim `/setup`.
2. If `DEN_SINGLE_ORG_OWNER_EMAILS` is empty, `DEN_BOOTSTRAP_ADMIN_EMAILS` is used as the eligible bootstrap email list.

On successful setup, the created first owner is inserted into the platform-admin allowlist even if the email came from `DEN_SINGLE_ORG_OWNER_EMAILS`.

## Environment Variables

Required for private bootstrap:

`DEN_SINGLE_ORG_ALLOW_PUBLIC_SIGNUP=false`

`DEN_SINGLE_ORG_OWNER_EMAILS=admin@example.com` or `DEN_BOOTSTRAP_ADMIN_EMAILS=admin@example.com`

`DEN_INITIAL_ADMIN_BOOTSTRAP_CODE_SHA256=<64-character lowercase hex SHA-256 digest>`

Alternative file-based injection:

`DEN_INITIAL_ADMIN_BOOTSTRAP_CODE_SHA256_FILE=/run/secrets/initial-admin-bootstrap-code-sha256`

Do not configure the raw code as an environment variable for OpenWork. The application accepts only the digest.

## Generate A Code Safely

Run these commands on an operator workstation or in a trusted secret-management shell. They avoid placing the raw code in shell history.

```bash
umask 077
code_file=$(mktemp)
digest_file=$(mktemp)
openssl rand -base64 32 | tr -d '\n' > "$code_file"
shasum -a 256 "$code_file" | cut -d ' ' -f1 > "$digest_file"
```

Store the raw code from `code_file` in your password manager or break-glass secret store. Store the digest from `digest_file` in the OpenWork deployment secret.

Remove local files after the first administrator has signed in:

```bash
rm -f "$code_file" "$digest_file"
```

## Kubernetes Secret

Create or update the chart Secret with the digest only:

```bash
kubectl create secret generic openwork-ee \
  --namespace openwork-ee \
  --from-file=DEN_INITIAL_ADMIN_BOOTSTRAP_CODE_SHA256="$digest_file" \
  --dry-run=client -o yaml | kubectl apply -f -
```

If the Helm chart creates the Secret, set:

```yaml
secret:
  values:
    initialAdminBootstrapCodeSha256: "REPLACE_BOOTSTRAP_CODE_SHA256"
```

If you use an existing Secret, make sure `secret.keys.initialAdminBootstrapCodeSha256` names the key that contains the digest. Do not put the digest in a ConfigMap.

## Docker Compose And Other Containers

For environment-variable injection, set the digest only:

```env
DEN_SINGLE_ORG_OWNER_EMAILS=admin@example.com
DEN_SINGLE_ORG_ALLOW_PUBLIC_SIGNUP=false
DEN_INITIAL_ADMIN_BOOTSTRAP_CODE_SHA256=REPLACE_BOOTSTRAP_CODE_SHA256
```

For file-based secret stores, mount a file containing the digest and set:

```env
DEN_INITIAL_ADMIN_BOOTSTRAP_CODE_SHA256_FILE=/run/secrets/initial-admin-bootstrap-code-sha256
```

The same pattern works with container-platform secret stores, systemd environment files, VM secret agents, and Kubernetes projected Secrets.

## Setup URL

Open:

```text
https://openwork.example.com/setup
```

The setup page asks for the eligible administrator email and the raw one-time setup code. It does not display configured privileged emails and it does not require email delivery.

## Verify Availability

The status endpoint reports only general state:

```bash
curl -fsS https://api.openwork.example.com/v1/auth/bootstrap/status
```

Possible statuses are `available`, `complete`, and `unavailable`. The response never includes configured emails or setup-code material.

## Rotation And Recovery

Before setup is consumed, rotate by generating a new raw code and replacing `DEN_INITIAL_ADMIN_BOOTSTRAP_CODE_SHA256` or the digest file. Restart or roll the Den API pods so they read the new secret.

After setup is consumed, rotating the digest cannot re-enable bootstrap. Use normal administrator account recovery, database backups, or an explicitly reviewed operational recovery procedure.

If the digest is missing or malformed, bootstrap fails closed and `/setup` reports that setup is unavailable. Fix the secret and restart the API. Do not delete users or organizations to recover a malformed bootstrap configuration.

Multiple Den API replicas are supported. Bootstrap grant reservation and claim consumption are stored in MySQL with row locks and a singleton primary key, so concurrent setup attempts can create at most one initial administrator.

## Security Warnings

Never put the raw setup code in source control, Helm values committed to a repository, ConfigMaps, logs, screenshots, issue descriptions, PR bodies, or chat transcripts.

Treat the digest as sensitive deployment configuration. It cannot be used directly as the setup code, but exposing it weakens defense in depth.

SMTP and email verification are not required for initial-admin bootstrap. If email verification is enabled for normal auth, Better Auth still owns the signup mechanics and protections.
