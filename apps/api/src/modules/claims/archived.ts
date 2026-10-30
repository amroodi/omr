import { ForbiddenException } from '@nestjs/common';

export const ARCHIVED_FA = 'این پرونده پرداخت شده و بایگانی شده است؛ هیچ تغییری در آن ممکن نیست.';

/**
 * A paid case is archived: nobody — بیمه‌گزار, کارگزاری, بیمه‌گر, admins — may change it any more
 * (fields, documents, reviews, letters, actions, originals, amounts, deleting).
 */
export function assertNotPaid(claim: { status: string }) {
  if (claim.status === 'PAID') throw new ForbiddenException({ statusCode: 403, code: 'CASE_ARCHIVED', message: ARCHIVED_FA });
}
