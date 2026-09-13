// AUDIT ONLY. Local Anvil, unlocked throwaway accounts; refuses any other chain.
// Run from repository root after forge build audit/2026-09-13/References.sol.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {JsonRpcProvider, ContractFactory, keccak256, toUtf8Bytes} from 'ethers';
const provider = new JsonRpcProvider('http://127.0.0.1:18547', 31337, {staticNetwork:true, cacheTimeout:-1});
provider.pollingInterval = 10;
assert.equal(await provider.send('eth_chainId', []), '0x7a69');
const signer = await provider.getSigner(0), owner = await signer.getAddress();
const artifact = (file, name) => JSON.parse(fs.readFileSync(`out/${file}/${name}.json`));
async function deploy(file, name) { const a=artifact(file,name); const c=await new ContractFactory(a.abi,a.bytecode.object,signer).deploy({gasLimit:90000000}); await c.waitForDeployment(); return c; }
async function tx(p) { return await (await p).wait(); }
const bulk=await deploy('BulkSend.sol','BulkSend'), ref=await deploy('References.sol','FloorReference');
const e=await deploy('RealTokens.sol','OZ20'), nft=await deploy('RealTokens.sol','OZ721'), m=await deploy('RealTokens.sol','OZ1155'), lazy=await deploy('RealTokens.sol','A721');
await tx(e.mint(owner,10n**25n)); await tx(nft.mintMany(owner,1,901,{gasLimit:90000000})); await tx(lazy.mint(owner,901));
// 16 mixed IDs establish cold-key cost without 300 redundant setup transactions.
for(let id=1;id<=16;id++) await tx(m.mint(owner,id,1000000));
for(const router of [bulk,ref]) { await tx(e.approve(router.target,10n**24n)); for(const t of [nft,m,lazy]) await tx(t.setApprovalForAll(router.target,true)); }
const rows=[], singles=[];
let snapshot=await provider.send('evm_snapshot',[]);
async function reset() { assert(await provider.send('evm_revert',[snapshot])); snapshot=await provider.send('evm_snapshot',[]); }
const recipients=Array.from({length:300},(_,i)=>'0x'+keccak256(toUtf8Bytes(`audit-recipient-${i}`)).slice(-40));
function intrinsic(data) { return 21000 + [...Buffer.from(data.slice(2),'hex')].reduce((n,b)=>n+(b?16:4),0); }
async function measure(shape,n,variant,c,fn,args,validate,trace=false) {
 await reset();
 const data=c.interface.encodeFunctionData(fn,args);
 const r=await tx(signer.sendTransaction({to:c.target,data,gasLimit:90000000}));
 assert.equal(r.status,1); await validate();
 const row={shape,n,variant,gas:Number(r.gasUsed),perRecipient:Number(r.gasUsed)/n,bytes:(data.length-2)/2,intrinsic:intrinsic(data)};
 if(trace) {
  const t=await provider.send('debug_traceTransaction',[r.hash,{disableMemory:true,disableStack:true,disableStorage:true}]);
  // Fixtures at depth 2 do not call other contracts for EOA distributions.
  // Includes classification probes; excludes router CALL cost, counted as router overhead.
  assert(t.structLogs.length > 0, 'Start Anvil with --steps-tracing');
  assert(t.structLogs.some(s=>s.depth===2));
  assert(!t.structLogs.some(s=>s.depth>2));
  row.tokenExecution=t.structLogs.filter(s=>s.depth===2).reduce((a,s)=>a+Number(s.gasCost),0);
  row.routerExecution=row.gas-row.intrinsic-row.tokenExecution;
 }
 rows.push(row);
}
for(const shape of ['A','B','C','D','E','F']) {
 for(const n of [1,10,50,100,300]) {
  const to=recipients.slice(0,n), ids=to.map((_,i)=>shape==='D'?i*3+1:shape==='F'?i%16+1:shape==='E'?1:i+1);
  const amounts=to.map((_,i)=>shape==='A'?(BigInt(i)+1n)*10n**18n:shape==='B'?10n**18n:shape==='F'?BigInt(i%7+1):2n);
  let token, prod, prodArgs, minimal, minArgs, fast, fastArgs;
  if(shape==='A'||shape==='B') {token=e;prod='airdrop20';prodArgs=[token.target,to,amounts];minimal='ref20';minArgs=[...prodArgs];if(shape==='B'){fast='equal20';fastArgs=[token.target,to,amounts[0]];}}
  else if(shape==='C'||shape==='D'){token=nft;prod='airdrop721';prodArgs=[token.target,to,ids,true];minimal='ref721';minArgs=[...prodArgs];if(shape==='C'){fast='sequential721';fastArgs=[token.target,to,1,true];}}
  else {token=m;prod='airdrop1155';prodArgs=[token.target,to,ids,amounts];minimal='ref1155';minArgs=[...prodArgs];if(shape==='E'){fast='equal1155';fastArgs=[token.target,to,1,amounts[0]];}}
  const validate=async()=>{ for(let i=0;i<n;i++) {
   if(token===e) assert.equal(await e.balanceOf(to[i]),amounts[i]);
   else if(token===nft) assert.equal((await nft.ownerOf(ids[i])).toLowerCase(),to[i]);
   else assert.equal(await m.balanceOf(to[i],ids[i]),amounts[i]);
  }};
  await measure(shape,n,'reference',ref,minimal,minArgs,validate);
  await measure(shape,n,'strict',bulk,prod,[...prodArgs,false],validate,n===100);
  await measure(shape,n,'lenient',bulk,prod,[...prodArgs,true],validate);
  if(fast) await measure(shape,n,'specialized',ref,fast,fastArgs,validate);
 }
 console.log(`completed shape ${shape}`);
}
// Ordinary owner transactions are context, not n times the atomic floor.
for(const [name,token,fn,args] of [
 ['ERC20 transfer',e,'transfer',[recipients[0],10n**18n]],
 ['ERC721 safe EOA',nft,'safeTransferFrom(address,address,uint256)',[owner,recipients[0],1]],
 ['ERC721 unsafe EOA',nft,'transferFrom',[owner,recipients[0],1]],
 ['ERC1155 EOA',m,'safeTransferFrom',[owner,recipients[0],1,2,'0x']],
 ['ERC721A safe EOA',lazy,'safeTransferFrom(address,address,uint256)',[owner,recipients[0],1]]]) {
 await reset();const data=token.interface.encodeFunctionData(fn,args);const r=await tx(signer.sendTransaction({to:token.target,data,gasLimit:90000000}));singles.push({name,gas:Number(r.gasUsed),intrinsic:intrinsic(data)});
}
for(const [label,token,ids,safe] of [
 ['OZ721 unsafe',nft,Array.from({length:100},(_,i)=>i+1),false],
 ['ERC721A ascending',lazy,Array.from({length:100},(_,i)=>i+1),true],
 ['ERC721A gapped ascending',lazy,Array.from({length:100},(_,i)=>i*3+1),true],
 ['ERC721A descending',lazy,Array.from({length:100},(_,i)=>100-i),true]]) {
 for(const variant of ['reference','strict']) await measure(label,100,variant,variant==='reference'?ref:bulk,variant==='reference'?'ref721':'airdrop721',variant==='reference'?[token.target,recipients.slice(0,100),ids,safe]:[token.target,recipients.slice(0,100),ids,safe,false],async()=>{for(let i=0;i<100;i++)assert.equal((await token.ownerOf(ids[i])).toLowerCase(),recipients[i]);});
}
const out={environment:{chain:'local Anvil Cancun; no Nitro L1 surcharge',compiler:'0.8.36',optimizerRuns:10000,viaIR:false,erc20Allowance:'finite, nonzero remainder',recipients:'distinct, fresh EOAs',sender:'nonzero remainder; no storage-clear refunds',sourceHash:keccak256(toUtf8Bytes(fs.readFileSync('src/BulkSend.sol','utf8')))},singles,rows};
fs.writeFileSync('audit/2026-09-13/results.json',JSON.stringify(out,null,2)+'\n');
console.log('Wrote results.json; every measured recipient checked.');
