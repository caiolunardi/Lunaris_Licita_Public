import type {IdentityState} from "../identity/session";

export type CatalogKind="orgaos"|"fornecedores";
export type CatalogItem={
  id:string;nome:string;cnpj:string|null;contato:string|null;email:string|null;
  telefone:string|null;observacoes:string|null;ativo:0|1;versao:number;
  origem_dado:"NATIVO"|"LEGADO";conferencia:string|null;
  uasg?:string|null;endereco_entrega_padrao?:string|null;
};
export type CatalogForm={
  nome:string;cnpj:string;contato:string;email:string;telefone:string;
  observacoes:string;uasg:string;endereco_entrega_padrao:string;
};
export type CatalogProps={kind:CatalogKind; identity:IdentityState; onIdentity:()=>void};
export const blankForm=():CatalogForm=>({
  nome:"",cnpj:"",contato:"",email:"",telefone:"",observacoes:"",
  uasg:"",endereco_entrega_padrao:""
});
export const toForm=(item:CatalogItem):CatalogForm=>({
  nome:item.nome,cnpj:item.cnpj||"",contato:item.contato||"",email:item.email||"",
  telefone:item.telefone||"",observacoes:item.observacoes||"",
  uasg:item.uasg||"",endereco_entrega_padrao:item.endereco_entrega_padrao||""
});
export const demoCatalog=(kind:CatalogKind,companyId:string):CatalogItem[]=>{
  const second=companyId.endsWith("horizonte");
  const init=(id:string,nome:string):CatalogItem=>({
    id, nome,cnpj:null,contato:"Setor de demonstração",email:null,
    telefone:null,observacoes:"Somente dados fictícios.",ativo:1,versao:1,
    origem_dado:"NATIVO",conferencia:"VALIDADO",uasg:null,endereco_entrega_padrao:null
  });
  if(kind==="orgaos")return second?
    [init("f2-demo-org-h1","Secretaria Horizonte — fictícia")]:
    [init("f2-demo-org-a1","Instituto Aurora — fictício"),
     init("f2-demo-org-a2","Secretaria Exemplo — fictícia"),
     {...init("f2-demo-org-a3","Fundação Desativada — fictícia"),ativo:0}];
  return second?
    [init("f2-demo-for-h1","Comercial Horizonte — fictício")]:
    [init("f2-demo-for-a1","Fornecedor Atlântico — fictício"),
     init("f2-demo-for-a2","Distribuidora Modelo — fictícia")];
};
