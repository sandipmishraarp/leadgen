import assert from "node:assert/strict";
import test from "node:test";
import { parseLeadIntakeEmail } from "./lead-parser";
import { getLeadIntakeConversationKey, normalizeLeadIntakeSubject } from "./lead-intake-grouping";

test("extracts Paul Smith from structured client email field", () => {
  const parsed = parseLeadIntakeEmail({
    fromEmail: "leads@example-provider.com",
    text: `
Provider: Web Lead Hub
Name: Paul Smith
Client Email:- paul.smith@example.com
Website: https://paulsmithdesign.com
Phone: +1 555 100 2000
Country: United States
Service: Website redesign
To: lead@aresourcepool.com
`
  });

  assert.equal(parsed.clientEmail, "paul.smith@example.com");
  assert.equal(parsed.name, "Paul Smith");
  assert.equal(parsed.website, "https://paulsmithdesign.com");
  assert.equal(parsed.service, "Website redesign");
  assert.ok(parsed.confidence >= 90);
  assert.ok(parsed.rejectedEmails.includes("lead@aresourcepool.com"));
});

test("extracts Kings Service Tours forwarded sender and ignores provider/internal emails", () => {
  const parsed = parseLeadIntakeEmail({
    fromEmail: "notifications@leadgenmarket.com",
    text: `
Forwarded by: notifications@leadgenmarket.com
To: lead@aresourcepool.com
Cc: abhay@aresourcepool.com

---------- Forwarded message ---------
From: Kings Service Tours <info@kingsservicetours.co.uk>
Subject: Need SEO and booking website help

We need help improving our travel website and SEO.
`
  });

  assert.equal(parsed.clientEmail, "info@kingsservicetours.co.uk");
  assert.equal(parsed.name, "Kings Service Tours");
  assert.ok(parsed.confidence >= 80);
  assert.ok(parsed.rejectedEmails.includes("notifications@leadgenmarket.com"));
  assert.ok(parsed.rejectedEmails.includes("lead@aresourcepool.com"));
  assert.ok(parsed.rejectedEmails.includes("abhay@aresourcepool.com"));
});

test("cleans mailto suffix and parses provider fields with dash or equals separators", () => {
  const parsed = parseLeadIntakeEmail({
    fromEmail: "provider@example.com",
    text: `
Sr No- 404
Client Name- Will Walsh
Email- terryrust74@yahoo.ca [mailto]
Website= https://walshroofing.example
Country- Canada
Service- Mobile Apps
Company: Walsh Roofing

---------- Forwarded message ---------
From: Will Walsh <terryrust74@yahoo.ca>
Subject: Roofing app design

I need an app for roofing jobs and customer updates.
`
  });

  assert.equal(parsed.clientEmail, "terryrust74@yahoo.ca");
  assert.equal(parsed.name, "Will Walsh");
  assert.equal(parsed.website, "https://walshroofing.example");
  assert.equal(parsed.country, "Canada");
  assert.equal(parsed.service, "Mobile Apps");
  assert.equal(parsed.company, "Walsh Roofing");
});

test("groups repeated Re/FW subject variants into one lead intake conversation key", () => {
  assert.equal(normalizeLeadIntakeSubject("Re: FW: @**1st PAGE ON..."), normalizeLeadIntakeSubject("@**1st PAGE ON..."));
  assert.equal(
    getLeadIntakeConversationKey({
      id: "a",
      extractedClientEmail: "PaulSmith5P4M@gmail.com [mailto]",
      subject: "Re: FW: @**1st PAGE ON..."
    }),
    getLeadIntakeConversationKey({
      id: "b",
      extractedClientEmail: "mailto:paulsmith5p4m@gmail.com",
      subject: "@**1st PAGE ON..."
    })
  );
});

test("detects reviewer not approved comments as Sandip acceptance review", () => {
  const parsed = parseLeadIntakeEmail({
    fromEmail: "provider@example.com",
    text: `
Not approved.

---------- Forwarded message ---------
From: Paul Smith <paulsmith5p4m@gmail.com>
Subject: @**1st PAGE ON...

How much?
`
  });

  assert.equal(parsed.clientEmail, "paulsmith5p4m@gmail.com");
  assert.equal(parsed.reviewerDecision?.approvalStatus, "not_approved_by_reviewer");
  assert.equal(parsed.reviewerDecision?.sandipReviewRequired, true);
  assert.equal(parsed.reviewerDecision?.sandipDecisionStatus, "pending");
});

test("uses first valid forwarded client in a multi-email chain", () => {
  const parsed = parseLeadIntakeEmail({
    fromEmail: "lead@aresourcepool.com",
    text: `
From: AResourcePool Leads <lead@aresourcepool.com>
To: sandip@aresourcepool.com

From: Maria Garcia <maria@client-company.es>
To: marketplace@provider.com

Please quote for a CRM automation project.
`
  });

  assert.equal(parsed.clientEmail, "maria@client-company.es");
  assert.equal(parsed.name, "Maria Garcia");
  assert.ok(parsed.rejectedEmails.includes("lead@aresourcepool.com"));
  assert.ok(parsed.rejectedEmails.includes("sandip@aresourcepool.com"));
});

test("rejects internal and no-reply emails", () => {
  const parsed = parseLeadIntakeEmail({
    fromEmail: "no-reply@leadplatform.com",
    text: `
Email: abhay@aresourcepool.com
From: no-reply@leadplatform.com
To: lead@aresourcepool.com
Cc: sandip@aresourcepool.com
`
  });

  assert.equal(parsed.clientEmail, null);
  assert.equal(parsed.confidence, 0);
  assert.ok(parsed.rejectedEmails.includes("abhay@aresourcepool.com"));
  assert.ok(parsed.rejectedEmails.includes("no-reply@leadplatform.com"));
});

test("marks fallback extraction as low confidence", () => {
  const parsed = parseLeadIntakeEmail({
    fromEmail: "provider@example.com",
    text: `
New project inquiry.
Reach Jane at jane@startup.io about a mobile app MVP.
`
  });

  assert.equal(parsed.clientEmail, "jane@startup.io");
  assert.ok(parsed.confidence < 80);
});

test("detects Paul Smith pricing intent from forwarded conversation", () => {
  const parsed = parseLeadIntakeEmail({
    fromEmail: "provider@example.com",
    text: `
---------- Forwarded message ---------
From: Paul Smith <paul@example.com>
Subject: SEO cost

How much?

From: Provider Rep <rep@provider.com>

Your email said you would provide the cost so I am asking how much that cost is?
`
  });

  assert.equal(parsed.clientEmail, "paul@example.com");
  assert.equal(parsed.detectedIntent, "ASKED_PRICING");
  assert.match(parsed.latestClientMessage || "", /How much/i);
  assert.ok(parsed.requestedItems.includes("Package options / pricing"));
});

test("detects Bill Patterson portfolio mockup and timeline requests", () => {
  const parsed = parseLeadIntakeEmail({
    fromEmail: "provider@example.com",
    text: `
Begin forwarded message:
From: Bill Patterson <bill@example.com>
Subject: Website redesign options

Yes, I’d be open to reviewing what your team can do.
Please send your company website, portfolio examples, typical package options,
a sample improvement or mockup, and a general timeline.
`
  });

  assert.equal(parsed.clientEmail, "bill@example.com");
  assert.equal(parsed.detectedIntent, "REQUESTED_PORTFOLIO");
  assert.ok(parsed.requestedItems.includes("Company website"));
  assert.ok(parsed.requestedItems.includes("Portfolio examples"));
  assert.ok(parsed.requestedItems.includes("Package options / pricing"));
  assert.ok(parsed.requestedItems.includes("Sample improvement/mockup"));
  assert.ok(parsed.requestedItems.includes("General timeline"));
});
