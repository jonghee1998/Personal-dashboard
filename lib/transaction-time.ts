/** Extract the actual card approval/payment time only. Never derive it from ingestion timestamps. */
type TimeRecord = {event_date?:string|null;metadata?:Record<string,unknown>|null};
const dateTimeKeys=['payment_datetime','payment_date_time','paid_at','approved_at','approval_datetime','transaction_datetime','transaction_date_time','occurred_at','payment_timestamp','transaction_timestamp','transaction_at','approved_datetime','event_datetime','datetime','timestamp'];
const timeKeys=['payment_time','paid_time','approval_time','approved_time','transaction_time','transaction_at_time','card_approval_time','event_time','time','HHMM','hhmm'];
const zonedTime=(value:string)=>{const parsed=new Date(value);if(Number.isNaN(parsed.valueOf()))return null;return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(parsed)};
const parsePaymentTime=(value:unknown):string|null=>{
 if(typeof value!=='string')return null;
 const text=value.trim();
 if(!text)return null;
 // Full timestamps with an explicit UTC offset are converted to Korea time.
 if(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)){
   return zonedTime(text.replace(' ','T'));
 }
 // A local date/time, without timezone information.
 const withDate=text.match(/^\d{4}[-/.]\d{2}[-/.]\d{2}[ T](\d{1,2}):(\d{2})(?::\d{2})?$/);
 const clock=text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
 const compact=text.match(/^(\d{2})(\d{2})(?:\d{2})?$/);
 const hit=withDate??clock??compact;
 if(!hit)return null;
 const hour=Number(hit[1]),minute=Number(hit[2]);
 return hour<24&&minute<60?String(hour).padStart(2,'0')+':'+String(minute).padStart(2,'0'):null;
};
export const paymentTime=(record:TimeRecord):string|null=>{
 const meta=record.metadata??{};
 for(const key of [...dateTimeKeys,...timeKeys]){
   const time=parsePaymentTime(meta[key]);
   if(time)return time;
 }
 // event_date may be an ISO timestamp in older records; plain dates provide no time.
 return parsePaymentTime(record.event_date);
};
export const paymentDateLabel=(record:TimeRecord):string=>{
 const date=record.event_date?.slice(0,10)??'';
 const time=paymentTime(record);
 return [date,time].filter(Boolean).join(' · ')||'날짜 미등록';
};
