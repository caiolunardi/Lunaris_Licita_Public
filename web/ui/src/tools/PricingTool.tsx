import {useEffect,useRef,useState,type FormEvent} from "react";
import {Calculator,Info,Save,ShieldCheck,TrendingUp,WalletCards} from "lucide-react";
import {Badge,Button,Card,EmptyState,Notice,SectionHeading,Skeleton} from "../components/UI";
import {formatMoney,formatPercent,formatQuantity,priceInputs,simulatePricing,
 type PriceInputs,type Pricing,type Quote,type ToolsProps,validatedQuoteList} from "./types";
type Fields={qty:string;cost:string;extra:string;fee:string;margin:string;sale:string};
const defaults:Fields={qty:"1",cost:"80,00",extra:"0,00",fee:"0",margin:"20",sale:""};
const fieldSpecs:Array<{key:keyof Fields;label:string;placeholder:string;hint:string}>= [
 {key:"qty",label:"Quantas unidades pretende vender?",placeholder:"1",hint:"Aceita frações: 1,500 = uma unidade e meia."},
 {key:"cost",label:"Quanto custa cada unidade?",placeholder:"80,00",hint:"Inclua o preço pago pela mercadoria."},
 {key:"extra",label:"Outros custos no total (frete, embalagem…)",placeholder:"0,00",hint:"Valor total, não por unidade."},
 {key:"fee",label:"Taxas sobre a venda (%)",placeholder:"0",hint:"Ex.: 5 = 5% do valor vendido."},
 {key:"margin",label:"Margem de lucro desejada (%)",placeholder:"20",hint:"Lucro como porcentagem do preço de venda."},
 {key:"sale",label:"Preço que pensa cobrar por unidade (opcional)",placeholder:"120,00",hint:"Deixe vazio para usar o preço mínimo calculado."}
];
async function responseJSON<T>(response:Response):Promise<T>{
 if(!response.ok)throw new Error(response.status===403?"Você não tem acesso a esta operação.":
  response.status===409?"A informação mudou ou os dados não foram aceitos. Revise antes de tentar novamente.":
  response.status===401?"Sua sessão expirou. Escolha sua empresa novamente.":
  "Não foi possível confirmar o cálculo. Confira a conexão e os valores.");
 return response.json() as Promise<T>;
}
export default function PricingTool({identity,onIdentity}:ToolsProps){
 const company=identity.active,preview=!!company&&identity.stage==="preview"&&identity.source==="fixture";
 const verified=!!company&&identity.stage==="verified"&&identity.source==="server";
 const canSave=!!company?.permissions.canWrite;
 const [fields,setFields]=useState<Fields>(defaults),[calc,setCalc]=useState<Pricing|null>(null);
 const [desc,setDesc]=useState(""),[vendor,setVendor]=useState(""),[reference,setReference]=useState("");
 const [quotes,setQuotes]=useState<Quote[]>([]),[listBusy,setListBusy]=useState(false),
  [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),
  [message,setMessage]=useState<string|null>(null),[cursor,setCursor]=useState<string|null>(null);
 const [entry,setEntry]=useState<PriceInputs|null>(null),saveIntent=useRef<string|null>(null);
 const root="/api/v1/companies/"+encodeURIComponent(company?.id||"")+"/tools";
 const load=async(after:string|null=null)=>{
  if(!verified)return;
  setListBusy(true);setError(null);
  try{
   const query=new URLSearchParams({limit:"20"});if(after)query.set("after",after);
   const result=await responseJSON<unknown>(await fetch(root+"/quotes?"+query,{
    credentials:"same-origin",cache:"no-store"}));
   if(!validatedQuoteList(result))throw new Error("A lista de cotações está incompleta.");
   setQuotes(old=>after?[...old,...result.items]:result.items);
   setCursor(result.nextCursor);
  }catch(e){setError(e instanceof Error?e.message:"Não foi possível ler as cotações.")}
  finally{setListBusy(false);}
 };
 useEffect(()=>{if(verified)void load();},[verified,company?.id]);
 const change=(key:keyof Fields,value:string)=>{
  setFields(old=>({...old,[key]:value}));setCalc(null);setEntry(null);
  saveIntent.current=null;setMessage(null);setError(null);
 };
 async function calculate(event:FormEvent){
  event.preventDefault();setError(null);setMessage(null);
  const parsed=priceInputs(fields);
  if(!parsed){setError("Revise os campos. Use vírgula nos centavos e informe taxas menores que 100% no total.");return;}
  setBusy(true);
  try{
   const calculated=preview?simulatePricing(parsed):
    (await responseJSON<{calculation:Pricing}>(await fetch(root+"/pricing",{
     method:"POST",credentials:"same-origin",cache:"no-store",
     headers:{"content-type":"application/json"},
     body:JSON.stringify(parsed)}))).calculation;
   if(calculated.isEstimate!==true||calculated.realSaleConfirmed!==false)
    throw new Error("O servidor não confirmou que é apenas uma estimativa.");
   setCalc(calculated);setEntry(parsed);saveIntent.current=null;
   setMessage("Estimativa calculada. Confira os custos antes de usar numa proposta.");
  }catch(e){setCalc(null);setEntry(null);
   setError(e instanceof Error?e.message:"Cálculo não disponível.");}
  finally{setBusy(false);}
 }
 async function save(){
  if(!calc||!entry||!canSave||busy)return;
  if(desc.trim().length<3||desc.length>150){setError("Descreva a cotação em pelo menos 3 letras.");return;}
  setBusy(true);setError(null);setMessage(null);
  if(preview){
   const id="demo-"+crypto.randomUUID();
   setQuotes(old=>[{id,descricao:desc.trim(),fornecedor_texto:vendor.trim()||null,
    referencia_texto:reference.trim()||null,quantidade_mil:entry.quantityMil,
    custo_unit_cent:entry.costUnitCent,custo_efetivo_total_cent:calc.totalCostCent,
    preco_minimo_unit_cent:calc.minimumUnitCent,preco_venda_unit_cent:calc.saleUnitCent,
    receita_total_cent:calc.revenueCent,custos_venda_total_cent:calc.saleFeesCent,
    lucro_total_cent:calc.profitCent,margem_percentual_escala:calc.actualMarginBps,
    lucro_sobre_custo_escala:calc.markupOverCostBps,
    entrada_json:JSON.stringify(entry),resultado_json:JSON.stringify(calc),versao_calculo:1,
    origem_dado:"NATIVO",conferencia:"VALIDADO",criado_em:null,licitacao_id:null},...old]);
   setMessage("Cotação registrada apenas nesta demonstração. Não há dados salvos.");
   setDesc("");setVendor("");setReference("");saveIntent.current=null;
   setBusy(false);return;
  }
  try{
   if(!saveIntent.current)saveIntent.current=crypto.randomUUID();
   const result=await responseJSON<{intentId:string}>(await fetch(root+"/quotes",{
    method:"POST",credentials:"same-origin",cache:"no-store",
    headers:{"content-type":"application/json"},body:JSON.stringify({
     intentId:saveIntent.current,descricao:desc.trim(),
     fornecedorTexto:vendor.trim()||null,referenciaTexto:reference.trim()||null,...entry})
   }));
   if(result.intentId!==saveIntent.current)throw new Error("Registro não confirmado.");
   saveIntent.current=null;setMessage("Cotação guardada no D1 local, com histórico auditável.");
   setDesc("");setVendor("");setReference("");await load();
  }catch(e){setError(e instanceof Error?e.message:"Não foi possível salvar.");}
  finally{setBusy(false);}
 }
 if(!company||(!verified&&!preview))return <Card><SectionHeading title="Selecione uma empresa para calcular"/>
  <p>As cotações ficam separadas por empresa.</p>
  <Button onClick={onIdentity}>Escolher empresa</Button></Card>;
 return <div className="f9-page">
  <div className="page-intro"><div><p className="eyebrow">F9 · Ferramentas</p>
   <h1>Calcule preços com confiança.</h1>
   <p>Saiba por quanto vender, o lucro previsto e se sua margem está adequada.</p></div>
   <Calculator size={34} aria-hidden="true"/></div>
  <Notice title={preview?"Exemplos sem dados reais":"Estimativa calculada no servidor local"}>
   {preview?"Você pode experimentar à vontade. Nenhuma cotação é enviada ao banco.":
    "O cálculo é feito pelo Worker local. Cotação salva não é venda, nota fiscal, crédito recebido ou dinheiro disponível."}
  </Notice>
  {error&&<div className="f4-error" role="alert">{error}</div>}
  {message&&<div className="f4-success" role="status">{message}</div>}
  <Card className="f9-card"><SectionHeading eyebrow="Passo 1" title="Informe os custos e sua meta"/>
   <p className="f9-muted">Começamos com valores de exemplo. Altere os números conforme seu caso.</p>
   <form className="f9-form" onSubmit={e=>void calculate(e)}>
    <div className="f9-fields">{fieldSpecs.map(f=><label key={f.key} className="f9-field">
      <span>{f.label}</span><input aria-label={f.label} type="text" inputMode="decimal"
       autoComplete="off" placeholder={f.placeholder} value={fields[f.key]}
       onChange={e=>change(f.key,e.target.value)} maxLength={26}/>
      <small>{f.hint}</small></label>)}</div>
    <Button type="submit" disabled={busy}><Calculator size={17}/>
     {busy?"Calculando…":"Calcular meu preço"}</Button>
   </form>
  </Card>
  {calc&&<Card className="f9-card"><SectionHeading eyebrow="Passo 2" title="Entenda o resultado">
    <Badge tone={calc.belowTargetMargin?"warning":"success"}>
     {calc.belowTargetMargin?"Abaixo da margem desejada":"Meta de margem atendida"}
    </Badge></SectionHeading>
   <div className="f9-price-result">
    <div><span>Custo total previsto</span><strong>{formatMoney(calc.totalCostCent)}</strong>
     <small>Produto + despesas extras para {formatQuantity(calc.quantityMil)} unidade(s).</small></div>
    <div className="f9-highlight"><span>Preço mínimo por unidade</span>
     <strong>{formatMoney(calc.minimumUnitCent)}</strong>
     <small>Para alcançar a margem que você pediu, considerando as taxas.</small></div>
    <div><span>Preço usado na simulação</span><strong>{formatMoney(calc.saleUnitCent)}</strong>
     <small>Você pode testar outro preço acima.</small></div>
    <div><span>Lucro líquido estimado</span><strong>{formatMoney(calc.profitCent)}</strong>
     <small>Depois do custo e taxas da venda.</small></div>
   </div>
   <div className="f9-margins">
    <div><TrendingUp size={20}/><span>Margem sobre a venda:
     <strong>{formatPercent(calc.actualMarginBps)}</strong></span></div>
    <div><WalletCards size={20}/><span>Lucro sobre o custo (markup):
     <strong>{formatPercent(calc.markupOverCostBps)}</strong></span></div></div>
   {calc.belowTargetMargin&&<Notice title="Atenção: sua meta não foi atingida">
    O preço digitado não cobre a margem escolhida. Verifique se precisa elevar
    o preço, diminuir custos ou rever sua meta antes de apresentar uma proposta.</Notice>}
   <Notice title="Simulação, não resultado bancário">
    Esta conta não registra recebimento, não cria boleto e não considera tributos não informados.
    O custo real pode ser diferente; confira documentação e regras do edital.</Notice>
   {canSave&&<div className="f9-save">
    <h3>Guarde esta cotação (opcional)</h3>
    <div className="f9-fields">
     <label className="f9-field"><span>Descrição da cotação</span>
      <input aria-label="Descrição da cotação" maxLength={150} value={desc}
       onChange={e=>{setDesc(e.target.value);saveIntent.current=null;}}
       placeholder="Ex.: computadores do pregão 001"/></label>
     <label className="f9-field"><span>Fornecedor (opcional)</span>
      <input aria-label="Fornecedor da cotação" maxLength={120} value={vendor}
       onChange={e=>{setVendor(e.target.value);saveIntent.current=null;}}
       placeholder="Nome do fornecedor"/></label>
     <label className="f9-field"><span>Referência (opcional)</span>
      <input aria-label="Referência da cotação" maxLength={120} value={reference}
       onChange={e=>{setReference(e.target.value);saveIntent.current=null;}}
       placeholder="Cotação ou orçamento"/></label></div>
    <Button type="button" disabled={busy||desc.trim().length<3} onClick={()=>void save()}>
     <Save size={17}/>{busy?"Conferindo…":"Salvar cotação"}</Button>
   </div>}
  </Card>}
  <Card className="f9-card"><SectionHeading eyebrow="Histórico" title="Cotações já guardadas"/>
   {listBusy&&<Skeleton lines={2}/>}
   {!listBusy&&quotes.length===0&&<EmptyState title="Ainda não há cotações"
    message="Faça um cálculo e salve uma simulação para comparar depois."/>}
   <div className="f9-quote-list">{quotes.map(q=><article className="f9-quote" key={q.id}>
    <div><strong>{q.descricao}</strong><small>{q.fornecedor_texto||"Sem fornecedor informado"}
     {preview?" · Exemplo temporário":""}</small></div>
    <div><span>Preço mínimo</span><strong>{formatMoney(q.preco_minimo_unit_cent)}</strong></div>
    <div><span>Lucro previsto</span><strong>{formatMoney(q.lucro_total_cent)}</strong></div>
    <div><Badge tone="neutral">Fórmula v{q.versao_calculo}</Badge></div>
   </article>)}</div>
   {cursor&&<Button variant="secondary" disabled={listBusy} onClick={()=>void load(cursor)}>
     Carregar mais cotações</Button>}
  </Card>
  <Card className="f9-card"><SectionHeading eyebrow="Dica rápida" title="Por que margem não é markup?"/>
   <p className="f9-muted"><Info size={16} aria-hidden="true"/> Se algo custa R$ 80 e é vendido por R$ 100,
    o lucro é R$ 20. Isso representa <strong>20% do preço de venda (margem)</strong>,
    mas <strong>25% do custo (markup)</strong>. Não use um pelo outro.</p>
   <p className="f9-muted"><ShieldCheck size={16} aria-hidden="true"/>
    A calculadora arredonda custos e taxas de forma conservadora para evitar
    sugerir um preço mínimo artificialmente baixo.</p>
  </Card>
 </div>;
}
