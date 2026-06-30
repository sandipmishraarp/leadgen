import type { Lead, Email, EmailEngagement } from "@prisma/client";

type LeadWithSignals = Lead & {
  threads?: {
    emails: Email[];
    sentEmails: { engagement?: EmailEngagement | null }[];
  }[];
};

export type LeadIntelligence = {
  detectedCountry: string;
  detectedTimezone: string;
  timezoneConfidence: number;
  timezoneWarning: string | null;
  currentLocalTime: string;
  bestEmailWindow: string;
  sendNowRecommendation: "Send Now" | "Schedule for Morning" | "Schedule for Afternoon" | "Wait Until Next Working Day";
  replyProbability: "High" | "Medium" | "Low";
  suggestedEmailAngle: string;
  businessHoursStatus: string;
  nextBestSendTime: string;
  nextBestSendTimeIso: string;
  confidence: number;
  isBusinessHours: boolean;
};

const COUNTRY_TIMEZONES: Record<string, string> = {
  "united states": "America/New_York",
  usa: "America/New_York",
  us: "America/New_York",
  canada: "America/Toronto",
  "united kingdom": "Europe/London",
  uk: "Europe/London",
  india: "Asia/Kolkata",
  australia: "Australia/Sydney",
  germany: "Europe/Berlin",
  france: "Europe/Paris",
  spain: "Europe/Madrid",
  italy: "Europe/Rome",
  netherlands: "Europe/Amsterdam",
  uae: "Asia/Dubai",
  "united arab emirates": "Asia/Dubai",
  singapore: "Asia/Singapore"
};

const US_AREA_TIMEZONES: Record<string, string> = {
  "212": "America/New_York",
  "315": "America/New_York",
  "347": "America/New_York",
  "646": "America/New_York",
  "718": "America/New_York",
  "917": "America/New_York",
  "305": "America/New_York",
  "786": "America/New_York",
  "312": "America/Chicago",
  "773": "America/Chicago",
  "872": "America/Chicago",
  "214": "America/Chicago",
  "469": "America/Chicago",
  "972": "America/Chicago",
  "303": "America/Denver",
  "720": "America/Denver",
  "602": "America/Phoenix",
  "480": "America/Phoenix",
  "623": "America/Phoenix",
  "213": "America/Los_Angeles",
  "310": "America/Los_Angeles",
  "323": "America/Los_Angeles",
  "408": "America/Los_Angeles",
  "415": "America/Los_Angeles",
  "650": "America/Los_Angeles",
  "818": "America/Los_Angeles",
  "206": "America/Los_Angeles",
  "425": "America/Los_Angeles"
};

export function buildLeadIntelligence(lead: LeadWithSignals, now = new Date()): LeadIntelligence {
  const timezoneResult = detectTimezone(lead);
  const local = getLocalParts(now, timezoneResult.timezone);
  const nextBest = getNextBestSendTime(now, timezoneResult.timezone);
  const isBusinessHours = isWeekday(local.weekday) && local.hour >= 8 && local.hour < 18;
  const recommendation = recommendSend(local);
  const probability = calculateReplyProbability(lead, isBusinessHours);
  const angle = suggestEmailAngle(lead.service);

  return {
    detectedCountry: lead.country || timezoneResult.country || "Unknown",
    detectedTimezone: timezoneResult.timezone,
    timezoneConfidence: timezoneResult.confidence,
    timezoneWarning: timezoneResult.confidence < 80 ? "Timezone estimated from country." : null,
    currentLocalTime: formatLocalTime(now, timezoneResult.timezone),
    bestEmailWindow: "9:00 AM - 11:30 AM and 2:00 PM - 4:30 PM local time",
    sendNowRecommendation: recommendation,
    replyProbability: probability,
    suggestedEmailAngle: angle,
    businessHoursStatus: isBusinessHours ? "Inside business hours" : "Outside business hours",
    nextBestSendTime: formatLocalTime(nextBest, timezoneResult.timezone),
    nextBestSendTimeIso: nextBest.toISOString(),
    confidence: Math.min(95, Math.max(45, timezoneResult.confidence + (lead.website ? 5 : 0) + (lead.service ? 5 : 0))),
    isBusinessHours
  };
}

export function detectTimezone(lead: Pick<Lead, "country" | "phone" | "website" | "company" | "email" | "timezone" | "timezoneConfidence">) {
  if (lead.timezone) {
    return {
      timezone: lead.timezone,
      confidence: lead.timezoneConfidence || 95,
      country: lead.country || null
    };
  }

  const country = (lead.country || "").trim().toLowerCase();
  if (["usa", "us", "united states", "united states of america"].includes(country)) {
    const areaCode = extractUsAreaCode(lead.phone);
    if (areaCode && US_AREA_TIMEZONES[areaCode]) {
      return { timezone: US_AREA_TIMEZONES[areaCode], confidence: 88, country: lead.country || "USA" };
    }
    const westHint = `${lead.website || ""} ${lead.company || ""} ${lead.email}`.toLowerCase();
    if (/(california|san francisco|los angeles|seattle|oregon|washington|\.(ca|us)$)/i.test(westHint)) {
      return { timezone: "America/Los_Angeles", confidence: 68, country: lead.country || "USA" };
    }
    return { timezone: "America/New_York", confidence: 55, country: lead.country || "USA" };
  }

  const timezone = COUNTRY_TIMEZONES[country] || inferTimezoneFromEmailDomain(lead.email) || "UTC";
  return {
    timezone,
    confidence: COUNTRY_TIMEZONES[country] ? 70 : 45,
    country: lead.country || null
  };
}

function recommendSend(local: ReturnType<typeof getLocalParts>): LeadIntelligence["sendNowRecommendation"] {
  if (!isWeekday(local.weekday)) return "Wait Until Next Working Day";
  const minutes = local.hour * 60 + local.minute;
  if (minutes >= 9 * 60 && minutes <= 11 * 60 + 30) return "Send Now";
  if (minutes >= 14 * 60 && minutes <= 16 * 60 + 30) return "Send Now";
  if (minutes < 9 * 60) return "Schedule for Morning";
  if (minutes < 14 * 60) return "Schedule for Afternoon";
  return "Wait Until Next Working Day";
}

function calculateReplyProbability(lead: LeadWithSignals, isBusinessHours: boolean): LeadIntelligence["replyProbability"] {
  let score = 0;
  if (isBusinessHours) score += 2;
  if (lead.lastInboundAt && Date.now() - lead.lastInboundAt.getTime() < 1000 * 60 * 60 * 24 * 7) score += 2;
  if (lead.website) score += 1;
  if (lead.service) score += 1;
  if (lead.company) score += 1;
  const engagement = lead.threads?.flatMap((thread) => thread.sentEmails.map((sent) => sent.engagement)).filter(Boolean) || [];
  if (engagement.some((item) => (item?.openCount || 0) > 0 || (item?.clickedLinks || 0) > 0)) score += 2;
  if (!lead.website) score -= 1;
  if (isGenericEmail(lead.email)) score -= 1;
  if (lead.createdAt && Date.now() - lead.createdAt.getTime() > 1000 * 60 * 60 * 24 * 30) score -= 2;
  if (score >= 5) return "High";
  if (score >= 2) return "Medium";
  return "Low";
}

function suggestEmailAngle(service: string | null) {
  const value = (service || "").toLowerCase();
  if (/(seo|ranking|traffic|google|local search)/.test(value)) return "Focus on Google visibility, ranking, qualified traffic, and local SEO opportunities.";
  if (/(website|web design|redesign|wordpress|shopify|webflow|wix|woocommerce)/.test(value)) return "Focus on redesign, mobile UX, conversion improvements, speed, and a cleaner customer journey.";
  if (/(app|mobile|android|ios|mvp)/.test(value)) return "Focus on MVP clarity, automation, customer experience, and a practical launch path.";
  if (/(ai|automation|agent|chatbot|workflow)/.test(value)) return "Focus on automation, cost saving, workflow improvement, and reducing manual effort.";
  if (/(crm|sales|pipeline|lead management|follow-up)/.test(value)) return "Focus on lead management, follow-up automation, sales tracking, and CRM visibility.";
  return "Use a consultative discovery angle: acknowledge the requirement, ask a few useful questions, and suggest a clear next step.";
}

function getNextBestSendTime(now: Date, timezone: string) {
  const local = getLocalParts(now, timezone);
  const minutes = local.hour * 60 + local.minute;
  let target = minutes < 9 * 60 && isWeekday(local.weekday)
    ? zonedTimeToUtc(now, timezone, 9, 0, 0)
    : minutes < 14 * 60 && isWeekday(local.weekday)
      ? zonedTimeToUtc(now, timezone, 14, 0, 0)
      : zonedTimeToUtc(addLocalDays(now, timezone, 1), timezone, 9, 0, 0);

  while (!isWeekday(getLocalParts(target, timezone).weekday)) {
    target = zonedTimeToUtc(addLocalDays(target, timezone, 1), timezone, 9, 0, 0);
  }
  return target;
}

function getLocalParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return {
    weekday: get("weekday"),
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute"))
  };
}

export function zonedTimeToUtc(base: Date, timezone: string, hour: number, minute: number, second: number) {
  const local = getLocalParts(base, timezone);
  const utcGuess = new Date(Date.UTC(local.year, local.month - 1, local.day, hour, minute, second));
  const actual = getLocalParts(utcGuess, timezone);
  const desiredLocal = Date.UTC(local.year, local.month - 1, local.day, hour, minute, second);
  const actualLocal = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, second);
  return new Date(utcGuess.getTime() - (actualLocal - desiredLocal));
}

export function localDateTimeToUtc(value: string, timezone: string) {
  const [datePart, timePart] = value.split("T");
  if (!datePart || !timePart) throw new Error("Custom schedule time must be a local date and time.");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  if (!year || !month || !day || Number.isNaN(hour) || Number.isNaN(minute)) {
    throw new Error("Custom schedule time is invalid.");
  }
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const actual = getLocalParts(utcGuess, timezone);
  const desiredLocal = Date.UTC(year, month - 1, day, hour, minute, 0);
  const actualLocal = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, 0);
  return new Date(utcGuess.getTime() - (actualLocal - desiredLocal));
}

function addLocalDays(date: Date, timezone: string, days: number) {
  const local = getLocalParts(date, timezone);
  return new Date(Date.UTC(local.year, local.month - 1, local.day + days, local.hour, local.minute));
}

export function formatLocalTime(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short"
  }).format(date);
}

function isWeekday(weekday: string) {
  return weekday !== "Sat" && weekday !== "Sun";
}

function extractUsAreaCode(phone: string | null) {
  const digits = (phone || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1, 4);
  if (digits.length >= 10) return digits.slice(0, 3);
  return null;
}

function inferTimezoneFromEmailDomain(email: string) {
  const tld = email.split(".").pop()?.toLowerCase();
  if (tld === "uk") return "Europe/London";
  if (tld === "in") return "Asia/Kolkata";
  if (tld === "au") return "Australia/Sydney";
  if (tld === "de") return "Europe/Berlin";
  if (tld === "fr") return "Europe/Paris";
  if (tld === "sg") return "Asia/Singapore";
  return null;
}

function isGenericEmail(email: string) {
  return /^(info|hello|sales|contact|admin|support)@/i.test(email);
}
