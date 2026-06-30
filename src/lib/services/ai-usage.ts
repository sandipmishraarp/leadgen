import crypto from "crypto";
import type OpenAI from "openai";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type AiFeature =
  | "DRAFT_GENERATION"
  | "FOLLOW_UP_GENERATION"
  | "CLIENT_BRAIN"
  | "QUALIFICATION"
  | "REWRITE_ACTION"
  | "SUBJECT_GENERATION"
  | "CLASSIFICATION"
  | "PROPOSAL"
  | "SRS"
  | "WEBSITE_AUDIT"
  | "KNOWLEDGE_EMBEDDING";

type UsageSettings = {
  dailyTokenLimit: number;
  dailyCostLimit: number;
  perUserDailyTokenLimit?: number | null;
  perFeatureDailyTokenLimit?: Prisma.JsonValue | null;
  perFeatureDailyCostLimit?: Prisma.JsonValue | null;
  smallModel: string;
  mainModel: string;
  bulkDraftsPerHour: number;
};

type AiCallOptions<T> = {
  feature: AiFeature;
  leadId?: string | null;
  userId?: string | null;
  action?: string | null;
  inputForCache?: unknown;
  model: string;
  call: () => Promise<{ response: OpenAI.Responses.Response; parsed: T }>;
};

const DEFAULT_SETTINGS: UsageSettings = {
  dailyTokenLimit: Number(process.env.AI_DAILY_TOKEN_LIMIT || 50000),
  dailyCostLimit: Number(process.env.AI_DAILY_COST_LIMIT || 5),
  perUserDailyTokenLimit: process.env.AI_USER_DAILY_TOKEN_LIMIT ? Number(process.env.AI_USER_DAILY_TOKEN_LIMIT) : null,
  perFeatureDailyTokenLimit: null,
  perFeatureDailyCostLimit: null,
  smallModel: process.env.OPENAI_SMALL_MODEL || "gpt-4.1-mini",
  mainModel: process.env.OPENAI_MODEL || "gpt-5.5",
  bulkDraftsPerHour: Number(process.env.AI_BULK_DRAFTS_PER_HOUR || 10)
};

const COST_PER_1K: Record<string, { input: number; output: number }> = {
  "gpt-4.1-mini": { input: 0.0004, output: 0.0016 },
  "gpt-4.1-nano": { input: 0.0001, output: 0.0004 },
  "gpt-5.5": { input: 0.005, output: 0.015 }
};

export function chooseAiModel(feature: AiFeature, preferred?: string) {
  if (preferred) return preferred;
  if (feature === "KNOWLEDGE_EMBEDDING") return process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
  if (["REWRITE_ACTION", "SUBJECT_GENERATION", "CLASSIFICATION", "QUALIFICATION"].includes(feature)) {
    return process.env.OPENAI_SMALL_MODEL || DEFAULT_SETTINGS.smallModel;
  }
  return process.env.OPENAI_MODEL || DEFAULT_SETTINGS.mainModel;
}

export async function executeAiCall<T>(options: AiCallOptions<T>): Promise<T> {
  const cacheKey = buildCacheKey(options.feature, options.leadId, options.action, options.inputForCache);
  const cached = await getCachedResponse<T>(cacheKey);
  if (cached) {
    await logAiUsage({
      feature: options.feature,
      model: options.model,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCost: 0,
      leadId: options.leadId,
      userId: options.userId,
      cacheKey,
      cacheHit: true
    });
    return cached;
  }

  await assertAiBudgetAvailable(options.feature, options.userId);
  const startedAt = Date.now();
  const { response, parsed } = await options.call();
  const latencyMs = Date.now() - startedAt;
  const usage = extractUsage(response, options.inputForCache, parsed);
  const estimatedCost = estimateCost(options.model, usage.inputTokens, usage.outputTokens);

  await Promise.all([
    logAiUsage({
      feature: options.feature,
      model: options.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      estimatedCost,
      latencyMs,
      leadId: options.leadId,
      userId: options.userId,
      cacheKey,
      cacheHit: false
    }),
    setCachedResponse(cacheKey, {
      feature: options.feature,
      leadId: options.leadId,
      action: options.action,
      model: options.model,
      inputHash: hash(options.inputForCache || {}),
      outputJson: parsed as Prisma.InputJsonValue
    })
  ]);

  return parsed;
}

export async function getAiUsageSummary() {
  const today = startOfToday();
  try {
    const [logs, settings] = await Promise.all([
      prisma.aiUsageLog.findMany({ where: { createdAt: { gte: today } }, orderBy: { createdAt: "desc" } }),
      getAiUsageSettings()
    ]);
    const byFeature = new Map<string, { calls: number; tokens: number; cost: number }>();
    for (const log of logs) {
      const current = byFeature.get(log.feature) || { calls: 0, tokens: 0, cost: 0 };
      current.calls += log.cacheHit ? 0 : 1;
      current.tokens += log.totalTokens;
      current.cost += log.estimatedCost;
      byFeature.set(log.feature, current);
    }
    return {
      settings,
      totalCallsToday: logs.filter((log) => !log.cacheHit).length,
      tokensToday: logs.reduce((sum, log) => sum + log.totalTokens, 0),
      costToday: logs.reduce((sum, log) => sum + log.estimatedCost, 0),
      averageTokensPerRequest: average(logs.filter((log) => !log.cacheHit).map((log) => log.totalTokens)),
      cacheHitsToday: logs.filter((log) => log.cacheHit).length,
      byFeature: Array.from(byFeature.entries()).map(([feature, value]) => ({ feature, ...value })),
      recent: logs.slice(0, 20)
    };
  } catch {
    return {
      settings: DEFAULT_SETTINGS,
      totalCallsToday: 0,
      tokensToday: 0,
      costToday: 0,
      averageTokensPerRequest: 0,
      cacheHitsToday: 0,
      byFeature: [],
      recent: []
    };
  }
}

export async function getAiUsageSettings(): Promise<UsageSettings> {
  try {
    const existing = await prisma.aiUsageSetting.findFirst({ orderBy: { createdAt: "asc" } });
    if (existing) return existing;
    return await prisma.aiUsageSetting.create({
      data: {
        dailyTokenLimit: DEFAULT_SETTINGS.dailyTokenLimit,
        dailyCostLimit: DEFAULT_SETTINGS.dailyCostLimit,
        perUserDailyTokenLimit: DEFAULT_SETTINGS.perUserDailyTokenLimit,
        smallModel: DEFAULT_SETTINGS.smallModel,
        mainModel: DEFAULT_SETTINGS.mainModel,
        bulkDraftsPerHour: DEFAULT_SETTINGS.bulkDraftsPerHour
      }
    });
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function updateAiUsageSettings(input: Partial<UsageSettings>) {
  const existing = await getAiUsageSettings();
  const existingRow = await prisma.aiUsageSetting.findFirst({ orderBy: { createdAt: "asc" } });
  const data = {
    dailyTokenLimit: Number(input.dailyTokenLimit ?? existing.dailyTokenLimit),
    dailyCostLimit: Number(input.dailyCostLimit ?? existing.dailyCostLimit),
    perUserDailyTokenLimit: input.perUserDailyTokenLimit === undefined ? existing.perUserDailyTokenLimit : input.perUserDailyTokenLimit,
    perFeatureDailyTokenLimit: input.perFeatureDailyTokenLimit ?? existing.perFeatureDailyTokenLimit ?? undefined,
    perFeatureDailyCostLimit: input.perFeatureDailyCostLimit ?? existing.perFeatureDailyCostLimit ?? undefined,
    smallModel: input.smallModel || existing.smallModel,
    mainModel: input.mainModel || existing.mainModel,
    bulkDraftsPerHour: Number(input.bulkDraftsPerHour ?? existing.bulkDraftsPerHour)
  };
  return existingRow
    ? prisma.aiUsageSetting.update({ where: { id: existingRow.id }, data })
    : prisma.aiUsageSetting.create({ data });
}

export function compressSalesEmailContext<T extends {
  lead: Record<string, unknown>;
  threadMessages: Array<Record<string, unknown>>;
  knowledgeContext?: string;
  previousApprovedExamples?: Array<Record<string, unknown> | string>;
}>(input: T): T {
  const messages = input.threadMessages || [];
  const inbound = messages.filter((message) => String(message.direction || "").toUpperCase() === "INBOUND").at(-1);
  const outbounds = messages.filter((message) => String(message.direction || "").toUpperCase() === "OUTBOUND").slice(-2);
  const fallbackLatest = inbound || messages.at(-1);
  return {
    ...input,
    lead: compactLead(input.lead),
    threadMessages: [fallbackLatest, ...outbounds].filter((message): message is Record<string, unknown> => Boolean(message)).map(compactMessage),
    knowledgeContext: truncateText(input.knowledgeContext || "", 1200),
    previousApprovedExamples: (input.previousApprovedExamples || []).slice(0, 2).map((example) =>
      typeof example === "string" ? truncateText(example, 900) : compactObject(example, 900)
    )
  };
}

export function truncateText(value: string, max = 1600) {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

export function optimizeAiText(value: string, max = 1600) {
  return truncateText(
    value
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/https?:\/\/\S{80,}/gi, "[long-url]")
      .replace(/\[cid:[^\]]+\]/gi, " ")
      .replace(/On .+ wrote:\s*[\s\S]*$/i, " ")
      .replace(/-{2,}\s*Original Message\s*-{2,}[\s\S]*$/i, " ")
      .replace(/(^|\n)>.*(\n|$)/g, "\n")
      .replace(/\b(?:unsubscribe|tracking pixel|view in browser)\b[\s\S]*$/i, " ")
      .replace(/\n\s*(best regards|regards|thanks|thank you),?[\s\S]{0,500}$/i, "\n")
      .replace(/\s+/g, " ")
      .trim(),
    max
  );
}

function compactLead(lead: Record<string, unknown>) {
  const keys = ["id", "name", "email", "company", "website", "country", "service", "status", "clientEmailConfidence", "summary", "clientBrain", "qualification"];
  return Object.fromEntries(keys.filter((key) => lead[key] !== undefined && lead[key] !== null).map((key) => [key, lead[key]]));
}

function compactMessage(message: Record<string, unknown>) {
  return compactObject(message, 1400);
}

function compactObject(value: Record<string, unknown>, maxText: number) {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      typeof item === "string" ? optimizeAiText(item, maxText) : item
    ])
  );
}

async function assertAiBudgetAvailable(feature: AiFeature, userId?: string | null) {
  const settings = await getAiUsageSettings();
  const today = startOfToday();
  try {
    const logs = await prisma.aiUsageLog.findMany({
      where: { createdAt: { gte: today }, cacheHit: false },
      select: { feature: true, userId: true, totalTokens: true, estimatedCost: true }
    });
    const totalTokens = logs.reduce((sum, log) => sum + log.totalTokens, 0);
    const totalCost = logs.reduce((sum, log) => sum + log.estimatedCost, 0);
    if (settings.dailyTokenLimit > 0 && totalTokens >= settings.dailyTokenLimit) throw new Error("AI daily limit reached.");
    if (settings.dailyCostLimit > 0 && totalCost >= settings.dailyCostLimit) throw new Error("AI daily limit reached.");
    if (userId && settings.perUserDailyTokenLimit) {
      const userTokens = logs.filter((log) => log.userId === userId).reduce((sum, log) => sum + log.totalTokens, 0);
      if (userTokens >= settings.perUserDailyTokenLimit) throw new Error("AI daily limit reached.");
    }
    const featureLimit = getJsonNumber(settings.perFeatureDailyTokenLimit, feature);
    if (featureLimit) {
      const featureTokens = logs.filter((log) => log.feature === feature).reduce((sum, log) => sum + log.totalTokens, 0);
      if (featureTokens >= featureLimit) throw new Error("AI daily limit reached.");
    }
    const featureCostLimit = getJsonNumber(settings.perFeatureDailyCostLimit, feature);
    if (featureCostLimit) {
      const featureCost = logs.filter((log) => log.feature === feature).reduce((sum, log) => sum + log.estimatedCost, 0);
      if (featureCost >= featureCostLimit) throw new Error("AI daily limit reached.");
    }
  } catch (error) {
    if (error instanceof Error && error.message === "AI daily limit reached.") throw error;
  }
}

function getJsonNumber(value: Prisma.JsonValue | null | undefined, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "number" ? raw : null;
}

async function getCachedResponse<T>(cacheKey: string): Promise<T | null> {
  try {
    const cached = await prisma.aiResponseCache.findUnique({ where: { cacheKey } });
    return cached?.outputJson as T | null;
  } catch {
    return null;
  }
}

async function setCachedResponse(cacheKey: string, data: {
  feature: string;
  leadId?: string | null;
  action?: string | null;
  model: string;
  inputHash: string;
  outputJson: Prisma.InputJsonValue;
}) {
  try {
    await prisma.aiResponseCache.upsert({
      where: { cacheKey },
      create: { cacheKey, ...data },
      update: { outputJson: data.outputJson, model: data.model, inputHash: data.inputHash }
    });
  } catch {
    // Cache should never block a valid AI result.
  }
}

async function logAiUsage(input: {
  feature: AiFeature;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  latencyMs?: number;
  leadId?: string | null;
  userId?: string | null;
  cacheKey?: string | null;
  cacheHit?: boolean;
}) {
  try {
    await prisma.aiUsageLog.create({
      data: {
        feature: input.feature,
        model: input.model,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        totalTokens: input.inputTokens + input.outputTokens,
        estimatedCost: input.estimatedCost,
        latencyMs: input.latencyMs ?? null,
        leadId: input.leadId || null,
        userId: input.userId || null,
        cacheKey: input.cacheKey || null,
        cacheHit: Boolean(input.cacheHit)
      }
    });
  } catch {
    // Usage logging should not break drafting if migrations are still being applied.
  }
}

function extractUsage(response: OpenAI.Responses.Response, input: unknown, output: unknown) {
  const usage = (response as unknown as { usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number } }).usage;
  const estimatedInput = estimateTokens(JSON.stringify(input || ""));
  const estimatedOutput = estimateTokens(JSON.stringify(output || ""));
  return {
    inputTokens: usage?.input_tokens ?? estimatedInput,
    outputTokens: usage?.output_tokens ?? estimatedOutput
  };
}

function estimateTokens(value: string) {
  return Math.max(1, Math.ceil(value.length / 4));
}

function estimateCost(model: string, inputTokens: number, outputTokens: number) {
  const rate = COST_PER_1K[model] || COST_PER_1K[DEFAULT_SETTINGS.mainModel];
  return (inputTokens / 1000) * rate.input + (outputTokens / 1000) * rate.output;
}

function buildCacheKey(feature: string, leadId?: string | null, action?: string | null, input?: unknown) {
  return hash({ feature, leadId: leadId || "", action: action || "", input });
}

function hash(value: unknown) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function average(values: number[]) {
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}
