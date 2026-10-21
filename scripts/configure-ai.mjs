// Upload only server-side AI configuration; never send Vite values or log secrets.
import { loadEnv } from 'vite';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const env=loadEnv('development',process.cwd(),'');
const ref='bodxafqkqlyfoyfgahyj';
if(new URL(env.VITE_SUPABASE_URL).hostname!==`${ref}.supabase.co`||!env.OPENAI_API_KEY||!env.AI_MODEL)throw Error('Configuração IA/projeto ausente.');
const directory=await mkdtemp(join(tmpdir(),'mapa-ai-secrets-'));
try{
  const file=join(directory,'secrets.env');
  await writeFile(file,`OPENAI_API_KEY=${JSON.stringify(env.OPENAI_API_KEY)}\nAI_MODEL=${JSON.stringify(env.AI_MODEL)}\nAI_DAILY_TOKEN_BUDGET=50000\n`,{mode:0o600});
  const result=spawnSync('npx',['supabase','secrets','set','--project-ref',ref,'--env-file',file],{encoding:'utf8'});
  if(result.status!==0)throw Error('Não foi possível configurar os segredos no projeto.');
  console.log('Chave e modelo configurados no servidor. Orçamento: 50.000 tokens/dia.');
}finally{await rm(directory,{recursive:true,force:true});}
