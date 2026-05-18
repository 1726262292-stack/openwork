import type * as React from "react";

export {};

declare module "react" {
  interface CSSProperties extends React.CSSProperties {
    [key: `--${string}`]: string | number | undefined;
  }
}
