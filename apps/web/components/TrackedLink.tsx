"use client";

import Link, { type LinkProps } from "next/link";

import { track } from "@/lib/analytics/ga";

type TrackedLinkProps = LinkProps & {
  children: React.ReactNode;
  className?: string;
  label: string;
  pageType?: string;
  eventName?: string;
  extraEventNames?: string[];
  eventParams?: Record<string, string | number | boolean>;
};

export default function TrackedLink({
  children,
  className,
  label,
  pageType = "dashboard",
  eventName = "rf_nav_click",
  extraEventNames,
  eventParams,
  ...props
}: TrackedLinkProps) {
  return (
    <Link
      {...props}
      className={className}
      onClick={() => {
        const payload = {
          label,
          href: typeof props.href === "string" ? props.href : "object_href",
          page_type: pageType,
          ...(eventParams || {}),
        };
        track(eventName, payload);
        (extraEventNames || []).forEach((name) => track(name, payload));
      }}
    >
      {children}
    </Link>
  );
}
