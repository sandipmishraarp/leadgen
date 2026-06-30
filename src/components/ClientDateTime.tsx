"use client";

import { useEffect, useState } from "react";

type ClientDateTimeProps = {
  value?: Date | string | null;
  fallback?: string;
  timeZone?: string;
  dateStyle?: "full" | "long" | "medium" | "short";
  timeStyle?: "full" | "long" | "medium" | "short";
  className?: string;
};

export function ClientDateTime({
  value,
  fallback = "--",
  timeZone,
  dateStyle = "short",
  timeStyle,
  className
}: ClientDateTimeProps) {
  const [text, setText] = useState(fallback);

  useEffect(() => {
    if (!value) {
      setText(fallback);
      return;
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      setText(fallback);
      return;
    }
    const options: Intl.DateTimeFormatOptions = {
      dateStyle,
      ...(timeZone ? { timeZone } : {})
    };
    if (timeStyle) options.timeStyle = timeStyle;
    setText(new Intl.DateTimeFormat("en-US", options).format(date));
  }, [dateStyle, fallback, timeStyle, timeZone, value]);

  return <span className={className} suppressHydrationWarning>{text}</span>;
}
