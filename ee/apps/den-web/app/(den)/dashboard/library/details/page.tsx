import { Suspense } from "react";
import { LibraryDetailsScreen } from "../../_components/library-details-screen";

export default function LibraryDetailsPage() {
  return (
    <Suspense fallback={null}>
      <LibraryDetailsScreen />
    </Suspense>
  );
}
