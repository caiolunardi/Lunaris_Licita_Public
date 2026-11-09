import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, createHash, webcrypto } from "node:crypto";
import { SecurityError, verifyAccessToken, authenticateAccess,
  requireCompanyRole, forbidPrivilegedOperation } from "../src/r7/security.mjs";
import { DomainError, registerCredit, updateTitleObservation, dueDateForCompetence }
  from "../src/r7/domain.mjs";
import { verifyR2Evidence, refuseR2Deletion } from "../src/r7/documents.mjs";

if (!globalThis.crypto) globalThis.crypto=webcrypto;
const { publicKey, privateKey }=generateKeyPairSync("rsa",{modulusLength:2048});
const issuer="https://licita-test.cloudflareaccess.com",audience="only-licita";
const jwk={...publicKey.export({format:"jwk"}),alg:"RS256",kid:"test-key",use:"sig"};
const b64=x=>Buffer.from(typeof x==="string"?x:JSON.stringify(x)).toString("base64url");
const now=Date.parse("2026-11-07T10:00:00Z");
function token(payload={},header={}) {
  const parts=[b64({alg:"RS256",kid:"test-key",typ:"JWT",...header}),
    b64({iss:issuer,aud:[audience],sub:"sub-test",iat:now/1000-60,
        exp:now/1000+3600,email:"validado@example.test",...payload})];
  return parts.join(".")+"."+sign("RSA-SHA256",Buffer.from(parts.join(".")),
                                 privateKey).toString("base64url");
}
const options=()=>({issuer,audience,keys:[jwk],nowMs:now});
const principal={issuer,subject:"sub-test",email:"validado@example.test"};
function dbMock({member={usuario_id:"user1",papel:"OPERADOR"},existing=null,
                  batchResult=[{meta:{changes:1}},{meta:{changes:1}}],throws=false}={}) {
  const statements=[];
  let calls=0;
  const db={
    statements, 
    prepare(sql){const item={sql,args:[]};statements.push(item);
      return {bind(...args){item.args=args;
        return {first:async()=>{
          if(sql.includes("JOIN usuarios_empresas"))return member;
          if(sql.includes("FROM operacoes WHERE"))return existing;
          return null;
        },run:async()=>({meta:{changes:1}})};
      }};},
    async batch(items){calls++; if(throws)throw Error("SQL rollback");
      return batchResult;},
    get batchCalls(){return calls;}
  };
  return db;
}
const credit=(over={})=>({intentId:"intent123",contaReceberId:"receber123",
  valorRecebidoCent:2000,retencaoConfirmadaCent:100,retencaoAtestadoId:"atest1",
  dataCredito:"2026-11-07",contaDestino:"CONTA1",referenciaExterna:"PIX-1",...over});
const note=(over={})=>({intentId:"nota123",tituloId:"titulo123",expectedVersion:2,
  observacoes:"Revisar",...over});
const deny=async fn=>assert.rejects(fn,e=>e instanceof Error);

test("W6 assinado RS256, issuer, audience, subject e expiry validos",async()=>{
  const a=await verifyAccessToken(token(),options());assert.equal(a.subject,"sub-test");
  assert.equal(a.issuer,issuer);assert.ok(Object.isFrozen(a));
});
test("W6 assinatura adulterada nao autentica",async()=>{
  const t=token();await deny(()=>verifyAccessToken(t.slice(0,-3)+"zzz",options()));
});
test("W6 token expirado e nbf no futuro falham",async()=>{
  await deny(()=>verifyAccessToken(token({exp:now/1000-1}),options()));
  await deny(()=>verifyAccessToken(token({nbf:now/1000+200}),options()));
});
test("W6 tokens com aud ou issuer errados falham",async()=>{
  await deny(()=>verifyAccessToken(token({aud:["outro"]}),options()));
  await deny(()=>verifyAccessToken(token({iss:"https://evil.example"}),options()));
});
test("W6 algoritmo nao RS256, kid ausente ou chave desconhecida falham",async()=>{
  await deny(()=>verifyAccessToken(token({},{alg:"HS256"}),options()));
  await deny(()=>verifyAccessToken(token({},{kid:"unknown"}),options()));
  await deny(()=>verifyAccessToken(token(),{...options(),keys:[]}));
});
test("W6 JWT malformado e sem sub rejeitado",async()=>{
  await deny(()=>verifyAccessToken("one.two.three",options()));
  await deny(()=>verifyAccessToken(token({sub:""}),options()));
});
test("W6 header Cf-Access-Jwt-Assertion e JWKS fixo funcionam",async()=>{
  const req=new Request("https://licita.example/api",{headers:{"cf-access-jwt-assertion":token()}});
  const accesses=[];
  const identity=await authenticateAccess(req,{ACCESS_TEAM_DOMAIN:issuer,ACCESS_AUD:audience},
    async url=>{accesses.push(url);return new Response(JSON.stringify({keys:[jwk]}),
      {headers:{"content-type":"application/json"}});},now);
  assert.equal(identity.subject,"sub-test");
  assert.deepEqual(accesses,[issuer+"/cdn-cgi/access/certs"]);
});
test("W6 sem JWT mesmo com x-user/email forjado rejeita",async()=>{
  const req=new Request("https://licita.example/api",{headers:{"x-user":"admin","x-email":"root@example"}});
  await deny(()=>authenticateAccess(req,{ACCESS_TEAM_DOMAIN:issuer,ACCESS_AUD:audience},
    async()=>{throw Error("nao deveria fetch");},now));
});
test("W6 configuracao sem AUD falha fechada",async()=>{
  const req=new Request("https://licita.example/api",{headers:{"cf-access-jwt-assertion":token()}});
  await deny(()=>authenticateAccess(req,{ACCESS_TEAM_DOMAIN:issuer},async()=>{},now));
});
test("W6 ADMIN, OPERADOR e CONSULTA leem somente a empresa autorizada",async()=>{
  const db=dbMock();const p=await requireCompanyRole(db,principal,"e1","read");
  assert.equal(p.companyId,"e1");assert.equal(p.userId,"user1");
  assert.deepEqual(db.statements[0].args,[issuer,"sub-test","e1"]);
});
test("W6 CONSULTA nao pode escrever e membro inativo nao passa",async()=>{
  await deny(()=>requireCompanyRole(dbMock({member:{usuario_id:"u",papel:"CONSULTA"}}),
       principal,"e1","write"));
  await deny(()=>requireCompanyRole(dbMock({member:null}),principal,"e1","read"));
});
test("W6 importacao LEGADO e expurgo privilegiado nao estao habilitados",async()=>{
  await deny(()=>requireCompanyRole(dbMock(),principal,"e1","import_legacy"));
  assert.throws(()=>forbidPrivilegedOperation(),SecurityError);
});
test("W6 body com empresa/ator/origem falsificados rejeitado",async()=>{
  const db=dbMock();
  await deny(()=>registerCredit(db,principal,"e1",credit({empresa_id:"e2"})));
  await deny(()=>registerCredit(db,principal,"e1",credit({origem_dado:"LEGADO"})));
  assert.equal(db.batchCalls,0);
});
test("W6 role CONSULTA nao executa credito nem altera titulo",async()=>{
  const db=dbMock({member:{usuario_id:"u",papel:"CONSULTA"}});
  await deny(()=>registerCredit(db,principal,"e1",credit()));
  await deny(()=>updateTitleObservation(db,principal,"e1",note()));
  assert.equal(db.batchCalls,0);
});
test("W1 referencia sem conta e valor negativo sao rejeitados",async()=>{
  for(const b of [credit({contaDestino:null}),credit({valorRecebidoCent:-1}),
                  credit({dataCredito:"2026-02-31"}),credit({referenciaExterna:" PIX-1 "})]){
    const db=dbMock();await deny(()=>registerCredit(db,principal,"e1",b));
    assert.equal(db.batchCalls,0);
  }
});
test("W1/W5 credito: predicado no mesmo INSERT, escopo, saldo, NF, empenho, licitacao",async()=>{
  const db=dbMock();const out=await registerCredit(db,principal,"e1",credit());
  assert.equal(out.replayed,false);assert.equal(db.batchCalls,1);
  const sql=db.statements.map(x=>x.sql).join("\n");
  assert.match(sql,/INSERT INTO recebimentos/);assert.match(sql,/JOIN notas_fiscais/);
  assert.match(sql,/AND c.cancelada=0/);assert.match(sql,/n.situacao IN/);
  assert.match(sql,/e.situacao='CONFIRMADO'/);assert.match(sql,/l.encerrada_em IS NULL/);
  assert.match(sql,/c.valor_bruto_cent-coalesce/);assert.match(sql,/origem_dado='LEGADO'/);
  assert.match(sql,/INSERT INTO operacoes/);
  assert.ok(db.statements.some(s=>s.args.includes("e1")));
  assert.ok(db.statements.some(s=>s.args.includes("user1")));
});
test("W1/W5 credito sem linhas alteradas nao finge sucesso",async()=>{
  const db=dbMock({batchResult:[{meta:{changes:0}},{meta:{changes:0}}]});
  await assert.rejects(()=>registerCredit(db,principal,"e1",credit()),e=>e.code==="credit_not_allowed_or_insufficient_balance");
});
test("W1 mesma intencao e hash divergente e conflito",async()=>{
  const db=dbMock({existing:{tipo:"RECEBIMENTO",hash_pedido:"hash-outro",estado:"CONCLUIDA"}});
  await assert.rejects(()=>registerCredit(db,principal,"e1",credit()),e=>e.code==="idempotency_conflict");
  assert.equal(db.batchCalls,0);
});
test("W1 conflito na transacao devolve falha sem confirmar",async()=>{
  const db=dbMock({throws:true});
  await assert.rejects(()=>registerCredit(db,principal,"e1",credit()),e=>e.code==="credit_conflict");
});
test("W4 CAS altera observacao apenas com versao exata e gera operacao",async()=>{
  const db=dbMock();const result=await updateTitleObservation(db,principal,"e1",note());
  assert.equal(result.newVersion,3);assert.equal(db.batchCalls,1);
  const sql=db.statements.map(s=>s.sql).join("\n");
  assert.match(sql,/UPDATE titulos_pagar SET observacoes/);
  assert.match(sql,/AND versao=\?/);assert.match(sql,/AND empresa_id=\?/);
  assert.match(sql,/AND origem_dado='NATIVO'/);assert.match(sql,/INSERT INTO operacoes/);
});
test("W4 versao obsoleta retorna conflito nao sucesso",async()=>{
  const db=dbMock({batchResult:[{meta:{changes:0}},{meta:{changes:0}}]});
  await assert.rejects(()=>updateTitleObservation(db,principal,"e1",note()),e=>e.code==="version_conflict");
});
test("W4 metadata arbitraria de outro cliente nunca passa",async()=>{
  const db=dbMock();await deny(()=>updateTitleObservation(db,principal,"e1",note({ator_id:"root"})));
  assert.equal(db.batchCalls,0);
});
test("W3 vencimento 31 limita fevereiro e volta a 31 em março",()=>{
  assert.equal(dueDateForCompetence("2026-02",31),"2026-02-28");
  assert.equal(dueDateForCompetence("2024-02",31),"2024-02-29");
  assert.equal(dueDateForCompetence("2026-03",31),"2026-03-31");
  assert.equal(dueDateForCompetence("2026-04",31),"2026-04-30");
});
test("W3 competencia e dia invalidos recusados",()=>{
  for(const [c,d] of [["2026-13",15],["2026-02",32],["0000-01",1],
                      ["2026-02",0],["2026-2",15]]){
    assert.throws(()=>dueDateForCompetence(c,d),DomainError);
  }
});
test("W7 R2 hash e bytes reais conferidos em fixture sintética",async()=>{
  const bytes=new TextEncoder().encode("arquivo ficticio");
  const hash=createHash("sha256").update(bytes).digest("hex");
  const row={chave_r2:"e1/doc-v1",sha256:hash,tamanho_bytes:bytes.byteLength};
  const bucket={get:async key=>({size:bytes.byteLength,body:true,arrayBuffer:async()=>bytes.buffer})};
  assert.equal((await verifyR2Evidence(bucket,row,"e1")).verified,true);
});
test("W7 acesso R2 entre empresas negado",async()=>{
  const row={chave_r2:"e2/doc",sha256:"a".repeat(64),tamanho_bytes:100};
  await deny(()=>verifyR2Evidence({get:async()=>{throw Error("never");}},row,"e1"));
});
test("W7 tamanho ou checksum diferente nao sao prova",async()=>{
  const bytes=new TextEncoder().encode("abc");
  const bucket={get:async()=>({size:bytes.byteLength,body:true,arrayBuffer:async()=>bytes.buffer})};
  await deny(()=>verifyR2Evidence(bucket,{chave_r2:"e1/doc",sha256:"a".repeat(64),
    tamanho_bytes:bytes.byteLength},"e1"));
  await deny(()=>verifyR2Evidence(bucket,{chave_r2:"e1/doc",sha256:"a".repeat(64),
    tamanho_bytes:40},"e1"));
});
test("W7 objetos grandes e exclusao R2 desabilitados",async()=>{
  await deny(()=>verifyR2Evidence({get:async()=>{}},{chave_r2:"e1/doc",
    sha256:"a".repeat(64),tamanho_bytes:100*1024*1024},"e1"));
  assert.throws(()=>refuseR2Deletion(),SecurityError);
});
