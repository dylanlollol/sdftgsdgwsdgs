'use strict';

// ══════════ MULTIPLAYER ══════════════════════════════════════
var mpWS = null, localPid = -1, mpName = 'Player', isMulti = false;
var remotePlayers = {}; // pid → {mesh, pos, rot, nameSprite}
var mpMoveTimer = 0;

// ── Main menu animated background ────────────────────────────
(function(){
  var bg=document.getElementById('mm-particles');
  if(!bg)return;
  var cols=['#1a4aff','#44bbff','#8855ff','#ff4488','#4488ff'];
  for(var i=0;i<28;i++){
    var p=document.createElement('div');p.className='mmp';
    var sz=(Math.random()*18+6)|0;
    p.style.cssText='width:'+sz+'px;height:'+sz+'px;'
      +'background:'+cols[i%cols.length]+';'
      +'left:'+(Math.random()*100)+'%;'
      +'bottom:'+(-20+Math.random()*30)+'%;'
      +'animation-delay:'+(-Math.random()*8)+'s;'
      +'animation-duration:'+(5+Math.random()*8)+'s;'
      +'transform:rotate('+(Math.random()*360)+'deg)';
    bg.appendChild(p);
  }
  // Mini preview canvas — spinning cubes
  var cv=document.getElementById('mm-canvas');
  if(!cv)return;
  cv.width=cv.offsetWidth||800;cv.height=cv.offsetHeight||600;
  var ctx=cv.getContext('2d');
  var cubes=[];for(var ci=0;ci<14;ci++){cubes.push({x:Math.random()*cv.width,y:Math.random()*cv.height,s:20+Math.random()*60,r:Math.random()*Math.PI*2,dr:(Math.random()-.5)*.012,vx:(Math.random()-.5)*.4,vy:(Math.random()-.5)*.3,col:cols[ci%cols.length]});}
  function drawCube(x,y,s,r,col){ctx.save();ctx.translate(x,y);ctx.rotate(r);ctx.strokeStyle=col;ctx.lineWidth=1.5;ctx.strokeRect(-s/2,-s/2,s,s);var d=s*.4;ctx.beginPath();ctx.moveTo(-s/2,-s/2);ctx.lineTo(-s/2+d,-s/2-d);ctx.lineTo(s/2+d,-s/2-d);ctx.lineTo(s/2,-s/2);ctx.moveTo(s/2,-s/2);ctx.lineTo(s/2+d,-s/2-d);ctx.moveTo(-s/2+d,-s/2-d);ctx.lineTo(-s/2+d,s/2-d);ctx.moveTo(s/2+d,-s/2-d);ctx.lineTo(s/2+d,s/2-d);ctx.lineTo(s/2,s/2);ctx.stroke();ctx.restore();}
  function raf(){if(!document.getElementById('mainmenu'))return;ctx.clearRect(0,0,cv.width,cv.height);cubes.forEach(function(cu){cu.r+=cu.dr;cu.x+=cu.vx;cu.y+=cu.vy;if(cu.x<-80)cu.x=cv.width+80;if(cu.x>cv.width+80)cu.x=-80;if(cu.y<-80)cu.y=cv.height+80;if(cu.y>cv.height+80)cu.y=-80;drawCube(cu.x,cu.y,cu.s,cu.r,cu.col);});requestAnimationFrame(raf);}
  raf();
})();

function mpTabSwitch(tab){
  document.getElementById('mppane-join').style.display=tab==='join'?'':'none';
  document.getElementById('mppane-create').style.display=tab==='create'?'':'none';
  document.querySelectorAll('.mp-tab').forEach(function(t){t.classList.remove('on');});
  document.getElementById('mptab-'+tab).classList.add('on');
  document.getElementById('mp-status').textContent='';
}
function mpSetStatus(msg,isErr){
  var el=document.getElementById('mp-status');
  el.textContent=msg;el.className=isErr?'err':'ok';
}

function mpConnect(host, password, playerName, onSuccess) {
  var wsUrl = 'ws://' + host;
  mpSetStatus('Connecting to ' + wsUrl + '…');
  var ws = new WebSocket(wsUrl);
  var done = false;
  ws.onopen = function() {
    ws.send(JSON.stringify({type:'join', name:playerName, password:password}));
  };
  ws.onerror = function() {
    if(!done){mpSetStatus('Connection failed — is server.js running?', true);}
  };
  ws.onclose = function() {
    if(!done){mpSetStatus('Connection closed', true);}
    if(isMulti){showNotif('⚠ Disconnected from server');isMulti=false;updateMpHud();}
  };
  ws.onmessage = function(ev) {
    var m; try{m=JSON.parse(ev.data);}catch(e){return;}
    if(m.type==='error'){mpSetStatus('Error: '+m.msg, true);ws.close();return;}
    if(m.type==='welcome'){
      done=true;mpWS=ws;localPid=m.pid;isMulti=true;mpName=playerName;
      mpSetStatus('Connected as '+playerName+' (pid:'+m.pid+')',false);
      // Sync existing players
      (m.players||[]).forEach(function(p){spawnRemotePlayer(p);});
      // Apply entity log (props spawned before we joined)
      (m.entities||[]).forEach(function(e){applyRemoteEntity(e);});
      ws.onmessage = onWsMessage;
      if(onSuccess)onSuccess();
      return;
    }
    if(m.type==='error'){mpSetStatus(m.msg,true);return;}
  };
}

function mpJoin() {
  var host = (document.getElementById('mp-ip').value||'localhost:7777').trim();
  var pass = document.getElementById('mp-pass').value||'';
  var name = (document.getElementById('mp-name').value||'Player').trim()||'Player';
  if(!host){mpSetStatus('Enter a server address',true);return;}
  mpConnect(host, pass, name, function(){startGame();document.getElementById('mm-mp').classList.remove('show');});
}
function mpConnectLocal() {
  var pass = document.getElementById('mp-pass2').value||'';
  var name = (document.getElementById('mp-name2').value||'Player').trim()||'Player';
  mpConnect('localhost:7777', pass, name, function(){startGame();document.getElementById('mm-mp').classList.remove('show');});
}

function onWsMessage(ev) {
  var m; try{m=JSON.parse(ev.data);}catch(e){return;}
  if(m.type==='move'){
    if(remotePlayers[m.pid]){
      var rp=remotePlayers[m.pid];
      rp.targetPos=new THREE.Vector3(m.pos.x,m.pos.y,m.pos.z);
      rp.targetRotY=m.rot?m.rot.y:0;
      if(m.hp!=null)rp.hp=m.hp;
    }
  } else if(m.type==='playerJoin'){spawnRemotePlayer(m);}
  else if(m.type==='playerLeave'){removeRemotePlayer(m.pid);}
  else if(m.type==='spawn'){applyRemoteEntity(m);}
  else if(m.type==='delete'){applyRemoteDelete(m.eid);}
  else if(m.type==='chat'){addChat(m.name,m.msg);}
  else if(m.type==='playerHit'){
    // We were hit by another player
    if(m.targetPid===localPid){plrHit(m.dmg);}
  }
  else if(m.type==='propUpdate'){
    var rpe=remoteProps[m.eid];
    if(rpe&&rpe.pb){
      rpe.pb.mesh.position.set(m.pos.x,m.pos.y,m.pos.z);
      if(m.q)rpe.pb.mesh.quaternion.set(m.q.x,m.q.y,m.q.z,m.q.w);
      if(m.vel){rpe.pb.vel.set(m.vel.x,m.vel.y,m.vel.z);rpe.pb.wake();}
    }
  }
  else if(m.type==='serverShutdown'){showNotif('⚠ Server shutting down!');mpWS=null;isMulti=false;updateMpHud();}
}

function mpSendPos() {
  if(!mpWS||!isMulti)return;
  mpWS.send(JSON.stringify({type:'move',pos:{x:camera.position.x,y:camera.position.y,z:camera.position.z},rot:{y:yaw,p:pitch},hp:player.hp}));
}
function mpSendSpawn(eid,etype,data){if(!mpWS||!isMulti)return;mpWS.send(JSON.stringify(Object.assign({type:'spawn',eid:eid,etype:etype},data)));}
function mpSendDelete(eid){if(!mpWS||!isMulti)return;mpWS.send(JSON.stringify({type:'delete',eid:eid}));}
function mpSendChat(msg){if(!mpWS||!isMulti)return;mpWS.send(JSON.stringify({type:'chat',msg:msg}));}
function mpSendButton(eid,state){if(!mpWS||!isMulti)return;mpWS.send(JSON.stringify({type:'button',eid:eid,state:state}));}

function updateMpHud(){
  var el=document.getElementById('mp-hud');
  var txt=document.getElementById('mp-hud-txt');
  el.classList.toggle('on',isMulti);
  if(isMulti&&txt)txt.textContent=Object.keys(remotePlayers).length+1+' players';
}

function addChat(name,msg){
  if(!started)return;
  var log=document.getElementById('chatlog');
  var line=document.createElement('div');line.className='chat-line';
  line.innerHTML='<span class="chat-name">'+name+'</span> '+msg.replace(/</g,'&lt;');
  log.appendChild(line);
  while(log.children.length>12)log.removeChild(log.firstChild);
  setTimeout(function(){if(line.parentNode)line.parentNode.removeChild(line);},8000);
}

// Map eid -> {mesh, pb} for remote props
var remoteProps={};

function applyRemoteEntity(m){
  if(!started||!scene)return;
  if(m.etype==='prop'){
    if(remoteProps[m.eid])return; // already exists
    // Reconstruct prop from serialized def index
    var def=PROPS[m.defIdx];
    if(!def)return;
    var r=mkPropMesh(def);
    r.mesh.castShadow=true;r.mesh.receiveShadow=true;
    if(m.pos)r.mesh.position.set(m.pos.x,m.pos.y,m.pos.z);
    if(m.quat)r.mesh.quaternion.set(m.quat.x,m.quat.y,m.quat.z,m.quat.w);
    scene.add(r.mesh);
    var pb=new PhysBody(r.mesh,r.hx,r.hy,r.hz,def.m||10,{res:def.res||0.14});
    pb.explosive=!!def.expl;
    pb._eid=m.eid;
    remoteProps[m.eid]={mesh:r.mesh,pb:pb};
  }
}
function applyRemoteDelete(eid){
  var rp=remoteProps[eid];
  if(rp){
    scene.remove(rp.mesh);
    var bi=physBodies.indexOf(rp.pb);if(bi>-1)physBodies.splice(bi,1);
    delete remoteProps[eid];
  }
}

var chatOpen=false;
function openChat(){
  chatOpen=true;var ci=document.getElementById('chatinput');
  ci.style.display='block';ci.focus();if(plocked)document.exitPointerLock();
}
function closeChat(){
  chatOpen=false;var ci=document.getElementById('chatinput');
  ci.style.display='none';ci.value='';rpl();
}

// Remote player rendering
function buildRemotePlayerMesh(name){
  // Root group: position = feet, body rises from 0 upward
  var g=new THREE.Group();
  var ML=function(col){return new THREE.MeshLambertMaterial({color:col});};
  // Shoes
  var shGeo=new THREE.BoxGeometry(.18,.08,.22);
  var shL=new THREE.Mesh(shGeo,ML(0x222222));shL.position.set(-.1,.04,.02);g.add(shL);
  var shR=shL.clone();shR.position.x=.1;g.add(shR);
  // Legs (jeans blue)
  var lL=new THREE.Mesh(new THREE.BoxGeometry(.2,.55,.2),ML(0x334466));lL.position.set(-.1,.355,0);g.add(lL);
  var rL=lL.clone();rL.position.x=.1;g.add(rL);
  // Torso (dark shirt)
  var tor=new THREE.Mesh(new THREE.BoxGeometry(.46,.52,.25),ML(0x334455));tor.position.y=.94;g.add(tor);
  // Arms (hanging at sides, same shirt color)
  var armGeo=new THREE.BoxGeometry(.16,.46,.18);
  var lA=new THREE.Mesh(armGeo,ML(0x334455));lA.position.set(-.34,.94,0);g.add(lA);
  var rA=lA.clone();rA.position.x=.34;g.add(rA);
  // Neck
  var neck=new THREE.Mesh(new THREE.CylinderGeometry(.08,.08,.12,7),ML(0xffcc99));neck.position.y=1.26;g.add(neck);
  // Head
  var head=new THREE.Mesh(new THREE.BoxGeometry(.32,.34,.3),ML(0xffcc99));head.position.y=1.49;g.add(head);
  // Eyes
  var eGeo=new THREE.SphereGeometry(.038,5,4);
  var eL=new THREE.Mesh(eGeo,ML(0x112244));eL.position.set(-.075,1.52,.15);g.add(eL);
  var eR=eL.clone();eR.position.x=.075;g.add(eR);
  // Hair
  var hair=new THREE.Mesh(new THREE.BoxGeometry(.34,.1,.32),ML(0x331100));hair.position.set(0,1.68,-.01);g.add(hair);
  // Name tag (billboard, stays upright)
  var cv=document.createElement('canvas');cv.width=256;cv.height=48;
  var ctx=cv.getContext('2d');
  ctx.fillStyle='rgba(0,0,0,.75)';ctx.roundRect?ctx.roundRect(0,0,256,48,8):ctx.fillRect(0,0,256,48);
  ctx.fill();
  ctx.fillStyle='#ffffff';ctx.font='bold 22px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(name,128,26);
  var tex=new THREE.CanvasTexture(cv);
  var label=new THREE.Mesh(new THREE.PlaneGeometry(1.5,.28),
    new THREE.MeshBasicMaterial({map:tex,transparent:true,depthWrite:false,side:THREE.DoubleSide}));
  label.position.y=1.98;g.add(label);
  return g;
}

function spawnRemotePlayer(data){
  if(remotePlayers[data.pid])return;
  var m=buildRemotePlayerMesh(data.name||'?');
  // Server sends camera (eye) position; body mesh root = feet = eye - 1.65
  var eyeH=1.65;
  if(data.pos)m.position.set(data.pos.x,(data.pos.y||eyeH)-eyeH,data.pos.z);
  if(started)scene.add(m);
  var tgt=m.position.clone();
  remotePlayers[data.pid]={mesh:m,name:data.name||'?',hp:100,targetPos:tgt,targetRotY:0};
  showNotif('🌐 '+( data.name||'Player')+' joined');
}
function removeRemotePlayer(pid){
  var rp=remotePlayers[pid];
  if(!rp)return;
  if(started&&rp.mesh)scene.remove(rp.mesh);
  delete remotePlayers[pid];
  showNotif('🌐 Player left');updateMpHud();
}
function updateRemotePlayers(dt){
  var eyeH=1.65;
  Object.values(remotePlayers).forEach(function(rp){
    if(!rp||!rp.mesh)return;
    if(rp.targetPos){
      // targetPos is eye position; root is at feet
      var feetTgt=rp.targetPos.clone();feetTgt.y-=eyeH;
      rp.mesh.position.lerp(feetTgt,Math.min(1,dt*16));
    }
    // Smooth yaw rotation
    var dy=rp.targetRotY-rp.mesh.rotation.y;
    while(dy>Math.PI)dy-=Math.PI*2;while(dy<-Math.PI)dy+=Math.PI*2;
    rp.mesh.rotation.y+=dy*Math.min(1,dt*12);
    // Name tag always faces camera
    rp.mesh.children.forEach(function(ch){
      if(ch.material&&ch.material.transparent&&ch.geometry&&ch.geometry.type==='PlaneGeometry'){
        ch.quaternion.copy(camera.quaternion);
      }
    });
  });
}

// ── BUTTON / WIRE SYSTEM ─────────────────────────────────────
var btns=[]; // {pb, eid, lit, ind, outEids:[]}
var wires=[]; // {fromEid, toEid, line}
var undoStack=[]; // array of physBody refs

function addBtnToProp(pb){
  var existing=btns.findIndex(function(b){return b.pb===pb;});
  if(existing>=0){
    if(btns[existing].ind)scene.remove(btns[existing].ind);
    // Remove wires connected to this button
    wires=wires.filter(function(w){if(w.fromEid===btns[existing].eid){if(w.line)scene.remove(w.line);return false;}return true;});
    btns.splice(existing,1);showNotif('🔘 Button removed');return;
  }
  var eid='btn_'+Math.random().toString(36).slice(2);
  var ind=new THREE.Mesh(new THREE.BoxGeometry(.32,.32,.08),new THREE.MeshBasicMaterial({color:0x22ff44}));
  ind.position.copy(pb.mesh.position);ind.position.y+=pb.hy+.04;
  scene.add(ind);
  pb._btnEid=eid;btns.push({pb,eid,lit:false,ind,outEids:[]});
  showNotif('🔘 Button added — press E to activate');SFX.spawn();
}

function addWireBetween(srcEid,dstPb){
  // Find src button
  var srcBtn=btns.find(function(b){return b.eid===srcEid;});if(!srcBtn)return;
  var dstEid=dstPb._btnEid||dstPb._thrEid||dstPb._fdEid||null;
  // Link to thruster/fading door by pb reference
  srcBtn.outEids.push({pb:dstPb,type:'generic'});
  // Visual wire
  var pts=[srcBtn.pb.mesh.position.clone(),dstPb.mesh.position.clone()];
  var geo=new THREE.BufferGeometry().setFromPoints(pts);
  var line=new THREE.Line(geo,new THREE.LineBasicMaterial({color:0xffcc00,linewidth:2}));
  scene.add(line);
  wires.push({fromEid:srcEid,toPb:dstPb,line});
  showNotif('🔌 Wire connected!');SFX.weld();
}

function triggerBtn(btn){
  btn.lit=!btn.lit;
  if(btn.ind)btn.ind.material.color.set(btn.lit?0xff4400:0x22ff44);
  SFX.tool();showNotif('🔘 Button '+(btn.lit?'ON':'OFF'));
  // Trigger connected outputs
  btn.outEids.forEach(function(out){
    // Toggle thrusters on connected pb
    var pb=out.pb;
    var tIdx=thrusters.findIndex(function(t){return t.pb===pb;});
    if(tIdx>=0)thrusters[tIdx].forced=btn.lit;
    // Toggle fading doors
    var fdIdx=fadingDoors.findIndex(function(fd){return fd.pb===pb;});
    if(fdIdx>=0){fadingDoors[fdIdx].open=btn.lit;}
    // Toggle motors
    var mIdx=motors.findIndex(function(m){return m.pb===pb;});
    if(mIdx>=0){pb.frozen=btn.lit;}
  });
  if(isMulti)mpSendButton(btn.eid,btn.lit);
}

function tryInteract(){
  if(!started||menuOpen||chatOpen)return;
  // Check buttons
  var nearBtn=null,nearD=2.8;
  btns.forEach(function(b){if(!b.pb||!b.pb.mesh)return;var d=camera.position.distanceTo(b.pb.mesh.position);if(d<nearD){nearBtn=b;nearD=d;}});
  if(nearBtn){triggerBtn(nearBtn);return;}
  // Check vehicles
  for(var i=0;i<ents.length;i++){var e2=ents[i];if(e2&&e2.mesh&&e2.etype==='vehicle'&&!e2.occupied&&camera.position.distanceTo(e2.mesh.position)<4.8){e2.enter();break;}}
}

function updateWires(dt){
  wires.forEach(function(w){
    var srcBtn=btns.find(function(b){return b.eid===w.fromEid;});
    if(!srcBtn||!srcBtn.pb||!srcBtn.pb.mesh||!w.toPb||!w.toPb.mesh){if(w.line)scene.remove(w.line);return;}
    if(w.line){
      w.line.geometry.setFromPoints([srcBtn.pb.mesh.position.clone(),w.toPb.mesh.position.clone()]);
      w.line.geometry.computeBoundingSphere();
    }
  });
  // Update button indicators
  btns.forEach(function(b){if(b.ind&&b.pb&&b.pb.mesh){b.ind.position.copy(b.pb.mesh.position);b.ind.position.y+=b.pb.hy+.04;}});
}

function doUndo(){
  if(!undoStack.length){showNotif('Nothing to undo');return;}
  var pb=undoStack.pop();
  if(!pb||!pb.mesh)return;
  if(PG.held===pb)pgRelease();
  scene.remove(pb.mesh);
  var bi=physBodies.indexOf(pb);if(bi>-1)physBodies.splice(bi,1);
  welds=welds.filter(function(w){return w.a!==pb&&w.b!==pb;});
  thrusters=thrusters.filter(function(t){if(t.pb===pb){if(t.ind)scene.remove(t.ind);return false;}return true;});
  winches=winches.filter(function(w){if(w.a===pb||w.b===pb){if(w.line)scene.remove(w.line);return false;}return true;});
  fadingDoors=fadingDoors.filter(function(fd){return fd.pb!==pb;});
  motors=motors.filter(function(m){return m.pb!==pb;});
  btns=btns.filter(function(b){return b.pb!==pb;});
  SFX.delete();showNotif('↩ Undone');
}

// ── Start game function ──────────────────────────────────────
function startGame(){
  initAudio();
  document.getElementById('mainmenu').style.display='none';
  started=true;
  initThree();initWpnScene();pgInit();createWorld();
  // Re-add remote player meshes to scene if multiplayer was set up before Three.js init
  Object.values(remotePlayers).forEach(function(rp){if(rp.mesh)scene.add(rp.mesh);});
  buildMenu();renderCats();renderGrid();updateToolHints();
  gameLoop();rpl();
}

// === AUDIO ===
var AC=null;
function initAudio(){try{AC=new(window.AudioContext||window.webkitAudioContext)();}catch(e){}}
function tone(f,t,v,d,det){if(!AC)return;try{var o=AC.createOscillator(),g=AC.createGain();o.connect(g);g.connect(AC.destination);o.type=t;o.frequency.value=f;if(det)o.detune.value=det;g.gain.setValueAtTime(v,AC.currentTime);g.gain.exponentialRampToValueAtTime(0.001,AC.currentTime+d);o.start();o.stop(AC.currentTime+d);}catch(e){}}
function noise(v,d,lp){if(!AC)return;try{var buf=AC.createBuffer(1,AC.sampleRate*d,AC.sampleRate),da=buf.getChannelData(0);for(var i=0;i<da.length;i++)da[i]=Math.random()*2-1;var s=AC.createBufferSource(),f=AC.createBiquadFilter(),g=AC.createGain();s.buffer=buf;f.type='lowpass';f.frequency.value=lp||800;s.connect(f);f.connect(g);g.connect(AC.destination);g.gain.setValueAtTime(v,AC.currentTime);g.gain.exponentialRampToValueAtTime(0.001,AC.currentTime+d);s.start();s.stop(AC.currentTime+d);}catch(e){}}
var SFX={
  pgrab:function(){tone(660,'sine',.07,.1);tone(880,'sine',.05,.12);},
  pdrop:function(){tone(330,'sine',.06,.08);tone(165,'sine',.04,.1);},
  pthrow:function(){noise(.15,.08,1400);tone(200,'sawtooth',.05,.06);},
  freeze:function(){tone(800,'sine',.09,.18);tone(1200,'sine',.05,.14);},
  unfreeze:function(){tone(400,'sine',.06,.12);},
  pistol:function(){noise(.5,.1,2200);tone(110,'square',.12,.04);},
  shotgun:function(){noise(.9,.22,500);tone(70,'square',.2,.09);},
  smg:function(){noise(.22,.07,2500);tone(155,'square',.07,.03);},
  ar2:function(){noise(.3,.1,1800);tone(95,'square',.09,.05);},
  rpg:function(){noise(.85,.32,350);tone(55,'sawtooth',.25,.14);},
  crowbar:function(){tone(280,'sawtooth',.18,.08);noise(.1,.05,3000);},
  explode:function(){noise(1.1,.55,180);tone(50,'sawtooth',.35,.22);},
  impact:function(){noise(.18,.06,500);tone(180,'square',.05,.04);},
  spawn:function(){tone(660,'sine',.06,.06);tone(880,'sine',.05,.09);},
  pickup:function(){tone(880,'sine',.05,.05);tone(1100,'sine',.04,.07);},
  weld:function(){noise(.25,.18,2200);tone(3500,'sine',.08,.12);},
  hurt:function(){noise(.35,.1,600);tone(180,'sawtooth',.15,.1);},
  tool:function(){tone(520,'sine',.06,.04);},
  empty:function(){tone(200,'square',.1,.06);},
  reload:function(){noise(.18,.12,1600);tone(260,'sine',.06,.08);},
  delete:function(){tone(200,'sawtooth',.1,.1);noise(.12,.08,600);},
};

// === DEFS ===
var PROPS=[
  {n:'Wooden Crate',c:'Furniture',col:0x8B6914,g:'box',s:[.8,.8,.8],m:25},
  {n:'Metal Crate',c:'Furniture',col:0x7a8a9a,g:'box',s:[.9,.9,.9],m:50},
  {n:'Small Box',c:'Furniture',col:0xaa8855,g:'box',s:[.4,.4,.4],m:4},
  {n:'Large Box',c:'Furniture',col:0x9a7744,g:'box',s:[1.5,1.5,1.5],m:80},
  {n:'Office Chair',c:'Furniture',col:0x222233,g:'box',s:[.5,.9,.5],m:12},
  {n:'Desk',c:'Furniture',col:0x4a4a5a,g:'box',s:[1.8,.75,.8],m:35},
  {n:'Bookshelf',c:'Furniture',col:0x5a3a1a,g:'box',s:[1,2,.3],m:25},
  {n:'Cabinet',c:'Furniture',col:0x555566,g:'box',s:[.8,1.8,.5],m:30},
  {n:'Safe',c:'Furniture',col:0x222222,g:'box',s:[.7,.9,.6],m:200},
  {n:'Sofa',c:'Furniture',col:0x446688,g:'box',s:[1.8,.8,.7],m:40},
  {n:'Fridge',c:'Furniture',col:0xddddee,g:'box',s:[.65,1.8,.65],m:80},
  {n:'Vending Machine',c:'Furniture',col:0x226633,g:'box',s:[.7,1.9,.5],m:120},
  {n:'Barrel (Red)',c:'Industrial',col:0xaa2211,g:'cyl',s:[.45,.9,.45],m:25},
  {n:'Barrel (Yellow)',c:'Industrial',col:0xeecc11,g:'cyl',s:[.45,.9,.45],m:20},
  {n:'Oil Drum',c:'Industrial',col:0x222222,g:'cyl',s:[.45,.9,.45],m:40},
  {n:'Explosive Barrel',c:'Industrial',col:0xff3300,g:'cyl',s:[.45,.9,.45],m:18,expl:true},
  {n:'Dumpster',c:'Industrial',col:0x226622,g:'box',s:[2,1.2,1],m:150},
  {n:'Fuel Tank',c:'Industrial',col:0xcc4422,g:'cyl',s:[.5,1,.5],m:60},
  {n:'Generator',c:'Industrial',col:0xffaa22,g:'box',s:[1,.9,.6],m:120},
  {n:'Pallet',c:'Industrial',col:0x9a7a4a,g:'box',s:[1.2,.12,.9],m:10},
  {n:'Ammo Box',c:'Military',col:0x556633,g:'box',s:[.45,.3,.3],m:10},
  {n:'Sandbag',c:'Military',col:0xaa9966,g:'box',s:[.5,.2,.25],m:20},
  {n:'Sandbag Wall',c:'Military',col:0xaa9966,g:'box',s:[1.5,.5,.25],m:80},
  {n:'Traffic Cone',c:'Urban',col:0xff7700,g:'cone',s:[.25,.6,.25],m:3},
  {n:'Bollard',c:'Urban',col:0xddcc00,g:'cyl',s:[.15,.8,.15],m:20},
  {n:'Fence Panel',c:'Urban',col:0xaaaaaa,g:'box',s:[2,1.2,.06],m:12},
  {n:'Park Bench',c:'Urban',col:0x5a3a1a,g:'box',s:[1.6,.45,.4],m:30},
  {n:'Rock (Small)',c:'Nature',col:0x777766,g:'sphere',s:[.4,.4,.4],m:20},
  {n:'Rock (Medium)',c:'Nature',col:0x666655,g:'sphere',s:[.7,.7,.7],m:60},
  {n:'Rock (Large)',c:'Nature',col:0x555544,g:'sphere',s:[1.2,1.2,1.2],m:150},
  {n:'Boulder',c:'Nature',col:0x4a4a3a,g:'sphere',s:[2,2,2],m:500},
  {n:'Log',c:'Nature',col:0x6B4226,g:'cyl',s:[.25,2,.25],m:40},
  {n:'Wooden Plank',c:'Building',col:0x9a7a4a,g:'box',s:[2,.1,.2],m:5},
  {n:'Metal Beam',c:'Building',col:0x8899aa,g:'box',s:[2,.15,.15],m:15},
  {n:'Long Beam',c:'Building',col:0x7a8a9a,g:'box',s:[4,.15,.15],m:30},
  {n:'Pipe (Short)',c:'Building',col:0x889999,g:'cyl',s:[.08,1,.08],m:5},
  {n:'Pipe (Long)',c:'Building',col:0x778888,g:'cyl',s:[.08,3,.08],m:10},
  {n:'Concrete Block',c:'Building',col:0x999988,g:'box',s:[.5,.5,.5],m:50},
  {n:'Cinderblock',c:'Building',col:0xaaa999,g:'box',s:[.4,.2,.2],m:15},
  {n:'Platform',c:'Building',col:0x779966,g:'box',s:[3,.15,3],m:100},
  {n:'Column',c:'Building',col:0xddddcc,g:'cyl',s:[.4,4,.4],m:150},
  {n:'Basketball',c:'Physics',col:0xff7722,g:'sphere',s:[.24,.24,.24],m:.6,res:.7},
  {n:'Soccer Ball',c:'Physics',col:0xffffff,g:'sphere',s:[.22,.22,.22],m:.5,res:.65},
  {n:'Bowling Ball',c:'Physics',col:0x2222aa,g:'sphere',s:[.27,.27,.27],m:7},
  {n:'Rubber Ball',c:'Physics',col:0xcc2222,g:'sphere',s:[.3,.3,.3],m:.5,res:.8},
  {n:'Metal Sphere',c:'Physics',col:0x8899aa,g:'sphere',s:[.4,.4,.4],m:20},
  {n:'Small Cube',c:'Physics',col:0x8B6914,g:'box',s:[.5,.5,.5],m:5},
  {n:'Metal Cube',c:'Physics',col:0x8899aa,g:'box',s:[.5,.5,.5],m:20},
  {n:'Large Cube',c:'Physics',col:0x556677,g:'box',s:[1.2,1.2,1.2],m:50},
  {n:'Cone',c:'Physics',col:0x995522,g:'cone',s:[.5,1,.5],m:5},
  {n:'Torus',c:'Physics',col:0x5588cc,g:'torus',s:[.5,.15,.5],m:8},
  {n:'Shipping Container',c:'Industrial',col:0x884422,g:'box',s:[2.5,2.5,6],m:500},
  {n:'Control Panel',c:'Tech',col:0x1a1a2a,g:'box',s:[1.2,.9,.3],m:20},
  {n:'Server Rack',c:'Tech',col:0x111122,g:'box',s:[.6,2,.8],m:100},
  {n:'Metal Grate',c:'Tech',col:0x777777,g:'box',s:[1,.05,1],m:8},
  // Birthday
  {n:'Birthday Cake',c:'Birthday',col:0xffaabb,g:'cyl',s:[.55,.7,.55],m:5},
  {n:'Cupcake',c:'Birthday',col:0xff88aa,g:'cyl',s:[.28,.32,.28],m:1},
  {n:'Red Balloon',c:'Birthday',col:0xff2222,g:'sphere',s:[.5,.65,.5],m:1},
  {n:'Blue Balloon',c:'Birthday',col:0x2244ff,g:'sphere',s:[.5,.65,.5],m:1},
  {n:'Gift Box',c:'Birthday',col:0xff44cc,g:'box',s:[.6,.6,.6],m:3},
  {n:'Tall Gift',c:'Birthday',col:0x44aaff,g:'box',s:[.5,.9,.5],m:4},
  {n:'Party Table',c:'Birthday',col:0xffdd88,g:'box',s:[1.6,.08,1],m:20},
  {n:'Confetti Pile',c:'Birthday',col:0xffff44,g:'box',s:[.9,.06,.9],m:2},
  {n:'Piñata',c:'Birthday',col:0xff8800,g:'sphere',s:[.55,.7,.55],m:4},
  {n:'Cake Slice',c:'Birthday',col:0xffccdd,g:'box',s:[.4,.4,.3],m:1},
];

var NPC_DEFS={
  citizen:    {n:'Citizen',     cat:'Friendly', e:'🧑',hp:100,spd:2.5,col:0x4a6080,leg:0x334466,sk:0xffcc99,agg:false,dmg:0,  ranged:false,desc:'Friendly civilian'},
  alyx:       {n:'Alyx Vance',  cat:'Friendly', e:'👩',hp:150,spd:3.0,col:0x882211,leg:0x111111,sk:0xcc9966,agg:false,dmg:0,  ranged:false,desc:'Resistance fighter'},
  barney:     {n:'Barney',      cat:'Friendly', e:'👮',hp:120,spd:2.8,col:0x2255aa,leg:0x112288,sk:0xffcc99,agg:false,dmg:0,  ranged:false,desc:'Security guard'},
  combine:    {n:'Combine',     cat:'Combine',  e:'💂',hp:80, spd:3.5,col:0x334455,leg:0x222233,sk:0x000000,agg:true, dmg:15, ranged:true, desc:'Hostile soldier'},
  metropolice:{n:'Metrocop',    cat:'Combine',  e:'🚔',hp:60, spd:3.8,col:0x445566,leg:0x222233,sk:0x000000,agg:true, dmg:10, ranged:true, desc:'City police officer'},
  manhack:    {n:'Manhack',     cat:'Combine',  e:'🔩',hp:30, spd:7.0,col:0x445566,leg:0x334455,sk:0x445566,agg:true, dmg:8,  ranged:false,desc:'Flying blade drone'},
  zombie:     {n:'Zombie',      cat:'Undead',   e:'🧟',hp:150,spd:1.5,col:0x667755,leg:0x445533,sk:0x88aa66,agg:true, dmg:20, ranged:false,desc:'Slow undead'},
  fastzombie: {n:'Fast Zombie', cat:'Undead',   e:'💀',hp:80, spd:5.5,col:0x445533,leg:0x223311,sk:0x667744,agg:true, dmg:25, ranged:false,desc:'Fast aggressive undead'},
  headcrab:   {n:'Headcrab',    cat:'Creatures',e:'🦀',hp:25, spd:4.0,col:0x998855,leg:0x776644,sk:0x998855,agg:true, dmg:10, ranged:false,desc:'Parasite crawler'},
  antlion:    {n:'Antlion',     cat:'Creatures',e:'🐛',hp:60, spd:6.0,col:0xaaaa44,leg:0x888833,sk:0xaaaa44,agg:true, dmg:15, ranged:false,desc:'Aggressive insect'},
  vortigaunt: {n:'Vortigaunt',  cat:'Creatures',e:'👾',hp:120,spd:2.5,col:0x223344,leg:0x112233,sk:0x334455,agg:true, dmg:18, ranged:true, desc:'Alien slave'},
  dog:        {n:'DOG',         cat:'Special',  e:'🤖',hp:300,spd:4.0,col:0x888888,leg:0x666666,sk:0x888888,agg:false,dmg:0,  ranged:false,desc:'Friendly robot companion'},
  turret:     {n:'Turret',      cat:'Special',  e:'🏛',hp:80, spd:0,  col:0xaaaaaa,leg:0x888888,sk:0xaaaaaa,agg:true, dmg:15, ranged:true, desc:'Automated defense turret'},
  caleblewis: {n:'Caleb Lewis', cat:'Birthday', e:'🎂',hp:999,spd:2.2,col:0x111111,leg:0xc8a96e,sk:0xffcc99,agg:false,dmg:0,  ranged:false,desc:'Birthday boy. He WILL puke cake on you.'},
};

var VEH_DEFS={
  jalopy:{n:'Jalopy',   e:'🚗',w:1.8,h:1.2,l:3.8,col:0xcc6633,spd:18,turn:1.8,desc:'Old car'},
  jeep:  {n:'Jeep',    e:'🚙',w:2.0,h:1.4,l:4.0,col:0x556633,spd:20,turn:1.6,desc:'Military jeep'},
  buggy: {n:'Buggy',   e:'🏎',w:1.6,h:.9, l:3.0,col:0xaaaa22,spd:30,turn:2.2,desc:'Dune buggy'},
  truck: {n:'Truck',   e:'🚛',w:2.5,h:2.5,l:7.0,col:0x334455,spd:12,turn:1.2,desc:'Heavy hauler'},
  apc:   {n:'APC',     e:'🪖',w:2.8,h:2.2,l:5.5,col:0x445533,spd:14,turn:1.4,desc:'Armored carrier'},
  heli:  {n:'Heli',    e:'🚁',w:3.0,h:1.5,l:4.0,col:0x555555,spd:22,turn:1.8,desc:'Aerial vehicle',fly:true},
  atv:   {n:'ATV',     e:'🏍',w:1.2,h:1.0,l:2.2,col:0xcc4422,spd:24,turn:2.5,desc:'All-terrain'},
};

var WEPS=[
  {n:'Physgun',e:'🔵',ammo:-1,dmg:0,  rof:0,   range:50, desc:'Gravity gun'},
  {n:'Toolgun',e:'🔧',ammo:-1,dmg:0,  rof:.1,  range:50, desc:'Multi-tool'},
  {n:'Pistol', e:'🔫',ammo:18,dmg:28, rof:.25, range:100,desc:'9mm semi-auto'},
  {n:'Shotgun',e:'💥',ammo:8, dmg:90, rof:.85, range:30, desc:'12ga pump'},
  {n:'SMG',    e:'⚡',ammo:45,dmg:12, rof:.09, range:70, desc:'Full-auto'},
  {n:'AR2',    e:'🎯',ammo:30,dmg:32, rof:.14, range:120,desc:'Pulse rifle'},
  {n:'RPG',    e:'💣',ammo:5, dmg:220,rof:1.5, range:250,desc:'Rocket launcher'},
  {n:'Crowbar',e:'🪓',ammo:-1,dmg:45, rof:.45, range:2.2,desc:'Melee'},
];

var TG_MODES=[
  {id:'freeze',  n:'Freeze',    ico:'❄',  desc:'Freeze/unfreeze a prop in place. Frozen props ignore all forces.',
   params:{}},
  {id:'weld',    n:'Weld',      ico:'🔗', desc:'Click two props to rigidly attach them. They move as one.',
   params:{strength:{label:'Spring Strength',min:10,max:200,val:85,step:5}}},
  {id:'thruster',n:'Thruster',  ico:'🚀', desc:'Click a surface to attach a thruster firing in that face direction. Click again to remove.',
   params:{force:{label:'Force',min:5,max:500,val:120,step:5},
           key:{label:'Hold Key',val:'none',options:['none','e','z','x','h','j','k','b']}}},
  {id:'winch',   n:'Winch',     ico:'⛓',  desc:'Click two props to connect a winch rope that pulls them together.',
   params:{length:{label:'Rest Length',min:0.5,max:30,val:4,step:0.5},
           strength:{label:'Pull Force',min:1,max:200,val:25,step:1},
           key:{label:'Hold Key',val:'none',options:['none','e','z','x','h','j','k','b']}}},
  {id:'fading',  n:'Fading Door',ico:'🚪',desc:'Toggle a prop solid/ghost. Bind a key to open/close like a door.',
   params:{key:{label:'Toggle Key',val:'e',options:['e','z','x','h','j','k','t','y','b']},
           speed:{label:'Fade Speed',min:0.5,max:10,val:4,step:0.5}}},
  {id:'motor',   n:'Motor',     ico:'⚙',  desc:'Spin a prop continuously. Great for fans, wheels, turntables.',
   params:{rpm:{label:'RPM',min:10,max:600,val:120,step:10},
           axis:{label:'Spin Axis',val:'y',options:['x','y','z']}}},
  {id:'color',   n:'Paint',     ico:'🎨', desc:'Cycle through 9 colors per click.',
   params:{}},
  {id:'delete',  n:'Delete',    ico:'🗑',  desc:'Permanently remove a prop.',
   params:{}},
  {id:'inflate', n:'Inflate',   ico:'🎈', desc:'Scale prop up.',
   params:{amount:{label:'Scale %',min:5,max:150,val:20,step:5}}},
  {id:'deflate', n:'Deflate',   ico:'🔽', desc:'Scale prop down.',
   params:{amount:{label:'Scale %',min:5,max:80,val:17,step:1}}},
  {id:'nograv',  n:'No Gravity',ico:'🌌', desc:'Toggle gravity on this prop.',
   params:{}},
  {id:'copy',    n:'Duplicator',ico:'📋', desc:'Spawn a copy of the clicked prop.',
   params:{}},
  {id:'button',  n:'Button',     ico:'🔘', desc:'Click a prop to make it a button. Press E to trigger it.',
   params:{}},
  {id:'wire',    n:'Wire',       ico:'🔌', desc:'Click a button, then click any thruster/fading-door/motor prop to connect them.',
   params:{}},
];
var TG_COLORS=[0xff4444,0x44ff88,0x4488ff,0xffff44,0xff44ff,0xffffff,0x888888,0xff8800,0x00ffff];
var tgMode='freeze',tgWeld1=null,tgColIdx=0;

// === THREE.JS ===
var scene,camera,renderer,clock;
var wpnScene=null,wpnCam=null,wpnMeshes=[],curWpnMesh=null;
var started=false,plocked=false,menuOpen=false;
var yaw=0,pitch=0,recoil=0;
var slot=0,activeTab='props';
var noclip=false,godMode=false,flyMode=false,crouching=false,inVeh=null;
var frameC=0,lastFPS=0;
var keys={};
var mlmb=false,mrmb=false,msd=0;
var RC=new THREE.Raycaster();
var _V=new THREE.Vector3(),_Q=new THREE.Quaternion();
var BOUND=200;

function initThree(){
  scene=new THREE.Scene();
  scene.background=new THREE.Color(0x87CEEB);
  scene.fog=new THREE.Fog(0x87CEEB,80,230);
  camera=new THREE.PerspectiveCamera(80,innerWidth/innerHeight,.05,500);
  camera.position.set(0,1.65,8);
  renderer=new THREE.WebGLRenderer({canvas:document.getElementById('gc'),antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.setSize(innerWidth,innerHeight);
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  clock=new THREE.Clock();
  scene.add(new THREE.AmbientLight(0x506070,.75));
  var sun=new THREE.DirectionalLight(0xfffaf0,1.3);
  sun.position.set(60,90,40);sun.castShadow=true;
  sun.shadow.mapSize.set(2048,2048);
  sun.shadow.camera.left=sun.shadow.camera.bottom=-120;
  sun.shadow.camera.right=sun.shadow.camera.top=120;
  sun.shadow.camera.far=350;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x87CEEB,0x556644,.4));
  window.addEventListener('resize',function(){
    camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();
    renderer.setSize(innerWidth,innerHeight);
    if(wpnCam){wpnCam.aspect=innerWidth/innerHeight;wpnCam.updateProjectionMatrix();}
  });
}

function buildWeaponMesh(s){
  // Weapons built facing -Z (into screen). Grip at -Y. Placed lower-right via g.position.
  var g=new THREE.Group();
  var ML=function(c){return new THREE.MeshLambertMaterial({color:c});};
  var MB=function(c,a){var m=new THREE.MeshBasicMaterial({color:c});if(a)m.transparent=true,m.opacity=a;return m;};
  function bx(w,h,d,c,x,y,z){var m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),ML(c));m.position.set(x||0,y||0,z||0);g.add(m);}
  function cy(r,l,c,x,y,z,basic){
    var m=new THREE.Mesh(new THREE.CylinderGeometry(r,r,l,8),basic?MB(c):ML(c));
    m.rotation.x=Math.PI/2;m.position.set(x||0,y||0,z||0);g.add(m);return m;
  }
  function sp(r,c,x,y,z,a){var m=new THREE.Mesh(new THREE.SphereGeometry(r,8,6),a?MB(c,a):MB(c));m.position.set(x||0,y||0,z||0);g.add(m);}

  if(s===0){ // Physgun — long blue barrel, glowing tip
    cy(.025,.82,0x1155bb, 0,.06,-.52);
    [-.18,-.3,-.42,-.54,-.66].forEach(function(z){
      var ring=new THREE.Mesh(new THREE.TorusGeometry(.04,.007,5,10),MB(0x2288ff,.8));
      ring.position.set(0,.06,z);g.add(ring);
    });
    sp(.056,0x44aaff, 0,.06,-.93);sp(.09,0x2266ff, 0,.06,-.93,.38);
    bx(.17,.11,.16,0x0c1e66, 0,.06,-.08);bx(.1,.28,.1,0x091444, 0,-.19,-.04);
    g.position.set(.24,-.22,-.32);

  } else if(s===1){ // Toolgun — orange/black
    bx(.12,.16,.36,0xcc5500, 0,.07,-.26);bx(.09,.05,.3,0x333333, 0,.14,-.23);
    cy(.028,.36,0x222222, 0,.07,-.56);
    bx(.1,.28,.1,0x222222, 0,-.19,-.06);
    sp(.033,0xffaa00, 0,.16,-.12);bx(.08,.04,.18,0x444444, 0,.07,-.1);
    g.position.set(.22,-.2,-.32);

  } else if(s===2){ // Pistol
    bx(.088,.1,.28,0x333333, 0,.07,-.22);bx(.078,.082,.22,0x444444, 0,-.03,-.19);
    cy(.024,.16,0x222222, 0,.07,-.41);
    bx(.086,.29,.098,0x2a2a2a, 0,-.18,-.05);bx(.062,.18,.065,0x222222, 0,-.2,-.02);
    g.position.set(.22,-.22,-.35);

  } else if(s===3){ // Shotgun
    bx(.11,.14,.26,0x333333, 0,.07,-.22);
    cy(.04,.62,0x222222, 0,.07,-.62);cy(.052,.22,0x5a3a1a, 0,.04,-.44);
    bx(.09,.1,.38,0x6b4226, 0,.06,.19);bx(.1,.27,.12,0x5a3a1a, 0,-.19,-.05);
    g.position.set(.28,-.24,-.38);

  } else if(s===4){ // SMG
    bx(.094,.115,.48,0x334433, 0,.05,-.34);
    cy(.024,.3,0x222222, 0,.05,-.66);cy(.034,.12,0x444444, 0,.05,-.72);
    bx(.065,.065,.2,0x445544, 0,.05,.12);
    bx(.068,.24,.072,0x222222, 0,-.18,.02);bx(.092,.21,.092,0x2a2a2a, 0,-.16,-.07);
    g.position.set(.24,-.2,-.34);

  } else if(s===5){ // AR2 — sci-fi pulse rifle
    bx(.108,.125,.52,0x192233, 0,.06,-.36);bx(.085,.04,.44,0x2233aa, 0,.14,-.34);
    cy(.026,.44,0x111122, 0,.06,-.72);
    [-.24,-.38].forEach(function(z){sp(.033,0x4488ff,0,.145,z);sp(.05,0x2255ff,0,.145,z,.32);});
    bx(.065,.065,.24,0x1a2233, 0,.06,.1);bx(.095,.24,.1,0x111122, 0,-.17,-.07);
    g.position.set(.26,-.22,-.36);

  } else if(s===6){ // RPG
    cy(.073,.82,0x223322, 0,.04,-.48);
    cy(.052,.24,0x884422, 0,.04,-.72);
    cy(.075,.1,0x333333, 0,.04,-.04);
    bx(.1,.27,.12,0x222222, 0,-.2,-.34);bx(.11,.12,.16,0x333333, 0,.12,.04);
    [.042,-.042].forEach(function(dx){bx(.02,.18,.12,0x222222,dx,.04,-.72);});
    g.position.set(.2,-.18,-.4);

  } else if(s===7){ // Crowbar
    var shaft=new THREE.Mesh(new THREE.CylinderGeometry(.028,.024,.74,7),ML(0x224455));
    shaft.rotation.x=Math.PI/2;shaft.rotation.z=.24;shaft.position.set(.04,.0,-.4);g.add(shaft);
    var hook=new THREE.Mesh(new THREE.TorusGeometry(.088,.022,6,8,.72),ML(0x224455));
    hook.position.set(.06,.06,-.76);hook.rotation.set(.5,.2,0);g.add(hook);
    var hookb=new THREE.Mesh(new THREE.TorusGeometry(.062,.018,6,8,.55),ML(0x224455));
    hookb.position.set(.02,-.02,-.04);hookb.rotation.set(-.8,0,.2);g.add(hookb);
    var grip=new THREE.Mesh(new THREE.CylinderGeometry(.036,.028,.26,8),ML(0x333333));
    grip.rotation.x=Math.PI/2;grip.rotation.z=.24;grip.position.set(.02,-.01,-.1);g.add(grip);
    g.position.set(.2,-.2,-.34);g.rotation.set(.08,0,.12);
  }
  return g;
}

function initWpnScene(){
  wpnScene=new THREE.Scene();
  wpnCam=new THREE.PerspectiveCamera(50,innerWidth/innerHeight,.01,8);
  wpnScene.add(wpnCam);
  wpnScene.add(new THREE.AmbientLight(0x707888,2.6));
  var wdl=new THREE.DirectionalLight(0xffffff,1.0);wdl.position.set(1,2,1);wpnScene.add(wdl);
  for(var i=0;i<8;i++){
    var inner=buildWeaponMesh(i);
    // Wrapper provides animation offset; inner has fixed build-time position
    var wrapper=new THREE.Group();wrapper.add(inner);
    wpnMeshes.push(wrapper);wpnCam.add(wrapper);wrapper.visible=(i===0);
  }
  curWpnMesh=wpnMeshes[0];
  wpnMeshes.forEach(function(w){w.traverse(function(o){o.frustumCulled=false;});});
}

function mkTex(col){
  var cv=document.createElement('canvas');cv.width=cv.height=64;
  var c=cv.getContext('2d');
  c.fillStyle='#'+col.toString(16).padStart(6,'0');c.fillRect(0,0,64,64);
  c.fillStyle='rgba(0,0,0,.07)';
  for(var i=0;i<8;i++)for(var j=0;j<8;j++)if((i+j)%2===0)c.fillRect(i*8,j*8,8,8);
  c.fillStyle='rgba(255,255,255,.06)';c.fillRect(0,0,64,5);
  c.fillStyle='rgba(0,0,0,.15)';c.fillRect(0,59,64,5);
  return new THREE.CanvasTexture(cv);
}

function createWorld(){
  scene.background=new THREE.Color(0x87b0c8);
  scene.fog=new THREE.FogExp2(0x87b0c8,.0028);

  var ML=function(col){return new THREE.MeshLambertMaterial({color:col});};
  function bx(w,h,d,col,x,y,z){
    var m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),ML(col));
    m.position.set(x,y+h/2,z);scene.add(m);return m;
  }
  function bxAbs(w,h,d,col,x,y,z){
    var m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),ML(col));
    m.position.set(x,y,z);scene.add(m);return m;
  }

  // ── MAIN GROUND PLANE ──────────────────────────────────────
  var gTex=mkTex(0x888888);gTex.wrapS=gTex.wrapT=THREE.RepeatWrapping;gTex.repeat.set(100,100);
  var ground=new THREE.Mesh(new THREE.PlaneGeometry(600,600),new THREE.MeshLambertMaterial({map:gTex,color:0x999999}));
  ground.rotation.x=-Math.PI/2;ground.position.y=0;ground.receiveShadow=true;scene.add(ground);
  // Sub-ground kill volume
  bxAbs(600,4,600,0x555555,0,-2.2,0);

  // ── CONCRETE MAIN SLAB (the big flat play area) ────────────
  bx(120,.55,100,0x909898, 0,0,0);

  // ── LARGE ORANGE BUILDING (left side) ──────────────────────
  var OBW=36,OBH=14,OBD=28,OBX=-48,OBZ=0;
  var wallC=0xc87844,walldC=0xa86030,roofC=0x8a8a8a;
  // Outer shell
  bx(OBW,OBH,.6,wallC, OBX,0,OBZ-OBD/2);  // front
  bx(OBW,OBH,.6,wallC, OBX,0,OBZ+OBD/2);  // back
  bx(.6,OBH,OBD,wallC, OBX-OBW/2,0,OBZ);  // left
  bx(.6,OBH,OBD,wallC, OBX+OBW/2,0,OBZ);  // right
  bx(OBW+1.2,.5,OBD+1.2,roofC, OBX,OBH,OBZ); // roof
  bx(OBW,.5,OBD,0x888880, OBX,0,OBZ); // floor
  // 2nd floor divider slab
  bx(OBW,.4,OBD,0x909090, OBX,OBH/2,OBZ);
  // 2nd floor walls
  bx(OBW,OBH/2,.6,walldC, OBX,OBH/2,OBZ-OBD/2);
  bx(OBW,OBH/2,.6,walldC, OBX,OBH/2,OBZ+OBD/2);
  bx(.6,OBH/2,OBD,walldC, OBX-OBW/2,OBH/2,OBZ);
  bx(.6,OBH/2,OBD,walldC, OBX+OBW/2,OBH/2,OBZ);
  bx(OBW+1.2,.4,OBD+1.2,roofC, OBX,OBH+OBH/2,OBZ); // top roof
  // Windows - ground floor (front)
  var wGlass=new THREE.MeshLambertMaterial({color:0x3366aa,transparent:true,opacity:.55});
  [-14,-4,6,16].forEach(function(ox){
    var ww=new THREE.Mesh(new THREE.BoxGeometry(4,2.8,.15),wGlass);ww.position.set(OBX+ox,3.8,OBZ-OBD/2-.01);scene.add(ww);
    var ww2=ww.clone();ww2.position.z=OBZ+OBD/2+.01;scene.add(ww2);
  });
  // Windows - 2nd floor
  [-12,0,12].forEach(function(ox){
    var ww3=new THREE.Mesh(new THREE.BoxGeometry(5,2.5,.15),wGlass);ww3.position.set(OBX+ox,OBH+2.5,OBZ-OBD/2-.01);scene.add(ww3);
  });
  // Door opening (gap in front wall, no actual mesh)
  bx(3.5,4.5,.7,wallC, OBX-14,0,OBZ-OBD/2); // doorframe sides filled (already done by wall)
  // Interior staircase (ground to 2nd)
  for(var si=0;si<7;si++){bx(3,.35,1.8,0x888888, OBX+15,si*.9+.17,OBZ-10+si*1.8);}
  // Interior partition wall
  bx(.5,OBH/2,OBD*.6,walldC, OBX+5,0,OBZ);

  // ── SMALL SHED / BUILDING ──────────────────────────────────
  var shedC=0x9a9090;
  bx(16,6,.5,shedC, 32,0,-18);bx(16,6,.5,shedC, 32,0,-4);
  bx(.5,6,14,shedC, 24,0,-11);bx(.5,6,14,shedC, 40,0,-11);
  bx(17.5,.4,15.5,roofC, 32,6,-11);
  bx(16,.3,14,0x777777, 32,0,-11); // floor
  // Door gap
  bx(3,4,.6,0x887755, 32,0,-18); // door frame marker

  // ── ELEVATED PLATFORM / RAISED AREA ────────────────────────
  bx(30,.5,22,0x888888, 40,10,26);  // big raised slab
  // Support columns
  [[26,18],[26,34],[54,18],[54,34]].forEach(function(p){bx(2,10,2,0x7a7a7a,p[0],0,p[1]);});
  // Stairs up
  for(var pi=0;pi<8;pi++){bx(3,.32,2,0x808080,26+pi*1.3,pi*.32*2,16+pi*2);}

  // ── RAMP ───────────────────────────────────────────────────
  for(var ri=0;ri<10;ri++){bx(10,.3,2.2,0x888080,-10,ri*.65,-(12+ri*2.2));}
  bx(.4,7,22.2,0x757575,-15,.5,-23);
  bx(.4,7,22.2,0x757575,-5,.5,-23);

  // ── WATER POOL ─────────────────────────────────────────────
  var poolX=38,poolZ=-28;
  bxAbs(22,1,18,0x7a8888,poolX,-.5,poolZ);
  [[-9,0,-9],[-9,0,9],[9,0,-9],[9,0,9]].forEach(function(p){});
  bx(22,.5,.5,0x778888,poolX,0,poolZ-9);bx(22,.5,.5,0x778888,poolX,0,poolZ+9);
  bx(.5,.5,18,0x778888,poolX-11,0,poolZ);bx(.5,.5,18,0x778888,poolX+11,0,poolZ);
  var waterM=new THREE.Mesh(new THREE.PlaneGeometry(21,17),new THREE.MeshLambertMaterial({color:0x1a4d88,transparent:true,opacity:.75}));
  waterM.rotation.x=-Math.PI/2;waterM.position.set(poolX,-.02,poolZ);scene.add(waterM);

  // ── PILLARS ARENA ──────────────────────────────────────────
  [[-6,-6],[6,-6],[-6,6],[6,6]].forEach(function(p){
    bx(1.4,12,1.4,0x7a7a7a,p[0],0,p[1]);
    bxAbs(2.2,.4,2.2,0x888888,p[0],12.4,p[1]);
  });

  // ── ROAD ───────────────────────────────────────────────────
  var roadM=new THREE.MeshLambertMaterial({color:0x444444});
  var road=new THREE.Mesh(new THREE.BoxGeometry(9,.4,250),roadM);road.position.set(-1,.2,0);scene.add(road);
  for(var li=-120;li<120;li+=5){
    var ln=new THREE.Mesh(new THREE.BoxGeometry(.22,.42,2.4),new THREE.MeshBasicMaterial({color:0xffdd00}));
    ln.position.set(-1,.2,li);scene.add(ln);
  }

  // ── SCATTERED STATIC CRATES ────────────────────────────────
  [[8,.4,5,0x8B6914],[9.5,.4,4.5,0x8B6914],[8.8,.4,5.8,0x7a8a9a]].forEach(function(p){
    bx(.82,.82,.82,p[3],p[0],p[1],p[2]);
  });

  // ── SPAWN MARKER ───────────────────────────────────────────
  var spawnMark=new THREE.Mesh(new THREE.CircleGeometry(.8,8),new THREE.MeshBasicMaterial({color:0x4488ff,transparent:true,opacity:.35}));
  spawnMark.rotation.x=-Math.PI/2;spawnMark.position.set(0,.56,6);scene.add(spawnMark);

  // ── AMBIENT LIGHTS ─────────────────────────────────────────
  scene.add(new THREE.HemisphereLight(0xadd8e6,0x556644,.7));
}


// === PHYSICS ===
var physBodies=[];
function PhysBody(mesh,hx,hy,hz,mass,opts){
  this.mesh=mesh;this.hx=hx;this.hy=hy;this.hz=hz;this.mass=Math.max(mass||10,.1);
  this.vel=new THREE.Vector3();this.angVel=new THREE.Vector3();
  this.frozen=false;this.sleeping=false;this.onGround=false;this.sleepT=0;
  this.noGravity=false;this.noCollide=false;this.explosive=false;
  this.restitution=(opts&&opts.res!=null)?opts.res:0.14;
  this.radius=Math.sqrt(hx*hx+hy*hy+hz*hz)*.85;
  physBodies.push(this);
}
PhysBody.prototype.wake=function(){this.sleeping=false;this.sleepT=0;};
PhysBody.prototype.impulse=function(v){if(this.frozen)return;this.wake();this.vel.addScaledVector(v,1/this.mass);};
PhysBody.prototype.update=function(dt){
  if(this.frozen||this.sleeping)return;
  // Gravity — 24 units/s² feels solid for the scale
  if(!this.noGravity)this.vel.y-=24*dt;
  // Very light air drag — objects should coast realistically
  var airD=Math.pow(.997,dt*60);
  this.vel.x*=airD;this.vel.z*=airD;
  this.angVel.multiplyScalar(Math.pow(.88,dt*60));
  this.mesh.position.addScaledVector(this.vel,dt);
  var al=this.angVel.length();
  if(al>.0005){_Q.setFromAxisAngle(_V.set(this.angVel.x/al,this.angVel.y/al,this.angVel.z/al),al*dt);this.mesh.quaternion.premultiply(_Q);}
  // Floor collision
  if(this.mesh.position.y<this.hy){
    this.mesh.position.y=this.hy;
    this.onGround=true;
    if(this.vel.y<-2){SFX.impact();} // only sound on hard landing
    var res=this.restitution;
    if(this.vel.y<0)this.vel.y=-this.vel.y*res;
    if(Math.abs(this.vel.y)<0.18)this.vel.y=0;
    // Sliding friction proportional to normal force (mass*g)
    var fric=0.78; var gFric=Math.pow(fric,dt*60);
    this.vel.x*=gFric;this.vel.z*=gFric;
    this.angVel.multiplyScalar(Math.pow(.55,dt*60));
  } else {this.onGround=false;}
  if(this.mesh.position.y<-100){this.mesh.position.set(0,3,0);this.vel.set(0,0,0);this.angVel.set(0,0,0);}
  var spd2=this.vel.lengthSq()+this.angVel.lengthSq();
  if(this.onGround&&spd2<0.006){
    this.sleepT+=dt;if(this.sleepT>0.65){this.sleeping=true;this.vel.set(0,0,0);this.angVel.set(0,0,0);}
  } else {this.sleepT=0;}
  if(Math.abs(this.mesh.position.x)>BOUND){this.vel.x*=-.5;this.mesh.position.x=Math.sign(this.mesh.position.x)*BOUND;}
  if(Math.abs(this.mesh.position.z)>BOUND){this.vel.z*=-.5;this.mesh.position.z=Math.sign(this.mesh.position.z)*BOUND;}
};
function collide(){
  var n=physBodies.length;
  for(var i=0;i<n;i++){
    var a=physBodies[i];
    if(!a||!a.mesh||a.noCollide||(a.frozen&&a.sleeping))continue;
    for(var j=i+1;j<n;j++){
      var b=physBodies[j];
      if(!b||!b.mesh||b.noCollide)continue;
      if(a.frozen&&b.frozen)continue;
      if(a._weldPeer===b||b._weldPeer===a)continue;
      // AABB broad phase
      var dx=b.mesh.position.x-a.mesh.position.x;
      var dy=b.mesh.position.y-a.mesh.position.y;
      var dz=b.mesh.position.z-a.mesh.position.z;
      var overlapX=a.hx+b.hx-Math.abs(dx);if(overlapX<=0)continue;
      var overlapY=a.hy+b.hy-Math.abs(dy);if(overlapY<=0)continue;
      var overlapZ=a.hz+b.hz-Math.abs(dz);if(overlapZ<=0)continue;
      // Find minimum penetration axis
      var nx=0,ny=0,nz=0,pen=0;
      if(overlapX<=overlapY&&overlapX<=overlapZ){pen=overlapX;nx=dx>0?1:-1;}
      else if(overlapY<=overlapX&&overlapY<=overlapZ){pen=overlapY;ny=dy>0?1:-1;}
      else{pen=overlapZ;nz=dz>0?1:-1;}
      // Positional correction
      var invMA=a.frozen?0:1/a.mass, invMB=b.frozen?0:1/b.mass;
      var invMsum=invMA+invMB; if(invMsum<1e-9)continue;
      // Slop: don't correct tiny overlaps to reduce jitter
      var slop=0.005,corrMag=Math.max(0,pen-slop)*0.85;
      var corrA=corrMag*invMA/invMsum, corrB=corrMag*invMB/invMsum;
      if(!a.frozen){a.mesh.position.x-=nx*corrA;a.mesh.position.y-=ny*corrA;a.mesh.position.z-=nz*corrA;}
      if(!b.frozen){b.mesh.position.x+=nx*corrB;b.mesh.position.y+=ny*corrB;b.mesh.position.z+=nz*corrB;}
      // Velocity impulse
      var rv=(b.vel.x-a.vel.x)*nx+(b.vel.y-a.vel.y)*ny+(b.vel.z-a.vel.z)*nz;
      if(rv<0){
        var e2=Math.min(a.restitution,b.restitution);
        var imp=-(1+e2)*rv/invMsum;
        imp=Math.max(-60,Math.min(60,imp));
        if(!a.frozen){a.vel.x-=imp*invMA*nx;a.vel.y-=imp*invMA*ny;a.vel.z-=imp*invMA*nz;}
        if(!b.frozen){b.vel.x+=imp*invMB*nx;b.vel.y+=imp*invMB*ny;b.vel.z+=imp*invMB*nz;}
        // Angular spin from off-center impact
        var spinMag=Math.abs(imp)*0.06;
        if(!a.frozen&&ny===0){a.angVel.x+=nz*spinMag*invMA;a.angVel.z-=nx*spinMag*invMA;}
        if(!b.frozen&&ny===0){b.angVel.x-=nz*spinMag*invMB;b.angVel.z+=nx*spinMag*invMB;}
        a.wake();b.wake();
      }
    }
  }
}
var welds=[];
function addWeld(a,b){
  // Store relative offset AND relative rotation
  var relOff=b.mesh.position.clone().sub(a.mesh.position);
  // Transform offset to A's local space so it rotates with A
  var aInvQ=a.mesh.quaternion.clone().invert();
  var localOff=relOff.clone().applyQuaternion(aInvQ);
  var relQ=b.mesh.quaternion.clone().premultiply(aInvQ);
  a._weldPeer=b;b._weldPeer=a;  // pre-tag so collision skips immediately
  welds.push({a:a,b:b,localOff:localOff,relQ:relQ});
  SFX.weld();showNotif('🔗 Welded!');
}
function updateWelds(){
  for(var i=0;i<welds.length;i++){
    var w=welds[i];
    if(!w.a||!w.a.mesh||!w.b||!w.b.mesh)continue;
    // Hard position constraint — b snaps to exact world offset from a
    var worldOff=w.localOff.clone().applyQuaternion(w.a.mesh.quaternion);
    var tgt=w.a.mesh.position.clone().add(worldOff);
    w.b.mesh.position.copy(tgt);
    // Match b rotation to a + relative rotation
    w.b.mesh.quaternion.copy(w.a.mesh.quaternion).multiply(w.relQ);
    // Combined-mass velocity so welded group moves as one solid object
    var tmass=w.a.mass+w.b.mass;
    var sv=w.a.vel.clone().multiplyScalar(w.a.mass/tmass).add(w.b.vel.clone().multiplyScalar(w.b.mass/tmass));
    w.a.vel.copy(sv);w.b.vel.copy(sv);
    w.b.angVel.copy(w.a.angVel);
    w.b.sleeping=w.a.sleeping;w.b.onGround=w.a.onGround;w.b.frozen=w.a.frozen;
    // Tag peers so collide() skips them
    w.a._weldPeer=w.b;w.b._weldPeer=w.a;
  }
}
var thrusters=[],winches=[],fadingDoors=[],motors=[];
function getTGP(id,p){var m=TG_MODES.find(function(m){return m.id===id;});return m&&m.params[p]?m.params[p].val:null;}
function toggleThruster(pb,hitPt,hitNorm){
  // Check if clicking near an existing thruster on this object → remove that one
  if(hitPt){
    for(var ci=thrusters.length-1;ci>=0;ci--){
      if(thrusters[ci].pb!==pb)continue;
      var wpt=pb.mesh.localToWorld(thrusters[ci].localPt.clone());
      if(wpt.distanceTo(hitPt)<0.85){
        if(thrusters[ci].ind)scene.remove(thrusters[ci].ind);
        thrusters.splice(ci,1);
        var rem=thrusters.filter(function(t){return t.pb===pb;}).length;
        showNotif('🚀 Thruster removed'+(rem?' ('+rem+' remaining)':''));SFX.freeze();return;
      }
    }
  }
  var dir=hitNorm?hitNorm.clone().negate():new THREE.Vector3(0,1,0);
  var force=getTGP('thruster','force')||120;
  var key=getTGP('thruster','key');key=(key==='none')?null:key;
  var ind=new THREE.Mesh(new THREE.ConeGeometry(.07,.26,6),new THREE.MeshBasicMaterial({color:0xff5500,transparent:true,opacity:.88}));
  scene.add(ind);
  var localPt=hitPt?pb.mesh.worldToLocal(hitPt.clone()):new THREE.Vector3(0,-pb.hy*.8,0);
  thrusters.push({pb:pb,dir:dir,localPt:localPt,force:force,key:key,ind:ind,t:0});
  var cnt=thrusters.filter(function(t){return t.pb===pb;}).length;
  showNotif('🚀 Thruster #'+cnt+(key?' — Hold ['+key.toUpperCase()+']':' — Always on'));SFX.spawn();
}
function addWinch(pb1,pb2){
  var len=getTGP('winch','length')||4,str=getTGP('winch','strength')||25;
  var key=getTGP('winch','key');key=(key==='none')?null:key;
  var geo=new THREE.BufferGeometry().setFromPoints([pb1.mesh.position.clone(),pb2.mesh.position.clone()]);
  var line=new THREE.Line(geo,new THREE.LineBasicMaterial({color:0x998866}));scene.add(line);
  winches.push({a:pb1,b:pb2,len:len,str:str,key:key,line:line});
  showNotif('⛓ Winch!'+(key?' Key ['+key.toUpperCase()+']':''));SFX.weld();
}
function addFadingDoor(pb){
  var key=getTGP('fading','key')||'e',spd=getTGP('fading','speed')||4;
  var existing=fadingDoors.find(function(fd){return fd.pb===pb;});
  if(existing){fadingDoors=fadingDoors.filter(function(fd){return fd.pb!==pb;});
    pb.mesh.traverse(function(o){if(o.isMesh&&o.material){o.material=o.material.clone();o.material.transparent=false;o.material.opacity=1;}});
    showNotif('🚪 Fading door removed');return;}
  pb.mesh.traverse(function(o){if(o.isMesh&&o.material){o.material=o.material.clone();o.material.transparent=true;o.material.opacity=1;}});
  fadingDoors.push({pb:pb,key:key,spd:spd,open:false,alpha:1});
  showNotif('🚪 Fading door — ['+key.toUpperCase()+'] toggles it');SFX.freeze();
}
function addMotor(pb){
  var rpm=getTGP('motor','rpm')||120,axis=getTGP('motor','axis')||'y';
  var existing=motors.findIndex(function(m){return m.pb===pb;});
  if(existing>=0){motors.splice(existing,1);showNotif('⚙ Motor removed');return;}
  motors.push({pb:pb,axis:axis,spd:rpm*Math.PI/30});
  showNotif('⚙ Motor '+rpm+' RPM on '+axis.toUpperCase());SFX.spawn();
}
function triggerFading(key){fadingDoors.forEach(function(fd){if(fd.key===key){fd.open=!fd.open;SFX.freeze();}});}
function updateThrusters(dt){
  for(var i=thrusters.length-1;i>=0;i--){
    var th=thrusters[i];
    if(!th.pb||!th.pb.mesh){if(th.ind)scene.remove(th.ind);thrusters.splice(i,1);continue;}
    th.t+=dt;
    var fire=!th.key||(th.key&&keys[th.key]);
    if(fire&&!th.pb.frozen){
      var _tf=th.force*dt/Math.max(th.pb.mass,.5);
      th.pb.vel.addScaledVector(th.dir,_tf);
      // Cap velocity to prevent runaway speeds
      if(th.pb.vel.length()>55)th.pb.vel.setLength(55);
      th.pb.wake();
    }
    if(th.ind){
      var wp=th.pb.mesh.localToWorld(th.localPt.clone());
      th.ind.position.copy(wp);
      th.ind.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),th.dir.clone().negate());
      th.ind.scale.y=fire?(.78+Math.sin(th.t*20)*.3):0.45;
      th.ind.material.opacity=fire?(.85+Math.sin(th.t*25)*.1):.18;
      th.ind.material.color.setHex(fire?0xff5500:0x888888);
    }
    if(fire&&Math.random()<.32){
      var _tp=th.pb.mesh.localToWorld(th.localPt.clone());
      spawnParts(_tp,0xff6600,2,2.0);
    }
  }
  for(var wi=winches.length-1;wi>=0;wi--){
    var w=winches[wi];
    if(!w.a||!w.a.mesh||!w.b||!w.b.mesh){if(w.line)scene.remove(w.line);winches.splice(wi,1);continue;}
    if(!w.key||keys[w.key]){
      var dv=w.b.mesh.position.clone().sub(w.a.mesh.position),dist=dv.length();
      if(dist>w.len){var pull=dv.normalize().multiplyScalar(w.str*dt);if(!w.a.frozen){w.a.vel.add(pull);w.a.wake();}if(!w.b.frozen){w.b.vel.sub(pull);w.b.wake();}}
    }
    if(w.line){w.line.geometry.setFromPoints([w.a.mesh.position.clone(),w.b.mesh.position.clone()]);w.line.geometry.computeBoundingSphere();}
  }
  for(var fi=fadingDoors.length-1;fi>=0;fi--){
    var fd=fadingDoors[fi];if(!fd.pb||!fd.pb.mesh){fadingDoors.splice(fi,1);continue;}
    var ta=fd.open?0.05:1;fd.alpha+=(ta-fd.alpha)*Math.min(1,fd.spd*dt);
    fd.pb.mesh.traverse(function(o){if(o.isMesh&&o.material&&o.material.transparent)o.material.opacity=fd.alpha;});
    fd.pb.noCollide=(fd.alpha<0.2);
  }
  for(var mi=0;mi<motors.length;mi++){var mo=motors[mi];if(!mo.pb||!mo.pb.mesh)continue;mo.pb.mesh.rotation[mo.axis]+=mo.spd*dt;mo.pb.frozen=true;}
}

// === PARTICLES ===
var parts=[];
function spawnParts(pos,col,n,sp){
  n=n||8;sp=sp||4;
  for(var i=0;i<n;i++){
    var m=new THREE.Mesh(new THREE.SphereGeometry(.04,3,3),new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:1}));
    m.position.copy(pos);scene.add(m);
    parts.push({mesh:m,vel:new THREE.Vector3((Math.random()-.5)*sp,Math.random()*sp,(Math.random()-.5)*sp),life:.35+Math.random()*.35,age:0});
  }
}
function muzzle(){
  var dir=new THREE.Vector3();camera.getWorldDirection(dir);
  var m=new THREE.Mesh(new THREE.SphereGeometry(.12,5,4),new THREE.MeshBasicMaterial({color:0xffffaa,transparent:true,opacity:.9}));
  m.position.copy(camera.position).addScaledVector(dir,.5);scene.add(m);
  parts.push({mesh:m,vel:new THREE.Vector3(0,0,0),life:.05,age:0});
}
function spawnTracer(from,to){
  var dir=to.clone().sub(from),len=dir.length();
  var m=new THREE.Mesh(new THREE.BoxGeometry(.015,.015,len),new THREE.MeshBasicMaterial({color:0xffffaa,transparent:true,opacity:.65}));
  m.position.copy(from).addScaledVector(dir.clone().normalize(),len/2);m.lookAt(to);scene.add(m);
  parts.push({mesh:m,vel:new THREE.Vector3(0,0,0),life:.09,age:0});
}
function updateParts(dt){
  for(var i=parts.length-1;i>=0;i--){
    var p=parts[i];p.age+=dt;p.vel.y-=14*dt;
    if(p.mesh)p.mesh.position.addScaledVector(p.vel,dt);
    if(p.mesh&&p.mesh.material)p.mesh.material.opacity=Math.max(0,1-p.age/p.life);
    if(p.age>=p.life){if(p.mesh)scene.remove(p.mesh);parts.splice(i,1);}
  }
}

// === PROJECTILES ===
var projs=[];
function fireProj(orig,dir,spd,dmg,isP,col,explodes){
  col=col||0xff6600;
  var geo=explodes?new THREE.CylinderGeometry(.04,.07,.28,8):new THREE.SphereGeometry(.07,5,4);
  var m=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color:col}));
  if(explodes){m.rotation.x=Math.PI/2;}
  m.position.copy(orig);scene.add(m);
  projs.push({mesh:m,vel:dir.clone().multiplyScalar(spd),dmg:dmg,isP:isP,explodes:!!explodes,life:6,age:0});
}
function updateProjs(dt){
  for(var i=projs.length-1;i>=0;i--){
    var p=projs[i];p.age+=dt;if(!p.mesh){projs.splice(i,1);continue;}
    p.vel.y-=(p.explodes?4:8)*dt;
    p.mesh.position.addScaledVector(p.vel,dt);
    if(p.explodes&&p.vel.lengthSq()>.01){p.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),p.vel.clone().normalize());}
    var hit=false;
    if(p.mesh.position.y<=.15){
      if(p.explodes)doExplode(p.mesh.position.clone(),5,p.dmg);
      else spawnParts(p.mesh.position.clone(),0xffaa22,4,2);
      hit=true;
    }
    if(!p.isP&&!hit&&p.mesh.position.distanceTo(camera.position)<1.2){plrHit(p.dmg);if(p.explodes)doExplode(p.mesh.position.clone(),3,p.dmg);hit=true;}
    if(!hit){for(var ei=0;ei<ents.length;ei++){var e=ents[ei];if(!e||!e.mesh||e.etype!=='npc'||e.dead)continue;if(p.isP&&p.mesh.position.distanceTo(e.mesh.position)<1.1){e.takeDmg(p.dmg);if(p.explodes)doExplode(p.mesh.position.clone(),4,p.dmg);else spawnParts(p.mesh.position.clone(),0xff2200,5,3);hit=true;break;}}}
    if(!hit){for(var bi=0;bi<physBodies.length;bi++){var b=physBodies[bi];if(!b||!b.mesh)continue;if(p.mesh.position.distanceTo(b.mesh.position)<b.radius+.15){b.impulse(p.vel.clone().multiplyScalar(.8/Math.max(b.mass,.5)));b.wake();if(p.explodes)doExplode(p.mesh.position.clone(),5,p.dmg);else{if(b.explosive)doExplode(b.mesh.position.clone(),5,180);spawnParts(p.mesh.position.clone(),0xffcc44,4,2);}hit=true;break;}}}
    if(hit||p.age>p.life){scene.remove(p.mesh);projs.splice(i,1);}
  }
}
function doExplode(pos,rad,dmg){
  spawnParts(pos,0xff8800,22,9);spawnParts(pos,0xff4400,12,5);SFX.explode();kfeed('💥 EXPLOSION!');
  for(var bi=0;bi<physBodies.length;bi++){var b=physBodies[bi];if(!b||!b.mesh)continue;var d=b.mesh.position.distanceTo(pos);if(d<rad){b.wake();b.impulse(b.mesh.position.clone().sub(pos).normalize().multiplyScalar((1-d/rad)*16));}}
  if(camera.position.distanceTo(pos)<rad)plrHit(dmg*(1-camera.position.distanceTo(pos)/rad));
  for(var ei=0;ei<ents.length;ei++){var e=ents[ei];if(!e||!e.mesh||e.etype!=='npc'||e.dead)continue;var de=e.mesh.position.distanceTo(pos);if(de<rad)e.takeDmg(dmg*(1-de/rad));}
}

// === PHYSGUN ===
var PG={held:null,dist:5,tDist:5,beam:null,rotating:false,rotX:0,rotY:0,rotZ:0};
function pgInit(){
  var geo=new THREE.BufferGeometry();
  var pos=new Float32Array(6);geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
  PG.beam=new THREE.Line(geo,new THREE.LineBasicMaterial({color:0x44aaff,transparent:true,opacity:.85}));
  PG.beam.visible=false;scene.add(PG.beam);
}
function pgFindPB(obj){
  if(!obj)return null;
  for(var i=0;i<physBodies.length;i++){var b=physBodies[i];if(!b||!b.mesh)continue;if(b.mesh===obj||b.mesh===obj.parent||(obj.parent&&b.mesh===obj.parent.parent))return b;}
  return null;
}
function pgGrab(){
  var dir=new THREE.Vector3();camera.getWorldDirection(dir);
  RC.far=60;RC.set(camera.position,dir);
  var hits=RC.intersectObjects(physBodies.map(function(b){return b.mesh;}),true);RC.far=Infinity;
  if(!hits.length)return;
  var pb=pgFindPB(hits[0].object);
  if(pb&&!pb.frozen){
    PG.held=pb;PG.dist=Math.max(1.5,hits[0].distance);PG.tDist=PG.dist;
    msd=0;
    pb.vel.set(0,0,0);pb.angVel.set(0,0,0);pb.sleeping=false;
    document.getElementById('xh').classList.add('grab');SFX.pgrab();
  }
}
function pgRelease(){
  if(PG.held){PG.held.wake();PG.held=null;}
  document.getElementById('xh').classList.remove('grab');
  if(PG.beam)PG.beam.visible=false;
}
function pgThrow(){
  if(!PG.held)return;
  var dir=new THREE.Vector3();camera.getWorldDirection(dir);
  PG.held.vel.copy(dir.multiplyScalar(24));PG.held.sleeping=false;SFX.pthrow();
  pgRelease();
}
function pgFreeze(pb){
  if(!pb)return;pb.frozen=!pb.frozen;pb.vel.set(0,0,0);pb.angVel.set(0,0,0);
  pb.mesh.traverse(function(c){if(c.isMesh&&c.material)c.material.emissive=new THREE.Color(pb.frozen?0x0044aa:0);});
  showNotif(pb.frozen?'❄ FROZEN':'🔓 UNFROZEN');pb.frozen?SFX.freeze():SFX.unfreeze();
  document.getElementById('xh').classList.toggle('frz',pb.frozen);
}
function pgUpdate(dt){
  if(!PG.held||!PG.held.mesh)return;
  var pb=PG.held;if(pb.frozen){pgRelease();return;}
  PG.tDist+=msd*.5;PG.tDist=Math.max(1.5,Math.min(38,PG.tDist));msd=0;
  PG.dist+=(PG.tDist-PG.dist)*.28;
  var dir=new THREE.Vector3();camera.getWorldDirection(dir);
  var tgt=camera.position.clone().addScaledVector(dir,PG.dist);

  // Rotation mode: hold E + move mouse to rotate freely
  PG.rotating=keys['e'];
  if(!PG.rotating){
    // Move to target — give it velocity so it collides properly on release
    var prevPos=pb.mesh.position.clone();
    pb.mesh.position.lerp(tgt, Math.min(1, dt*18));
    pb.vel.copy(pb.mesh.position.clone().sub(prevPos).divideScalar(Math.max(dt,0.001)));
    pb.vel.clampLength(0,40);
    pb.angVel.multiplyScalar(Math.pow(.25,dt));
    pb.sleeping=false;
  }

  if(PG.beam){
    PG.beam.visible=true;
    var bp=PG.beam.geometry.attributes.position;
    bp.setXYZ(0,camera.position.x,camera.position.y,camera.position.z);
    bp.setXYZ(1,pb.mesh.position.x,pb.mesh.position.y,pb.mesh.position.z);
    bp.needsUpdate=true;
    PG.beam.material.color.setHSL((.5+Math.sin(Date.now()*.003)*.15),1,.65);
    PG.beam.material.opacity=PG.rotating?.4:.85;
  }
}

// === TOOLGUN ===
function getRayHit(){
  var dir=new THREE.Vector3();camera.getWorldDirection(dir);
  RC.far=50;RC.set(camera.position,dir);
  var hits=RC.intersectObjects(physBodies.map(function(b){return b.mesh;}),true);RC.far=Infinity;
  if(!hits.length)return null;
  var pb=pgFindPB(hits[0].object);
  return pb?{pb:pb,point:hits[0].point}:null;
}
function useTool(){
  RC.far=80;var dT=new THREE.Vector3();camera.getWorldDirection(dT);RC.set(camera.position,dT);
  var hits=RC.intersectObjects(physBodies.map(function(b){return b.mesh;}),true);RC.far=Infinity;
  if(!hits.length){showNotif('No prop in range');return;}
  var pb=pgFindPB(hits[0].object);if(!pb)return;
  var hitPt=hits[0].point.clone();
  var hitNorm=new THREE.Vector3(0,1,0);
  if(hits[0].face)hitNorm.copy(hits[0].face.normal).applyQuaternion(hits[0].object.getWorldQuaternion(new THREE.Quaternion()));
  SFX.tool();
  if(tgMode==='freeze'){pgFreeze(pb);}
  else if(tgMode==='weld'){
    if(!tgWeld1){tgWeld1=pb;showNotif('🔗 Click second prop…');}
    else if(tgWeld1===pb){tgWeld1=null;showNotif('Same prop!');}
    else{addWeld(tgWeld1,pb);tgWeld1=null;}
  }
  else if(tgMode==='thruster'){toggleThruster(pb,hitPt,hitNorm);}
  else if(tgMode==='winch'){
    if(!tgWeld1){tgWeld1=pb;showNotif('⛓ Click second prop…');}
    else if(tgWeld1===pb){tgWeld1=null;showNotif('Same prop!');}
    else{addWinch(tgWeld1,pb);tgWeld1=null;}
  }
  else if(tgMode==='fading'){addFadingDoor(pb);}
  else if(tgMode==='motor'){addMotor(pb);}
  else if(tgMode==='color'){
    pb.mesh.traverse(function(ch){if(ch.isMesh&&ch.material)ch.material=new THREE.MeshLambertMaterial({color:TG_COLORS[tgColIdx%TG_COLORS.length]});});
    tgColIdx++;showNotif('🎨 Painted');
  }
  else if(tgMode==='delete'){
    if(PG.held===pb)pgRelease();scene.remove(pb.mesh);
    var bi=physBodies.indexOf(pb);if(bi>-1)physBodies.splice(bi,1);
    welds=welds.filter(function(w){return w.a!==pb&&w.b!==pb;});
    thrusters=thrusters.filter(function(th){if(th.pb===pb){if(th.ind)scene.remove(th.ind);return false;}return true;});
    winches=winches.filter(function(w){if(w.a===pb||w.b===pb){if(w.line)scene.remove(w.line);return false;}return true;});
    fadingDoors=fadingDoors.filter(function(fd){return fd.pb!==pb;});
    motors=motors.filter(function(m){return m.pb!==pb;});
    if(pb._eid&&isMulti)mpSendDelete(pb._eid);
    SFX.delete();showNotif('🗑 Deleted');
  }
  else if(tgMode==='inflate'){var sc1=1+(getTGP('inflate','amount')||20)/100;pb.mesh.scale.multiplyScalar(sc1);pb.radius*=sc1;pb.hx*=sc1;pb.hy*=sc1;pb.hz*=sc1;showNotif('🎈 Inflated');}
  else if(tgMode==='deflate'){var sc2=1-(getTGP('deflate','amount')||17)/100;pb.mesh.scale.multiplyScalar(sc2);pb.radius*=sc2;pb.hx*=sc2;pb.hy*=sc2;pb.hz*=sc2;showNotif('🔽 Deflated');}
  else if(tgMode==='nograv'){pb.noGravity=!pb.noGravity;pb.wake();showNotif(pb.noGravity?'🌌 No Gravity':'🌍 Gravity ON');}
  else if(tgMode==='copy'){var nm=pb.mesh.clone();nm.position.copy(pb.mesh.position).add(new THREE.Vector3((Math.random()-.5)*1.5,.8,(Math.random()-.5)*1.5));scene.add(nm);var np=new PhysBody(nm,pb.hx,pb.hy,pb.hz,pb.mass,{res:pb.restitution});undoStack.push(np);showNotif('📋 Duplicated');SFX.spawn();}
  else if(tgMode==='button'){addBtnToProp(pb);}
  else if(tgMode==='wire'){
    if(!tgWeld1){
      // Must select a button as source
      var btnSrc=btns.find(function(b){return b.pb===pb;});
      if(!btnSrc){showNotif('🔌 Select a BUTTON prop as source first');return;}
      tgWeld1=pb;showNotif('🔌 Wire: now click target prop…');SFX.freeze();
    } else if(tgWeld1===pb){tgWeld1=null;showNotif('Same prop');
    } else {
      var bSrc2=btns.find(function(b){return b.pb===tgWeld1;});
      if(bSrc2)addWireBetween(bSrc2.eid,pb);
      tgWeld1=null;
    }
  }
}

// === WEAPONS ===
var sCD=[];for(var wi=0;wi<8;wi++)sCD.push(0);
var player={hp:100,maxHp:100,suit:100,dead:false,vel:new THREE.Vector3(),weapons:[]};
WEPS.forEach(function(w){player.weapons.push({n:w.n,e:w.e,ammo:w.ammo,dmg:w.dmg,rof:w.rof,range:w.range,currentAmmo:w.ammo,reserveAmmo:w.ammo*4});});

function doShoot(){
  if(player.dead||menuOpen)return;
  var w=player.weapons[slot];
  var now=performance.now()/1000;
  if(now-sCD[slot]<w.rof)return;
  sCD[slot]=now;
  if(slot===0){if(!PG.held)pgGrab();return;}
  if(slot===1){useTool();return;}
  if(slot===7){
    SFX.crowbar();recoil+=.02;
    var dir7=new THREE.Vector3();camera.getWorldDirection(dir7);
    for(var ei7=0;ei7<ents.length;ei7++){var e7=ents[ei7];if(!e7||!e7.mesh||e7.etype!=='npc'||e7.dead)continue;if(e7.mesh.position.distanceTo(camera.position)<w.range){e7.takeDmg(w.dmg);spawnParts(e7.mesh.position.clone(),0xff2200,5,2);kfeed('🪓 Hit '+e7.def.n);return;}}
    for(var bi7=0;bi7<physBodies.length;bi7++){var pb7=physBodies[bi7];if(!pb7||!pb7.mesh)continue;if(pb7.mesh.position.distanceTo(camera.position)<w.range){pb7.impulse(dir7.clone().multiplyScalar(10));pb7.wake();return;}}
    return;
  }
  if(w.currentAmmo===0){SFX.empty();showNotif('EMPTY — R to reload');return;}
  if(w.ammo>0)w.currentAmmo--;
  var sfxArr=[null,null,SFX.pistol,SFX.shotgun,SFX.smg,SFX.ar2,SFX.rpg];
  if(sfxArr[slot])sfxArr[slot]();
  muzzle();recoil+=(slot===3?.08:slot===6?.12:.02);
  var dirS=new THREE.Vector3();camera.getWorldDirection(dirS);
  if(slot===6){fireProj(camera.position.clone().addScaledVector(dirS,1.2),dirS.clone(),22,w.dmg,true,0xff6600,true);return;}
  if(slot===3){for(var si=0;si<9;si++){var ds=dirS.clone().add(new THREE.Vector3((Math.random()-.5)*.14,(Math.random()-.5)*.14,(Math.random()-.5)*.14)).normalize();doHit(ds,w.dmg/9,w.range);}return;}
  var sp=slot===4?.04:slot===5?.018:.008;
  doHit(dirS.clone().add(new THREE.Vector3((Math.random()-.5)*sp,(Math.random()-.5)*sp,(Math.random()-.5)*sp)).normalize(),w.dmg,w.range);
}
function npcOwnsObj(npc,obj){var n=obj;while(n){if(n===npc.mesh)return true;n=n.parent;}return false;}
function doHit(dir,dmg,range){
  RC.far=range;RC.set(camera.position,dir);
  // Check remote players first
  var rpMeshes=Object.values(remotePlayers).map(function(rp){return rp.mesh;}).filter(Boolean);
  if(rpMeshes.length){
    var rpHits=RC.intersectObjects(rpMeshes,true);
    if(rpHits.length){
      var hitMesh=rpHits[0].object;
      var hitPid=null;
      Object.keys(remotePlayers).forEach(function(pid){
        var rp=remotePlayers[pid];if(!rp||!rp.mesh)return;
        var n=hitMesh;while(n){if(n===rp.mesh){hitPid=pid;break;}n=n.parent;}
      });
      if(hitPid!=null){
        spawnParts(rpHits[0].point,0xff2200,7,3.5);spawnTracer(camera.position,rpHits[0].point);
        if(mpWS&&isMulti)mpWS.send(JSON.stringify({type:'playerHit',targetPid:parseInt(hitPid),dmg:dmg}));
        showNotif('🎯 Hit player!');RC.far=Infinity;return;
      }
    }
  }
  var npcMs=[];for(var ei=0;ei<ents.length;ei++){var e=ents[ei];if(e&&e.etype==='npc'&&!e.dead)npcMs.push(e.mesh);}
  if(npcMs.length){
    var nh=RC.intersectObjects(npcMs,true);
    if(nh.length){
      var hitObj=nh[0].object;
      for(var ni=0;ni<ents.length;ni++){
        var en=ents[ni];if(!en||en.etype!=='npc'||en.dead)continue;
        if(npcOwnsObj(en,hitObj)){
          en.takeDmg(dmg);spawnParts(nh[0].point,0xff2200,7,3.5);spawnTracer(camera.position,nh[0].point);RC.far=Infinity;return;
        }
      }
    }
  }
  var ph=RC.intersectObjects(physBodies.map(function(b){return b.mesh;}),true);RC.far=Infinity;
  if(ph.length){
    var pb=pgFindPB(ph[0].object);
    if(pb){pb.impulse(dir.clone().multiplyScalar(dmg*.07/Math.max(pb.mass,1)));pb.wake();spawnParts(ph[0].point,0xffcc44,4,2);if(pb.explosive)doExplode(pb.mesh.position.clone(),5,180);SFX.impact();spawnTracer(camera.position,ph[0].point);return;}
  }
  // Hit remote players
  var _bestD=range+1,_bestRp=null;
  Object.values(remotePlayers).forEach(function(rp){
    if(!rp||!rp.mesh)return;
    var chest=rp.mesh.position.clone().add(new THREE.Vector3(0,.9,0));
    var toC=chest.clone().sub(camera.position);
    var proj=toC.dot(dir);if(proj<0.1||proj>range)return;
    var cl=camera.position.clone().addScaledVector(dir,proj);
    if(cl.distanceTo(chest)<0.6&&proj<_bestD){_bestD=proj;_bestRp=rp;}
  });
  if(_bestRp){
    if(isMulti&&mpWS)mpWS.send(JSON.stringify({type:'playerHit',targetPid:_bestRp.pid,dmg:dmg}));
    spawnParts(camera.position.clone().addScaledVector(dir,_bestD),0xff2200,7,3);
    kfeed('🎯 Hit player');return;
  }
  spawnTracer(camera.position,camera.position.clone().addScaledVector(dir,range));
}

// === PLAYER ===
function plrHit(d){
  if(player.dead||godMode)return;SFX.hurt();
  var ab=Math.min(player.suit,d*.5);player.suit=Math.max(0,player.suit-ab);d-=ab;
  player.hp=Math.max(0,player.hp-d);
  document.getElementById('dvign').classList.add('hit');setTimeout(function(){document.getElementById('dvign').classList.remove('hit');},150);
  if(player.hp<=0)die();
}
function die(){player.dead=true;document.getElementById('death').style.display='flex';if(plocked)document.exitPointerLock();}
function respawn(){player.hp=player.maxHp;player.suit=100;player.dead=false;player.vel.set(0,0,0);camera.position.set(0,1.65,8);yaw=0;pitch=0;recoil=0;document.getElementById('death').style.display='none';showNotif('Respawned');}

function updatePlayer(dt){
  if(player.dead||inVeh)return;
  recoil*=.72;pitch=Math.max(-1.55,Math.min(1.55,pitch));
  camera.rotation.order='YXZ';camera.rotation.y=yaw;camera.rotation.x=pitch+recoil*.38;
  if(godMode){player.hp=Math.min(player.maxHp,player.hp+80*dt);player.suit=100;}

  // ── NOCLIP (C) ─────────────────────────────────────────────
  if(noclip){
    var ncS=keys['shift']?38:18,ncF=new THREE.Vector3(),ncR=new THREE.Vector3();
    camera.getWorldDirection(ncF);ncR.crossVectors(ncF,new THREE.Vector3(0,1,0)).normalize();
    if(keys['w'])camera.position.addScaledVector(ncF,ncS*dt);
    if(keys['s'])camera.position.addScaledVector(ncF,-ncS*dt);
    if(keys['a'])camera.position.addScaledVector(ncR,-ncS*dt);
    if(keys['d'])camera.position.addScaledVector(ncR,ncS*dt);
    if(keys[' '])camera.position.y+=ncS*dt;
    if(keys['control'])camera.position.y-=ncS*dt;
    return;
  }

  crouching=!!(keys['control']);
  var eyeH=crouching?0.74:1.65;
  var fwd=new THREE.Vector3(),rv=new THREE.Vector3();
  camera.getWorldDirection(fwd);fwd.y=0;fwd.normalize();rv.crossVectors(fwd,new THREE.Vector3(0,1,0));

  // ── FLY MODE (V) ───────────────────────────────────────────
  if(flyMode){
    var flyS=keys['shift']?26:11;
    var flyFwd=new THREE.Vector3();camera.getWorldDirection(flyFwd);
    var flyR=new THREE.Vector3();flyR.crossVectors(flyFwd,new THREE.Vector3(0,1,0)).normalize();
    var flyMv=new THREE.Vector3();
    if(keys['w'])flyMv.addScaledVector(flyFwd,flyS);
    if(keys['s'])flyMv.addScaledVector(flyFwd,-flyS*.8);
    if(keys['a'])flyMv.addScaledVector(flyR,-flyS*.8);
    if(keys['d'])flyMv.addScaledVector(flyR,flyS*.8);
    if(keys[' '])flyMv.y+=flyS;
    if(keys['control'])flyMv.y-=flyS*.8;
    // Smooth acceleration, strong deceleration
    player.vel.lerp(flyMv,Math.min(1,dt*9));
    camera.position.addScaledVector(player.vel,dt);
    // Light drag in air while flying
    player.vel.multiplyScalar(Math.pow(.88,dt*60));
    camera.position.x=Math.max(-BOUND,Math.min(BOUND,camera.position.x));
    camera.position.z=Math.max(-BOUND,Math.min(BOUND,camera.position.z));
    if(camera.position.y<eyeH){camera.position.y=eyeH;player.vel.y=0;}
    return;
  }

  // ── WALKING ────────────────────────────────────────────────
  var spd=crouching?2.8:keys['shift']?12:6.5,mv=new THREE.Vector3();
  if(keys['w'])mv.addScaledVector(fwd,spd);
  if(keys['s'])mv.addScaledVector(fwd,-spd*.7);
  if(keys['a'])mv.addScaledVector(rv,-spd*.8);
  if(keys['d'])mv.addScaledVector(rv,spd*.8);
  player.vel.x=mv.x;player.vel.z=mv.z;
  var onG=(camera.position.y<=eyeH+.1);
  if(keys[' ']&&onG&&!crouching){player.vel.y=9.4;SFX.impact();}
  player.vel.y-=24*dt;
  camera.position.addScaledVector(player.vel,dt);
  camera.position.y+=(eyeH-camera.position.y)*Math.min(1,dt*14);
  if(camera.position.y<eyeH){camera.position.y=eyeH;player.vel.y=Math.max(0,player.vel.y);}
  if((mv.x||mv.z)&&onG){
    camera.position.y+=Math.sin(performance.now()*.013)*(.026+(keys['shift']?.01:0));
  }
  // ── Player ↔ PhysBody collision ──────────────────────────
  var PRAD=0.38,PHGT=eyeH;
  for(var pci=0;pci<physBodies.length;pci++){
    var ppb=physBodies[pci];if(!ppb||!ppb.mesh||ppb.frozen||ppb.sleeping||ppb===PG.held)continue;
    var pdx=camera.position.x-ppb.mesh.position.x;
    var pdy=camera.position.y-ppb.mesh.position.y;
    var pdz=camera.position.z-ppb.mesh.position.z;
    // Use AABB: check if camera sphere overlaps prop AABB
    var cx=Math.max(-ppb.hx,Math.min(ppb.hx,pdx));
    var cy=Math.max(-ppb.hy,Math.min(ppb.hy,pdy));
    var cz=Math.max(-ppb.hz,Math.min(ppb.hz,pdz));
    var nx2=pdx-cx,ny2=pdy-cy,nz2=pdz-cz;
    var dist2=nx2*nx2+ny2*ny2+nz2*nz2;
    if(dist2<PRAD*PRAD&&dist2>1e-6){
      var dn=Math.sqrt(dist2);
      var pen=PRAD-dn,nnx=nx2/dn,nny=ny2/dn,nnz=nz2/dn;
      camera.position.x+=nnx*pen;
      camera.position.y+=nny*pen;
      camera.position.z+=nnz*pen;
      // Push prop away
      var pushSpd=(player.vel.x*nnx+player.vel.y*nny+player.vel.z*nnz);
      if(pushSpd<0){
        ppb.vel.x-=nnx*pushSpd*.6/Math.max(ppb.mass,1);
        ppb.vel.y-=nny*pushSpd*.6/Math.max(ppb.mass,1);
        ppb.vel.z-=nnz*pushSpd*.6/Math.max(ppb.mass,1);
        ppb.wake();
      }
      if(nny>0.6)player.vel.y=Math.max(0,player.vel.y);
    }
  }
  camera.position.x=Math.max(-BOUND,Math.min(BOUND,camera.position.x));
  camera.position.z=Math.max(-BOUND,Math.min(BOUND,camera.position.z));
  // Player vs physics object collision (capsule/cylinder)
  var _pR=0.4;
  for(var _i=0;_i<physBodies.length;_i++){
    var _p=physBodies[_i];
    if(!_p||!_p.mesh||_p.noCollide)continue;
    var _py=camera.position.y-_p.mesh.position.y;
    if(Math.abs(_py)>(crouching?0.72:1.65)+_p.hy+0.1)continue;
    var _px=camera.position.x-_p.mesh.position.x;
    var _pz=camera.position.z-_p.mesh.position.z;
    var _cx=Math.max(-_p.hx,Math.min(_p.hx,_px));
    var _cz=Math.max(-_p.hz,Math.min(_p.hz,_pz));
    var _dx=_px-_cx,_dz=_pz-_cz,_d2=_dx*_dx+_dz*_dz;
    if(_d2>1e-6&&_d2<_pR*_pR){
      var _d=Math.sqrt(_d2),_pen=_pR-_d;
      camera.position.x+=_dx/_d*_pen;camera.position.z+=_dz/_d*_pen;
      var _push=player.vel.dot(new THREE.Vector3(_dx,0,_dz).normalize());
      if(_push<0){player.vel.x-=_dx/_d*_push;player.vel.z-=_dz/_d*_push;}
      if(!_p.frozen){_p.vel.x+=_dx/_d*_pen*1.5;_p.vel.z+=_dz/_d*_pen*1.5;_p.wake();}
    }
  }
}

// === ENTITIES (NPCs + Vehicles) ===
var ents=[];

function mkMat(col){return new THREE.MeshLambertMaterial({color:col});}

function NPC(type,pos){
  this.etype='npc';this.npcType=type;var d=NPC_DEFS[type];this.def=d;
  this.hp=d.hp;this.dead=false;this.state='idle';this.stT=0;this.shtT=0;
  this.dir=new THREE.Vector3(Math.random()-.5,0,Math.random()-.5).normalize();
  this.mesh=this._build();this.mesh.position.copy(pos);this.mesh.position.y=0;
  this._bar();
  // Invisible hitbox cylinder for reliable raycasting - much larger than visual
  var _hbH=this.npcType==='headcrab'?0.55:this.npcType==='manhack'?0.5:this.npcType==='caleblewis'?2.2:1.9;
  var _hbR=this.npcType==='headcrab'?0.42:this.npcType==='manhack'?0.45:this.npcType==='caleblewis'?0.55:0.45;
  var _hbM=new THREE.Mesh(new THREE.CylinderGeometry(_hbR,_hbR,_hbH,8),new THREE.MeshBasicMaterial({visible:false,transparent:true,opacity:0}));
  _hbM.position.y=_hbH/2;this.mesh.add(_hbM);
  scene.add(this.mesh);ents.push(this);
}
NPC.prototype._build=function(){
  var g=new THREE.Group(),t=this.npcType,d=this.def;

  /* ---- CALEB LEWIS — tall birthday bro ---- */
  if(t==='caleblewis'){
    var sc=1.28; // tall
    var g2=new THREE.Group();
    // Legs (cargo pants - beige/tan)
    var lLegC=new THREE.Mesh(new THREE.BoxGeometry(.22*sc,.62*sc,.22*sc),mkMat(0xc8a96e));lLegC.position.set(-.14*sc,.3*sc,0);g2.add(lLegC);
    var rLegC=lLegC.clone();rLegC.position.x=.14*sc;g2.add(rLegC);
    // Cargo pockets
    var cpL=new THREE.Mesh(new THREE.BoxGeometry(.1*sc,.14*sc,.04*sc),mkMat(0xb89860));cpL.position.set(-.22*sc,.34*sc,.12*sc);g2.add(cpL);
    var cpR=cpL.clone();cpR.position.x=.22*sc;g2.add(cpR);
    // Shoes
    var shGeo=new THREE.BoxGeometry(.24*sc,.09*sc,.28*sc);
    var shL=new THREE.Mesh(shGeo,mkMat(0x111111));shL.position.set(-.14*sc,.02*sc,.04*sc);g2.add(shL);
    var shR=shL.clone();shR.position.x=.14*sc;g2.add(shR);
    // Torso group
    var tGrp=new THREE.Group();tGrp.position.y=.88*sc;g2.add(tGrp);
    // White undershirt (visible at bottom + collar)
    var undershirt=new THREE.Mesh(new THREE.BoxGeometry(.52*sc,.06*sc,.3*sc),mkMat(0xffffff));undershirt.position.y=-.28*sc;tGrp.add(undershirt);
    var collar=new THREE.Mesh(new THREE.BoxGeometry(.18*sc,.08*sc,.04*sc),mkMat(0xffffff));collar.position.set(0,.26*sc,.15*sc);tGrp.add(collar);
    // Black tee
    var tshirt=new THREE.Mesh(new THREE.BoxGeometry(.56*sc,.56*sc,.3*sc),mkMat(0x111111));tGrp.add(tshirt);
    // Arms (skin at bottom, black sleeve)
    var armGeo=new THREE.BoxGeometry(.17*sc,.58*sc,.17*sc);
    var lArm2=new THREE.Mesh(armGeo,mkMat(0x111111));lArm2.position.set(-.39*sc,0,0);tGrp.add(lArm2);
    var rArm2=lArm2.clone();rArm2.position.x=.39*sc;tGrp.add(rArm2);
    // Forearms (skin)
    var faGeo=new THREE.BoxGeometry(.15*sc,.26*sc,.15*sc);
    var lFa=new THREE.Mesh(faGeo,mkMat(0xffcc99));lFa.position.set(-.39*sc,-.42*sc,0);tGrp.add(lFa);
    var rFa=lFa.clone();rFa.position.x=.39*sc;tGrp.add(rFa);
    // Neck
    var neck=new THREE.Mesh(new THREE.CylinderGeometry(.1*sc,.11*sc,.18*sc,8),mkMat(0xffcc99));neck.position.y=.37*sc;tGrp.add(neck);
    // Head
    var head=new THREE.Mesh(new THREE.SphereGeometry(.2*sc,10,8),mkMat(0xffcc99));head.position.y=.56*sc;tGrp.add(head);
    // Eyes
    var eGeo=new THREE.SphereGeometry(.03*sc,5,4);
    var eL=new THREE.Mesh(eGeo,mkMat(0x3a2a1a));eL.position.set(-.08*sc,.58*sc,.18*sc);tGrp.add(eL);
    var eR=eL.clone();eR.position.x=.08*sc;tGrp.add(eR);
    // Brunette hair with bangs
    var hair=new THREE.Mesh(new THREE.SphereGeometry(.21*sc,10,6),mkMat(0x3b2200));hair.position.set(0,.62*sc,0);hair.scale.set(1,.7,1);tGrp.add(hair);
    var bangs=new THREE.Mesh(new THREE.BoxGeometry(.38*sc,.1*sc,.12*sc),mkMat(0x3b2200));bangs.position.set(0,.62*sc,.17*sc);tGrp.add(bangs);
    var bang2=new THREE.Mesh(new THREE.BoxGeometry(.14*sc,.14*sc,.06*sc),mkMat(0x3b2200));bang2.position.set(-.12*sc,.56*sc,.2*sc);tGrp.add(bang2);
    // Birthday hat (cone + stripes)
    var hatBase=new THREE.Mesh(new THREE.ConeGeometry(.14*sc,.38*sc,10),mkMat(0xff44cc));hatBase.position.set(0,.86*sc,.02*sc);tGrp.add(hatBase);
    var hatBrim=new THREE.Mesh(new THREE.TorusGeometry(.14*sc,.025*sc,6,12),mkMat(0xffff00));hatBrim.position.set(0,.68*sc,.02*sc);tGrp.add(hatBrim);
    var pom=new THREE.Mesh(new THREE.SphereGeometry(.04*sc,5,4),mkMat(0xffffff));pom.position.set(0,1.07*sc,.02*sc);tGrp.add(pom);
    // Hat stripe
    var stripe=new THREE.Mesh(new THREE.TorusGeometry(.14*sc,.018*sc,6,12,.8),mkMat(0xffff00));stripe.position.set(0,.78*sc,.02*sc);tGrp.add(stripe);
    // Mouth (for puke indicator)
    this._mouth=new THREE.Mesh(new THREE.SphereGeometry(.035*sc,5,4),mkMat(0xff88aa));
    this._mouth.position.set(0,.48*sc,.2*sc);tGrp.add(this._mouth);
    this._tGrp=tGrp;this._lArm=lArm2;this._rArm=rArm2;this._lLeg=lLegC;this._rLeg=rLegC;
    this.pukeT=Math.random()*3;this.slapT=Math.random()*4;this.slapAnim=0;
    return g2;
  }

  /* ---- HEADCRAB ---- */
  if(t==='headcrab'){
    var body=new THREE.Mesh(new THREE.SphereGeometry(.3,8,5),mkMat(d.col));body.scale.y=.48;body.position.y=.24;g.add(body);
    var mouth=new THREE.Mesh(new THREE.ConeGeometry(.14,.18,6),mkMat(0xcc8866));mouth.rotation.x=Math.PI/2;mouth.position.set(0,.14,.27);g.add(mouth);
    [[-0.26,0,.16],[0.26,0,.16],[-0.22,0,-.2],[0.22,0,-.2]].forEach(function(lp){
      var leg=new THREE.Mesh(new THREE.CylinderGeometry(.028,.018,.38,5),mkMat(0x776644));leg.position.set(lp[0],.14,lp[2]);leg.rotation.z=lp[0]<0?-.75:.75;leg.rotation.x=lp[2]>0?.3:-.2;g.add(leg);});
    return g;
  }
  /* ---- ANTLION ---- */
  if(t==='antlion'){
    var ab=new THREE.Mesh(new THREE.BoxGeometry(.44,.26,.7),mkMat(d.col));ab.position.y=.34;g.add(ab);
    var ah=new THREE.Mesh(new THREE.BoxGeometry(.3,.2,.26),mkMat(d.leg));ah.position.set(0,.38,.5);g.add(ah);
    var m1=new THREE.Mesh(new THREE.BoxGeometry(.07,.04,.22),mkMat(0x666633));m1.position.set(-.11,.32,.64);m1.rotation.z=-.3;g.add(m1);
    var m2=m1.clone();m2.position.x=.11;m2.rotation.z=.3;g.add(m2);
    for(var li=0;li<3;li++){for(var si=0;si<2;si++){var aleg=new THREE.Mesh(new THREE.CylinderGeometry(.023,.018,.44,5),mkMat(0x888833));aleg.position.set(si===0?-.27:.27,.16,-.1+(li-.5)*.26);aleg.rotation.z=si===0?-1.1:1.1;aleg.rotation.x=(li-.5)*.28;g.add(aleg);}}
    var wg=new THREE.Mesh(new THREE.BoxGeometry(.68,.018,.48),new THREE.MeshLambertMaterial({color:0xaaaa66,transparent:true,opacity:.5}));wg.position.y=.54;g.add(wg);
    return g;
  }
  /* ---- MANHACK ---- */
  if(t==='manhack'){
    var disc=new THREE.Mesh(new THREE.CylinderGeometry(.36,.36,.09,12),mkMat(d.col));disc.position.y=.38;g.add(disc);
    this._blades=[];
    for(var bi=0;bi<4;bi++){var bl=new THREE.Mesh(new THREE.BoxGeometry(.48,.025,.07),mkMat(0x8899aa));bl.position.y=.42;bl.rotation.y=bi*Math.PI/4;g.add(bl);this._blades.push(bl);}
    var eye=new THREE.Mesh(new THREE.SphereGeometry(.065,6,6),new THREE.MeshBasicMaterial({color:0xff2200}));eye.position.set(0,.36,.32);g.add(eye);
    var glow=new THREE.Mesh(new THREE.SphereGeometry(.09,6,6),new THREE.MeshBasicMaterial({color:0xff4400,transparent:true,opacity:.3}));glow.position.copy(eye.position);g.add(glow);
    return g;
  }
  /* ---- DOG ---- */
  if(t==='dog'){
    var torso=new THREE.Mesh(new THREE.BoxGeometry(.52,.36,.78),mkMat(0x888888));torso.position.y=.66;g.add(torso);
    var neck=new THREE.Mesh(new THREE.BoxGeometry(.16,.26,.16),mkMat(0x999999));neck.position.set(0,.88,.34);g.add(neck);
    var head=new THREE.Mesh(new THREE.BoxGeometry(.34,.3,.34),mkMat(0x888888));head.position.set(0,1.1,.42);g.add(head);
    var e1=new THREE.Mesh(new THREE.SphereGeometry(.055,6,6),new THREE.MeshBasicMaterial({color:0x44aaff}));e1.position.set(-.1,1.12,.58);g.add(e1);
    var e2=e1.clone();e2.position.x=.1;g.add(e2);
    var glow2=new THREE.Mesh(new THREE.SphereGeometry(.08,6,6),new THREE.MeshBasicMaterial({color:0x2266ff,transparent:true,opacity:.4}));glow2.position.set(0,1.12,.58);g.add(glow2);
    [[-0.3,0,.28],[.3,0,.28],[-0.3,0,-.28],[.3,0,-.28]].forEach(function(lp){var dl=new THREE.Mesh(new THREE.BoxGeometry(.13,.5,.13),mkMat(0x777777));dl.position.set(lp[0],.38,lp[2]);g.add(dl);});
    return g;
  }
  /* ---- TURRET ---- */
  if(t==='turret'){
    var base=new THREE.Mesh(new THREE.CylinderGeometry(.28,.38,.16,10),mkMat(0xbbbbbb));base.position.y=.08;g.add(base);
    var tbody=new THREE.Mesh(new THREE.CylinderGeometry(.17,.24,.52,10),mkMat(0xaaaaaa));tbody.position.y=.46;g.add(tbody);
    var teye=new THREE.Mesh(new THREE.SphereGeometry(.09,8,6),new THREE.MeshBasicMaterial({color:0xff4400}));teye.position.set(0,.66,.13);g.add(teye);
    var tg1=new THREE.Mesh(new THREE.CylinderGeometry(.028,.028,.44,6),mkMat(0x888888));tg1.rotation.x=Math.PI/2;tg1.position.set(-.09,.56,.22);g.add(tg1);
    var tg2=tg1.clone();tg2.position.x=.09;g.add(tg2);
    [0,1.05,2.1,3.15].forEach(function(a){var tleg=new THREE.Mesh(new THREE.BoxGeometry(.055,.48,.055),mkMat(0x999999));tleg.position.set(Math.sin(a)*.3,-.05,Math.cos(a)*.3);g.add(tleg);});
    return g;
  }
  /* ---- VORTIGAUNT ---- */
  if(t==='vortigaunt'){
    var vtg=new THREE.Group();vtg.position.y=.72;vtg.rotation.x=.25;g.add(vtg);
    var vt=new THREE.Mesh(new THREE.BoxGeometry(.5,.5,.26),mkMat(0x223344));vtg.add(vt);
    var vhead=new THREE.Mesh(new THREE.BoxGeometry(.32,.32,.28),mkMat(0x1a2a35));vhead.position.y=.42;vtg.add(vhead);
    [-.09,0,.09].forEach(function(ex){var ve=new THREE.Mesh(new THREE.SphereGeometry(.038,5,5),new THREE.MeshBasicMaterial({color:0x44ffaa}));ve.position.set(ex,.44,.15);vtg.add(ve);});
    var vglow=new THREE.Mesh(new THREE.SphereGeometry(.085,6,6),new THREE.MeshBasicMaterial({color:0x22ee88,transparent:true,opacity:.35}));vglow.position.set(0,.44,.15);vtg.add(vglow);
    [[-.36,0,0],[.36,0,0],[-.3,-.12,.16]].forEach(function(ap){var va=new THREE.Mesh(new THREE.BoxGeometry(.11,.5,.11),mkMat(0x334455));va.position.set(ap[0],ap[1],ap[2]);vtg.add(va);});
    var vl1=new THREE.Mesh(new THREE.BoxGeometry(.17,.52,.17),mkMat(0x112233));vl1.position.set(-.14,.26,0);g.add(vl1);
    var vl2=vl1.clone();vl2.position.x=.14;g.add(vl2);
    return g;
  }

  /* ---- HUMANOIDS (citizen/alyx/barney/combine/metropolice/zombie/fastzombie) ---- */
  var hunch=(t==='zombie'?.5:t==='fastzombie'?.82:0);
  var skinCol=d.sk||0xffcc99, bodyCol=d.col, legCol=d.leg||d.col;
  var isZombie=(t==='zombie'||t==='fastzombie');

  var torsoGrp=new THREE.Group();torsoGrp.position.y=.76;torsoGrp.rotation.x=hunch;g.add(torsoGrp);

  // Torso
  var torsoMesh=new THREE.Mesh(new THREE.BoxGeometry(.5,.5,.26),mkMat(bodyCol));torsoGrp.add(torsoMesh);

  // Chest armor for combine
  if(t==='combine'){var arm=new THREE.Mesh(new THREE.BoxGeometry(.42,.3,.06),mkMat(0x445566));arm.position.set(0,.04,.14);torsoGrp.add(arm);
    var shL=new THREE.Mesh(new THREE.BoxGeometry(.12,.1,.14),mkMat(0x334455));shL.position.set(-.3,.2,.0);torsoGrp.add(shL);
    var shR=shL.clone();shR.position.x=.3;torsoGrp.add(shR);}

  // Head
  var headMesh;
  if(isZombie){headMesh=new THREE.Mesh(new THREE.BoxGeometry(.32,.3,.28),mkMat(skinCol));}
  else{headMesh=new THREE.Mesh(new THREE.SphereGeometry(.165,8,7),mkMat(skinCol));}
  headMesh.position.set(0,.42,hunch>.4?.06:0);torsoGrp.add(headMesh);

  // Hair
  if(t==='alyx'){var hair=new THREE.Mesh(new THREE.BoxGeometry(.32,.12,.28),mkMat(0x221100));hair.position.set(0,.5,-.04);torsoGrp.add(hair);
    var pt=new THREE.Mesh(new THREE.CylinderGeometry(.035,.02,.2,6),mkMat(0x332211));pt.position.set(0,.38,-.15);torsoGrp.add(pt);}
  if(t==='citizen'){var chair=new THREE.Mesh(new THREE.BoxGeometry(.3,.1,.26),mkMat(0x553322));chair.position.set(0,.5,0);torsoGrp.add(chair);}

  // Helmet for combine/metrocop
  if(t==='combine'||t==='metropolice'){
    var helm=new THREE.Mesh(new THREE.BoxGeometry(.34,.22,.34),mkMat(t==='combine'?0x222233:0x333344));helm.position.y=.44;torsoGrp.add(helm);
    var visor=new THREE.Mesh(new THREE.BoxGeometry(.26,.09,.04),new THREE.MeshLambertMaterial({color:0xff8800,transparent:true,opacity:.75}));visor.position.set(0,.42,.17);torsoGrp.add(visor);}
  else if(!isZombie){
    // eyes
    var el=new THREE.Mesh(new THREE.SphereGeometry(.028,4,4),new THREE.MeshBasicMaterial({color:0x334455}));el.position.set(-.065,.43,.16);torsoGrp.add(el);
    var er=el.clone();er.position.x=.065;torsoGrp.add(er);}

  // Barney: cap + badge
  if(t==='barney'){
    var cap=new THREE.Mesh(new THREE.BoxGeometry(.36,.09,.36),mkMat(0x2255aa));cap.position.y=.52;torsoGrp.add(cap);
    var brim=new THREE.Mesh(new THREE.BoxGeometry(.42,.04,.2),mkMat(0x1a4499));brim.position.set(0,.48,.18);torsoGrp.add(brim);}

  // Arms
  var aGeo=new THREE.BoxGeometry(.14,.48,.14);
  var lArm=new THREE.Mesh(aGeo,mkMat(isZombie?skinCol:bodyCol));lArm.position.set(-.36,0,hunch>.5?.06:0);lArm.rotation.x=hunch>.5?-.45:0;torsoGrp.add(lArm);
  var rArm=new THREE.Mesh(aGeo,mkMat(isZombie?skinCol:bodyCol));rArm.position.set(.36,0,0);torsoGrp.add(rArm);
  if(t==='fastzombie'){lArm.scale.y=1.4;rArm.scale.y=1.35;lArm.rotation.x=-.5;rArm.rotation.x=-.3;}

  // Legs
  var lGeo=new THREE.BoxGeometry(.19,.52,.19);
  var lLeg=new THREE.Mesh(lGeo,mkMat(legCol));lLeg.position.set(-.14,.25,0);g.add(lLeg);
  var rLeg=new THREE.Mesh(lGeo,mkMat(legCol));rLeg.position.set(.14,.25,0);g.add(rLeg);

  // Shoes
  if(!isZombie){
    var sGeo=new THREE.BoxGeometry(.21,.09,.25);
    g.add(Object.assign(new THREE.Mesh(sGeo,mkMat(0x1a1a1a)),{position:{x:-.14,y:.0,z:.03,set:function(){},clone:function(){return this;}}}));
    var lSh=new THREE.Mesh(sGeo,mkMat(0x1a1a1a));lSh.position.set(-.14,.0,.03);g.add(lSh);
    var rSh=new THREE.Mesh(sGeo,mkMat(0x1a1a1a));rSh.position.set(.14,.0,.03);g.add(rSh);}

  this._lArm=lArm;this._rArm=rArm;this._lLeg=lLeg;this._rLeg=rLeg;
  return g;
};
NPC.prototype._bar=function(){
  var cv=document.createElement('canvas');cv.width=64;cv.height=8;
  var c=cv.getContext('2d');c.fillStyle='#300';c.fillRect(0,0,64,8);c.fillStyle='#0f0';c.fillRect(0,0,64,8);
  this._btex=new THREE.CanvasTexture(cv);this._bcv=cv;this._bc=c;
  var bm=new THREE.Mesh(new THREE.PlaneGeometry(.85,.1),new THREE.MeshBasicMaterial({map:this._btex,transparent:true,depthTest:false}));
  bm.position.y=2.1;this.mesh.add(bm);this._bm=bm;
};
NPC.prototype._updBar=function(){
  var f=this.hp/this.def.hp;this._bc.fillStyle='#300';this._bc.fillRect(0,0,64,8);
  this._bc.fillStyle=f>.5?'#0f0':f>.25?'#ff0':'#f00';this._bc.fillRect(0,0,64*f,8);this._btex.needsUpdate=true;
  if(this._bm)this._bm.lookAt(camera.position);
};
NPC.prototype.takeDmg=function(d){
  if(this.dead)return;this.hp=Math.max(0,this.hp-d);this.state='aggro';
  var self=this;
  this.mesh.traverse(function(c){if(c.isMesh&&c.material)c.material.emissive=new THREE.Color(.5,0,0);});
  setTimeout(function(){if(!self.dead)self.mesh.traverse(function(c){if(c.isMesh&&c.material)c.material.emissive.set(0,0,0);});},120);
  if(this.hp<=0)this.die();
};
NPC.prototype.die=function(){
  this.dead=true;kfeed('💀 '+this.def.n+' killed');this.mesh.rotation.z=Math.PI/2;this.mesh.position.y=.3;
  if(this._bm)this.mesh.remove(this._bm);
  var self=this;setTimeout(function(){scene.remove(self.mesh);var i=ents.indexOf(self);if(i>-1)ents.splice(i,1);},5000);
};
NPC.prototype.update=function(dt){
  if(this.dead)return;this.stT+=dt;this.shtT+=dt;this._updBar();

  // ── CALEB LEWIS special update ──
  if(this.npcType==='caleblewis'){
    var pp2=camera.position.clone();pp2.y=0;var mp2=this.mesh.position.clone();mp2.y=0;
    var d2=mp2.distanceTo(pp2),dir2=pp2.clone().sub(mp2).normalize();
    // Wander
    if(this.stT>2.5){this.stT=0;this.dir.set(Math.random()-.5,0,Math.random()-.5).normalize();}
    this.mesh.position.x+=this.dir.x*this.def.spd*dt;this.mesh.position.z+=this.dir.z*this.def.spd*dt;
    if(this.dir.lengthSq()>.01)this.mesh.lookAt(this.mesh.position.clone().add(this.dir));
    var bob2=Math.sin(this.stT*8)*.15;
    if(this._lLeg)this._lLeg.rotation.x=bob2;if(this._rLeg)this._rLeg.rotation.x=-bob2;
    if(this._lArm)this._lArm.rotation.x=-bob2*.7;if(this._rArm)this._rArm.rotation.x=bob2*.7;
    // Puke cake on player
    this.pukeT-=dt;
    if(this.pukeT<=0){
      this.pukeT=3+Math.random()*3;
      if(d2<10){
        // Spray cake puke particles
        for(var pi2=0;pi2<18;pi2++){
          var pDir=dir2.clone().add(new THREE.Vector3((Math.random()-.5)*.6,(Math.random()*.4),(Math.random()-.5)*.6)).normalize();
          var pPos=this.mesh.position.clone().add(new THREE.Vector3(dir2.x*.4,1.6,dir2.z*.4));
          spawnParts(pPos,pi2%2===0?0x22dd44:0xffddcc,3,2.5+Math.random()*2);
        }
        showNotif('🤢 CALEB PUKED ON YOU!');
        if(d2<3)plrHit(5);
        SFX.spawn();
      }
    }
    // Belly slap
    this.slapT-=dt;
    if(this.slapT<=0){
      this.slapT=5+Math.random()*4;this.slapAnim=0.5;
      showNotif('👋 Caleb slaps his belly');SFX.impact();
    }
    if(this.slapAnim>0){
      this.slapAnim=Math.max(0,this.slapAnim-dt*4);
      if(this._tGrp){var wobble=Math.sin(this.slapAnim*20)*.08;this._tGrp.scale.set(1+wobble,1-wobble*.5,1+wobble);}
      if(this._rArm){this._rArm.rotation.z=-Math.abs(Math.sin(this.slapAnim*20))*.9;}
    } else {if(this._tGrp)this._tGrp.scale.set(1,1,1);if(this._rArm)this._rArm.rotation.z=0;}
    return;
  }
  var pp=camera.position.clone();pp.y=0;var mp=this.mesh.position.clone();mp.y=0;
  var dist=mp.distanceTo(pp),d=this.def;
  if(d.spd===0){if(dist<22&&d.ranged&&!player.dead&&this.shtT>1.5){this.shtT=0;var drt=camera.position.clone().sub(this.mesh.position).normalize().add(new THREE.Vector3((Math.random()-.5)*.1,0,0));fireProj(this.mesh.position.clone().add(new THREE.Vector3(0,1.4,0)),drt,18,d.dmg,false,0xffcc00);}return;}
  if(d.agg){if(dist<26&&!player.dead)this.state='aggro';else if(this.stT>3){this.state='wander';this.stT=0;this.dir.set(Math.random()-.5,0,Math.random()-.5).normalize();}}
  else{if(dist<10&&!player.dead)this.state='flee';else if(this.stT>4){this.state='wander';this.stT=0;this.dir.set(Math.random()-.5,0,Math.random()-.5).normalize();}}
  var spd=d.spd;
  if(this.state==='aggro'||this.state==='flee'){
    var tp=pp.clone().sub(mp).normalize();if(this.state==='flee')tp.negate();
    this.dir.lerp(tp,.09);this.dir.y=0;if(this.dir.length()>.01)this.dir.normalize();spd*=1.2;
    if(d.ranged&&this.state==='aggro'&&dist<18&&dist>3){spd*=.3;if(this.shtT>2){this.shtT=0;var dr2=camera.position.clone().sub(this.mesh.position).normalize().add(new THREE.Vector3((Math.random()-.5)*.1,(Math.random()-.5)*.04,0));fireProj(this.mesh.position.clone().add(new THREE.Vector3(0,1.5,0)),dr2,17,d.dmg,false,0xff8800);}}
    else if(!d.ranged&&this.state==='aggro'&&dist<1.4&&!player.dead&&this.shtT>.6){this.shtT=0;plrHit(d.dmg);}
  }
  this.mesh.position.x+=this.dir.x*spd*dt;this.mesh.position.z+=this.dir.z*spd*dt;this.mesh.position.y=0;
  if(this.npcType==='manhack'){this.mesh.position.y=1.2+Math.sin(this.stT*3)*.3;if(this._blades){var bspd=15+spd*2;this._blades.forEach(function(bl){bl.rotation.y+=bspd*dt;});}}
  if(this.dir.lengthSq()>.01)this.mesh.lookAt(this.mesh.position.clone().add(this.dir));
  if(Math.abs(this.mesh.position.x)>BOUND||Math.abs(this.mesh.position.z)>BOUND)this.dir.negate();
  var bob=Math.sin(this.stT*8*d.spd*.3)*.2;
  if(this._lLeg)this._lLeg.rotation.x=bob;if(this._rLeg)this._rLeg.rotation.x=-bob;
  if(this._lArm)this._lArm.rotation.x=-bob*.7;if(this._rArm)this._rArm.rotation.x=bob*.7;
};

function Vehicle(type,pos){
  this.etype='vehicle';this.vType=type;var d=VEH_DEFS[type];this.def=d;
  this.spd=0;this.aVel=0;this.vel=new THREE.Vector3();this.occupied=false;
  this.mesh=this._build(d);this.mesh.position.copy(pos);this.mesh.position.y=d.h/2;scene.add(this.mesh);ents.push(this);
}
Vehicle.prototype._build=function(d){
  var g=new THREE.Group();
  var body=new THREE.Mesh(new THREE.BoxGeometry(d.w,d.h,d.l),new THREE.MeshLambertMaterial({color:d.col}));body.castShadow=true;body.receiveShadow=true;g.add(body);
  if(d.fly){
    this.rotor=new THREE.Mesh(new THREE.BoxGeometry(d.w*2.6,.06,.28),mkMat(0x888888));this.rotor.position.y=d.h/2+.1;g.add(this.rotor);
  } else {
    var cab=new THREE.Mesh(new THREE.BoxGeometry(d.w*.78,d.h*.52,d.l*.45),mkMat(new THREE.Color(d.col).offsetHSL(0,0,.08)));cab.position.set(0,d.h*.52,-d.l*.05);g.add(cab);
    var ws=new THREE.Mesh(new THREE.BoxGeometry(d.w*.72,d.h*.38,.06),new THREE.MeshLambertMaterial({color:0x99bbff,transparent:true,opacity:.5}));ws.position.set(0,d.h*.48,-d.l*.27);ws.rotation.x=.25;g.add(ws);
    this.wheels=[];
    var wpos=[[d.w/2+.12,-d.h/2+.06,d.l*.3],[-(d.w/2+.12),-d.h/2+.06,d.l*.3],[d.w/2+.12,-d.h/2+.06,-d.l*.3],[-(d.w/2+.12),-d.h/2+.06,-d.l*.3]];
    for(var wi=0;wi<wpos.length;wi++){
      var t=new THREE.Mesh(new THREE.CylinderGeometry(d.h*.3,d.h*.3,.2,12),mkMat(0x111111));t.rotation.z=Math.PI/2;t.position.set(wpos[wi][0],wpos[wi][1],wpos[wi][2]);g.add(t);
      var rim=new THREE.Mesh(new THREE.CylinderGeometry(d.h*.16,d.h*.16,.22,8),mkMat(0x888899));rim.rotation.z=Math.PI/2;rim.position.set(wpos[wi][0],wpos[wi][1],wpos[wi][2]);g.add(rim);
      this.wheels.push(t);
    }
  }
  [[-d.w*.33,0,-d.l/2],[d.w*.33,0,-d.l/2]].forEach(function(p){var hl=new THREE.Mesh(new THREE.SphereGeometry(.1,6,6),new THREE.MeshBasicMaterial({color:0xffffbb}));hl.position.set(p[0],p[1],p[2]);g.add(hl);});
  return g;
};
Vehicle.prototype.enter=function(){this.occupied=true;inVeh=this;document.getElementById('vhud').classList.add('on');};
Vehicle.prototype.exit=function(){
  this.occupied=false;inVeh=null;
  var f=new THREE.Vector3();this.mesh.getWorldDirection(f);camera.position.copy(this.mesh.position).addScaledVector(f.negate(),2).add(new THREE.Vector3(2.5,2,0));
  document.getElementById('vhud').classList.remove('on');
};
Vehicle.prototype.update=function(dt){
  if(this.rotor)this.rotor.rotation.y+=dt*13*(this.occupied?1:.2);
  if(this.occupied){
    var a=this.def.spd*.9;
    if(keys['w'])this.spd=Math.min(this.def.spd,this.spd+a*dt*3);
    else if(keys['s'])this.spd=Math.max(-this.def.spd*.5,this.spd-a*dt*3);
    else this.spd*=.96;
    if(keys['a'])this.aVel+=this.def.turn*dt*(this.spd>0?1:-1);
    if(keys['d'])this.aVel-=this.def.turn*dt*(this.spd>0?1:-1);
    if(this.def.fly){if(keys[' '])this.vel.y=Math.min(9,this.vel.y+22*dt);else this.vel.y-=12*dt;this.vel.y=Math.max(-6,this.vel.y);}
    document.getElementById('vspd').textContent=Math.abs(Math.round(this.spd*3.6));
  } else this.spd*=.97;
  this.aVel*=.84;this.mesh.rotation.y+=this.aVel;
  var fwd=new THREE.Vector3(0,0,-1).applyQuaternion(this.mesh.quaternion);
  this.mesh.position.addScaledVector(fwd,this.spd*dt);
  this.mesh.position.y=this.def.fly?Math.max(this.def.h/2,this.mesh.position.y+this.vel.y*dt):this.def.h/2+.01;
  if(this.wheels)for(var wi=0;wi<this.wheels.length;wi++)this.wheels[wi].rotation.x-=this.spd*dt*3;
  if(this.occupied)camera.position.copy(this.mesh.position).add(new THREE.Vector3(0,this.def.h+.9,0));
  if(Math.abs(this.mesh.position.x)>BOUND){this.spd*=-.5;this.mesh.position.x=Math.sign(this.mesh.position.x)*BOUND;}
  if(Math.abs(this.mesh.position.z)>BOUND){this.spd*=-.5;this.mesh.position.z=Math.sign(this.mesh.position.z)*BOUND;}
};

// === SPAWN HELPERS ===
function spawnPos(){var d=new THREE.Vector3();camera.getWorldDirection(d);var p=camera.position.clone().addScaledVector(d,4.5);p.y=Math.max(1.2,p.y);return p;}
function mkPropMesh(def){
  var s=def.s,geo,hx=s[0]/2,hy=s[1]/2,hz=s[2]/2;
  if(def.g==='sphere'){geo=new THREE.SphereGeometry(s[0],14,10);hx=hy=hz=s[0];}
  else if(def.g==='cyl'){geo=new THREE.CylinderGeometry(s[0],s[0],s[1],12);hx=s[0];hy=s[1]/2;hz=s[0];}
  else if(def.g==='cone'){geo=new THREE.ConeGeometry(s[0],s[1],10);hx=s[0];hy=s[1]/2;hz=s[0];}
  else if(def.g==='torus'){geo=new THREE.TorusGeometry(s[0],s[1],10,18);hx=s[0]+s[1];hy=s[1];hz=s[0]+s[1];}
  else geo=new THREE.BoxGeometry(s[0],s[1],s[2]);
  var mesh=new THREE.Mesh(geo,new THREE.MeshLambertMaterial({map:mkTex(def.col)}));
  return{mesh:mesh,hx:hx,hy:hy,hz:hz};
}
function doSpawnProp(i){
  var def=PROPS[i];if(!def)return;
  var r=mkPropMesh(def);r.mesh.castShadow=true;r.mesh.receiveShadow=true;
  var sp=spawnPos();r.mesh.position.copy(sp);
  scene.add(r.mesh);var pb=new PhysBody(r.mesh,r.hx,r.hy,r.hz,def.m||10,{res:def.res||0.14});pb.explosive=!!def.expl;
  var eid='prop_'+Date.now()+'_'+localPid+'_'+Math.random().toString(36).slice(2,6);
  pb._eid=eid;
  if(isMulti){
    mpSendSpawn(eid,'prop',{defIdx:i,pos:{x:sp.x,y:sp.y,z:sp.z},quat:{x:0,y:0,z:0,w:1}});
  }
  SFX.spawn();showNotif('▶ '+def.n);
  undoStack.push(pb);if(undoStack.length>50)undoStack.shift();
}
function doSpawnNPC(type){var p=spawnPos();p.y=0;new NPC(type,p);SFX.spawn();showNotif('▶ '+NPC_DEFS[type].n);}
function doSpawnVeh(type){var p=spawnPos();p.y=0;new Vehicle(type,p);SFX.spawn();showNotif('▶ '+VEH_DEFS[type].n);}
function doGiveWep(si){var w=player.weapons[si];if(!w||w.ammo<0)return;w.currentAmmo=w.ammo;w.reserveAmmo+=w.ammo*4;setSlot(si);SFX.pickup();showNotif('▶ '+w.n);}

// === SPAWN MENU ===
var selItem=null;
var activeCat='All';

function buildMenu(){
  document.querySelectorAll('.smt').forEach(function(t){
    t.addEventListener('click',function(){
      document.querySelectorAll('.smt').forEach(function(x){x.classList.remove('on');});
      t.classList.add('on');activeTab=t.dataset.t;activeCat='All';renderCats();renderGrid();
    });
  });
  document.getElementById('sm-srch').addEventListener('input',renderGrid);
}

function renderCats(){
  var cats=document.getElementById('sm-cats');cats.innerHTML='';
  if(activeTab==='toolgun'||activeTab==='weapons'||activeTab==='vehicles'){
    document.getElementById('sm-body').style.display='flex';
    var allEl=document.createElement('div');allEl.className='cat-item on';allEl.textContent='All';
    allEl.addEventListener('click',function(){activeCat='All';document.querySelectorAll('.cat-item').forEach(function(x){x.classList.remove('on');});allEl.classList.add('on');renderGrid();});
    cats.appendChild(allEl);return;
  }
  if(activeTab==='npcs'){
    document.getElementById('sm-body').style.display='flex';
    var npcCats=['All','Friendly','Combine','Undead','Creatures','Special','Birthday'];
    npcCats.forEach(function(c){
      var cnt=c==='All'?Object.keys(NPC_DEFS).length:Object.keys(NPC_DEFS).filter(function(k){return NPC_DEFS[k].cat===c;}).length;
      var el=document.createElement('div');el.className='cat-item'+(activeCat===c?' on':'');
      el.textContent=c+(cnt?' ('+cnt+')':'');
      el.addEventListener('click',function(){activeCat=c;document.querySelectorAll('.cat-item').forEach(function(x){x.classList.remove('on');});el.classList.add('on');renderGrid();});
      cats.appendChild(el);
    });return;
  }
  // Props - category tree
  var seen={};var catList=[];
  PROPS.forEach(function(p){if(!seen[p.c]){seen[p.c]=true;catList.push(p.c);}});
  var hdr=document.createElement('div');hdr.className='cat-hdr';hdr.textContent='Browse';cats.appendChild(hdr);
  var allEl=document.createElement('div');allEl.className='cat-item'+(activeCat==='All'?' on':'');allEl.textContent='All ('+PROPS.length+')';
  allEl.addEventListener('click',function(){setCat('All',allEl);});cats.appendChild(allEl);
  catList.forEach(function(c){
    var cnt=PROPS.filter(function(p){return p.c===c;}).length;
    var el=document.createElement('div');el.className='cat-item'+(activeCat===c?' on':'');
    el.textContent=c+' ('+cnt+')';
    el.addEventListener('click',function(){setCat(c,el);});
    cats.appendChild(el);
  });
}
function setCat(c,el){
  activeCat=c;document.querySelectorAll('.cat-item').forEach(function(x){x.classList.remove('on');});
  el.classList.add('on');renderGrid();
}

function renderGrid(){
  var grid=document.getElementById('sm-grid'),tg=document.getElementById('sm-tg');
  grid.style.display='';tg.style.display='none';tg.classList.remove('show');
  grid.innerHTML='';var q=document.getElementById('sm-srch').value.toLowerCase();

  if(activeTab==='toolgun'){
    grid.style.display='none';tg.style.display='flex';tg.classList.add('show');tg.innerHTML='';
    TG_MODES.forEach(function(m){
      var row=document.createElement('div');row.className='tgm'+(m.id===tgMode?' on':'');
      // Build param HTML
      var ph='';
      if(m.params){Object.keys(m.params).forEach(function(pk){
        var p=m.params[pk];
        if(p.options){
          ph+='<div class="tg-param"><span class="tg-pl">'+p.label+'</span><select class="tg-sel" data-m="'+m.id+'" data-p="'+pk+'">'
            +p.options.map(function(o){return '<option value="'+o+'"'+(o===p.val?' selected':'')+'>'+o+'</option>';}).join('')+'</select></div>';
        } else {
          ph+='<div class="tg-param"><span class="tg-pl">'+p.label+': <b class="tg-pv" id="tgv_'+m.id+'_'+pk+'">'+p.val+'</b></span>'
            +'<input class="tg-sl" type="range" min="'+p.min+'" max="'+p.max+'" step="'+p.step+'" value="'+p.val+'" data-m="'+m.id+'" data-p="'+pk+'"></div>';
        }
      });}
      row.innerHTML='<div class="tgm-ico">'+m.ico+'</div>'
        +'<div style="flex:1"><div class="tgm-name">'+m.n+'</div><div class="tgm-desc">'+m.desc+'</div>'
        +(ph?'<div class="tg-params">'+ph+'</div>':'')+'</div>';
      row.addEventListener('click',function(ev){
        if(ev.target.tagName==='INPUT'||ev.target.tagName==='SELECT'||ev.target.tagName==='OPTION')return;
        tgMode=m.id;tgWeld1=null;
        document.querySelectorAll('.tgm').forEach(function(x){x.classList.remove('on');});row.classList.add('on');
        updateToolHints();showNotif('🔧 '+m.n);setSlot(1);
      });
      // Wire up sliders/selects after appending
      tg.appendChild(row);
      row.querySelectorAll('.tg-sl').forEach(function(sl){
        sl.addEventListener('input',function(){
          var mo=TG_MODES.find(function(mx){return mx.id===sl.dataset.m;});
          if(mo&&mo.params[sl.dataset.p]){mo.params[sl.dataset.p].val=parseFloat(sl.value);var lbl=document.getElementById('tgv_'+sl.dataset.m+'_'+sl.dataset.p);if(lbl)lbl.textContent=sl.value;}
        });
        sl.addEventListener('mousedown',function(ev){ev.stopPropagation();});
        sl.addEventListener('click',function(ev){ev.stopPropagation();});
      });
      row.querySelectorAll('.tg-sel').forEach(function(sel){
        sel.addEventListener('change',function(){
          var mo=TG_MODES.find(function(mx){return mx.id===sel.dataset.m;});
          if(mo&&mo.params[sel.dataset.p])mo.params[sel.dataset.p].val=sel.value;
        });
        sel.addEventListener('mousedown',function(ev){ev.stopPropagation();});
      });
    });return;
  }

  if(activeTab==='props'){
    PROPS.forEach(function(def,i){
      if(q&&!def.n.toLowerCase().includes(q)&&!def.c.toLowerCase().includes(q))return;
      if(activeCat!=='All'&&def.c!==activeCat)return;
      var gi=mkGridItem(null,def.n,def.expl,i,'prop');
      var cv=document.createElement('canvas');cv.className='gi-cv';cv.width=64;cv.height=52;
      gi.insertBefore(cv,gi.firstChild);setTimeout((function(d,c){return function(){renderThumb(d,c);};})(def,cv),0);
      grid.appendChild(gi);
    });
  } else if(activeTab==='npcs'){
    Object.keys(NPC_DEFS).forEach(function(key){
      var def=NPC_DEFS[key];
      if(q&&!def.n.toLowerCase().includes(q))return;
      if(activeCat!=='All'&&def.cat!==activeCat)return;
      var gi=mkGridItem(def.e,def.n,false,key,'npc');grid.appendChild(gi);
    });
  } else if(activeTab==='vehicles'){
    Object.keys(VEH_DEFS).forEach(function(key){
      var def=VEH_DEFS[key];
      if(q&&!def.n.toLowerCase().includes(q))return;
      var gi=mkGridItem(def.e,def.n,false,key,'vehicle');grid.appendChild(gi);
    });
  } else if(activeTab==='weapons'){
    WEPS.slice(2).forEach(function(def,i){
      if(q&&!def.n.toLowerCase().includes(q))return;
      var gi=mkGridItem(def.e,def.n,false,i+2,'weapon');grid.appendChild(gi);
    });
  }
}

function mkGridItem(ico,name,badge,ref,type){
  var gi=document.createElement('div');gi.className='gi';
  if(badge){var bEl=document.createElement('div');bEl.className='gi-xbadge';bEl.textContent='EXPL';gi.appendChild(bEl);}
  if(ico){var iEl=document.createElement('div');iEl.className='gi-ico';iEl.textContent=ico;gi.appendChild(iEl);}
  var nm=document.createElement('div');nm.className='gi-name';nm.textContent=name;gi.appendChild(nm);
  gi.addEventListener('click',function(){
    document.querySelectorAll('.gi').forEach(function(x){x.classList.remove('sel');});gi.classList.add('sel');
    selItem={type:type,ref:ref};
    document.getElementById('sm-sel-name').textContent=name;
    var sub='';
    if(type==='prop'){var def=PROPS[ref];sub=def.c+' · '+def.m+'kg'+(def.expl?' · ⚠ EXPLOSIVE':'');}
    else if(type==='npc'){var nd=NPC_DEFS[ref];sub=(nd.agg?'⚠ Hostile':'✓ Friendly')+' · '+nd.hp+'HP';}
    else if(type==='vehicle'){var vd=VEH_DEFS[ref];sub=vd.desc+' · '+(vd.spd*3.6|0)+' km/h';}
    else if(type==='weapon'){var wd=WEPS[ref];sub=wd.desc+' · '+(wd.ammo<0?'∞':wd.ammo)+' ammo';}
    document.getElementById('sm-sel-sub').textContent=sub;
    // Spawn immediately on click
    spawnSel();
  });
  // single click spawns immediately (see above)
  return gi;
}

// Single shared offscreen renderer for ALL thumbnails - prevents context explosion
var _thumbR=null,_thumbS=null,_thumbC=null,_thumbQ=[],_thumbBusy=false;
function getThumbR(){
  if(_thumbR)return _thumbR;
  var oc=document.createElement('canvas');oc.width=64;oc.height=52;
  _thumbR=new THREE.WebGLRenderer({canvas:oc,antialias:false,preserveDrawingBuffer:true});
  _thumbR.setSize(64,52);_thumbR.setClearColor(0x1a1a1a,1);
  _thumbS=new THREE.Scene();
  _thumbC=new THREE.PerspectiveCamera(52,64/52,.1,50);_thumbC.position.set(1.4,.9,1.4);_thumbC.lookAt(0,0,0);
  _thumbS.add(new THREE.AmbientLight(0x505060,2));
  var dl=new THREE.DirectionalLight(0xffffff,.9);dl.position.set(2,3,2);_thumbS.add(dl);
  return _thumbR;
}
function renderThumb(def,cv){
  if(!cv||!def)return;
  _thumbQ.push({def:def,cv:cv});
  if(!_thumbBusy)drainThumbQ();
}
function drainThumbQ(){
  if(!_thumbQ.length){_thumbBusy=false;return;}
  _thumbBusy=true;
  var item=_thumbQ.shift();
  setTimeout(function(){
    try{
      var r=getThumbR();
      // Clear old meshes from scene (keep lights)
      var toRemove=[];
      _thumbS.traverse(function(o){if(o.isMesh)toRemove.push(o);});
      toRemove.forEach(function(o){_thumbS.remove(o);if(o.geometry)o.geometry.dispose();});
      var res=mkPropMesh(item.def);var mesh=res.mesh;
      var box=new THREE.Box3().setFromObject(mesh);var ctr=new THREE.Vector3();box.getCenter(ctr);
      mesh.position.sub(ctr);mesh.scale.setScalar(1.5/box.getSize(new THREE.Vector3()).length());
      mesh.rotation.y=.55;_thumbS.add(mesh);
      r.render(_thumbS,_thumbC);
      // Copy offscreen canvas to target canvas via 2D context
      var ctx=item.cv.getContext('2d');
      ctx.drawImage(r.domElement,0,0,64,52);
    }catch(e){}
    drainThumbQ();
  },0);
}


function spawnSel(){
  if(!selItem)return;
  if(selItem.type==='prop')doSpawnProp(selItem.ref);
  else if(selItem.type==='npc')doSpawnNPC(selItem.ref);
  else if(selItem.type==='vehicle')doSpawnVeh(selItem.ref);
  else if(selItem.type==='weapon')doGiveWep(selItem.ref);
}
function closeMenu(){menuOpen=false;document.getElementById('smenu').classList.remove('open');rpl();}

// === HUD / TOOL HINTS ===
function updateToolHints(){
  var h=[
    {n:'Physgun',m:'GRAVITY GUN',h:'<b>LMB:</b> Grab &amp; hold prop<br><b>RMB:</b> Freeze in place<br><b>Scroll:</b> Adjust distance<br><b>G:</b> Throw held prop<br><b>R:</b> Rotate'},
    {n:'Toolgun',m:'MODE: '+(TG_MODES.find(function(m){return m.id===tgMode;})||{n:tgMode}).n,h:'<b>LMB:</b> Use current tool<br><b>Q→Toolgun tab:</b> Change mode<br><b>Tip:</b> '+(TG_MODES.find(function(m){return m.id===tgMode;})||{desc:'Select a mode'}).desc.substring(0,48)+'…'},
    {n:'Pistol',  m:'SEMI-AUTO',   h:'<b>LMB:</b> Fire<br><b>R:</b> Reload'},
    {n:'Shotgun', m:'PUMP-ACTION', h:'<b>LMB:</b> Fire<br><b>R:</b> Reload'},
    {n:'SMG',     m:'FULL-AUTO',   h:'<b>Hold LMB:</b> Fire<br><b>R:</b> Reload'},
    {n:'AR2',     m:'PULSE RIFLE', h:'<b>LMB:</b> Fire<br><b>R:</b> Reload'},
    {n:'RPG',     m:'EXPLOSIVE',   h:'<b>LMB:</b> Launch rocket<br><b>R:</b> Reload'},
    {n:'Crowbar', m:'MELEE',       h:'<b>LMB:</b> Swing'},
  ];
  var info=h[slot]||h[0];
  document.getElementById('tp-name').textContent=info.n;
  document.getElementById('tp-mode').textContent=info.m;
  document.getElementById('tp-hint').innerHTML=info.h;
}

var notTO=null;
function showNotif(msg){var el=document.getElementById('notif');el.textContent=msg;el.style.display='block';el.style.opacity='1';if(notTO)clearTimeout(notTO);notTO=setTimeout(function(){el.style.opacity='0';setTimeout(function(){el.style.display='none';},300);},2000);}
function kfeed(msg){var kf=document.getElementById('kfeed'),d=document.createElement('div');d.className='kfe';d.textContent=msg;kf.appendChild(d);setTimeout(function(){if(d.parentNode)d.parentNode.removeChild(d);},4200);}

function updateHUD(){
  document.getElementById('hpv').textContent=Math.ceil(player.hp);
  document.getElementById('hpf').style.width=(player.hp/player.maxHp*100)+'%';
  document.getElementById('hpf').style.background=player.hp>50?'#e44':player.hp>25?'#f80':'#f00';
  document.getElementById('spv').textContent=Math.ceil(player.suit);
  document.getElementById('spf').style.width=(player.suit/100*100)+'%';
  var w=player.weapons[slot];
  document.getElementById('wlbl').textContent=w.n.toUpperCase();
  document.getElementById('abig').textContent=w.ammo<0?'∞':w.currentAmmo;
  document.getElementById('ares').textContent=w.ammo<0?'':(w.reserveAmmo>0?'/ '+w.reserveAmmo:'NO RESERVE');
  document.getElementById('entc').textContent=(physBodies.length+ents.length)+' ents';
  document.getElementById('ncbadge').style.display=noclip?'block':'none';
  document.getElementById('godbadge').style.display=godMode?'block':'none';
  document.getElementById('crouchbadge').style.display=crouching?'block':'none';
  var flybadge=document.getElementById('flybadge');if(flybadge)flybadge.style.display=flyMode?'block':'none';
  updateMpHud();
  var hint=document.getElementById('hint'),h='';
  if(!plocked&&!menuOpen)h='Click to play';
  else{
    RC.far=7;var dh=new THREE.Vector3();camera.getWorldDirection(dh);RC.set(camera.position,dh);
    var hhits=RC.intersectObjects(physBodies.map(function(b){return b.mesh;}),true);RC.far=Infinity;
    if(hhits.length)h='[LMB] Grab  [G] Freeze  [Del] Delete';
    for(var ei=0;ei<ents.length;ei++){var e=ents[ei];if(e&&e.mesh&&e.etype==='vehicle'&&!e.occupied&&camera.position.distanceTo(e.mesh.position)<4.5){h='[F] Enter '+e.def.n;break;}}
  }
  hint.style.display=h?'block':'none';if(h)hint.textContent=h;
}

// === INPUT ===
function setSlot(i){
  slot=i;if(PG.held&&i!==0)pgRelease();
  document.querySelectorAll('.ws').forEach(function(s,j){s.classList.toggle('on',j===i);});
  updateToolHints();
  if(curWpnMesh)curWpnMesh.visible=false;
  curWpnMesh=wpnMeshes[i]||null;
  if(curWpnMesh)curWpnMesh.visible=true;
}
function rpl(){if(!menuOpen&&!player.dead)document.body.requestPointerLock();}

document.addEventListener('keydown',function(e){
  if(e.repeat&&'wasdWASD '.includes(e.key))return;
  keys[e.key.toLowerCase()]=true;
  if(!started)return;
  var k=e.key.toLowerCase();
  if(k==='q'){if(!menuOpen){menuOpen=true;document.getElementById('smenu').classList.add('open');if(plocked)document.exitPointerLock();renderCats();renderGrid();}}
  if(k==='f'&&!menuOpen){if(inVeh)inVeh.exit();else{for(var i=0;i<ents.length;i++){var e2=ents[i];if(e2&&e2.mesh&&e2.etype==='vehicle'&&!e2.occupied&&camera.position.distanceTo(e2.mesh.position)<4.8){e2.enter();break;}}}}
  /* G key: handled above */
  if(k==='delete'&&!menuOpen){RC.far=50;var dd=new THREE.Vector3();camera.getWorldDirection(dd);RC.set(camera.position,dd);var dh2=RC.intersectObjects(physBodies.map(function(b){return b.mesh;}),true);RC.far=Infinity;if(dh2.length){var dpb=pgFindPB(dh2[0].object);if(dpb){if(PG.held===dpb)pgRelease();scene.remove(dpb.mesh);var di=physBodies.indexOf(dpb);if(di>-1)physBodies.splice(di,1);welds=welds.filter(function(w){return w.a!==dpb&&w.b!==dpb;});thrusters=thrusters.filter(function(th){if(th.pb===dpb){if(th.ind)scene.remove(th.ind);return false;}return true;});winches=winches.filter(function(w){if(w.a===dpb||w.b===dpb){if(w.line)scene.remove(w.line);return false;}return true;});fadingDoors=fadingDoors.filter(function(fd){return fd.pb!==dpb;});motors=motors.filter(function(m){return m.pb!==dpb;});if(isMulti&&dpb._eid)mpSendDelete(dpb._eid);SFX.delete();showNotif('Deleted');}}}
  if(k==='r'&&!menuOpen&&!inVeh&&!PG.held){var rw=player.weapons[slot];if(rw.ammo>0&&rw.reserveAmmo>0){var rn=Math.min(rw.ammo-rw.currentAmmo,rw.reserveAmmo);if(rn>0){rw.currentAmmo+=rn;rw.reserveAmmo-=rn;SFX.reload();showNotif('Reloaded');}}}
  if(k==='c'&&!e.ctrlKey&&!menuOpen&&!chatOpen){noclip=!noclip;flyMode=false;showNotif(noclip?'✈ Noclip ON':'✈ Noclip OFF');}
  if(k==='v'&&!menuOpen&&!chatOpen){flyMode=!flyMode;noclip=false;if(flyMode)player.vel.set(0,0,0);showNotif(flyMode?'🚀 Fly Mode ON':'🚀 Fly Mode OFF');}
  if(k==='g'&&!menuOpen&&!chatOpen&&!inVeh&&PG.held){pgThrow();}
  else if(k==='g'&&!menuOpen&&!chatOpen&&!inVeh&&!PG.held){godMode=!godMode;showNotif(godMode?'🛡 God Mode ON':'🛡 God Mode OFF');}
  if(k==='z'&&!menuOpen&&!chatOpen){doUndo();}
  if(k==='e'&&!menuOpen&&!chatOpen){tryInteract();}
  if(k==='t'&&!menuOpen&&!chatOpen&&isMulti){e.preventDefault();openChat();return;}
  if(k==='tab'&&!menuOpen){updateScoreboard();document.getElementById('scoreboard').classList.add('show');e.preventDefault();}
  if(!menuOpen&&!chatOpen)triggerFading(k);
  if(k>='1'&&k<='8')setSlot(parseInt(k)-1);
  if(k==='escape'&&menuOpen){closeMenu();}
  if(!menuOpen)e.preventDefault();
});
document.addEventListener('keyup',function(e){
  keys[e.key.toLowerCase()]=false;
  if(e.key.toLowerCase()==='q'&&menuOpen)closeMenu();
  if(e.key==='Tab'){document.getElementById('scoreboard').classList.remove('show');}
});
document.getElementById('chatinput').addEventListener('keydown',function(e){
  if(e.key==='Enter'){var msg=this.value.trim();if(msg){mpSendChat(msg);addChat(mpName,msg);}closeChat();}
  if(e.key==='Escape'){closeChat();}
  e.stopPropagation();
});
document.addEventListener('mousemove',function(e){
  if(!plocked||menuOpen||player.dead)return;
  if(PG.held&&PG.rotating){
    // Free 3D rotation: mouse X → world Y axis, mouse Y → camera right axis
    var rotSpd=0.012;
    var camRight=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0);
    var pb=PG.held;
    // Rotate around world Y (horizontal mouse)
    _Q.setFromAxisAngle(new THREE.Vector3(0,1,0), -e.movementX*rotSpd);
    pb.mesh.quaternion.premultiply(_Q);
    // Rotate around camera right axis (vertical mouse)
    _Q.setFromAxisAngle(camRight, -e.movementY*rotSpd);
    pb.mesh.quaternion.premultiply(_Q);
    pb.angVel.set(0,0,0);
    return;
  }
  yaw-=e.movementX*.002;pitch-=e.movementY*.002;pitch=Math.max(-1.55,Math.min(1.55,pitch));
});
document.addEventListener('mousedown',function(e){
  if(!started||menuOpen)return;
  if(e.button===0){mlmb=true;if(!plocked){rpl();return;}if(!inVeh)doShoot();}
  if(e.button===2){mrmb=true;if(!menuOpen&&!inVeh&&slot===0){RC.far=50;var dr=new THREE.Vector3();camera.getWorldDirection(dr);RC.set(camera.position,dr);var rh=RC.intersectObjects(physBodies.map(function(b){return b.mesh;}),true);RC.far=Infinity;if(rh.length){var rpb=pgFindPB(rh[0].object);if(rpb)pgFreeze(rpb);}}}
  e.preventDefault();
});
document.addEventListener('mouseup',function(e){
  if(e.button===0){mlmb=false;if(PG.held&&slot===0)pgRelease();}
  if(e.button===2)mrmb=false;
});
document.addEventListener('wheel',function(e){
  if(menuOpen)return;
  if(PG.held){msd=-e.deltaY*.006;}
  else{msd=0;var d=e.deltaY>0?1:-1;setSlot((slot+d+8)%8);}
  e.preventDefault();
},{passive:false});
document.addEventListener('contextmenu',function(e){e.preventDefault();});
document.addEventListener('pointerlockchange',function(){plocked=!!document.pointerLockElement;});

document.querySelectorAll('.ws').forEach(function(s,i){s.addEventListener('click',function(){setSlot(i);});});
document.getElementById('smenu').addEventListener('mousedown',function(e){e.stopPropagation();});
document.getElementById('smenu').addEventListener('wheel',function(e){e.stopPropagation();},{passive:false});

// === GAME LOOP ===
function gameLoop(){
  requestAnimationFrame(gameLoop);if(!started)return;
  var dt=Math.min(clock.getDelta(),.05);
  frameC++;var now=performance.now();
  if(now-lastFPS>700){document.getElementById('fpsc').textContent=Math.round(1000*frameC/(now-lastFPS))+' fps';frameC=0;lastFPS=now;}
  updatePlayer(dt);
  for(var bi=0;bi<physBodies.length;bi++){try{if(physBodies[bi]&&physBodies[bi].mesh)physBodies[bi].update(dt);}catch(x){}}
  try{collide();}catch(x){}
  updateWelds();
  for(var ei=0;ei<ents.length;ei++){try{if(ents[ei]&&ents[ei].mesh&&ents[ei].update)ents[ei].update(dt);}catch(x){}}
  if(slot===0)pgUpdate(dt);
  updateProjs(dt);updateParts(dt);updateThrusters(dt);
  updateRemotePlayers(dt);updateWires(dt);
  if((slot===4||slot===5)&&mlmb&&plocked&&!menuOpen&&!inVeh&&!chatOpen)doShoot();
  // Multiplayer position sync (every ~50ms)
  if(isMulti){
    mpMoveTimer+=dt;
    if(mpMoveTimer>0.05){mpMoveTimer=0;mpSendPos();}
    // Sync prop positions every 3 seconds so late-joiners get accurate state
    if(!window._mpPropT)window._mpPropT=0;
    window._mpPropT+=dt;
    if(window._mpPropT>3){window._mpPropT=0;
      physBodies.forEach(function(pb){
        if(!pb||!pb._eid||pb.sleeping||pb.frozen)return;
        if(mpWS&&mpWS.readyState===1)mpWS.send(JSON.stringify({
          type:'propUpdate',eid:pb._eid,
          pos:{x:pb.mesh.position.x,y:pb.mesh.position.y,z:pb.mesh.position.z},
          vel:{x:pb.vel.x,y:pb.vel.y,z:pb.vel.z},
          q:{x:pb.mesh.quaternion.x,y:pb.mesh.quaternion.y,z:pb.mesh.quaternion.z,w:pb.mesh.quaternion.w}
        }));
      });
    }
  }
  updateHUD();
  renderer.render(scene,camera);
  // First-person weapon overlay — render after main scene, no color clear
  if(plocked&&!menuOpen&&curWpnMesh&&wpnCam){
    wpnCam.position.copy(camera.position);
    wpnCam.quaternion.copy(camera.quaternion);
    wpnCam.aspect=camera.aspect;wpnCam.updateProjectionMatrix();
    var t=Date.now();
    curWpnMesh.position.y=Math.sin(t*.0014)*.003 - recoil*.05;
    curWpnMesh.position.x=Math.sin(t*.0009)*.002;
    curWpnMesh.rotation.x=-recoil*.22;
    renderer.autoClear=false;renderer.clearDepth();
    renderer.render(wpnScene,wpnCam);
    renderer.autoClear=true;
  }
}

// ── Main menu buttons ──────────────────────────────────────
document.getElementById('btn-sp').addEventListener('click',function(){
  initAudio();startGame();
});
document.getElementById('btn-mp').addEventListener('click',function(){
  document.getElementById('mm-mp').classList.add('show');
});
document.getElementById('rbtn').addEventListener('click',respawn);

// Scoreboard function
function updateScoreboard(){
  var rows=document.getElementById('sb-rows');if(!rows)return;
  rows.innerHTML='';
  // Self
  var self=document.createElement('div');self.className='sb-row';
  self.innerHTML='<span class="sb-name sb-you">★ '+mpName+'</span><span class="sb-hp">'+player.hp+'</span>';
  rows.appendChild(self);
  // Remote
  Object.values(remotePlayers).forEach(function(rp){
    var r=document.createElement('div');r.className='sb-row';
    r.innerHTML='<span class="sb-name">'+rp.name+'</span><span class="sb-hp">'+(rp.hp||100)+'</span>';
    rows.appendChild(r);
  });
}