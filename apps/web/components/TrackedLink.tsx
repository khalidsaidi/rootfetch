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
  const hrefString = typeof props.href === "string" ? props.href : "";
  const isArtifactOrApiLink =
    typeof props.href === "string" &&
    (hrefString.startsWith("/api/") ||
      hrefString.startsWith("/rootfetch/") ||
      hrefString.endsWith(".json") ||
      hrefString.endsWith(".csv") ||
      hrefString.endsWith(".md"));

  const onTrackedClick = () => {
    const payload = {
      label,
      href: hrefString || "object_href",
      page_type: pageType,
      ...(eventParams || {}),
    };
    track(eventName, payload);
    (extraEventNames || []).forEach((name) => track(name, payload));
  };

  if (isArtifactOrApiLink) {
    return (
      <a href={hrefString} className={className} onClick={onTrackedClick}>
        {children}
      </a>
    );
  }

  return (
    <Link
      {...props}
      className={className}
      onClick={onTrackedClick}
    >
      {children}
    </Link>
  );
}
