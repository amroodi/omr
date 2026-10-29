/**
 * Repair the names of files uploaded before the upload-name fix: Persian names were saved garbled
 * («Ù…Ø¯Ø§Ø±Ú©.pdf» instead of «مدارک.pdf»). Only the stored name changes — the files themselves were
 * always intact. Idempotent (see uploadName), so it runs on every deploy and touches nothing twice.
 *
 *   npx ts-node prisma/fix-file-names.ts
 */
import { PrismaClient } from '@prisma/client';
import { uploadName } from '../src/common/validation/upload-name';

const prisma = new PrismaClient();
// Names that can need it: some character in the Latin-1 upper half, nothing beyond it.
const SUSPECT = '[\u0080-ÿ]';

async function main(): Promise<void> {
  let docs = 0;
  for (const d of await prisma.$queryRawUnsafe<{ id: string; fileName: string }[]>(`SELECT id, "fileName" FROM "Document" WHERE "fileName" ~ '${SUSPECT}'`)) {
    const fixed = uploadName(d.fileName);
    if (fixed !== d.fileName) { await prisma.document.update({ where: { id: d.id }, data: { fileName: fixed } }); docs++; }
  }
  let letters = 0;
  for (const l of await prisma.$queryRawUnsafe<{ id: string; fileName: string }[]>(`SELECT id, "fileName" FROM "ClaimLetter" WHERE "fileName" ~ '${SUSPECT}'`)) {
    const fixed = uploadName(l.fileName);
    if (fixed !== l.fileName) { await prisma.claimLetter.update({ where: { id: l.id }, data: { fileName: fixed } }); letters++; }
  }
  console.log(`File names repaired: ${docs} document(s), ${letters} letter(s).`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
