"use client";

import { useEffect } from "react";

type Props = {
  href: string;
};

export function StarterSuccessRedirect(props: Props) {
  useEffect(() => {
    if (!props.href) return;
    window.location.replace(props.href);
  }, [props.href]);

  return null;
}
