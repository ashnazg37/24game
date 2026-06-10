import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ref, onValue, runTransaction, update, get, set, increment, remove, onDisconnect }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { getRandomSolvablePuzzle } from "./solver.js";
import { renderCards, fmt } from "./cards.js";

const roomCode = new URLSearchParams(window.location.search).get("room");
if (!roomCode) window.location.href = "dashboard.html";

let currentUser=null, isHost=false, room=null;
let skipInFlight=false, autoAdvanceTimeout=null, abandonHandled=false;
let cards=[], selectedIdx=null, selectedOp=null, cardHistory=[];
const OPS={"+":  (a,b)=>a+b, "−":(a,b)=>a-b, "×":(a,b)=>a*b, "÷":(a,b)=>a/b};

function render() {
  renderCards("card-grid", cards, selectedIdx, selectedOp,
    idx => { selectedIdx=idx; selectedOp=null; clearInputError(); render(); },
    op  => { selectedOp=op; render(); },
    bIdx => combineCards(bIdx)
  );
}

onAuthStateChanged(auth, user => {
  if (!user) { window.location.href = "index.html"; return; }
  currentUser = user;
  document.getElementById("user-photo").src = user.photoURL||"";
  document.getElementById("room-code-nav").textContent = roomCode;
  remove(ref(db,`matchmaking/matched/${user.uid}`));
  remove(ref(db,`matchmaking/seeking/${user.uid}`));
  const onRef=ref(db,`rooms/${roomCode}/players/${user.uid}/online`);
  set(onRef,true); onDisconnect(onRef).set(false);
  listenToRoom();
});

function listenToRoom() {
  onValue(ref(db,`rooms/${roomCode}`), snap => {
    if(!snap.exists()){alert("Room not found.");window.location.href="dashboard.html";return;}
    room=snap.val(); renderGame();
  });
}

function renderGame() {
  isHost = room.meta.hostUid===currentUser.uid;
  const is1v1 = room.meta.gameMode==="1v1";
  document.getElementById("round-display").textContent=`Round ${room.meta.currentRound+1} / ${room.settings.totalRounds}`;
  document.getElementById("resign-btn").textContent=is1v1?"Resign":"Leave Room";

  if (is1v1&&room.meta.status==="active"&&!abandonHandled) {
    const online=Object.entries(room.players||{}).filter(([,p])=>p.online).map(([uid])=>uid);
    if (online.length===1&&online[0]===currentUser.uid) {
      const gone=Object.keys(room.players||{}).find(uid=>uid!==currentUser.uid);
      if(gone){abandonHandled=true;handleAbandonment(gone);return;}
    }
  }
  renderSidebars();
  if(room.meta.status==="finished"||room.meta.status==="abandoned"){showView("end-view");renderEndScreen();return;}
  const round=currentRound(); if(!round)return;
  if(round.status==="active"){showView("round-view");renderActiveRound(round);}
  else{showView("result-view");renderResult(round);}
}

function renderActiveRound(round) {
  skipInFlight=false;
  const nums=Object.values(round.numbers), numKey=nums.join(",");
  if(window._lastNumKey!==numKey){
    window._lastNumKey=numKey;
    cards=nums.map(n=>({value:n,expr:String(n),used:false,isResult:false}));
    selectedIdx=null;selectedOp=null;cardHistory=[];
  }
  render();
  const onlineCount=Object.values(room.players||{}).filter(p=>p.online).length;
  const needed=room.settings.skipMode==="unanimous"?onlineCount:Math.ceil(onlineCount/2);
  const votes=Object.keys(round.skipVotes||{}).length;
  document.getElementById("skip-count").textContent=votes;
  document.getElementById("skip-needed").textContent=needed;
  document.getElementById("skip-btn").style.opacity=round.skipVotes?.[currentUser.uid]?"0.4":"1";
  if(round.status==="active"&&needed>0&&votes>=needed) triggerSkip();
}

function combineCards(bIdx) {
  const a=cards[selectedIdx],b=cards[bIdx];
  if(selectedOp==="÷"&&Math.abs(b.value)<1e-12){showInputError("Can't divide by zero");return;}
  const result=OPS[selectedOp](a.value,b.value);
  if(!isFinite(result)){showInputError("Invalid");return;}
  cardHistory.push(JSON.parse(JSON.stringify(cards)));
  cards[selectedIdx]={value:result,expr:`(${a.expr} ${selectedOp} ${b.expr})`,used:false,isResult:true};
  cards[bIdx]={...b,used:true};
  selectedIdx=null;selectedOp=null;clearInputError();
  const rem=cards.filter(c=>!c.used);
  if(rem.length===1) checkWin(rem[0]); else render();
}

function checkWin(card) {
  if(Math.abs(card.value-24)<1e-9) autoSubmit(card.expr);
  else{render();showInputError(`Result is ${fmt(card.value)}, not 24 — ↩ undo`);}
}

document.getElementById("undo-btn").addEventListener("click",()=>{
  if(!cardHistory.length)return;
  cards=cardHistory.pop();selectedIdx=null;selectedOp=null;clearInputError();render();
});

async function autoSubmit(solution){
  const result=await runTransaction(ref(db,`rooms/${roomCode}/rounds/${room.meta.currentRound}`),cur=>{
    if(!cur||cur.status!=="active")return;
    return{...cur,status:"solved",winnerId:currentUser.uid,winnerName:currentUser.displayName,solution,solvedAt:Date.now()};
  });
  if(result.committed) await resolveWin(currentUser.uid);
}

document.getElementById("skip-btn").addEventListener("click",async()=>{
  const round=currentRound();
  if(!round||round.status!=="active"||round.skipVotes?.[currentUser.uid])return;
  await update(ref(db,`rooms/${roomCode}/rounds/${room.meta.currentRound}/skipVotes`),{[currentUser.uid]:true});
});

async function triggerSkip(){
  if(skipInFlight)return; skipInFlight=true;
  try{
    const result=await runTransaction(ref(db,`rooms/${roomCode}/rounds/${room.meta.currentRound}`),
      cur=>{if(!cur||cur.status!=="active")return;return{...cur,status:"skipped"};});
    if(result.committed&&room.meta.gameMode==="1v1"){
      const u={};Object.keys(room.players||{}).forEach(uid=>{u[`players/${uid}/roundsPlayed`]=increment(1);});
      if(Object.keys(u).length)await update(ref(db),u);
    }
  }finally{skipInFlight=false;}
}

function renderResult(round){
  const el=document.getElementById("result-content");
  if(round.status==="solved")
    el.innerHTML=`<p class="result-winner">🏆 ${round.winnerName}</p><code class="result-solution">${round.solution}</code>`;
  else el.innerHTML=`<p class="result-skipped">Round skipped.</p>`;
  const is1v1=room.meta.gameMode==="1v1";
  document.getElementById("next-round-btn").style.display=(isHost&&!is1v1)?"inline-block":"none";
  document.getElementById("waiting-for-host").style.display=(!isHost&&!is1v1)?"block":"none";
  if(is1v1&&isHost&&!autoAdvanceTimeout){
    const msg=document.getElementById("auto-advance-msg");
    msg.style.display="block";msg.textContent="Next round in 3s…";
    autoAdvanceTimeout=setTimeout(async()=>{autoAdvanceTimeout=null;msg.style.display="none";try{await nextRound();}catch(e){console.error(e);}},3000);
  }
}

function renderEndScreen(){
  document.getElementById("end-title").textContent=room.meta.status==="abandoned"?"Game Ended":"Game Over";
  const ab=document.getElementById("abandon-msg");
  if(room.meta.status==="abandoned"){ab.textContent=room.meta.abandonedBy===currentUser.uid?"You resigned.":`${room.meta.abandonedName||"Opponent"} left.`;ab.style.display="block";}
  else ab.style.display="none";
  document.getElementById("final-scores").innerHTML=Object.entries(room.players||{})
    .sort(([,a],[,b])=>b.roomScore-a.roomScore)
    .map(([uid,p],i)=>`<div class="final-player ${uid===currentUser.uid?"is-you":""}">
      <span class="final-rank">#${i+1}</span>
      <img src="${p.photoURL||""}" onerror="this.style.display='none'" style="width:30px;height:30px;border-radius:50%;">
      <span class="final-name">${p.displayName}</span>
      <span class="final-score">${p.roomScore} wins</span></div>`).join("");
}

function renderSidebars(){
  const players=Object.entries(room.players||{}).filter(([,p])=>p.online);
  const is1v1=room.meta.gameMode==="1v1";
  document.getElementById("room-leaderboard").innerHTML=[...players]
    .sort(([,a],[,b])=>b.roomScore-a.roomScore)
    .map(([uid,p])=>`<li class="player-item ${uid===currentUser.uid?"is-you":""}">
      <img src="${p.photoURL||""}" style="width:24px;height:24px;border-radius:50%;" onerror="this.style.display='none'">
      <span style="font-size:0.86rem;flex:1;">${p.displayName}</span>
      <span class="player-score">${p.roomScore}</span></li>`).join("");
  const eloSection=document.getElementById("elo-section");
  if(eloSection)eloSection.style.display=is1v1?"block":"none";
  if(is1v1){
    document.getElementById("elo-list").innerHTML=[...players]
      .sort(([,a],[,b])=>(b.rating??1200)-(a.rating??1200))
      .map(([uid,p])=>`<li class="player-item ${uid===currentUser.uid?"is-you":""}">
        <span style="font-size:0.86rem;flex:1;">${p.displayName}</span>
        <span class="player-score">${p.rating??1200}</span></li>`).join("");
  }
}

document.getElementById("next-round-btn").addEventListener("click",()=>nextRound());
async function nextRound(){
  if(!isHost)return;
  const next=room.meta.currentRound+1,total=room.settings.totalRounds;
  if(next>=total){await update(ref(db,`rooms/${roomCode}/meta`),{status:"finished"});return;}
  const numbers=getRandomSolvablePuzzle();
  await update(ref(db),{
    [`rooms/${roomCode}/meta/currentRound`]:next,
    [`rooms/${roomCode}/rounds/${next}`]:{numbers,status:"active",startedAt:Date.now(),winnerId:null,winnerName:null,solution:null,skipVotes:{}}
  });
}

document.getElementById("resign-btn").addEventListener("click",async()=>{
  if(!confirm(room?.meta?.gameMode==="1v1"?"Resign?":"Leave room?"))return;
  const r=ref(db,`rooms/${roomCode}/players/${currentUser.uid}/online`);
  onDisconnect(r).cancel();await set(r,false);window.location.href="dashboard.html";
});

async function handleAbandonment(abandonerUid){
  const result=await runTransaction(ref(db,`rooms/${roomCode}/meta/status`),s=>{if(s!=="active")return;return"abandoned";});
  if(!result.committed)return;
  await update(ref(db,`rooms/${roomCode}/meta`),{abandonedBy:abandonerUid,abandonedName:room.players?.[abandonerUid]?.displayName||"Opponent"});
  await resolveWin(currentUser.uid);
}

async function resolveWin(winnerId){
  const players=room.players||{},allUids=Object.keys(players),is1v1=room.meta.gameMode==="1v1",updates={};
  if(is1v1){
    const reads=await Promise.all(allUids.map(uid=>get(ref(db,`players/${uid}/rating`))));
    const ratings={};allUids.forEach((uid,i)=>{ratings[uid]=reads[i].val()??1200;});
    const changes=eloChanges(ratings,winnerId,allUids);
    allUids.forEach(uid=>{
      const nr=Math.max(100,ratings[uid]+changes[uid]);
      updates[`players/${uid}/rating`]=nr;updates[`rooms/${roomCode}/players/${uid}/rating`]=nr;
      updates[`players/${uid}/roundsPlayed`]=increment(1);
    });
    updates[`players/${winnerId}/wins`]=increment(1);
  }
  updates[`rooms/${roomCode}/players/${winnerId}/roomScore`]=increment(1);
  if(Object.keys(updates).length)await update(ref(db),updates);
}

function expected(rA,rB){return 1/(1+Math.pow(10,(rB-rA)/400));}
function eloChanges(ratings,winnerId,uids,K=32){
  const d={};uids.forEach(uid=>{d[uid]=0;});
  const Rw=ratings[winnerId]??1200;
  uids.forEach(uid=>{if(uid===winnerId)return;const Ro=ratings[uid]??1200;d[winnerId]+=K*(1-expected(Rw,Ro));d[uid]+=K*(0-expected(Ro,Rw));});
  return Object.fromEntries(Object.entries(d).map(([uid,v])=>[uid,Math.round(v)]));
}

function currentRound(){return room?.rounds?.[room.meta.currentRound]??null;}
function showView(id){["round-view","result-view","end-view"].forEach(v=>document.getElementById(v).style.display=v===id?"block":"none");}
function showInputError(msg){const el=document.getElementById("input-error");el.textContent=msg;el.style.display="block";}
function clearInputError(){const el=document.getElementById("input-error");el.textContent="";el.style.display="none";}