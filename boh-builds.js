const regularId='boh-primary-regular-sandwich';
const spicyId='boh-primary-spicy-sandwich';

export const primarySandwichItems=[
 {id:regularId,category_id:'c2',section:'Make',title:'Regular CFA Sandwich',notes:'',link:'',hidden:false,position:-2},
 {id:spicyId,category_id:'c2',section:'Make',title:'Spicy CFA Sandwich',notes:'',link:'',hidden:false,position:-1}
];

const regularBuild={steps:['Bottom bun','Pickles','Chicken filet','Top bun']};
export function getBohBuild(itemId){return itemId===regularId?regularBuild:null;}

const layers=[
 `<path d="M29 126c2 8 17 13 43 13s40-5 43-13l-1 8c-2 9-19 14-42 14s-40-5-42-14z" fill="#b77432"/>
 <ellipse cx="72" cy="126" rx="43" ry="13" fill="#e4a951"/>
 <ellipse cx="72" cy="124" rx="38" ry="9.5" fill="#f7d787"/>
 <path d="M43 123q27-8 58 0" fill="none" stroke="#fff1be" stroke-width="1.8" stroke-linecap="round"/>`,
 `<g transform="rotate(-8 57 100)"><ellipse cx="57" cy="100" rx="22" ry="8" fill="#597a34"/>
 <ellipse cx="57" cy="98" rx="19" ry="6" fill="#97ae58"/>
 <path d="m51 98 3-1m6 1 3 1" stroke="#d9dfa1" stroke-width="1.7" stroke-linecap="round"/></g>
 <g transform="rotate(11 85 99)"><ellipse cx="85" cy="99" rx="22" ry="8" fill="#476c36"/>
 <ellipse cx="85" cy="97" rx="19" ry="6" fill="#86a351"/>
 <path d="m78 97 4-1m6 2 3-1" stroke="#d9dfa1" stroke-width="1.7" stroke-linecap="round"/></g>`,
 `<path d="M24 75c2-6 7-7 10-10 6-6 13-6 18-12 4-4 9-4 14-5 9-1 15 3 20 5 4 2 10 2 14 6 6 6 16 4 19 12 2 5-5 8-11 9l-70 7c-8 1-16-3-14-12z" fill="#ae601e"/>
 <path d="M25 74c2-5 8-6 11-10 6-5 13-5 18-10 5-4 12-5 16-4 6 1 11 3 16 5 4 1 9 1 13 5 6 6 15 4 18 10 2 4-3 6-10 7l-69 6c-6 1-15-3-13-9z" fill="#cf842b"/>
 <path d="m38 71 6-2m8-6 6-3m8-1 3 2m15 2 4 2m6 5 8 1m-54 5 4-1m18-5 4 2" fill="none" stroke="#edb259" stroke-width="2.5" stroke-linecap="round"/>`,
 `<path d="M28 33C30 16 48 7 72 7s42 9 44 26c1 8-18 12-44 12s-45-4-44-12z" fill="#c38138"/>
 <path d="M29 31C32 16 49 8 72 8s40 8 43 23c0 7-19 10-43 10s-43-3-43-10z" fill="#e8ac5c"/>
 <path d="M45 20q11-8 27-8 15 0 26 7" fill="none" stroke="#f7cc88" stroke-width="3" stroke-linecap="round"/>`
];

export function renderBuildDiagram(itemId,step,animate=false){
 const build=getBohBuild(itemId);
 if(!build)return '';
 const visible=Math.max(0,Math.min(step,build.steps.length));
 return `<svg class="build-diagram" viewBox="0 0 144 156" aria-hidden="true" focusable="false">
   <path d="M72 24v111" fill="none" stroke="#e9e3dc" stroke-width="1.5" stroke-dasharray="3 5"/>
   ${layers.slice(0,visible).map((art,index)=>`<g data-layer="${index+1}"${animate&&index===visible-1?' class="build-layer-enter"':''}>${art}</g>`).join('')}
 </svg>`;
}
