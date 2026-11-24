import type {Dispatch,SetStateAction} from 'react';
import type {Item} from './use-dashboard-data';

type Props={
 items:Item[];
 selectedNewsId:string|null;
 openNewsCategories:string[];
 setOpenNewsCategories:Dispatch<SetStateAction<string[]>>;
 expandedNewsCategory:string|null;
 setExpandedNewsCategory:Dispatch<SetStateAction<string|null>>;
 openNews:(id:string)=>void;
 closeNews:()=>void;
};

export default function NewsTab({
 items,selectedNewsId,openNewsCategories,setOpenNewsCategories,expandedNewsCategory,
 setExpandedNewsCategory,openNews,closeNews
}:Props){
 const allNews=items.filter(x=>x.kind==='news');
 const newsGroups=Object.entries(allNews.reduce<Record<string,Item[]>>((groups,x)=>{
   const category=x.category?.trim()||'기타 뉴스';
   (groups[category]??=[]).push(x);
   return groups;
 },{})).sort((a,b)=>{
   const rank=(category:string)=>{const k=category.toLowerCase().replace(/\s+/g,'');if(/그외|그밖|기타|etc|other/.test(k))return 99;if(k.includes('ai')||k.includes('인공지능')||k.includes('다이제스트'))return 0;if(k.includes('기술')||k.includes('테크')||k.includes('개발')||k.includes('it'))return 1;if(k.includes('경제')||k.includes('금융')||k.includes('시장'))return 2;if(k.includes('산업')||k.includes('기업')||k.includes('비즈니스'))return 3;if(k.includes('국제')||k.includes('해외')||k.includes('세계'))return 4;if(k.includes('정책')||k.includes('사회'))return 5;if(k.includes('생활')||k.includes('문화')||k.includes('건강'))return 6;return 7};
   return rank(a[0])-rank(b[0])||a[0].localeCompare(b[0],'ko');
 })
   .map(([category,articles])=>[category,[...articles].sort((a,b)=>(b.event_date??'').localeCompare(a.event_date??''))] as const);
 const newsCategoryEmoji=(category:string)=>/AI|인공지능|다이제스트/i.test(category)?'✦':/기술|테크|개발|IT/i.test(category)?'⌘':/경제|금융|시장/.test(category)?'↗':/국제|세계/.test(category)?'◎':'▣';
 const selectedNews=allNews.find(x=>x.id===selectedNewsId);
 const getNewsBody=(x:Item)=>typeof x.metadata.full_body==='string'?x.metadata.full_body:(x.description??'기사 본문이 아직 제공되지 않았습니다.');
 return <main>
  {selectedNews?
    <article className="newsDetail">
      <button type="button" className="newsBack" onClick={closeNews} aria-label="뉴스 목록으로 돌아가기">← 뉴스 목록</button>
      <div className="newsDetailCategory">{selectedNews.category??'뉴스'} · {selectedNews.source??'브리핑'}</div>
      <h2 className="newsDetailHeadline">{selectedNews.title}</h2>
      <div className="newsDetailDate">{selectedNews.event_date??''}</div>
      {selectedNews.description&&<p className="newsDetailSummary">{selectedNews.description}</p>}
      <div className="newsDetailBody">{getNewsBody(selectedNews).split(/\n\s*\n/).map((paragraph,i)=><p key={i}>{paragraph}</p>)}</div>
      {selectedNews.url&&<a className="newsOriginal" href={selectedNews.url} target="_blank" rel="noopener noreferrer">원문 기사 보기 ↗</a>}
      <button type="button" className="newsBack newsBackBottom" onClick={closeNews}>← 뉴스 목록으로</button>
    </article>:
    <>
      {newsGroups.map(([category,articles])=><section className={'panel newsCategoryPanel '+(category==='AI 테크 다이제스트'?'digestPanel':'')} key={category}>
        <div className="newsCategoryHeading">
          <button type="button" className="newsCategoryToggle" aria-expanded={openNewsCategories.includes(category)} aria-label={category+' 카테고리 '+(openNewsCategories.includes(category)?'접기':'펼치기')} onClick={()=>setOpenNewsCategories(old=>old.includes(category)?old.filter(name=>name!==category):[...old,category])}>
            <span className="newsCategoryLabel"><span className="newsCategorySymbol">{newsCategoryEmoji(category)}</span><span><strong className="newsCategoryName">{category}</strong><small>{articles.length}개 기사 · 최신순</small></span></span>
            <span className={'newsCategoryChevron '+(!openNewsCategories.includes(category)?'collapsed':'')} aria-hidden="true">⌄</span>
          </button>
          {openNewsCategories.includes(category)&&articles.length>3&&<button type="button" className="newsCategoryMore" onClick={()=>setExpandedNewsCategory(old=>old===category?null:category)}>{expandedNewsCategory===category?'3개만 보기 ↑':'전체 보기 →'}</button>}
        </div>
        {openNewsCategories.includes(category)&&(expandedNewsCategory===category?articles:articles.slice(0,3)).map(x=><button type="button" className="newsListButton" key={x.id} onClick={()=>openNews(x.id)}>
          <span className="newsListText"><small>{x.event_date??'날짜 미등록'} · {x.source??category}</small><strong>{x.title}</strong><span>{x.description??''}</span></span>
          <span className="newsListArrow" aria-hidden="true">›</span>
        </button>)}
      </section>)}
      {!newsGroups.length&&<section className="panel"><p className="empty">뉴스 없음</p></section>}
    </>
  }
</main>;
}
