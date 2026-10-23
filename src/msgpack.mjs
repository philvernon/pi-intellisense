/** Minimal MessagePack codec for the Neovim RPC values this extension uses. */
export function encode(value) {
  if(value===null||value===undefined)return Buffer.from([0xc0]);
  if(value===false)return Buffer.from([0xc2]);
  if(value===true)return Buffer.from([0xc3]);
  if(Number.isSafeInteger(value)){
    if(value>=0&&value<128)return Buffer.from([value]);
    if(value>=-32&&value<0)return Buffer.from([0x100+value]);
    if(value>=0&&value<256)return Buffer.from([0xcc,value]);
    if(value>=-128&&value<128)return Buffer.from([0xd0,value&255]);
    if(value>=0&&value<65536){const b=Buffer.alloc(3);b[0]=0xcd;b.writeUInt16BE(value,1);return b;}
    if(value>=-32768&&value<32768){const b=Buffer.alloc(3);b[0]=0xd1;b.writeInt16BE(value,1);return b;}
    if(value>=0&&value<=0xffffffff){const b=Buffer.alloc(5);b[0]=0xce;b.writeUInt32BE(value,1);return b;}
    const b=Buffer.alloc(9);b[0]=0xd3;b.writeBigInt64BE(BigInt(value),1);return b;
  }
  if(typeof value==="string"){
    const bytes=Buffer.from(value,"utf8"),len=bytes.length;
    if(len<32)return Buffer.concat([Buffer.from([0xa0|len]),bytes]);
    if(len<256)return Buffer.concat([Buffer.from([0xd9,len]),bytes]);
    if(len<65536){const head=Buffer.alloc(3);head[0]=0xda;head.writeUInt16BE(len,1);return Buffer.concat([head,bytes]);}
    const head=Buffer.alloc(5);head[0]=0xdb;head.writeUInt32BE(len,1);return Buffer.concat([head,bytes]);
  }
  if(Array.isArray(value)){
    const len=value.length;
    const h=len<16?Buffer.from([0x90|len]):Buffer.alloc(len<65536?3:5);
    if(len>=16){h[0]=len<65536?0xdc:0xdd;len<65536?h.writeUInt16BE(len,1):h.writeUInt32BE(len,1);}
    return Buffer.concat([h,...value.map(encode)]);
  }
  if(typeof value==="object"){
    const pairs=Object.entries(value),len=pairs.length;
    const h=len<16?Buffer.from([0x80|len]):Buffer.alloc(len<65536?3:5);
    if(len>=16){h[0]=len<65536?0xde:0xdf;len<65536?h.writeUInt16BE(len,1):h.writeUInt32BE(len,1);}
    return Buffer.concat([h,...pairs.flatMap(([k,v])=>[encode(k),encode(v)])]);
  }
  throw new TypeError("Cannot MessagePack encode "+typeof value);
}
export function decode(buffer,offset=0){
  let i=offset;
  const take=n=>{if(i+n>buffer.length)throw new RangeError("incomplete MessagePack");const s=i;i+=n;return s;};
  const head=buffer[take(1)];
  function readN(n){const s=take(n);return buffer.subarray(s,s+n).toString("utf8");}
  function readArray(n){const arr=[];for(let j=0;j<n;j++){const part=decode(buffer,i);i=part.offset;arr.push(part.value);}return arr;}
  function readMap(n){const obj={};for(let j=0;j<n;j++){const k=decode(buffer,i);i=k.offset;const v=decode(buffer,i);i=v.offset;obj[String(k.value)]=v.value;}return obj;}
  let value;
  if(head<=0x7f)value=head;
  else if(head>=0xe0)value=head-256;
  else if((head&0xe0)===0xa0)value=readN(head&31);
  else if((head&0xf0)===0x90)value=readArray(head&15);
  else if((head&0xf0)===0x80)value=readMap(head&15);
  else switch(head){
    case 0xc0:value=null;break;
    case 0xc2:value=false;break;
    case 0xc3:value=true;break;
    case 0xcc:value=buffer.readUInt8(take(1));break;
    case 0xcd:value=buffer.readUInt16BE(take(2));break;
    case 0xce:value=buffer.readUInt32BE(take(4));break;
    case 0xcf:{const num=buffer.readBigUInt64BE(take(8));value=Number(num);break;}
    case 0xd0:value=buffer.readInt8(take(1));break;
    case 0xd1:value=buffer.readInt16BE(take(2));break;
    case 0xd2:value=buffer.readInt32BE(take(4));break;
    case 0xd3:value=Number(buffer.readBigInt64BE(take(8)));break;
    case 0xca:value=buffer.readFloatBE(take(4));break;
    case 0xcb:value=buffer.readDoubleBE(take(8));break;
    case 0xd9:value=readN(buffer.readUInt8(take(1)));break;
    case 0xda:value=readN(buffer.readUInt16BE(take(2)));break;
    case 0xdb:value=readN(buffer.readUInt32BE(take(4)));break;
    case 0xdc:value=readArray(buffer.readUInt16BE(take(2)));break;
    case 0xdd:value=readArray(buffer.readUInt32BE(take(4)));break;
    case 0xde:value=readMap(buffer.readUInt16BE(take(2)));break;
    case 0xdf:value=readMap(buffer.readUInt32BE(take(4)));break;
    case 0xc4:{const n=buffer.readUInt8(take(1));const s=take(n);value=buffer.subarray(s,s+n);break;}
    case 0xc5:{const n=buffer.readUInt16BE(take(2));const s=take(n);value=buffer.subarray(s,s+n);break;}
    case 0xc6:{const n=buffer.readUInt32BE(take(4));const s=take(n);value=buffer.subarray(s,s+n);break;}
    case 0xc7:case 0xc8:case 0xc9:case 0xd4:case 0xd5:case 0xd6:case 0xd7:case 0xd8:
      throw new Error("Unsupported MessagePack extension type");
    default:throw new Error("Unsupported MessagePack code "+head.toString(16));
  }
  return {value,offset:i};
}
