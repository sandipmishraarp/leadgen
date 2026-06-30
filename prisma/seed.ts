import { PrismaClient } from "@prisma/client";
import { encryptSecret, hashPassword } from "../src/lib/crypto";

const prisma = new PrismaClient();

async function main() {
  const email = (process.env.ADMIN_EMAIL || "admin@aresourcepool.com").toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "ChangeMe123!";

  await prisma.user.upsert({
    where: { email },
    create: {
      name: "AResourcePool Admin",
      email,
      passwordHash: hashPassword(password),
      role: "ADMIN"
    },
    update: {}
  });

  await prisma.aiPrompt.upsert({
    where: {
      name_version: {
        name: "sales_reply",
        version: "phase1-context-v2"
      }
    },
    create: {
      name: "sales_reply",
      version: "phase1-context-v2",
      systemText:
        "Draft approval-only AResourcePool sales replies and follow-ups using system instructions, knowledge base context, previous sent examples, lead-specific thread context, and user edit learnings. Never auto-send.",
      userText:
        "Use the retrieved context to write a short-to-medium email from Abhay Kumar, Sales & Marketing Director, AResourcePool. Keep the tone polite, professional, consultative, non-pushy, and include a clear next step."
    },
    update: {}
  });

  const knowledgeItems = [
    {
      title: "AResourcePool service portfolio",
      category: "services",
      keywords: ["website", "app", "ai", "crm", "automation", "seo", "software"],
      content:
        "AResourcePool helps clients with website design and redesign, web application development, mobile apps, AI automation, CRM implementation/customization, SEO, digital marketing support, API integrations, dashboards, and custom software development."
    },
    {
      title: "Sales tone and sender identity",
      category: "tone",
      keywords: ["tone", "abhay", "sales", "professional"],
      content:
        "Write as Abhay Kumar, Sales & Marketing Director at AResourcePool. Tone should be polite, professional, consultative, concise, helpful, and not pushy. Avoid exaggerated claims. Use clear next steps such as a quick call, sharing requirements, or confirming scope."
    },
    {
      title: "Pricing guardrails",
      category: "pricing",
      keywords: ["price", "cost", "budget", "quote", "proposal"],
      content:
        "Do not invent exact pricing unless the email thread already contains it. If asked for price, explain that cost depends on scope, features, design complexity, integrations, timeline, and content readiness. Offer to review requirements and share a tailored estimate."
    },
    {
      title: "Discovery questions",
      category: "sales_process",
      keywords: ["requirements", "scope", "meeting", "call"],
      content:
        "Useful discovery questions: current website/app URL, target audience, required features, preferred timeline, budget range, examples they like, integrations needed, content readiness, SEO/marketing goals, and decision-making process. Ask only the most relevant 1-3 questions."
    },
    {
      title: "Follow-up rules",
      category: "followup",
      keywords: ["follow-up", "no reply", "waiting", "reminder"],
      content:
        "Follow-ups should be short and respectful. Reference the prior message briefly, add a helpful reason to reconnect, avoid guilt or pressure, and include one easy next step. Do not resend the same email. Final follow-up should politely keep the door open."
    }
  ];

  for (const item of knowledgeItems) {
    await prisma.aiKnowledgeItem.upsert({
      where: { id: item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-") },
      create: {
        id: item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        ...item
      },
      update: item
    });
  }

  const knowledgeBaseItems = [
    {
      id: "kb-company-services",
      title: "AResourcePool company services",
      category: "company_services",
      content:
        "AResourcePool provides website design/redesign, WordPress, Shopify, WooCommerce, Webflow, Wix, custom software development, mobile app development, AI agents and automation, CRM development and integration, SEO and digital marketing, AWS, DevOps, backend/API development, UI/UX design, QA, and maintenance."
    },
    {
      id: "kb-pricing-guidance",
      title: "AResourcePool pricing guidance",
      category: "pricing",
      content:
        "Simple website refresh: $500-$900. Professional website redesign: $1,000-$1,800. Growth website package: $1,800-$2,800. Mobile app MVP: $2,500-$5,000. Full mobile app: $5,000-$8,000+. AI automation/agent MVP: $3,000-$8,000+. Hourly references: Frontend $12/hr, Android $12/hr, iOS $14/hr, Backend/AWS $18/hr. Use ranges, not fixed promises, unless requirements are clear."
    },
    {
      id: "kb-portfolio-capabilities",
      title: "Portfolio capability summary",
      category: "portfolio",
      content:
        "Use portfolio references broadly unless a specific approved case study is available. Relevant capability areas include lead-generation websites, ecommerce stores, booking workflows, dashboards, CRM integrations, AI assistant prototypes, marketing automation, SEO improvements, custom APIs, and maintenance retainers."
    },
    {
      id: "kb-case-study-patterns",
      title: "Case study response patterns",
      category: "case_studies",
      content:
        "When a client asks for examples or proof, briefly mention similar work by category, explain the outcome in plain language, and offer to share relevant examples or arrange a short walkthrough. Do not invent client names, exact metrics, or confidential details."
    }
  ];

  for (const item of knowledgeBaseItems) {
    await prisma.knowledgeBase.upsert({
      where: { id: item.id },
      create: item,
      update: {
        title: item.title,
        category: item.category,
        content: item.content,
        isActive: true
      }
    });
  }

  if (
    process.env.IMAP_HOST &&
    process.env.IMAP_USER &&
    process.env.IMAP_PASSWORD &&
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASSWORD
  ) {
    await prisma.emailAccount.upsert({
      where: { emailAddress: process.env.IMAP_USER },
      create: {
        emailAddress: process.env.IMAP_USER,
        accountType: "SALES_SENDER",
        imapHost: process.env.IMAP_HOST,
        imapPort: Number(process.env.IMAP_PORT || 993),
        imapUser: process.env.IMAP_USER,
        imapPasswordEncrypted: encryptSecret(process.env.IMAP_PASSWORD),
        smtpHost: process.env.SMTP_HOST,
        smtpPort: Number(process.env.SMTP_PORT || 465),
        smtpUser: process.env.SMTP_USER,
        smtpPasswordEncrypted: encryptSecret(process.env.SMTP_PASSWORD)
      },
      update: {
        imapHost: process.env.IMAP_HOST,
        imapPort: Number(process.env.IMAP_PORT || 993),
        imapUser: process.env.IMAP_USER,
        imapPasswordEncrypted: encryptSecret(process.env.IMAP_PASSWORD),
        smtpHost: process.env.SMTP_HOST,
        smtpPort: Number(process.env.SMTP_PORT || 465),
        smtpUser: process.env.SMTP_USER,
        smtpPasswordEncrypted: encryptSecret(process.env.SMTP_PASSWORD),
        accountType: "SALES_SENDER",
        isActive: true
      }
    });
  }

  console.log(`Seeded admin user: ${email}`);
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
