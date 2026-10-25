const units={m:1,cm:0.01,mm:0.001,um:1e-6,km:1000,mi:1609.344,ft:0.3048,in:0.0254,thou:0.0000254,deg:Math.PI/180,rad:1};
const functions={sin:Math.sin,cos:Math.cos,tan:Math.tan,sqrt:Math.sqrt,abs:Math.abs,floor:Math.floor,ceil:Math.ceil,round:Math.round};
// implicit: factor for numbers typed without a unit (default: degrees for angles, 1 otherwise).
export function parseNumber(text,unit,{implicit=unit==='angle'?Math.PI/180:1}={}){
  const tokens=String(text).trim().replaceAll('°','deg').replaceAll('µ','u').match(/(?:\d*\.?\d+(?:e[+-]?\d+)?)|[a-z]+|\*\*|[+\-*/%()]/gi)||[];
  if(tokens.join('').toLowerCase()!==String(text).replaceAll('°','deg').replaceAll('µ','u').replace(/\s/g,'').toLowerCase())throw Error('Use a number, unit, or arithmetic expression.');
  let index=0,explicitUnit=false;
  const primary=()=>{
    let value,token=tokens[index++];
    if(token==='+'||token==='-')return (token==='-'?-1:1)*primary();
    if(token==='('){value=sum();if(tokens[index++]!==')')throw Error('Missing closing parenthesis');}
    else if(token in functions){if(tokens[index++]!=='(')throw Error('Function needs parentheses');value=functions[token](sum());if(tokens[index++]!==')')throw Error('Missing closing parenthesis');}
    else if(token==='pi')value=Math.PI;else if(token==='e')value=Math.E;else{value=Number(token);if(token===undefined||!Number.isFinite(value))throw Error('Invalid numeric expression');}
    if(tokens[index] in units){explicitUnit=true;value*=units[tokens[index++]];}
    return value;
  };
  const power=()=>{const value=primary();return tokens[index]==='**'?(index++,value**power()):value;};
  const product=()=>{let value=power();while(['*','/','%'].includes(tokens[index])){const operator=tokens[index++],next=power();value=operator==='*'?value*next:operator==='/'?value/next:value%next;}return value;};
  const sum=()=>{let value=product();while(['+','-'].includes(tokens[index])||(explicitUnit&&/^[\d.]/.test(tokens[index]??''))){const operator=/^[\d.]/.test(tokens[index])?'+':tokens[index++],next=product();value+=operator==='+'?next:-next;}return value;};
  let value=sum();if(index!==tokens.length||!Number.isFinite(value))throw Error('Invalid numeric expression');if(!explicitUnit)value*=implicit;return value;
}
