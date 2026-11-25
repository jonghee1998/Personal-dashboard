import type {MemoEditorProps} from './finance-tab';
import type {Item} from './use-dashboard-data';

export default function TransactionMemoEditor({item,editor,label}:{
 item:Item;
 editor:MemoEditorProps;
 label:string;
}){
 const {memoDraft,memoError,savingMemoIds,setMemoDraft,cancelMemo,saveMemo}=editor;
 const saving=savingMemoIds.has(item.id);
 return <div className="dailyMemoEditor">
   <textarea aria-label={label} value={memoDraft} maxLength={400} rows={3}
     placeholder="결제 메모를 입력하세요" onChange={event=>setMemoDraft(event.target.value)}/>
   {memoError&&<p className="dailyMemoError" role="alert">{memoError}</p>}
   <div className="dailyMemoActions">
     <small>{memoDraft.length}/400</small>
     <button type="button" onClick={cancelMemo}>취소</button>
     <button type="button" className="dailyMemoSave" disabled={saving} onClick={()=>void saveMemo(item)}>
       {saving?'저장 중…':'저장'}
     </button>
   </div>
 </div>;
}
