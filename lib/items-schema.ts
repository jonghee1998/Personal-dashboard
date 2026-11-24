import {z} from 'zod';

/** PATCH /api/items 본문. 상태 수정은 정산·할 일 체크(pending↔done)만, 옛 형식 {id,status}(action 없음)는 받지 않는다. */
export const itemPatchSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('status'),id:z.string().uuid(),status:z.enum(['pending','done'])}),
 z.object({action:z.literal('memo'),id:z.string().uuid(),memo:z.string().max(400)})
]);
export type ItemPatch=z.infer<typeof itemPatchSchema>;
