import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { routeAiEmbeddings } from "@/lib/services/ai-router";

const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
const MAX_CHARS_PER_CHUNK = 1800;
const MAX_SOURCE_ITEMS = 60;

type SourceChunk = {
  sourceType: string;
  sourceId: string;
  title: string;
  category: string;
  content: string;
  metadata?: Prisma.InputJsonObject;
};

export async function syncVectorKnowledge(apiKey: string) {
  const sourceChunks = await collectSourceChunks();
  const chunksToEmbed: SourceChunk[] = [];

  for (const chunk of sourceChunks) {
    const contentHash = hashContent(chunk.content);
    const existing = await prisma.vectorChunk.findUnique({
      where: {
        sourceType_sourceId_contentHash: {
          sourceType: chunk.sourceType,
          sourceId: chunk.sourceId,
          contentHash
        }
      },
      select: { id: true, isActive: true }
    });
    if (existing?.isActive) continue;
    chunksToEmbed.push(chunk);
  }

  if (chunksToEmbed.length === 0) return { indexed: 0, total: sourceChunks.length };

  const embeddings = await embedTexts(apiKey, chunksToEmbed.map((chunk) => chunk.content));

  for (let index = 0; index < chunksToEmbed.length; index += 1) {
    const chunk = chunksToEmbed[index];
    const embedding = embeddings[index];
    const contentHash = hashContent(chunk.content);

    await prisma.vectorChunk.updateMany({
      where: {
        sourceType: chunk.sourceType,
        sourceId: chunk.sourceId,
        isActive: true
      },
      data: { isActive: false }
    });

    const saved = await prisma.vectorChunk.upsert({
      where: {
        sourceType_sourceId_contentHash: {
          sourceType: chunk.sourceType,
          sourceId: chunk.sourceId,
          contentHash
        }
      },
      create: {
        ...chunk,
        contentHash,
        embedding: embedding as Prisma.InputJsonArray,
        isActive: true
      },
      update: {
        title: chunk.title,
        category: chunk.category,
        content: chunk.content,
        embedding: embedding as Prisma.InputJsonArray,
        metadata: chunk.metadata,
        isActive: true
      }
    });

    await tryUpdatePgVector(saved.id, embedding);
  }

  return { indexed: chunksToEmbed.length, total: sourceChunks.length };
}

export async function retrieveVectorKnowledge(query: string, apiKey: string, take = 5) {
  const chunks = await prisma.vectorChunk.findMany({
    where: { isActive: true },
    orderBy: { updatedAt: "desc" },
    take: 500
  });
  if (chunks.length === 0) return "";

  const [queryEmbedding] = await embedTexts(apiKey, [query]);

  return chunks
    .map((chunk) => ({
      chunk,
      score: cosineSimilarity(queryEmbedding, parseEmbedding(chunk.embedding))
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, take)
    .map(({ chunk, score }, index) =>
      [
        `Context ${index + 1} (${chunk.category}, ${chunk.sourceType}, score ${score.toFixed(3)}):`,
        `Title: ${chunk.title}`,
        chunk.content
      ].join("\n")
    )
    .join("\n\n");
}

async function collectSourceChunks() {
  const [knowledgeBase, aiKnowledgeItems, approvedExamples, sentEmails, outboundEmails] = await Promise.all([
    prisma.knowledgeBase.findMany({
      where: { isActive: true },
      orderBy: { updatedAt: "desc" },
      take: MAX_SOURCE_ITEMS
    }),
    prisma.aiKnowledgeItem.findMany({
      where: { isActive: true },
      orderBy: { updatedAt: "desc" },
      take: MAX_SOURCE_ITEMS
    }),
    prisma.approvedEmailExample.findMany({
      orderBy: { createdAt: "desc" },
      take: MAX_SOURCE_ITEMS
    }),
    prisma.sentEmail.findMany({
      orderBy: { sentAt: "desc" },
      take: MAX_SOURCE_ITEMS,
      include: { thread: { include: { lead: true } } }
    }),
    prisma.email.findMany({
      where: { direction: "OUTBOUND", textBody: { not: null } },
      orderBy: { sentAt: "desc" },
      take: MAX_SOURCE_ITEMS,
      include: { thread: { include: { lead: true } } }
    })
  ]);

  return [
    ...knowledgeBase.flatMap((item) =>
      chunkSource({
        sourceType: "knowledge_base",
        sourceId: item.id,
        title: item.title,
        category: normalizeCategory(item.category),
        content: item.content
      })
    ),
    ...aiKnowledgeItems.flatMap((item) =>
      chunkSource({
        sourceType: "ai_knowledge_item",
        sourceId: item.id,
        title: item.title,
        category: normalizeCategory(item.category),
        content: item.content,
        metadata: { keywords: item.keywords }
      })
    ),
    ...approvedExamples.flatMap((example) =>
      chunkSource({
        sourceType: "approved_example",
        sourceId: example.id,
        title: `${example.emailType} approved email example`,
        category: "approved_examples",
        content: [
          `Email type: ${example.emailType}`,
          example.leadIndustry ? `Lead industry: ${example.leadIndustry}` : "",
          example.clientCountry ? `Client country: ${example.clientCountry}` : "",
          example.editDifference ? `Edit learning: ${example.editDifference}` : "",
          "Final sent email:",
          example.userFinalSentEmail
        ]
          .filter(Boolean)
          .join("\n"),
        metadata: {
          emailType: example.emailType,
          leadIndustry: example.leadIndustry,
          clientCountry: example.clientCountry,
          wasSuccessful: example.wasSuccessful
        }
      })
    ),
    ...sentEmails.flatMap((email) =>
      chunkSource({
        sourceType: "sent_email",
        sourceId: email.id,
        title: email.subject,
        category: "sent_emails",
        content: email.body,
        metadata: {
          leadEmail: email.thread.lead?.email,
          leadCompany: email.thread.lead?.company,
          sentAt: email.sentAt.toISOString()
        }
      })
    ),
    ...outboundEmails.flatMap((email) =>
      chunkSource({
        sourceType: "outbound_email",
        sourceId: email.id,
        title: email.subject,
        category: "sent_emails",
        content: email.textBody || email.snippet || "",
        metadata: {
          leadEmail: email.thread.lead?.email,
          leadCompany: email.thread.lead?.company,
          sentAt: email.sentAt.toISOString()
        }
      })
    )
  ].filter((chunk) => chunk.content.trim().length > 0);
}

function chunkSource(source: SourceChunk) {
  const clean = source.content.replace(/\s+/g, " ").trim();
  if (clean.length <= MAX_CHARS_PER_CHUNK) {
    return [{ ...source, content: clean }];
  }

  const chunks: SourceChunk[] = [];
  for (let start = 0; start < clean.length; start += MAX_CHARS_PER_CHUNK) {
    const content = clean.slice(start, start + MAX_CHARS_PER_CHUNK);
    chunks.push({
      ...source,
      sourceId: `${source.sourceId}:${chunks.length + 1}`,
      title: `${source.title} (${chunks.length + 1})`,
      content
    });
  }
  return chunks;
}

async function embedTexts(apiKey: string, texts: string[]) {
  return routeAiEmbeddings({ apiKey, texts, action: EMBEDDING_MODEL });
}

async function tryUpdatePgVector(id: string, embedding: number[]) {
  const vector = `[${embedding.join(",")}]`;
  try {
    await prisma.$executeRawUnsafe(
      'UPDATE "vector_chunks" SET "embeddingVector" = $1::vector WHERE "id" = $2',
      vector,
      id
    );
  } catch {
    // pgvector is optional for local MVP development; JSON embeddings remain available.
  }
}

function parseEmbedding(value: unknown) {
  return Array.isArray(value) ? value.map(Number) : [];
}

function cosineSimilarity(a: number[], b: number[]) {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function hashContent(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeCategory(category: string) {
  const value = category.toLowerCase();
  if (value.includes("price")) return "pricing";
  if (value.includes("portfolio")) return "portfolio";
  if (value.includes("case")) return "case_studies";
  if (value.includes("service")) return "company_services";
  return value;
}
