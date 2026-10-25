import { h } from 'vue';
const paths={viewport:'M3 5 10 1l7 4v9l-7 4-7-4Z M3 5l7 4 7-4 M10 9v9',objects:'M3 3h3v3H3z M3 13h3v3H3z M12 8h3v3h-3z M4 6v7 M6 4h3v6h3 M6 15h9',properties:'M4 2v16 M10 2v16 M16 2v16 M1 6h6 M7 13h6 M13 8h6',timeline:'M2 4h16 M2 16h16 M5 2v16 M11 6l3 3-3 3-3-3Z'};
export const paneIcon=id=>paths[id]?h('svg',{viewBox:'0 0 20 20',width:16,height:16,fill:'none',stroke:'currentColor','stroke-width':1.4,'aria-hidden':true},[h('path',{d:paths[id]})]):null;
