import { createDenTypeId, isDenTypeId } from "@openwork-ee/utils/typeid";

// Better Auth keeps the provider subject in accountId. This policy only
// normalizes the local account-row primary key that Den stores as a TypeID.
export function ensureDenAccountId<TAccount extends { id?: unknown }>(account: TAccount) {
  return {
    ...account,
    id: isDenTypeId("account", account.id)
      ? account.id
      : createDenTypeId("account"),
  };
}
