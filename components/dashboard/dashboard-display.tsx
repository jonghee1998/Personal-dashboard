export const money=(n:number)=>'₩'+Math.round(n).toLocaleString('ko-KR');
export const amountKnown=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)||typeof value==='string'&&value.trim()!==''&&Number.isFinite(Number(value));
export const card=(title:string,value:string,sub:string,cls='')=><section className={'metric '+cls}><div className="eyebrow">{title}</div><strong>{value}</strong><small>{sub}</small></section>;
