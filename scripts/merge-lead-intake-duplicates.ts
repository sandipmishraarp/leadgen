import { prisma } from "../src/lib/prisma";
import { mergeDuplicateLeadIntakes } from "../src/lib/services/lead-intake-grouping";

async function main() {
  const apply = process.argv.includes("--apply");
  const merged = await mergeDuplicateLeadIntakes(prisma, !apply);
  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    groups: merged.length,
    merged
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
