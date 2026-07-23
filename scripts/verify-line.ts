/**
 * verify-line.ts — 転位線数値コアの検証(記事仕様書 02 付記 1)
 *
 * 実行: node scripts/verify-line.ts
 * (Node 22.18+ の型ストリップ実行を利用。ビルドには含まれない)
 *
 * 検証項目:
 *  1. 円弧平衡: τ < τ_c で張り出した弧が解析解 τb = T/R(たわみ
 *     h = R − √(R² − L²/4))と 2% 以内で一致すること。
 *  2. 1 サイクル: τ = 1.1τ_c で相殺(ループ切り離し)が起き、主ループが
 *     固定点を囲んで拡大し、源の線分が再生して 2 回目の放出に至ること。
 *  3. 緩和: τ = 0 に戻すとループが縮んで消え、源が直線へ戻ること。
 *  4. 全過程で NaN が出ないこと。
 */

import {
  FrankReadSim,
  TAU_C_SIM,
  sagFromRadius,
  type SimEvents,
} from "../src/widgets/frank-read-source/lib/line.ts";

let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  const mark = ok ? "ok  " : "FAIL";
  console.log(`  [${mark}] ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const events: SimEvents = { recombined: false, collapsedLoops: 0, nan: false };

function run(sim: FrankReadSim, simTime: number, onEvent?: () => void): void {
  const chunk = 1 / 60;
  let t = 0;
  while (t < simTime) {
    sim.advance(Math.min(chunk, simTime - t), events);
    if (events.nan) throw new Error("NaN を検出しました");
    if (events.recombined && onEvent) onEvent();
    t += chunk;
  }
}

/* ---- 1. 円弧平衡 ---- */
console.log("1. 円弧平衡(τb = T/R、誤差 2% 以内)");
for (const ratio of [0.4, 0.8, 0.95]) {
  const sim = new FrankReadSim();
  sim.tau = ratio * TAU_C_SIM;
  run(sim, 8);
  // 解析解: R = T/(τb)、h = R − √(R² − L²/4)(T = b = L = 1)
  const rExact = 1 / sim.tau;
  const hExact = sagFromRadius(rExact, 1);
  let hSim = 0;
  for (const y of sim.source.y) if (y > hSim) hSim = y;
  const err = Math.abs(hSim - hExact) / hExact;
  check(
    `τ = ${ratio} τ_c`,
    err < 0.02,
    `h_sim = ${hSim.toFixed(4)}, h_exact = ${hExact.toFixed(4)}, 誤差 ${(err * 100).toFixed(2)}%`,
  );
}

/* ---- 2. 1 サイクル(τ = 1.1 τ_c) ---- */
console.log("2. 源の動作(τ = 1.1 τ_c)");
{
  const sim = new FrankReadSim();
  sim.tau = 1.1 * TAU_C_SIM;
  let emissions = 0;
  let firstLoopId = -1;
  let firstLoopR0 = 0;
  const maxTime = 60;
  const chunk = 1 / 60;
  let t = 0;
  while (t < maxTime && emissions < 2) {
    sim.advance(chunk, events);
    if (events.nan) throw new Error("NaN を検出しました");
    if (events.recombined) {
      emissions++;
      if (emissions === 1 && sim.loops.length > 0) {
        const loop = sim.loops[sim.loops.length - 1];
        firstLoopId = loop.id;
        firstLoopR0 = loop.maxRadius();
      }
    }
    // ステージ外(半径 2.5L)へ出たループは widget と同様に除去する
    for (let i = sim.loops.length - 1; i >= 0; i--) {
      if (sim.loops[i].maxRadius() > 2.5) sim.loops.splice(i, 1);
    }
    t += chunk;
  }
  check(
    "相殺が 2 回以上起きる",
    emissions >= 2,
    `${emissions} 回 (t = ${t.toFixed(1)})`,
  );

  // 主ループの検証(1 回目の放出直後の状態を再現)
  const sim2 = new FrankReadSim();
  sim2.tau = 1.1 * TAU_C_SIM;
  let seen = false;
  let loopContainsPins = false;
  let loopGrew = false;
  t = 0;
  while (t < maxTime && !seen) {
    sim2.advance(chunk, events);
    if (events.recombined && sim2.loops.length > 0) {
      seen = true;
      const loop = sim2.loops[0];
      loopContainsPins =
        loop.containsPoint(sim2.pinAx, 0) && loop.containsPoint(sim2.pinBx, 0);
      const r0 = loop.maxRadius();
      // advance は 1 回あたりのステップ数に上限があるため小刻みに進める
      for (let s = 0; s < 30; s++) sim2.advance(chunk, events);
      const stillThere = sim2.loops.find((l) => l.id === loop.id);
      loopGrew = !!stillThere && stillThere.maxRadius() > r0 * 1.05;
    }
    t += chunk;
  }
  check("主ループが両固定点を囲む", loopContainsPins);
  check("主ループが応力下で拡大する", loopGrew);
  const endsPinned =
    sim2.source.x[0] === sim2.pinAx &&
    sim2.source.y[0] === 0 &&
    sim2.source.x[sim2.source.n - 1] === sim2.pinBx &&
    sim2.source.y[sim2.source.n - 1] === 0;
  check("源の両端が固定点に留まる", endsPinned);
  void firstLoopId;
  void firstLoopR0;

  /* ---- 3. 緩和(τ = 0) ---- */
  console.log("3. 緩和(τ = 0 でループ消滅・直線復帰)");
  sim2.tau = 0;
  run(sim2, 30);
  check(
    "ループがすべて縮んで消える",
    sim2.loops.length === 0,
    `残り ${sim2.loops.length}`,
  );
  let maxAbsY = 0;
  for (const y of sim2.source.y) maxAbsY = Math.max(maxAbsY, Math.abs(y));
  check(
    "源が直線へ戻る(|y| < 0.02)",
    maxAbsY < 0.02,
    `max|y| = ${maxAbsY.toFixed(4)}`,
  );
}

console.log(failures === 0 ? "\nすべて合格" : `\n失敗 ${failures} 件`);
process.exit(failures === 0 ? 0 : 1);
