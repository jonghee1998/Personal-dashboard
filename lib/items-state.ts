// 화면의 항목 상태 변경(낙관적 갱신·실패 복원·중복 요청 막기) 도우미. next/*·react 를 import 하지 않는다(node 테스트에서 바로 씀).

type StatusRow={id:string;status:string};

/** 실패 복원: id 행이 아직 optimistic 상태일 때만 previous 로 되돌린다. 그사이 다른 상태(예: 삭제로 archived)가 됐거나
 *  행이 없으면 그대로 두고, 다른 행은 건드리지 않는다. 바뀐 것이 없으면 같은 배열을 돌려준다. */
export function revertStatus<T extends StatusRow>(items:T[],id:string,optimistic:string,previous:string):T[]{
 if(!items.some(y=>y.id===id&&y.status===optimistic))return items;
 return items.map(y=>y.id===id&&y.status===optimistic?{...y,status:previous}:y);
}

/** 같은 항목의 상태 변경 요청이 진행 중이면 false(그 클릭은 무시), 아니면 진행 중으로 표시하고 true. */
export function beginStatusChange(inFlight:Set<string>,id:string):boolean{
 if(inFlight.has(id))return false;
 inFlight.add(id);
 return true;
}

/** 요청이 끝나면(성공·실패) 진행 중 표시를 지운다. */
export function endStatusChange(inFlight:Set<string>,id:string):void{
 inFlight.delete(id);
}
