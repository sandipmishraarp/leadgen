"use client";

import { Children, type ReactNode, useEffect, useMemo, useState } from "react";

type Tab = {
  id: string;
  label: string;
  content?: ReactNode;
};

export function LeadDetailTabs({ tabs = [], children }: { tabs?: Tab[]; children?: ReactNode }) {
  const panels = useMemo(() => Children.toArray(children), [children]);
  const safeTabs: Tab[] = tabs.length
    ? tabs
    : panels.map((_, index) => ({ id: `tab-${index}`, label: `Tab ${index + 1}` }));
  const [active, setActive] = useState(safeTabs[0]?.id || "");
  const activeIndex = Math.max(0, safeTabs.findIndex((tab) => tab.id === active));
  const activeTab = safeTabs[activeIndex] || safeTabs[0];
  const activeContent = activeTab?.content ?? panels[activeIndex] ?? panels[0] ?? null;

  useEffect(() => {
    function activateFromIntent() {
      const requested = window.sessionStorage.getItem("leadDetailActiveTab") || window.location.hash.replace("#", "");
      const normalized = requested === "drafts-composer" ? "drafts" : requested;
      if (safeTabs.some((tab) => tab.id === normalized)) {
        setActive(normalized);
        window.sessionStorage.removeItem("leadDetailActiveTab");
        window.setTimeout(() => {
          const target = document.getElementById(requested) || document.getElementById("drafts-composer");
          target?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 120);
      }
    }

    activateFromIntent();
    window.addEventListener("hashchange", activateFromIntent);
    window.addEventListener("lead-detail-open-tab", activateFromIntent);
    return () => {
      window.removeEventListener("hashchange", activateFromIntent);
      window.removeEventListener("lead-detail-open-tab", activateFromIntent);
    };
  }, [safeTabs]);

  if (!safeTabs.length) {
    return (
      <section className="rounded-xl border border-dashed border-line bg-white p-6 text-sm text-muted">
        Lead detail sections are unavailable.
      </section>
    );
  }

  return (
    <section className="min-w-0">
      <div className="sticky top-[116px] z-20 -mx-1 mb-4 overflow-x-auto border-b border-line bg-slate-50/95 px-1 pt-2 backdrop-blur-xl">
        <div className="flex min-w-max gap-1">
          {safeTabs.map((tab) => {
            const selected = tab.id === activeTab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActive(tab.id)}
                className={`rounded-t-xl border px-3 py-2 text-sm font-semibold transition ${
                  selected
                    ? "border-line border-b-white bg-white text-ink shadow-sm"
                    : "border-transparent text-muted hover:bg-white hover:text-ink"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>
      <div>{activeContent}</div>
    </section>
  );
}
