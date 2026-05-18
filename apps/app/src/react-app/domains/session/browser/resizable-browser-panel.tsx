/** @jsxImportSource react */
import * as React from "react";
import { usePanelRef, type PanelImperativeHandle } from "react-resizable-panels";

import { ResizablePanel } from "@/components/ui/resizable";
import { useUiStateStore } from "../../../shell/ui-state-store";

type ResizableBrowserPanelProps = {
  children: React.ReactNode;
  defaultWidth: number;
  panelRef: React.RefObject<PanelImperativeHandle | null>;
};

export function useResizableBrowserPanelLayout(browserPanelOpen: boolean) {
  const browserPanelWidth = useUiStateStore((state) => state.workspaceRightSidebarExpandedWidth);
  const setBrowserPanelWidth = useUiStateStore((state) => state.setWorkspaceRightSidebarExpandedWidth);
  const browserPanelRef = usePanelRef();
  const [browserPanelDefaultWidth, setBrowserPanelDefaultWidth] = React.useState(browserPanelWidth);

  React.useEffect(() => {
    if (browserPanelOpen) {
      return;
    }
    
    setBrowserPanelDefaultWidth(browserPanelWidth);
  }, [browserPanelOpen, browserPanelWidth]);

  const commitBrowserPanelWidth = React.useCallback(() => {
    const size = browserPanelRef.current?.getSize();

    if (size?.inPixels) {
      setBrowserPanelWidth(Math.round(size.inPixels));
    }
  }, [browserPanelRef, setBrowserPanelWidth]);

  return {
    browserPanelDefaultWidth,
    browserPanelRef,
    commitBrowserPanelWidth,
  };
}

export function ResizableBrowserPanel({
  children,
  defaultWidth,
  panelRef,
}: ResizableBrowserPanelProps) {
  return (
    <ResizablePanel
      panelRef={panelRef}
      defaultSize={`${defaultWidth}px`}
      minSize="320px"
      maxSize="70%"
      className="min-h-0 overflow-hidden lg:flex lg:flex-col"
    >
      {children}
    </ResizablePanel>
  );
}
