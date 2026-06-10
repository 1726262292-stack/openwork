import { redirect } from "next/navigation";
import { getMarketplaceSourcesRoute } from "../../../_lib/den-org";

export default function IntegrationsPage() {
  redirect(getMarketplaceSourcesRoute());
}
