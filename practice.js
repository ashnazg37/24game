import { getRandomSolvablePuzzle } from "./solver.js";
import { renderCards, fmt } from "./cards.js";

let timeLimit=60, timeLeft=60, elapsed=0, timerInterval=null, puzzleStart=null;
let solved=0, streak=0, bestMs=null, totalMs=0;
let cards=[], selectedIdx=null, selectedOp=null, cardHistory=[];
const OPS={"+":  (a,b)=>a+b, "−":(a,b)=>a-b, "×":(a,b)=>a*b, "÷":(a,b)=>a/b};

function render() {
  renderCards("card-grid", cards, selectedIdx, selectedOp,
    idx => { selectedIdx=idx; selectedOp=null; clearErr(); render(); },
    op  => { selectedOp=op; render(); },
    bIdx => combine(bIdx)
  );
}

document.getElementById("start-btn").addEventListener("click", () => {
  timeLimit = parseInt(document.getElementById("time-limit-select").value);
  document.getElementById("start-screen").style.display = "none";
  document.getElementById("game-screen").style.display  = "block";
  if (timeLimit===0) document.getElementById("timer-fill").style.display = "none";
  nextPuzzle();
});

function nextPuzzle() {
  clearInterval(timerInterval);
  cards       = getRandomSolvablePuzzle().map(n=>({value:n,expr:String(n),used:false,isResult:false}));
  selectedIdx = null; selectedOp = null; cardHistory = [];
  puzzleStart = Date.now(); elapsed = 0;
  clearErr(); hideFeedback(); render();
  if (timeLimit>0) startCountdown(); else startStopwatch();
}

function startCountdown() {
  timeLeft=timeLimit; paint(timeLeft,timeLimit);
  timerInterval=setInterval(()=>{ timeLeft--; paint(timeLeft,timeLimit); if(timeLeft<=0){clearInterval(timerInterval);onTimeout();}},1000);
}
function startStopwatch() {
  document.getElementById("timer-seconds").textContent="0";
  timerInterval=setInterval(()=>{elapsed++;document.getElementById("timer-seconds").textContent=elapsed;},1000);
}
function paint(left,total) {
  const pct=total>0?(left/total)*100:100;
  const col=pct>50?"#818cf8":pct>25?"#fbbf24":"#f87171";
  document.getElementById("timer-seconds").textContent=left;
  document.getElementById("timer-seconds").style.color=col;
  document.getElementById("timer-fill").style.width=pct+"%";
  document.getElementById("timer-fill").style.backgroundColor=col;
}
function onTimeout(){streak=0;showFeedback("⏱ Time's up!","timeout");updateStats();setTimeout(nextPuzzle,1800);}

function combine(bIdx) {
  const a=cards[selectedIdx], b=cards[bIdx];
  if (selectedOp==="÷"&&Math.abs(b.value)<1e-12){showErr("Can't divide by zero");return;}
  const result=OPS[selectedOp](a.value,b.value);
  if (!isFinite(result)){showErr("Invalid");return;}
  cardHistory.push(JSON.parse(JSON.stringify(cards)));
  cards[selectedIdx]={value:result,expr:`(${a.expr} ${selectedOp} ${b.expr})`,used:false,isResult:true};
  cards[bIdx]={...b,used:true};
  selectedIdx=null; selectedOp=null; clearErr();
  const rem=cards.filter(c=>!c.used);
  if (rem.length===1) checkWin(rem[0]); else render();
}

function checkWin(card) {
  if (Math.abs(card.value-24)<1e-9) {
    clearInterval(timerInterval);
    const ms=Date.now()-puzzleStart;
    solved++;streak++;totalMs+=ms;
    if(bestMs===null||ms<bestMs) bestMs=ms;
    showFeedback(`✓ Solved in ${(ms/1000).toFixed(1)}s`,"correct");
    updateStats(); setTimeout(nextPuzzle,1400);
  } else { render(); showErr(`Result is ${fmt(card.value)}, not 24 — tap ↩ Undo`); }
}

document.getElementById("undo-btn").addEventListener("click",()=>{
  if(!cardHistory.length)return;
  cards=cardHistory.pop();selectedIdx=null;selectedOp=null;clearErr();render();
});
document.getElementById("skip-btn").addEventListener("click",()=>{
  clearInterval(timerInterval);streak=0;showFeedback("Skipped.","wrong");updateStats();setTimeout(nextPuzzle,1000);
});

function updateStats(){
  document.getElementById("stat-solved").textContent=solved;
  document.getElementById("stat-streak").textContent=streak;
  if(bestMs!==null) document.getElementById("stat-best").textContent=(bestMs/1000).toFixed(1)+"s";
  if(solved>0)      document.getElementById("stat-avg").textContent=((totalMs/solved)/1000).toFixed(1)+"s";
}
function showFeedback(msg,type){const el=document.getElementById("feedback");el.textContent=msg;el.className=`feedback ${type}`;}
function hideFeedback(){const el=document.getElementById("feedback");el.textContent="";el.className="feedback hidden";}
function showErr(msg){const el=document.getElementById("input-error");el.textContent=msg;el.style.display="block";}
function clearErr(){const el=document.getElementById("input-error");el.textContent="";el.style.display="none";}