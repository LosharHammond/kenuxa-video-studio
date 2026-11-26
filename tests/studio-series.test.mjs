import test from "node:test";
import assert from "node:assert/strict";
import {parseHTML} from "linkedom";
import {readFile} from "node:fs/promises";

test("Studio queues a selected series once, saves in order without per-file saveAs, cleans tabs and continues after a failure", async () => {
  const original = Object.fromEntries(["document","window","location","chrome","history"].map(k=>[k,globalThis[k]]));
  const {document,window} = parseHTML(await readFile(new URL("../extension/studio.html",import.meta.url),"utf8"));
  const $ = id => document.getElementById(id);
  for (const select of document.querySelectorAll("select"))
    Object.defineProperty(select,"value",{value:select.querySelector("option")?.getAttribute("value") || "",writable:true});
  for (const dialog of document.querySelectorAll("dialog")) {
    dialog.showModal = () => dialog.setAttribute("open","");
    dialog.close = () => dialog.removeAttribute("open");
  }
  const tabs = new Map(), events = [], saves = [], data = {};
  let tabId=10;
  const source = {sourceTabId:1,title:"Test series | Example",sourceUrl:"https://example.test/series/show"};
  const storage = {get:async key=>({[key]:key==="studio-test"?source:data[key]}),set:async values=>Object.assign(data,values)};
  globalThis.document=document;
  globalThis.window=window;
  globalThis.location=new URL("https://extension.test/studio.html?job=studio-test#library");
  globalThis.history={replaceState(){}};
  globalThis.chrome={
    runtime:{getURL:p=>"https://extension.test/"+p},storage:{local:storage,session:storage},
    tabs:{
      create:async ({url})=>{ const id=++tabId;tabs.set(id,url);events.push(`open:${id}`);return {id}; },
      get:async id=>({status:"complete",url:tabs.get(id)}),
      remove:async id=>{events.push(`close:${id}`);tabs.delete(id);},
    },
    scripting:{executeScript:async ({func,target,args})=>{
      const id=target.tabId;
      if(func.name==="findEpisodeLinks")return [{result:[1,2,3].map(number=>({number,pageUrl:`https://example.test/series/show/episode-${number}`}))}];
      if(func.name==="inspectPlayers")return [{frameId:0,result:id===1?[]:[{urls:[`https://cdn.test/${id}.mp4`],playing:true,frameId:0,sourceOrigin:"https://example.test",observedAt:Date.now()}]}];
      if(func.name==="fetchInPage") {
        if(id===12)return [{result:{error:"Fixture episode failed"}}];
        return [{result:{status:200,url:args[0],type:"video/mp4",length:"8",base64:args[2].method==="HEAD"?"":btoa("testdata")}}];
      }
      return [{result:undefined}];
    }},
    downloads:{
      download:async options=>{saves.push(options);events.push(`save:${saves.length}`);return saves.length;},
      search:async ()=>[{state:"complete"}],
      onChanged:{addListener(){},removeListener(){}},
    },
  };
  const waitFor = async condition => {
    for(let i=0;i<200;i++) {if(condition())return;await new Promise(r=>setTimeout(r,10));}
    throw Error("Studio did not reach expected state: "+$("notice").textContent);
  };
  try {
    await import("../extension/studio.js");
    await waitFor(()=>$("sourceTitle").textContent===source.title);
    await $("findEpisodes").onclick();
    assert.equal($("episodeList").querySelectorAll("input").length,3);
    for(const c of $("episodeList").querySelectorAll("input"))c.setAttribute("checked","");
    const queued=$("queueEpisodes").onclick();
    assert($("sharingDialog").hasAttribute("open"));
    await $("sharePrivate").onclick();
    await queued;
    await waitFor(()=>$("queueList").querySelectorAll(".status-label.complete, .status-label.failed").length===3);
    await waitFor(()=>tabs.size===0);
    assert.equal(saves.length,2);
    assert(saves[0].filename.endsWith("Episode 001.mp4"));
    assert(saves[1].filename.endsWith("Episode 003.mp4"));
    assert(saves.every(s=>s.saveAs===false && s.filename.startsWith("Test series/")));
    assert.deepEqual(events,["open:11","save:1","close:11","open:12","close:12","open:13","save:2","close:13"]);
    assert.equal(data.kenuxaHistory.length,2);
  } finally {
    for(const [k,v] of Object.entries(original)) if(v===undefined)delete globalThis[k];else globalThis[k]=v;
  }
});
