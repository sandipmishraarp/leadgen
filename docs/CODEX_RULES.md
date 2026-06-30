# Codex Rules

## Low Credit Mode

- Work with minimum necessary exploration.
- Prefer surgical fixes over broad changes.
- Avoid long analysis unless explicitly requested.

## Repository Analysis

- Never analyze the full repository unless asked.
- Inspect a maximum of 5 files first.
- Expand file inspection only when required to complete the task safely.

## Prisma And Database

- Never create duplicate Prisma models.
- Always read `schema.prisma` before making Prisma changes.
- Reuse existing tables, fields, relations, and migrations where possible.
- Add new models only when truly required by the task.

## Existing Architecture

- Reuse existing services and APIs.
- Do not replace working logic.
- Do not rewrite modules when a small patch is enough.
- Maintain backward compatibility.

## UI And AI Scope

- No UI redesign unless requested.
- No new AI features unless requested.
- Preserve existing user flows unless the task explicitly changes them.

## Bug Fixes

- For bugs, make the smallest surgical fix only.
- Do not refactor unrelated code.
- Do not change business logic unless required to fix the bug.

## Task Workflow

- For every task, show files to change before implementation.
- Then implement only the requested scope.
- Verify the change with the smallest relevant check.
