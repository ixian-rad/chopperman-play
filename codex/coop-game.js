import * as THREE from 'three';
import { createCoop } from './coop/index.js';

// All Backyard-specific policy stays here; coop/ owns the shared protocol.
export function integrateCoop({backyard,scene,camera,renderer,campaignGame,audio,updateHUD,resetLog,loadLog}){
  const logs=new Map();let selected=null,pending=null,serial=0,partner='Partner';
  const toast=text=>{const el=document.getElementById('coop-toast');el.textContent=text;el.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>{el.hidden=true;},5200);};
  const treeById=id=>backyard.field?.trees.find(t=>String(t.id)===String(id));
  function renderLogs(){
    const session=coop.session;
    const count=[...(session?.logs.values()??[])].filter(l=>l.split).length;
    document.getElementById('team-logs').textContent=`Team logs split · ${count}`;
    const available=[...logs.values()].filter(l=>!l.split&&l.info.tree!==undefined);
    const button=document.getElementById('shared-log');button.hidden=!coop.inSession();button.disabled=!available.length;
    button.textContent=available.length?`Bring shared timber to block · ${available.length}`:'Shared timber · fell a tree first';
    document.getElementById('team-logs').hidden=!coop.inSession();
  }
  function removeLog(id){const l=logs.get(id);if(l){l.split=true;l.mesh?.removeFromParent();l.mesh?.geometry.dispose();l.mesh?.material.dispose();}}
  function clearLogs(){for(const id of logs.keys())removeLog(id);logs.clear();selected=null;pending=null;}
  const coop=createCoop({THREE,scene,getCamera:()=>camera,getViewportHeight:()=>renderer.domElement.clientHeight,hooks:{
    getProfile:()=>({name:backyard.playerName,character:backyard.characterId,costume:backyard.costume,axe:backyard.axe}),
    getWorld:()=>({seed:backyard.worldSeed,setting:backyard.setting}),
    onWorldInit:async world=>{
      if(!backyard.loaded)throw Error('The backyard is still loading. Try again in a moment.');
      clearLogs();await backyard.rebuildSharedWorld(world);
      if(world.isHost){
        // Starting a room keeps this host's existing damage and felling.
        for(const t of backyard.field.trees){
          const id=String(t.id);if(['falling','fallen','stump'].includes(t.state))coop.session.felled.add(id);
          else if(t.hits)coop.session.trees.set(id,{hp:t.meta.hitsToFell-t.hits,preset:true});
        }
      }
      document.getElementById('yard-setting').disabled=true;renderLogs();
    },
    getTrees:()=>backyard.field.trees.map(t=>({id:t.id,hp:t.meta.hitsToFell,x:t.position.x,z:t.position.z})),
    getLocalState:()=>{const p=backyard.player;return {x:p.position.x,y:p.position.y,z:p.position.z,yaw:p.rotation.y,anim:backyard.anim==='Walk'?'Casual_Walk':backyard.anim,swinging:!!backyard.swinging||!!backyard.stumpAction,running:backyard.anim==='Run'};},
    // Player roots use world metres and face (sin(yaw), 0, cos(yaw)).
    getListenerYaw:()=>backyard.player.rotation.y,
    spawnAvatar:profile=>backyard.spawnRemoteAvatar(profile),
    onTreeHit:(ev,mine)=>{
      const t=treeById(ev.tree);if(!t||!['standing','chopping'].includes(t.state))return;
      backyard.field.activate(t);t.hits=t.meta.hitsToFell-ev.hp;t.anim.shake=ev.instant?0:1;
      if(!mine&&!ev.instant){backyard.spawnChips(t.position.clone().setY(t.meta.chopHeight*t.scale));audio.play('treeHit');}
    },
    onTreeFell:(ev,mine)=>{
      const t=treeById(ev.tree);if(!t||['falling','fallen','stump'].includes(t.state))return;
      t.hits=t.meta.hitsToFell;backyard.field.fell(t,new THREE.Vector3(ev.dir[0],0,ev.dir[1]));
      if(ev.instant){t.anim.th=t.anim.rest;t.anim.w=0;t.obj.hinge.quaternion.setFromAxisAngle(t.anim.axis,t.anim.rest);t.state='stump';backyard.field.active.delete(t);}
      else {audio.play('treeCreak');t.anim.onLand=()=>{audio.play('treeFall');backyard.onShake(.07,500);if(mine)backyard.celebrate();};}
      if(!ev.instant){
        if(mine)coop.session.award({xp:35,gold:20,reason:'Tree felled'});
        if(coop.session.isHost)coop.session.spawnLog({id:`tree-${ev.tree}-1`,tree:ev.tree,species:t.species,x:1.1+(Number(t.id)%4)*.36,z:.9+Math.floor(Number(t.id)/4)*.12});
      }
      backyard.materialsDirty=true;
    },
    onLogSpawned:ev=>{
      if(logs.has(ev.log))return;
      const l={info:ev.info,split:!!ev.info.split,mesh:null};logs.set(ev.log,l);
      if(!l.split&&ev.info.tree!==undefined){
        l.mesh=new THREE.Mesh(new THREE.CylinderGeometry(.14,.16,.5,10),new THREE.MeshLambertMaterial({color:0xa87949}));
        l.mesh.rotation.z=Math.PI/2;l.mesh.position.set(ev.info.x??1.1,.17,ev.info.z??.9);scene.add(l.mesh);
      }
      renderLogs();
    },
    onLogSplit:(ev,mine)=>{
      removeLog(ev.log);
      if(mine&&pending?.id===ev.log){const fn=pending.complete;pending=null;selected=null;fn();}
      else if(selected===ev.log){selected=null;resetLog();toast('Log already taken. Your partner split it.');}
      if(!mine)toast(`${coop.session.remote?.name||partner} split a log. Teamwork!`);
      renderLogs();
    },
    onDenied:ev=>{if(ev.kind==='logSplit'){pending=null;selected=null;removeLog(ev.log);resetLog();renderLogs();toast('Log already taken. Choose another log.');}},
    onAward:ev=>{
      const level=campaignGame.level;campaignGame.xp+=ev.xp;campaignGame.coins+=ev.gold;campaignGame.save();
      if(campaignGame.level>level)audio.play('levelUp');audio.play('points');updateHUD();
      if(ev.shared)toast(`${backyard.playerName} +${ev.xp} XP shared · +${ev.gold} coins`);
    },
    onPlayerJoined:p=>{partner=p.name;toast(`${p.name} joined the backyard.`);},
    onPlayerLeft:p=>toast(`${p.name} left. Back to single player.`),
    onPlayerDisconnected:p=>toast(`${p.name} disconnected. You can keep chopping.`),
    onEnded:reason=>{
      if(pending){const fn=pending.complete;pending=null;fn();}
      selected=null;document.getElementById('yard-setting').disabled=false;
      toast(reason==='left'?'Disconnected. Back to single player.':`${partner} left. Back to single player.`);renderLogs();
    },
  }});
  backyard.coop=coop;
  coop.mountUI();document.querySelector('.topbar').appendChild(coop.ui.root);
  // Reserve the actual wrapped voice HUD height above the game's footer.
  // Observing layout keeps this correct on phones and when partner text changes.
  const voiceHud=document.getElementById('coop-voice-hud'),footer=document.querySelector('footer');
  const syncVoiceLayout=()=>{
    document.body.style.setProperty('--coop-voice-height',`${voiceHud.getBoundingClientRect().height}px`);
    document.body.style.setProperty('--coop-footer-height',`${footer.getBoundingClientRect().height}px`);
  };
  const voiceLayout=new ResizeObserver(syncVoiceLayout);
  voiceLayout.observe(voiceHud,{box:'border-box'});voiceLayout.observe(footer,{box:'border-box'});
  window.addEventListener('resize',syncVoiceLayout);syncVoiceLayout();
  // Host/join cannot run before the selected assets and tree library are ready.
  const host=coop.host,join=coop.join;
  coop.host=async()=>{if(!backyard.loaded)throw Error('The backyard is still loading.');return host();};
  coop.join=async code=>{if(!backyard.loaded)throw Error('The backyard is still loading.');return join(code);};
  document.getElementById('shared-log').onclick=async()=>{
    const next=[...logs].find(([,l])=>!l.split&&l.info.tree!==undefined);if(!next||pending)return;
    selected=next[0];await backyard.enterStump();loadLog(next[1].info.species);toast(`${next[1].info.species} timber ready. First split claims it.`);
  };
  return {coop,toast,renderLogs,clearSelection:()=>{selected=null;},
    beforeImpact(result,complete){
      if(!coop.inSession()||!result.split){complete();return;}
      const id=selected||`${coop.session.localId}-round-${Date.now()}-${serial++}`;
      pending={id,complete};if(!selected)coop.session.spawnLog({id,species:'campaign'});
      coop.session.splitLog(id);
    },
  };
}
