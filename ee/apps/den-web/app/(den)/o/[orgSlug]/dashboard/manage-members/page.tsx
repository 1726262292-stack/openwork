import { redirect } from "next/navigation";

export default function ManageMembersRedirectPage({
  params,
}: {
  params: { orgSlug: string };
}) {
  redirect(`/o/${encodeURIComponent(params.orgSlug)}/dashboard/members`);
}
