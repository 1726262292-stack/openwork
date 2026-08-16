import { Suspense } from "react";
import { LibraryOverviewScreen } from "../_components/library-overview-screen";

export default function LibraryPage() {
  return (
    <Suspense fallback={null}>
      <LibraryOverviewScreen />
    </Suspense>
  );
}
