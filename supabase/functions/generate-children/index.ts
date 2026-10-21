import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
import {createGenerationHandler,generationLog} from './handler.ts';

declare const Deno:{env:{get:(name:string)=>string|undefined};serve:(handler:(request:Request)=>Promise<Response>)=>void};
declare const EdgeRuntime:{waitUntil:(task:Promise<unknown>)=>void};
const admin=createClient(Deno.env.get('SUPABASE_URL')??'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'',{auth:{persistSession:false,autoRefreshToken:false}});
Deno.serve(createGenerationHandler({
  allowedOrigins:Deno.env.get('MAPA_ALLOWED_ORIGINS'),
  key:Deno.env.get('OPENAI_API_KEY'),model:Deno.env.get('AI_MODEL'),budget:Deno.env.get('AI_DAILY_TOKEN_BUDGET'),
  service:{
    authenticate:async token=>{const {data,error}=await admin.auth.getUser(token);return error?null:data.user;},
    available:async actor=>{const result=await admin.rpc('ai_generation_available',{p_actor:actor});if(result.error)throw Error('AI_UNAVAILABLE');return result.data===true;},
    reserve:async args=>admin.rpc('reserve_ai_generation',args),
    finish:async args=>admin.rpc('finish_ai_generation',args),
  },
  background:task=>EdgeRuntime.waitUntil(task),log:event=>console.info(generationLog(event)),
}));
