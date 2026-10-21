import { createStore } from 'zustand/vanilla';
import { readView, writeView, type Viewport, type ViewPreferences } from '../maps/preferences';
import { cleanCollapsed } from '../maps/visibility';
import type { MapNode } from '../maps/api';

export const VIEW_DEBOUNCE_MS=600;
type Status='loading'|'saved'|'pending'|'saving'|'error';
interface ViewState {
  ready:boolean; status:Status; loadFailed:boolean; viewport:Viewport|null; collapsedIds:string[]; restoreVersion:number;
  load:()=>Promise<void>; retry:()=>Promise<void>; flush:()=>Promise<boolean>; dispose:()=>void;
  initializeViewport:(viewport:Viewport)=>void; changeViewport:(viewport:Viewport)=>void;
  setCollapsed:(ids:string[])=>void; clean:(nodes:MapNode[])=>void;
}
type Dependencies={read?:typeof readView;write?:typeof writeView};
// One controller per account/map. View writes are serialized independently from content.
export function createMapViewStore(userId:string,mapId:string,nodes:MapNode[],dependencies:Dependencies={}) {
  const read=dependencies.read??readView,write=dependencies.write??writeView;
  let active=true,version=0,savedVersion=0,generation=0;
  let currentNodes=nodes;
  let timer:ReturnType<typeof setTimeout>|undefined;
  let flight:Promise<boolean>|null=null;
  let reader:AbortController|undefined;
  const store=createStore<ViewState>((set,get)=>{
    const update=(patch:Partial<ViewState>)=>{if(active)set(patch);};
    const schedule=()=>{
      version++;
      update({status:get().loadFailed?'error':'pending'});
      clearTimeout(timer);
      timer=setTimeout(()=>{void get().flush();},VIEW_DEBOUNCE_MS);
    };
    const load=async()=>{
      active=true;
      const ticket=++generation;
      reader?.abort();reader=new AbortController();
      try {
        const remote=await read(userId,mapId,AbortSignal.any([reader.signal,AbortSignal.timeout(20_000)]));
        if(!active||ticket!==generation)return;
        const collapsedIds=cleanCollapsed(currentNodes,remote?.collapsedIds??[]);
        const dirty=version>savedVersion;
        update({ready:true,loadFailed:false,status:dirty?'pending':'saved',...(!dirty?{viewport:remote?.viewport??null,collapsedIds,restoreVersion:get().restoreVersion+1}:{})});
        if(!dirty && remote && JSON.stringify(collapsedIds)!==JSON.stringify(remote.collapsedIds)) schedule();
        if(dirty)void get().flush();
      } catch {
        if(active&&ticket===generation)update({ready:true,loadFailed:true,status:'error'});
      }
    };
    return {
      ready:false,status:'loading',loadFailed:false,viewport:null,collapsedIds:[],restoreVersion:0,
      load,
      retry:async()=>{if(get().loadFailed)await load();else await get().flush();},
      initializeViewport:(viewport)=>{if(!get().viewport)set({viewport});},
      changeViewport:(viewport)=>{
        if(JSON.stringify(viewport)===JSON.stringify(get().viewport))return;
        set({viewport});schedule();
      },
      setCollapsed:(ids)=>{
        const collapsedIds=cleanCollapsed(currentNodes,ids);
        if(JSON.stringify(collapsedIds)===JSON.stringify(get().collapsedIds))return;
        set({collapsedIds});schedule();
      },
      clean:(nextNodes)=>{currentNodes=nextNodes;get().setCollapsed(get().collapsedIds);},
      flush:async()=>{
        clearTimeout(timer);
        if(get().loadFailed||!get().ready||!get().viewport)return false;
        if(flight)return flight.then(ok=>ok?get().flush():false);
        if(version===savedVersion)return true;
        const ticket=generation,target=version;
        const value:ViewPreferences={viewport:get().viewport!,collapsedIds:[...get().collapsedIds]};
        update({status:'saving'});
        flight=(async()=>{
          try {
            await write(userId,mapId,value);
            if(ticket!==generation)return false;
            savedVersion=target;
            update({status:version===savedVersion?'saved':'pending'});
            return true;
          } catch {if(ticket===generation)update({status:'error'});return false;}
        })();
        const ok=await flight;
        if(ticket!==generation)return false;
        flight=null;
        if(ok&&version>savedVersion)return get().flush();
        return ok;
      },
      dispose:()=>{
        // Flush the latest view on route exit; RLS still checks the captured account/map.
        void get().flush();active=false;reader?.abort();clearTimeout(timer);
      },
    };
  });
  return store;
}
