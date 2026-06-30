import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/services/activity";

export type TrackingMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
  referrer?: string | null;
};

const TRACKABLE_URL_PATTERN = /https?:\/\/[^\s<>()"']+/gi;

export function appBaseUrl() {
  return (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
}

export function trackingEnabled() {
  return process.env.TRACKING_ENABLED !== "false" && Boolean(process.env.TRACKING_BASE_URL) && !globalThis.trackingGatewayRuntimeDisabled;
}

export function trackingBaseUrl() {
  return (process.env.TRACKING_BASE_URL || "").replace(/\/$/, "");
}

export function setTrackingRuntimeDisabled(disabled: boolean) {
  globalThis.trackingGatewayRuntimeDisabled = disabled;
}

export function buildTrackedHtml(body: string, engagementId: string) {
  const html = linkifyEscapedText(body, engagementId).replace(/\n/g, "<br />");
  const pixelUrl = openPixelUrl(engagementId);
  return [
    "<!doctype html><html><body>",
    `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.55;color:#111827">${html}</div>`,
    `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none;width:1px;height:1px" />`,
    "</body></html>"
  ].join("");
}

export function buildTrackedHtmlFromHtml(html: string, engagementId: string) {
  const pixelUrl = openPixelUrl(engagementId);
  const tracked = html.replace(/href=(["'])(.*?)\1/gi, (match, quote, url) => {
    if (!shouldRewriteUrl(url)) return match;
    const trackedUrl = clickTrackingUrl(engagementId, url);
    return `href=${quote}${trackedUrl}${quote}`;
  });
  return [
    "<!doctype html><html><body>",
    `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.55;color:#111827">${tracked}</div>`,
    `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none;width:1px;height:1px" />`,
    "</body></html>"
  ].join("");
}

export async function recordEmailOpen(engagementId: string, meta: TrackingMeta) {
  const engagement = await prisma.emailEngagement.findUnique({
    where: { id: engagementId },
    include: { sentEmail: { include: { thread: { include: { lead: true } } } } }
  });
  if (!engagement) return null;

  const now = new Date();
  const openCount = engagement.openCount + 1;
  const next = scoreEngagement({
    openCount,
    clickedLinks: engagement.clickedLinks,
    websiteVisits: engagement.websiteVisits,
    proposalViews: engagement.proposalViews,
    replied: false
  });

  const updated = await prisma.emailEngagement.update({
    where: { id: engagement.id },
    data: {
      openCount,
      firstOpenAt: engagement.firstOpenAt || now,
      lastOpenAt: now,
      engagementScore: next.engagementScore,
      leadScore: next.leadScore
    }
  });

  await logActivity({
    type: "EMAIL_SENT",
    message: `Email opened by ${engagement.sentEmail.toEmails.join(", ")}`,
    leadId: engagement.sentEmail.thread.leadId || undefined,
    threadId: engagement.sentEmail.threadId,
    metadata: { engagementId, openCount, ...meta }
  });

  return updated;
}

export async function recordLinkClick(engagementId: string, url: string, meta: TrackingMeta) {
  const safeUrl = sanitizeRedirectUrl(url);
  const engagement = await prisma.emailEngagement.findUnique({
    where: { id: engagementId },
    include: { sentEmail: { include: { thread: true } } }
  });
  if (!engagement) return { url: safeUrl, engagement: null };

  await prisma.linkClick.create({
    data: {
      engagementId,
      url: safeUrl,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      referrer: meta.referrer
    }
  });

  const clickedLinks = engagement.clickedLinks + 1;
  const next = scoreEngagement({
    openCount: engagement.openCount,
    clickedLinks,
    websiteVisits: engagement.websiteVisits,
    proposalViews: engagement.proposalViews,
    replied: false
  });

  const updated = await prisma.emailEngagement.update({
    where: { id: engagementId },
    data: {
      clickedLinks,
      lastClickedAt: new Date(),
      engagementScore: next.engagementScore,
      leadScore: next.leadScore
    }
  });

  await logActivity({
    type: "EMAIL_SENT",
    message: `Tracked link clicked: ${safeUrl}`,
    leadId: engagement.sentEmail.thread.leadId || undefined,
    threadId: engagement.sentEmail.threadId,
    metadata: { engagementId, url: safeUrl, ...meta }
  });

  return { url: safeUrl, engagement: updated };
}

export async function recordWebsiteVisit(input: {
  engagementId?: string | null;
  leadId?: string | null;
  email?: string | null;
  pageUrl: string;
  meta: TrackingMeta;
}) {
  const visit = await prisma.websiteVisit.create({
    data: {
      engagementId: input.engagementId || undefined,
      leadId: input.leadId || undefined,
      email: input.email || undefined,
      pageUrl: input.pageUrl,
      ipAddress: input.meta.ipAddress,
      userAgent: input.meta.userAgent,
      referrer: input.meta.referrer
    }
  });

  if (input.engagementId) {
    await incrementEngagement(input.engagementId, "websiteVisits");
  }

  await logActivity({
    type: "EMAIL_SENT",
    message: `Website visit tracked: ${input.pageUrl}`,
    leadId: input.leadId || undefined,
    metadata: { visitId: visit.id, engagementId: input.engagementId, email: input.email }
  });

  return visit;
}

export async function recordProposalView(input: {
  engagementId?: string | null;
  sentEmailId?: string | null;
  leadId?: string | null;
  proposalId?: string | null;
  proposalUrl?: string | null;
  meta: TrackingMeta;
}) {
  const view = await prisma.proposalView.create({
    data: {
      engagementId: input.engagementId || undefined,
      sentEmailId: input.sentEmailId || undefined,
      leadId: input.leadId || undefined,
      proposalId: input.proposalId || undefined,
      proposalUrl: input.proposalUrl || undefined,
      ipAddress: input.meta.ipAddress,
      userAgent: input.meta.userAgent,
      referrer: input.meta.referrer
    }
  });

  if (input.engagementId) {
    await incrementEngagement(input.engagementId, "proposalViews");
  }

  await logActivity({
    type: "EMAIL_SENT",
    message: "Proposal opened",
    leadId: input.leadId || undefined,
    metadata: { proposalViewId: view.id, engagementId: input.engagementId, proposalId: input.proposalId }
  });

  return view;
}

export function requestMeta(request: Request): TrackingMeta {
  const forwardedFor = request.headers.get("x-forwarded-for");
  return {
    ipAddress: forwardedFor?.split(",")[0]?.trim() || request.headers.get("x-real-ip"),
    userAgent: request.headers.get("user-agent"),
    referrer: request.headers.get("referer")
  };
}

export function scoreEngagement(input: {
  openCount: number;
  clickedLinks: number;
  websiteVisits: number;
  proposalViews: number;
  replied: boolean;
}) {
  const engagementScore =
    Math.min(input.openCount, 10) * 5 +
    input.clickedLinks * 20 +
    input.websiteVisits * 15 +
    input.proposalViews * 25 +
    (input.replied ? 30 : 0);
  let leadScore = "Cold";
  if (input.openCount >= 5 && input.clickedLinks > 0) leadScore = "Hot";
  else if (input.openCount >= 3 || input.clickedLinks > 0 || input.websiteVisits > 0 || input.proposalViews > 0) leadScore = "Interested";
  else if (input.openCount >= 1) leadScore = "Warm";
  return { engagementScore, leadScore };
}

async function incrementEngagement(engagementId: string, field: "websiteVisits" | "proposalViews") {
  const engagement = await prisma.emailEngagement.findUnique({ where: { id: engagementId } });
  if (!engagement) return;
  const nextValue = engagement[field] + 1;
  const next = scoreEngagement({
    openCount: engagement.openCount,
    clickedLinks: engagement.clickedLinks,
    websiteVisits: field === "websiteVisits" ? nextValue : engagement.websiteVisits,
    proposalViews: field === "proposalViews" ? nextValue : engagement.proposalViews,
    replied: false
  });
  await prisma.emailEngagement.update({
    where: { id: engagementId },
    data: {
      [field]: nextValue,
      engagementScore: next.engagementScore,
      leadScore: next.leadScore
    }
  });
}

function linkifyEscapedText(body: string, engagementId: string) {
  let result = "";
  let lastIndex = 0;
  for (const match of body.matchAll(TRACKABLE_URL_PATTERN)) {
    const url = match[0].replace(/[),.]+$/, "");
    const index = match.index || 0;
    result += escapeHtml(body.slice(lastIndex, index));
    const tracked = clickTrackingUrl(engagementId, url);
    result += `<a href="${escapeHtml(tracked)}">${escapeHtml(url)}</a>`;
    lastIndex = index + match[0].length;
  }
  result += escapeHtml(body.slice(lastIndex));
  return result;
}

function openPixelUrl(engagementId: string) {
  if (trackingEnabled()) {
    return `${trackingBaseUrl()}/open.php?trackingId=${encodeURIComponent(engagementId)}`;
  }
  return `${appBaseUrl()}/api/track/open/${engagementId}.gif`;
}

function clickTrackingUrl(engagementId: string, url: string) {
  if (trackingEnabled()) {
    return `${trackingBaseUrl()}/click.php?trackingId=${encodeURIComponent(engagementId)}&url=${encodeURIComponent(url)}`;
  }
  return `${appBaseUrl()}/api/track/click/${engagementId}?url=${encodeURIComponent(url)}`;
}

function shouldRewriteUrl(url: string) {
  const value = String(url || "").trim();
  const lower = value.toLowerCase();
  if (!value || lower.startsWith("mailto:") || lower.startsWith("tel:") || lower.startsWith("#")) return false;
  if (lower.includes("unsubscribe")) return false;
  if (trackingBaseUrl() && lower.startsWith(trackingBaseUrl().toLowerCase())) return false;
  if (lower.includes("/click.php") || lower.includes("/api/track/click") || lower.includes("trackingid=")) return false;
  return /^https?:\/\//i.test(value);
}

function sanitizeRedirectUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.toString();
  } catch {
    // fall through
  }
  return appBaseUrl();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

declare global {
  // eslint-disable-next-line no-var
  var trackingGatewayRuntimeDisabled: boolean | undefined;
}
