import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { SourceMaterialsPage } from "@/components/source-materials/SourceMaterialsPage";

export default function Sources() {
  return (
    <AppErrorBoundary>
      <SourceMaterialsPage />
    </AppErrorBoundary>
  );
}
