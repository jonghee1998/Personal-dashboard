import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProductionRecord,isReportedSyntheticId,isStaleReplay} from '../lib/ingest-integrity.ts';
const now=Date.parse('2026-11-12T11:00:00+09:00');
const meta={environment:'production',is_synthetic:false,source_system:'samsungcard',verification_source:'monimo_session',as_of:'2026-11-12T08:00:00+09:00',verified_at:'2026-11-12T08:05:00+09:00',run_id:'b4df4f59-3c11-4abf-814c-45ec4eb41234',source_record_id:'approval-1234'};
const row={kind:'transaction',external_id:'card-1234',title:'정상 카드 거래',amount:5000,event_date:'2026-11-12',metadata:meta};
const codes=x=>validateProductionRecord(x,now).map(v=>v.code);
test('valid structural provenance passes',()=>assert.deepEqual(codes(row),[]));
test('missing evidence and synthetic flag rejected',()=>{
 assert.ok(codes({...row,metadata:{}}).includes('ENVIRONMENT_REQUIRED'));
 assert.ok(codes({...row,metadata:{...meta,is_synthetic:true}}).includes('SYNTHETIC_OR_UNKNOWN'));
 assert.ok(codes({...row,metadata:{...meta,environment:'demo'}}).includes('ENVIRONMENT_REQUIRED'));
});
test('reported synthetic IDs and explicit demo identifiers rejected',()=>{
 assert.equal(isReportedSyntheticId('benefit-point-sample-telco'),true);
 assert.ok(codes({...row,external_id:'demo-tx-1'}).includes('SYNTHETIC_ID'));
 assert.ok(codes({...row,title:'[가상] 거래'}).includes('SYNTHETIC_LABEL'));
});
test('valid business label containing test is not blindly rejected',()=>assert.deepEqual(codes({...row,title:'테스트 카페'}),[]));
test('point whitelist and zero balance',()=>{
 const point={...row,kind:'benefit',category:'points',external_id:'benefit-point-samsungcard',amount:0,metadata:{...meta,provider:'삼성카드'}};
 assert.deepEqual(codes(point),[]);
 assert.ok(codes({...point,metadata:{...point.metadata,provider:'미연동 포인트'}}).includes('POINT_PROVIDER_NOT_ALLOWED'));
});
test('application requires actual receipt and date',()=>{
 const application={...row,kind:'benefit',category:'application',metadata:{...meta,source_system:'application_receipt',verification_source:'official_receipt',source_record_id:undefined}};
 assert.ok(codes(application).includes('RECEIPT_REQUIRED'));
});
test('news requires a non-placeholder HTTPS source',()=>{
 const news={...row,kind:'news',url:'https://example.com/sample',metadata:{...meta,source_system:'news_rss',verification_source:'official_rss'}};
 assert.ok(codes(news).includes('OFFICIAL_URL_REQUIRED'));
});
test('cleanup needs reason and valid provenance',()=>{
 const deleted={...row,external_id:'benefit-point-sample-telco',kind:'benefit',category:'points',status:'archived',metadata:{...meta,source_system:'user_confirmed',verification_source:'user_confirmed',deletion_reason:'confirmed synthetic cleanup'}};
 assert.deepEqual(codes(deleted),[]);
 assert.ok(codes({...deleted,metadata:{...deleted.metadata,deletion_reason:''}}).includes('DELETION_REASON_REQUIRED'));
});
test('future time and stale replay rejected',()=>{
 assert.ok(codes({...row,metadata:{...meta,verified_at:'2026-11-13T00:00:00+09:00'}}).includes('TIMESTAMP_ORDER'));
 assert.equal(isStaleReplay({...meta,as_of:'2026-11-11T00:00:00+09:00'},meta),true);
});
