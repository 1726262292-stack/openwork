import { getInitialActiveOrganizationIdForUser } from "./active-organization.js";
import { db } from "./db.js";
import { env } from "./env.js";
import {
  sendDenOrganizationInvitationEmail,
  sendDenVerificationEmail,
} from "./email.js";
import { syncDenSignupContact } from "./loops.js";
import {
  DEN_API_KEY_DEFAULT_PREFIX,
  DEN_API_KEY_RATE_LIMIT_MAX,
  DEN_API_KEY_RATE_LIMIT_TIME_WINDOW_MS,
} from "./api-keys.js";
import {
  denOrganizationAccess,
  denOrganizationStaticRoles,
} from "./organization-access.js";
import { seedDefaultOrganizationRoles } from "./orgs.js";
import { createDenTypeId, normalizeDenTypeId } from "@openwork-ee/utils/typeid";
import * as schema from "@openwork-ee/den-db/schema";
import { apiKey } from "@better-auth/api-key";
import { scim } from "@better-auth/scim";
import { sso } from "@better-auth/sso";
import { APIError } from "better-call";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { and, eq } from "@openwork-ee/den-db/drizzle";
import { emailOTP, organization } from "better-auth/plugins";

const socialProviders = {
  ...(env.github.clientId && env.github.clientSecret
    ? {
        github: {
          clientId: env.github.clientId,
          clientSecret: env.github.clientSecret,
        },
      }
    : {}),
  ...(env.google.clientId && env.google.clientSecret
    ? {
        google: {
          clientId: env.google.clientId,
          clientSecret: env.google.clientSecret,
        },
      }
    : {}),
};

function hasRole(roleValue: string, roleName: string) {
  return roleValue
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .includes(roleName);
}

function maybeString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function pickRemoteIdentity(userInfo: Record<string, unknown>) {
  return (
    maybeString(userInfo.sub) ??
    maybeString(userInfo.id) ??
    maybeString(userInfo.nameID) ??
    maybeString(userInfo.nameId) ??
    maybeString(userInfo.email)
  );
}

function getInvitationOrigin() {
  return (
    env.betterAuthTrustedOrigins.find((origin) => origin !== "*") ??
    env.betterAuthUrl
  );
}

function buildInvitationLink(invitationId: string) {
  return new URL(
    `/join-org?invite=${encodeURIComponent(invitationId)}`,
    getInvitationOrigin(),
  ).toString();
}

export const auth = betterAuth({
  baseURL: env.betterAuthUrl,
  secret: env.betterAuthSecret,
  trustedOrigins:
    env.betterAuthTrustedOrigins.length > 0
      ? env.betterAuthTrustedOrigins
      : undefined,
  socialProviders:
    Object.keys(socialProviders).length > 0 ? socialProviders : undefined,
  database: drizzleAdapter(db, {
    provider: "mysql",
    schema,
  }),
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          const activeOrganizationId = await getInitialActiveOrganizationIdForUser(session.userId);

          return {
            data: {
              ...session,
              activeOrganizationId,
            },
          };
        },
      },
    },
  },
  advanced: {
    ipAddress: {
      ipAddressHeaders: ["x-forwarded-for", "x-real-ip", "cf-connecting-ip"],
      ipv6Subnet: 64,
    },
    database: {
      generateId: (options) => {
        switch (options.model) {
          case "user":
            return createDenTypeId("user");
          case "session":
            return createDenTypeId("session");
          case "account":
            return createDenTypeId("account");
          case "verification":
            return createDenTypeId("verification");
          case "apikey":
          case "apiKey":
            return createDenTypeId("apiKey");
          case "rateLimit":
            return createDenTypeId("rateLimit");
          case "organization":
            return createDenTypeId("organization");
          case "member":
            return createDenTypeId("member");
          case "invitation":
            return createDenTypeId("invitation");
          case "team":
            return createDenTypeId("team");
          case "teamMember":
            return createDenTypeId("teamMember");
          case "organizationRole":
            return createDenTypeId("organizationRole");
          case "scimProvider":
            return createDenTypeId("scimProvider");
          case "ssoProvider":
            return createDenTypeId("ssoProvider");
          case "ssoConnection":
            return createDenTypeId("ssoConnection");
          case "externalIdentity":
            return createDenTypeId("externalIdentity");
          default:
            return false;
        }
      },
    },
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 20,
    customRules: {
      "/sign-in/email": {
        window: 300,
        max: 5,
      },
      "/sign-up/email": {
        window: 3600,
        max: env.devMode ? 100 : 5,
      },
      "/email-otp/send-verification-otp": {
        window: 3600,
        max: 5,
      },
      "/email-otp/verify-email": {
        window: 300,
        max: 10,
      },
      "/request-password-reset": {
        window: 3600,
        max: 5,
      },
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    afterEmailVerification: async (user) => {
      await syncDenSignupContact({
        email: user.email,
        name: user.name,
      });
    },
  },
  emailAndPassword: {
    enabled: true,
    autoSignIn: false,
    requireEmailVerification: true,
    revokeSessionsOnPasswordReset: true,
    async sendResetPassword({ user, url }) {
      await sendEmail({
        to: user.email,
        template: "passwordReset",
        props: { resetLink: url },
      });
    },
  },
  plugins: [
    emailOTP({
      overrideDefaultEmailVerification: true,
      otpLength: 6,
      expiresIn: 600,
      allowedAttempts: 5,
      async sendVerificationOTP({ email, otp, type }) {
        await sendDenVerificationEmail({
          email,
          verificationCode: otp,
        });
      },
    }),
    organization({
      ac: denOrganizationAccess,
      roles: denOrganizationStaticRoles,
      creatorRole: "owner",
      requireEmailVerificationOnInvitation: true,
      dynamicAccessControl: {
        enabled: true,
      },
      teams: {
        enabled: true,
        defaultTeam: {
          enabled: false,
        },
      },
      async sendInvitationEmail(data) {
        await sendDenOrganizationInvitationEmail({
          email: data.email,
          inviteLink: buildInvitationLink(data.id),
          invitedByName: data.inviter.user.name ?? data.inviter.user.email,
          invitedByEmail: data.inviter.user.email,
          organizationName: data.organization.name,
          role: data.role,
        });
      },
      organizationHooks: {
        afterCreateOrganization: async ({ organization }) => {
          await seedDefaultOrganizationRoles(
            normalizeDenTypeId("organization", organization.id),
          );
        },
        beforeRemoveMember: async ({ member }) => {
          if (hasRole(member.role, "owner")) {
            throw new APIError("BAD_REQUEST", {
              message: "The organization owner cannot be removed.",
            });
          }
        },
        beforeUpdateMemberRole: async ({ member, newRole }) => {
          if (hasRole(member.role, "owner")) {
            throw new APIError("BAD_REQUEST", {
              message: "The organization owner role cannot be changed.",
            });
          }

          if (hasRole(newRole, "owner")) {
            throw new APIError("BAD_REQUEST", {
              message:
                "Owner can only be assigned during organization creation.",
            });
          }
        },
      },
    }),
    scim({
      beforeSCIMTokenGenerated: async ({ member }) => {
        if (!member?.organizationId) {
          throw new APIError("FORBIDDEN", {
            message: "SCIM connections must belong to an organization.",
          });
        }

        if (!hasRole(member.role, "owner") && !hasRole(member.role, "admin")) {
          throw new APIError("FORBIDDEN", {
            message: "Only workspace owners and admins can manage SCIM.",
          });
        }
      },
    }),
    sso({
      providersLimit: 1000,
      provisionUserOnEveryLogin: true,
      domainVerification: {
        enabled: true,
      },
      organizationProvisioning: {
        disabled: false,
        defaultRole: "member",
      },
      saml: {
        enableInResponseToValidation: true,
        allowIdpInitiated: true,
        algorithms: {
          onDeprecated: "warn",
        },
      },
      provisionUser: async ({ user, userInfo, provider }) => {
        if (!provider.organizationId) {
          return;
        }

        const existingRows = await db
          .select()
          .from(schema.ExternalIdentityTable)
          .where(and(
            eq(schema.ExternalIdentityTable.organizationId, normalizeDenTypeId("organization", provider.organizationId)),
            eq(schema.ExternalIdentityTable.userId, normalizeDenTypeId("user", user.id)),
          ))
          .limit(1);
        const now = new Date();
        const existing = existingRows[0] ?? null;
        const remoteId = pickRemoteIdentity(userInfo);
        const displayName = maybeString(userInfo.name) ?? maybeString(userInfo.displayName) ?? maybeString(user.name);
        const email = maybeString(userInfo.email) ?? maybeString(user.email);
        const payload = {
          organizationId: normalizeDenTypeId("organization", provider.organizationId),
          userId: normalizeDenTypeId("user", user.id),
          source: existing?.scimProviderId ? "scim+sso" : "sso",
          ssoProviderId: provider.providerId,
          remoteId,
          userName: maybeString(userInfo.preferred_username) ?? email,
          email,
          displayName,
          attributesJson: userInfo,
          active: true,
          lastSsoLoginAt: now,
        };

        if (existing) {
          await db
            .update(schema.ExternalIdentityTable)
            .set({
              ...payload,
              scimProviderId: existing.scimProviderId,
              externalId: existing.externalId,
              nameJson: existing.nameJson,
              emailsJson: existing.emailsJson,
              lastScimSyncAt: existing.lastScimSyncAt,
            })
            .where(eq(schema.ExternalIdentityTable.id, existing.id));
          return;
        }

        await db.insert(schema.ExternalIdentityTable).values({
          id: createDenTypeId("externalIdentity"),
          ...payload,
        });
      },
    }),
    apiKey({
      defaultPrefix: DEN_API_KEY_DEFAULT_PREFIX,
      enableMetadata: true,
      enableSessionForAPIKeys: true,
      maximumNameLength: 64,
      requireName: true,
      storage: "database",
      rateLimit: {
        enabled: true,
        maxRequests: DEN_API_KEY_RATE_LIMIT_MAX,
        timeWindow: DEN_API_KEY_RATE_LIMIT_TIME_WINDOW_MS,
      },
    }),
  ],
});
