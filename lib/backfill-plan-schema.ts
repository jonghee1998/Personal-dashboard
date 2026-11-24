import {z} from 'zod';
const evidence=z.object({
 source_system:z.literal('samsungcard'),
 account_key:z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/),
 billing_month:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
 amount_basis:z.enum(['statement_billed','purchase_approval']),
 source_record_id_type:z.enum(['provider','fingerprint']),
 source_record_id:z.string().trim().min(1).max(180).optional(),
 source_date:z.string().date(),
 source_merchant:z.string().trim().min(1).max(400),
 source_amount:z.number().int().min(-1e12).max(1e12),
 evidence_sha256:z.string().regex(/^[a-f0-9]{64}$/),
 source_row_ref:z.string().trim().min(1).max(180)
}).strict();
export const backfillPlanSchema=z.object({entries:z.array(z.object({
 external_id:z.string().min(1).max(180),
 classification:z.enum(['exact_unique','ambiguous','unmatched','conflict']),
 reason:z.string().max(500).optional(),evidence:evidence.optional()
}).strict()).min(1).max(5000)}).strict();
