import { clear, h } from '../../utils/dom.js';

let stylesInjected = false;

export function injectWarfrontStylesOnce() {
  if (stylesInjected || typeof document === 'undefined') return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .header{text-align:center;margin-bottom:1rem;padding-bottom:1rem;border-bottom:1px solid rgba(90,79,71,.55)}
    .gold-widget,.gold-row{display:flex;align-items:center;justify-content:space-between;background:rgba(61,53,47,.82);border:1px solid rgba(90,79,71,.68);border-radius:8px;padding:10px 16px;margin-bottom:1rem}
    .gw-gold,.gold-row .lbl{font-family:'Cinzel',serif;font-size:20px;color:#c9a84c}
    .gw-slots,.gold-row .rem{font-size:13px;color:#d4c9a8}
    .gw-sep{color:#8d7d65;margin:0 .35rem}
    .collection-sel{display:flex;gap:8px;margin-bottom:1rem}
    .col-btn{flex:1;padding:10px;border-radius:8px;border:1px solid rgba(90,79,71,.7);background:transparent;cursor:pointer;font-family:'Cinzel',serif;font-size:14px;letter-spacing:1px;transition:all .15s;text-align:center;color:#d4c9a8}
    .col-btn:hover{border-color:#c9a84c}.col-btn.active{background:#3d2f10;border-color:#c9a84c;color:#c9a84c}
    .col-btn.fantasy{color:#c9a84c}.col-btn.animals{color:#6bd96b}
    .legend{display:flex;gap:10px;flex-wrap:wrap;font-size:11px;color:#d4c9a8;margin-bottom:1rem;padding:7px 12px;background:#2a2420;border-radius:6px}
    .legend-item{display:flex;align-items:center;gap:4px}.leg-dot{width:9px;height:9px;border-radius:50%;flex-shrink:0}
    .units-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,140px));gap:8px;margin-bottom:.75rem;justify-content:center}
    .unit-card{background:linear-gradient(160deg,#080c18 0%,#0d1320 60%,#111828 100%);border:1px solid rgba(80,140,255,.22);border-radius:10px;padding:10px 8px 8px;cursor:pointer;position:relative;overflow:hidden;transition:border-color .18s,box-shadow .18s,background .18s;user-select:none;display:flex;flex-direction:column;min-height:180px}
    .unit-card::before{content:'';position:absolute;top:0;left:0;width:36px;height:36px;border-top:2px solid rgba(80,180,255,.5);border-left:2px solid rgba(80,180,255,.5);border-radius:10px 0 0 0;pointer-events:none;transition:opacity .18s;opacity:.55}
    .unit-card::after{content:'';position:absolute;bottom:0;right:0;width:28px;height:28px;border-bottom:2px solid rgba(80,180,255,.3);border-right:2px solid rgba(80,180,255,.3);border-radius:0 0 10px 0;pointer-events:none;opacity:.4}
    .unit-card:hover{border-color:rgba(80,200,255,.7);box-shadow:0 0 18px rgba(80,200,255,.18),inset 0 0 22px rgba(80,200,255,.04)}
    .unit-card:hover::before{opacity:1}
    .unit-card.selected{border-color:rgba(80,255,160,.85);background:linear-gradient(160deg,#041510 0%,#071f14 60%,#0b2619 100%);box-shadow:0 0 22px rgba(80,255,160,.22),inset 0 0 20px rgba(80,255,160,.05)}
    .unit-card.selected::before{border-color:rgba(80,255,160,.65);opacity:1}
    .unit-card.selected::after{border-color:rgba(80,255,160,.45)}
    .unit-card.dimmed{opacity:.28;pointer-events:none}
    .uc-top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:3px}
    .uc-name{font-family:'Cinzel',serif;font-size:10px;color:#b8ccff;line-height:1.2;letter-spacing:.2px}
    .uc-cost{font-size:10px;font-weight:700;color:#0a0c15;background:linear-gradient(135deg,#c9a84c,#ffe080);padding:1px 5px;border-radius:3px;white-space:nowrap;box-shadow:0 0 6px rgba(200,168,76,.4)}
    .uc-icon{font-size:28px;margin:1px auto 3px;display:block;text-align:center;filter:drop-shadow(0 0 5px rgba(80,200,255,.35))}
    .unit-card.selected .uc-icon{filter:drop-shadow(0 0 8px rgba(80,255,160,.6))}
    .uc-tags{display:flex;flex-wrap:wrap;gap:2px;margin-bottom:3px;min-height:13px}
    .tag{font-size:8px;padding:1px 4px;border-radius:3px;text-transform:uppercase;letter-spacing:.3px;font-weight:600}
    .tag-ground{background:rgba(90,79,71,.6);color:#c8b898}.tag-flying{background:rgba(20,55,95,.8);color:#82c8ff}.tag-melee{background:rgba(95,18,18,.8);color:#ff9090}.tag-ranged{background:rgba(18,75,38,.8);color:#80ffaa}.tag-rusher{background:rgba(75,18,95,.8);color:#cc80ff}.tag-aoe{background:rgba(95,55,18,.8);color:#ffb870}.tag-support{background:rgba(18,75,75,.8);color:#80ffee}.tag-special{background:rgba(55,18,75,.8);color:#ff80cc}.tag-animal{background:rgba(10,45,10,.8);color:#6be86b}.tag-fantasy{background:rgba(40,18,55,.8);color:#bb80ff}
    .uc-bars{margin-bottom:3px}
    .bar-row{display:flex;align-items:center;gap:4px;margin-bottom:1px}
    .bar-lbl{font-size:8px;color:rgba(160,185,230,.7);width:18px;text-transform:uppercase}
    .bar-track{flex:1;height:3px;background:rgba(255,255,255,.07);border-radius:2px;overflow:hidden}
    .bar-fill{height:100%;border-radius:2px}
    .uc-tip{font-size:9px;color:rgba(160,185,220,.6);font-style:italic;line-height:1.3;margin-bottom:3px;flex:1}
    .qty-ctrl{display:flex;align-items:center;gap:4px;margin-top:auto}
    .qty-btn{width:22px;height:22px;border:1px solid rgba(80,140,255,.38);border-radius:4px;background:rgba(80,140,255,.08);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;color:#b8ccff;transition:background .1s,border-color .1s}
    .qty-btn:hover:not(:disabled){background:rgba(80,140,255,.2);border-color:rgba(80,200,255,.8)}
    .qty-btn:disabled{opacity:.22;cursor:not-allowed}
    .qty-num{font-family:'Cinzel',serif;font-size:14px;color:#7fffb0;min-width:16px;text-align:center}
    .roster{display:flex;flex-wrap:wrap;gap:6px;min-height:44px;padding:8px 10px;background:rgba(6,12,24,.8);border:1px solid rgba(80,160,255,.14);border-radius:9px;margin-bottom:10px;position:relative}
    .roster-chip{font-size:18px;width:36px;height:36px;display:flex;align-items:center;justify-content:center;border-radius:8px;background:linear-gradient(135deg,rgba(80,140,255,.14),rgba(80,200,255,.07));border:1px solid rgba(80,200,255,.38);box-shadow:0 0 8px rgba(80,200,255,.12),inset 0 0 8px rgba(80,200,255,.04);transition:all .15s}
    .roster-chip:hover{border-color:rgba(80,220,255,.7);box-shadow:0 0 14px rgba(80,200,255,.25)}
    .roster-empty{font-size:12px;color:rgba(120,150,200,.38);font-style:italic;align-self:center;letter-spacing:.3px}
    .army-sticky{position:sticky;bottom:0;z-index:99;background:linear-gradient(180deg,rgba(3,7,18,.97) 0%,rgba(5,10,22,.98) 100%);backdrop-filter:blur(14px);border-top:1px solid rgba(80,200,255,.22);border-left:1px solid rgba(80,200,255,.1);border-right:1px solid rgba(80,200,255,.1);border-bottom:0;border-radius:14px 14px 0 0;padding:12px 14px 14px;margin-top:.5rem;box-shadow:0 -12px 40px rgba(0,40,140,.18),0 0 0 1px rgba(80,200,255,.06) inset}
    .army-sticky::before{content:'';position:absolute;top:0;left:50%;transform:translateX(-50%);width:60px;height:2px;background:linear-gradient(90deg,transparent,rgba(80,200,255,.6),transparent);border-radius:2px}
    .army-sticky .roster{margin-bottom:10px}
    .btn-main{width:100%;padding:13px;font-family:'Cinzel',serif;font-size:14px;letter-spacing:2.5px;background:linear-gradient(135deg,rgba(10,30,80,.6),rgba(8,22,60,.7));color:#80cfff;border:1px solid rgba(80,180,255,.45);border-radius:10px;cursor:pointer;transition:all .2s;margin-bottom:0;position:relative;overflow:hidden;box-shadow:0 0 18px rgba(40,120,255,.1),inset 0 0 20px rgba(40,120,255,.04);text-shadow:0 0 14px rgba(80,200,255,.45)}
    .btn-main::before{content:'';position:absolute;top:0;left:0;width:32px;height:32px;border-top:1.5px solid rgba(80,200,255,.5);border-left:1.5px solid rgba(80,200,255,.5);border-radius:10px 0 0 0;pointer-events:none}
    .btn-main::after{content:'';position:absolute;bottom:0;right:0;width:22px;height:22px;border-bottom:1.5px solid rgba(80,200,255,.35);border-right:1.5px solid rgba(80,200,255,.35);border-radius:0 0 10px 0;pointer-events:none}
    .btn-main:hover:not(:disabled){border-color:rgba(80,220,255,.8);box-shadow:0 0 28px rgba(40,160,255,.22),inset 0 0 28px rgba(40,160,255,.07);color:#c0eeff;text-shadow:0 0 20px rgba(80,220,255,.65)}
    .btn-main:disabled{opacity:.28;cursor:not-allowed}
    .payout-section{margin-top:1.5rem}.payout-section h3{font-family:'Cinzel',serif;font-size:13px;color:#c9a84c;margin-bottom:7px;letter-spacing:1px}.ptable{width:100%;border-collapse:collapse;font-size:12px}.ptable th{text-align:left;padding:5px 8px;border-bottom:1px solid rgba(90,79,71,.85);color:#d4c9a8;font-size:11px;text-transform:uppercase;letter-spacing:.4px;font-weight:400}.ptable td{padding:5px 8px;border-bottom:1px solid #2a2420;color:#f2ead8}.mb{display:inline-block;font-size:11px;font-weight:600;padding:2px 8px;border-radius:4px}.mb-win{background:#0d3d1a;color:#4caf50}.mb-lose{background:#3d0d0d;color:#e53935}
    .battle-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}.battle-title{font-family:'Cinzel',serif;font-size:16px;color:#c9a84c;letter-spacing:2px}.wave-info{font-size:13px;color:#d4c9a8}
    .battle-scene{width:100%;min-width:0;border:1px solid rgba(80,140,255,.28);border-radius:10px;margin-bottom:10px;overflow:hidden;position:relative;box-shadow:0 0 24px rgba(80,140,255,.1),inset 0 0 40px rgba(0,0,0,.3)}
    .battle-inner{width:680px;transform-origin:top left;will-change:transform}
    .sky-zone{position:relative;height:120px;background:#07101e;overflow:hidden;animation:sky-day 60s ease-in-out infinite}
    .sky-zone::before{content:'';position:absolute;inset:0;background-image:radial-gradient(1.2px 1.2px at 8% 20%,#fff 0%,transparent 100%),radial-gradient(1px 1px at 18% 70%,#dde 0%,transparent 100%),radial-gradient(1.5px 1.5px at 28% 40%,#fff 0%,transparent 100%),radial-gradient(1px 1px at 37% 15%,#eef 0%,transparent 100%),radial-gradient(1.2px 1.2px at 46% 60%,#fff 0%,transparent 100%),radial-gradient(1px 1px at 54% 30%,#dde 0%,transparent 100%),radial-gradient(1.5px 1.5px at 63% 80%,#fff 0%,transparent 100%),radial-gradient(1px 1px at 72% 10%,#eef 0%,transparent 100%),radial-gradient(1.2px 1.2px at 80% 55%,#fff 0%,transparent 100%),radial-gradient(1px 1px at 88% 35%,#dde 0%,transparent 100%),radial-gradient(1.5px 1.5px at 93% 75%,#fff 0%,transparent 100%),radial-gradient(1px 1px at 13% 50%,#fff 0%,transparent 100%),radial-gradient(1px 1px at 58% 90%,#eef 0%,transparent 100%),radial-gradient(1.2px 1.2px at 41% 85%,#fff 0%,transparent 100%),radial-gradient(1px 1px at 75% 65%,#dde 0%,transparent 100%);animation:twinkle 3s ease-in-out infinite alternate;pointer-events:none}
    .sky-label{position:absolute;top:5px;left:8px;font-size:9px;color:#2a5080;text-transform:uppercase;letter-spacing:1px;z-index:2}
    .celestial{position:absolute;width:28px;height:28px;border-radius:50%;pointer-events:none;z-index:3}
    .celestial.sun{background:radial-gradient(circle,#fffbe0 30%,#ffd060 70%,#ff9020 100%);box-shadow:0 0 22px 10px rgba(255,200,60,.6)}
    .celestial.moon{background:radial-gradient(circle,#e8e8d8 40%,#c0c0b0 100%);box-shadow:0 0 12px 4px rgba(180,180,220,.3)}
    .env-cloud{position:absolute;pointer-events:none;z-index:2;background:rgba(255,255,255,.18);border-radius:50%;filter:blur(5px)}
    .ground-zone{position:relative;height:160px;overflow:hidden}
    .ground-zone::before{content:'';position:absolute;inset:0;background:linear-gradient(180deg,#0a1c08 0%,#122a0e 45%,#1a3812 100%);pointer-events:none;z-index:0}
    .ground-zone::after{content:'';position:absolute;bottom:0;left:0;right:0;height:36px;background:#0d1f09;clip-path:ellipse(60% 100% at 30% 100%);pointer-events:none;z-index:1}
    .hill-l{position:absolute;bottom:10px;left:10%;width:200px;height:60px;background:#0d1f09;border-radius:50% 50% 0 0;z-index:0;pointer-events:none}
    .hill-r{position:absolute;bottom:10px;right:8%;width:160px;height:50px;background:#0d1f09;border-radius:50% 50% 0 0;z-index:0;pointer-events:none}
    .ground-grass{position:absolute;bottom:0;left:0;right:0;height:36px;background:#0e2209;z-index:1;pointer-events:none}
    .torch-p{position:absolute;left:52px;bottom:18px;width:6px;height:6px;border-radius:50%;background:#ffaa30;z-index:3;box-shadow:0 0 10px 6px rgba(255,160,40,.4);pointer-events:none;animation:flicker 1.2s ease-in-out infinite alternate}
    .torch-e{position:absolute;right:52px;bottom:18px;width:6px;height:6px;border-radius:50%;background:#ff6030;z-index:3;box-shadow:0 0 10px 6px rgba(255,80,40,.4);pointer-events:none;animation:flicker 1.4s ease-in-out infinite alternate}
    .ground-label{position:absolute;bottom:5px;left:8px;font-size:9px;color:#2a4a1a;text-transform:uppercase;letter-spacing:1px;z-index:4}
    .mountain-layer{position:absolute;bottom:0;left:0;width:100%;pointer-events:none;z-index:1}
    .hp-bars-row{display:flex;align-items:center;gap:8px;padding:8px 12px;font-size:11px;background:#0a0e0a}.hp-label-p{color:#4a9eff;font-weight:600;white-space:nowrap;min-width:52px}.hp-label-e{color:#ff5a4a;font-weight:600;white-space:nowrap;min-width:52px;text-align:right}.hp-track{flex:1;height:8px;background:#111;border-radius:4px;overflow:hidden}.hp-fill-p{height:100%;background:#4a9eff;border-radius:4px;transition:width .3s}.hp-fill-e{height:100%;background:#ff5a4a;border-radius:4px;transition:width .3s;float:right}
    .log{background:#2a2420;border:1px solid rgba(90,79,71,.68);border-radius:8px;padding:8px 12px;font-size:12px;height:88px;overflow:hidden;line-height:1.85;margin-bottom:1rem}.ll{color:#d4c9a8}.ll.good{color:#6be88a}.ll.bad{color:#ff8080}.ll.aoe{color:#ffb860}.ll.info{color:#80c8ff}.ll.special{color:#ff90d0}
    .base{position:absolute;top:50%;transform:translateY(-50%);width:46px;border-radius:6px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:4px 2px;z-index:5}
    .base-p{left:4px;background:#0d2a4a;border:1px solid #4a9eff}.base-e{right:4px;background:#4a0d0d;border:1px solid #ff5a4a}
    .base-name{font-size:8px;color:#d4c9a8;text-transform:uppercase;letter-spacing:.5px}.base-hp-text{font-family:'Cinzel',serif;font-size:11px}
    .base-hp-bar{width:36px;height:4px;background:#111;border-radius:2px;overflow:hidden;margin-top:2px}.base-hp-fill-p{height:100%;background:#4a9eff;border-radius:2px;transition:width .3s}.base-hp-fill-e{height:100%;background:#ff5a4a;border-radius:2px;transition:width .3s}
    .fighter{position:absolute;display:flex;flex-direction:column;align-items:center;pointer-events:none;z-index:10}
    .fighter-icon{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;border:1.5px solid transparent}
    .fighter.player .fighter-icon{border-color:#4a9eff;background:#0d2040}.fighter.enemy .fighter-icon{border-color:#ff5a4a;background:#2a0d0d}
    .fighter.slowed .fighter-icon{border-color:#80c8ff;background:#0a1a40}
    .unit-hp-bar{width:28px;height:4px;background:#111;border-radius:2px;overflow:hidden;margin-top:2px}.unit-hp-fill{height:100%;border-radius:2px;transition:width .1s}
    .player .unit-hp-fill{background:#4a9eff}.enemy .unit-hp-fill{background:#ff5a4a}
    .shade-low .fighter-icon{border-color:#555!important;background:#1a1a1a!important}.shade-mid .fighter-icon{border-color:#7a3aaa!important;background:#1a0a2a!important}.shade-high .fighter-icon{border-color:#e07020!important;background:#2a1000!important}
    .camo-fighter{opacity:.15!important}
    .aoe-ring{position:absolute;border-radius:50%;border:2px solid rgba(255,180,60,.7);pointer-events:none;animation:aoe-pop .4s ease-out forwards;z-index:20}
    .frost-ring{position:absolute;border-radius:50%;border:2px solid rgba(80,180,255,.8);pointer-events:none;animation:aoe-pop .4s ease-out forwards;z-index:20}
    .explode-ring{position:absolute;border-radius:50%;border:3px solid rgba(255,100,20,.9);pointer-events:none;animation:aoe-pop .55s ease-out forwards;z-index:20}
    .respawn-flash{position:absolute;border-radius:50%;border:3px solid rgba(255,160,40,.9);pointer-events:none;animation:aoe-pop .5s ease-out forwards;z-index:20}
    .stun-ring{position:absolute;border-radius:50%;border:2px solid rgba(255,220,40,.8);pointer-events:none;animation:aoe-pop .6s ease-out forwards;z-index:20}
    .enemy-aoe-ring{position:absolute;border-radius:50%;border:2px solid rgba(255,80,20,.85);pointer-events:none;animation:aoe-pop .5s ease-out forwards;z-index:20}
    .enemy-explode-ring{position:absolute;border-radius:50%;border:3px solid rgba(255,60,0,1);pointer-events:none;animation:aoe-pop .6s ease-out forwards;z-index:22}
    .enemy-frost-ring{position:absolute;border-radius:50%;border:2px solid rgba(255,160,80,.8);pointer-events:none;animation:aoe-pop .5s ease-out forwards;z-index:20}
    .enemy-boom-ring{position:absolute;border-radius:50%;border:6px solid rgba(255,40,40,1);background:rgba(180,20,0,.25);pointer-events:none;z-index:27;animation:boom-ring .5s ease-out forwards}
    .hit-flash{position:absolute;border-radius:50%;pointer-events:none;z-index:21;width:16px;height:16px;background:rgba(255,200,80,.6);animation:hit-pop .22s ease-out forwards;transform:translate(-50%,-50%)}
    .dmg-number{position:absolute;font-family:Cinzel,serif;font-size:13px;font-weight:700;color:#ff6060;text-shadow:0 0 6px #000;pointer-events:none;z-index:30;animation:dmg-num .7s ease-out forwards;white-space:nowrap}.dmg-number.crit{color:#ffd700;font-size:16px}
    .shade-burst{position:absolute;width:52px;height:52px;border-radius:50%;border:2px solid #9060ff;background:rgba(100,30,200,.35);pointer-events:none;z-index:26;animation:shade-spawn .55s ease-out forwards;transform:translate(-50%,-50%)}
    .enemy-shade-burst{position:absolute;width:52px;height:52px;border-radius:50%;border:2px solid #ff4040;background:rgba(200,30,30,.35);pointer-events:none;z-index:26;animation:shade-spawn .55s ease-out forwards;transform:translate(-50%,-50%)}
    .shade-shadow{position:absolute;width:40px;height:16px;border-radius:50%;background:rgba(80,0,120,.75);pointer-events:none;z-index:23;animation:shadow-pool .6s ease-out forwards;transform-origin:center center}
    .damage-flash{animation:dmg-shake .25s ease-out}
    .tele-shadow{position:absolute;pointer-events:none;z-index:20;opacity:.6;animation:shadow-fade .4s ease-out forwards}.tele-shadow .fighter-icon{border-color:#9b30ff!important;background:#1a0030!important;box-shadow:0 0 12px rgba(155,48,255,.8)!important}
    .teleport-flash{position:absolute;border-radius:50%;pointer-events:none;z-index:25;width:36px;height:36px;background:rgba(160,60,255,.55);animation:hit-pop .35s ease-out forwards;transform:translate(-50%,-50%)}
    .enemy-teleport-flash{position:absolute;border-radius:50%;border:2px solid rgba(255,80,80,.9);pointer-events:none;animation:aoe-pop .35s ease-out forwards;z-index:22;width:32px;height:32px}
    .chain-bolt{position:absolute;height:2px;background:rgba(120,200,255,.8);pointer-events:none;z-index:22;transform-origin:left center;animation:arc-fade .3s ease-out forwards}
    .enemy-chain-bolt{position:absolute;height:2px;background:rgba(255,120,40,.9);pointer-events:none;z-index:22;transform-origin:left center;animation:arc-fade .35s ease-out forwards}
    .chain-arc{position:absolute;height:2px;background:linear-gradient(90deg,rgba(100,180,255,0),rgba(160,220,255,1),rgba(100,180,255,0));pointer-events:none;z-index:22;transform-origin:left center;animation:arc-fade .35s ease-out forwards}
    .reflect-burst{position:absolute;font-size:18px;pointer-events:none;z-index:28;animation:reflect-burst .4s ease-out forwards}
    .mirror-arc{position:absolute;height:2px;pointer-events:none;z-index:24;background:linear-gradient(90deg,rgba(180,180,255,0),rgba(200,200,255,1),rgba(180,180,255,0));transform-origin:left center;animation:mirror-arc-fade .35s ease-out forwards}
    .poison-cloud{position:absolute;width:22px;height:22px;border-radius:50%;background:radial-gradient(circle,rgba(80,200,30,.8),transparent);pointer-events:none;z-index:24;animation:poison-rise .7s ease-out forwards}
    .poison-tick{position:absolute;border-radius:50%;pointer-events:none;z-index:24;width:14px;height:14px;background:rgba(80,200,40,.7);animation:hit-pop .3s ease-out forwards;transform:translate(-50%,-50%)}
    .heal-cross{position:absolute;font-size:12px;pointer-events:none;z-index:28;color:#4caf50;text-shadow:0 0 6px #000;animation:heal-cross .7s ease-out forwards;white-space:nowrap}
    .speed-line{position:absolute;height:2px;background:linear-gradient(90deg,rgba(255,255,200,.8),transparent);pointer-events:none;z-index:22;transform-origin:right center;animation:speed-line .3s ease-out forwards}
    .trumpet-wave{position:absolute;border-radius:50%;border:3px solid #ffe060;pointer-events:none;z-index:23;animation:trumpet-wave .7s ease-out forwards}
    .stink-cloud{position:absolute;border-radius:50%;pointer-events:none;z-index:23;background:radial-gradient(circle,rgba(80,220,40,.35),rgba(40,140,20,0));border:2px solid rgba(80,220,40,.6);animation:aoe-pop .6s ease-out forwards}
    .bee-sting{position:absolute;font-size:10px;pointer-events:none;z-index:28;color:#ffd700;animation:bee-sting .4s ease-out forwards}.bee-sting::after{content:'🐝'}
    .bee-swarm-aura{position:absolute;pointer-events:none;z-index:27;width:32px;height:32px}
    .bee-swarm-aura::before,.bee-swarm-aura::after{content:'🐝';font-size:11px;position:absolute;top:50%;left:50%;animation:bee-swarm-orbit .9s linear infinite}
    .bee-swarm-aura::after{animation-delay:-.45s}
    .wave-drag{position:absolute;pointer-events:none;z-index:25;border-radius:50%;border:3px solid rgba(100,200,255,.85);background:rgba(60,160,255,.15);animation:wave-drag .55s cubic-bezier(.25,.46,.45,.94) forwards}
    .wave-ripple{position:absolute;pointer-events:none;z-index:24;border-radius:50%;border:2px solid rgba(140,220,255,.9);width:60px;height:60px;animation:wave-ripple .5s ease-out forwards}
    .wave-knocked .fighter-icon{animation:knockback-slide .6s ease-out forwards!important;border-color:rgba(100,200,255,.9)!important}
    .siege-bomb{position:absolute;pointer-events:none;z-index:28;font-size:14px;animation:bomb-arc .45s cubic-bezier(.33,0,.66,1) forwards}
    .boom-ring{position:absolute;border-radius:50%;border:6px solid rgba(255,180,40,1);background:rgba(255,80,0,.25);pointer-events:none;z-index:27;animation:boom-ring .5s ease-out forwards}
    .goblin-boom{position:absolute;border-radius:50%;pointer-events:none;z-index:27;width:120px;height:120px;animation:goblin-boom .7s ease-out forwards}
    .frost-slow-ring{position:absolute;border-radius:50%;border:3px solid rgba(140,220,255,1);width:50px;height:50px;pointer-events:none;z-index:26;animation:frost-slow .6s ease-out forwards}
    .dodge-text{position:absolute;font-family:'Cinzel',serif;font-size:11px;font-weight:700;color:#ffd700;text-shadow:0 0 6px #000;pointer-events:none;z-index:30;animation:dodge-pop .6s ease-out forwards}
    .dodge-flash{animation:dodge-flash-anim .28s ease-out}
    .squirrel-dodging .fighter-icon{animation:squirrel-dodge .3s ease-out}
    .bear-grow-ring{position:absolute;border-radius:50%;border:4px solid #ff6600;width:60px;height:60px;pointer-events:none;z-index:26;animation:bear-grow-ring .5s ease-out forwards}
    .contaminated .fighter-icon{animation:contaminate-pulse .7s ease-in-out infinite;border-color:rgba(160,200,60,.9)!important}
    .infected-aura .fighter-icon{animation:infect-aura .8s ease-in-out infinite;border-color:rgba(180,60,240,.9)!important}
    .contaminate-ring{position:absolute;border-radius:50%;border:4px solid rgba(180,220,40,.9);pointer-events:none;z-index:24;animation:contaminate-ring .8s ease-out forwards}
    .roar-ring{position:absolute;border-radius:50%;pointer-events:none;z-index:28;width:180px;height:60px;border:5px solid rgba(255,200,40,.95);background:rgba(255,160,10,.06);animation:roar-ring-expand .9s cubic-bezier(.2,.6,.4,1) forwards}
    .tiger-roaring .fighter-icon{animation:tiger-roar-glow .75s ease-out!important;border-color:#ffcc00!important;transform:scale(1.4);transition:transform .2s}
    .silenced-unit .fighter-icon{animation:silence-pulse .6s ease-in-out infinite;filter:grayscale(.6);border-color:rgba(180,180,180,.5)!important}
    .kangaroo-arc{position:absolute;font-size:18px;pointer-events:none;z-index:30;animation:kang-fade .38s linear forwards;transition:left .03s linear,top .03s linear}
    .skunk-gas{position:absolute;border-radius:60%;pointer-events:none;z-index:24;transform-origin:center center}
    .skunk-gas-ground{background:radial-gradient(ellipse,rgba(60,215,40,.72),rgba(30,165,20,.4) 55%,transparent 80%);animation:gas-ground 2.5s cubic-bezier(.2,.6,.4,1) forwards}
    .skunk-gas-air{background:radial-gradient(ellipse,rgba(80,210,50,.52),rgba(40,150,25,.25) 60%,transparent 85%);animation:gas-rise 2.2s ease-out forwards}
    .giraffe-target{position:absolute;font-size:16px;pointer-events:none;z-index:29;animation:target-lock .45s ease-out forwards}
    .speed-boosted .fighter-icon{animation:saiyan-pulse .5s ease-in-out infinite alternate;border-color:#60d0ff!important}
    .brute-raging .fighter-icon{animation:rage-glow .3s ease-in-out infinite alternate;border-color:#ff4020!important;background:#3a0808!important}
    .bear-raging .fighter-icon{animation:rage-glow .3s ease-in-out infinite alternate;border-color:#ff4020!important;background:#3a0808!important}
    .warlord-buffed .fighter-icon{animation:warlord-aura .8s ease-in-out infinite alternate;border-color:#c8a83c!important}
    .shaking{animation:ground-shake .4s ease-out}
    .croc-spinning .fighter-icon{animation:croc-spin .6s ease-out}
    .gorilla-jumping .fighter-icon{animation:gorilla-jump .45s cubic-bezier(.3,-.5,.7,1.5)}
    .gorilla-ranged .fighter-icon{animation:gorilla-rage .5s ease-in-out infinite;border-color:#ff4400!important}
    .lumberjack-chopping .fighter-icon{animation:axe-chop .25s ease-out}
    .angel-bless-particle{position:absolute;pointer-events:none;z-index:28;font-size:12px;animation:angel-bless .7s ease-out forwards}
    .angel-double-buffed .fighter-icon{animation:angel-double-glow .4s ease-in-out infinite;border-color:#e0d0ff!important}
    .shark-prey-mark{position:absolute;font-size:14px;pointer-events:none;z-index:29;animation:shark-prey-lock .7s ease-out forwards}
    .shark-buffed .fighter-icon{animation:shark-buff-pulse .6s ease-in-out 3}
    .shark-prey-fog{position:absolute;width:60px;height:60px;border-radius:50%;background:radial-gradient(circle,rgba(20,40,120,.85),rgba(10,20,80,.4) 60%,transparent 80%);pointer-events:none;z-index:27;animation:fog-appear .8s ease-out forwards}
    .shark-prey-skull{position:absolute;font-size:10px;pointer-events:none;z-index:20;top:-3px;right:-3px;line-height:1}
    .mantis-wave{position:absolute;width:60px;height:60px;border-radius:50%;border:5px solid rgba(60,200,255,1);pointer-events:none;z-index:27;animation:mantis-wave .5s ease-out forwards}
    .genie-coin{position:absolute;pointer-events:none;z-index:28;font-size:11px;animation:coin-fall .7s ease-in forwards}
    .genie-aura{position:absolute;width:70px;height:70px;border-radius:50%;border:4px solid rgba(180,40,255,1);pointer-events:none;z-index:28;background:rgba(120,0,200,.08);animation:purple-aura-expand .8s ease-out forwards}
    .genie-wishing .fighter-icon{animation:genie-icon-glow .5s ease-in-out 3}
    .time-stop-ring{position:absolute;width:200px;height:80px;border-radius:50%;border:4px solid rgba(80,180,255,1);pointer-events:none;z-index:28;animation:time-stop-ring .7s ease-out forwards}
    .time-frozen .fighter-icon{animation:frozen-pulse .4s ease-in-out infinite;border-color:rgba(80,180,255,.8)!important}
    .time-rewind-ring{position:absolute;width:60px;height:60px;border-radius:50%;border:4px solid rgba(80,255,120,1);border-style:dashed;pointer-events:none;z-index:28;animation:time-rewind-swirl .8s ease-out forwards}
    .time-accel-streak{position:absolute;height:3px;background:linear-gradient(90deg,rgba(255,215,0,.9),transparent);pointer-events:none;z-index:27;animation:time-accel-streak .35s ease-out forwards;transform-origin:left center}
    .wizard-casting .fighter-icon{animation:wizard-glow .6s ease-in-out}
    .fly-shadow{position:absolute;border-radius:50%;pointer-events:none;z-index:0;background:rgba(0,0,0,.35);filter:blur(4px);transform-origin:center center}
    @keyframes twinkle{0%{opacity:.7}50%{opacity:1}100%{opacity:.6}}
    @keyframes flicker{0%{opacity:.7;box-shadow:0 0 8px 4px rgba(255,160,40,.3)}100%{opacity:1;box-shadow:0 0 14px 9px rgba(255,160,40,.5)}}
    @keyframes cloud-drift{0%{transform:translateX(0)}100%{transform:translateX(780px)}}
    @keyframes sky-day{0%{background:linear-gradient(180deg,#06060f 0%,#110820 100%)}18%{background:linear-gradient(180deg,#6a2812 0%,#b84e1e 42%,#d4884a 100%)}28%{background:linear-gradient(180deg,#2a5070 0%,#508090 100%)}50%{background:linear-gradient(180deg,#1a4e8a 0%,#72b4d4 100%)}72%{background:linear-gradient(180deg,#2a5070 0%,#508090 100%)}82%{background:linear-gradient(180deg,#8c3818 0%,#c05a22 42%,#d48840 100%)}94%{background:linear-gradient(180deg,#09080e 0%,#14091c 100%)}100%{background:linear-gradient(180deg,#06060f 0%,#110820 100%)}}
    @keyframes aoe-pop{0%{transform:translate(-50%,-50%) scale(0);opacity:1}100%{transform:translate(-50%,-50%) scale(1);opacity:0}}
    @keyframes hit-pop{0%{transform:translate(-50%,-50%) scale(.4);opacity:1}100%{transform:translate(-50%,-50%) scale(1.5);opacity:0}}
    @keyframes dmg-num{0%{opacity:1;transform:translateY(0)}100%{opacity:0;transform:translateY(-28px)}}
    @keyframes dmg-shake{0%{filter:brightness(3)}30%{filter:brightness(1.8)}100%{filter:brightness(1)}}
    @keyframes shade-spawn{0%{transform:translate(-50%,-50%) scale(.2);opacity:1}60%{transform:translate(-50%,-50%) scale(1.4);opacity:.7}100%{transform:translate(-50%,-50%) scale(1);opacity:0}}
    @keyframes shadow-pool{0%{transform:translate(-50%,-50%) scale(.1,.2);opacity:0}40%{opacity:.7;transform:translate(-50%,-50%) scale(1.2,.3)}100%{opacity:0;transform:translate(-50%,-50%) scale(1.8,.15)}}
    @keyframes shadow-fade{0%{opacity:.6}100%{opacity:0}}
    @keyframes arc-fade{0%{opacity:1}100%{opacity:0}}
    @keyframes mirror-arc-fade{0%{opacity:.8}100%{opacity:0}}
    @keyframes reflect-burst{0%{opacity:1;transform:scale(.5)}50%{opacity:.8;transform:scale(1.3) rotate(30deg)}100%{opacity:0;transform:scale(1.8) rotate(60deg)}}
    @keyframes poison-rise{0%{opacity:.8;transform:translate(-50%,-50%) scale(.3)}100%{opacity:0;transform:translate(-50%,-80%) scale(1.8)}}
    @keyframes heal-cross{0%{opacity:1;transform:translateY(0) scale(1)}100%{opacity:0;transform:translateY(-22px) scale(1.4)}}
    @keyframes speed-line{0%{opacity:.8;transform:scaleX(1)}100%{opacity:0;transform:scaleX(0)}}
    @keyframes trumpet-wave{0%{transform:translate(-50%,-50%) scale(0);opacity:.9;border-color:#ffe060}100%{transform:translate(-50%,-50%) scale(1);opacity:0;border-color:#ff9020}}
    @keyframes bee-sting{0%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(2) translateY(-10px)}}
    @keyframes bee-swarm-orbit{0%{transform:translate(-50%,-50%) rotate(0deg) translateX(16px) rotate(0deg);opacity:.9}100%{transform:translate(-50%,-50%) rotate(360deg) translateX(16px) rotate(-360deg);opacity:.6}}
    @keyframes wave-drag{0%{opacity:.9;transform:scaleX(1) scaleY(1)}40%{opacity:.7;transform:scaleX(1.6) scaleY(.7)}100%{opacity:0;transform:scaleX(2.2) scaleY(.3)}}
    @keyframes wave-ripple{0%{opacity:.8;transform:translate(-50%,-50%) scale(.2)}100%{opacity:0;transform:translate(-50%,-50%) scale(1.8)}}
    @keyframes knockback-slide{0%{outline:3px solid rgba(100,200,255,.9);box-shadow:0 0 18px rgba(100,200,255,.7)}100%{outline:none;box-shadow:none}}
    @keyframes bomb-arc{0%{transform:translate(0,0) scale(1);opacity:1}50%{transform:translate(var(--bx),calc(var(--by) - 40px)) scale(1.2);opacity:1}100%{transform:translate(calc(var(--bx)*2),0) scale(.5);opacity:0}}
    @keyframes boom-ring{0%{transform:translate(-50%,-50%) scale(.1);opacity:1;border-width:6px}60%{transform:translate(-50%,-50%) scale(1.2);opacity:.8;border-width:3px}100%{transform:translate(-50%,-50%) scale(1.8);opacity:0;border-width:1px}}
    @keyframes goblin-boom{0%{transform:translate(-50%,-50%) scale(.2);opacity:1;background:rgba(255,200,40,.9)}30%{transform:translate(-50%,-50%) scale(1.5);opacity:.9;background:rgba(255,120,20,.8)}70%{transform:translate(-50%,-50%) scale(1.8);opacity:.5;background:rgba(100,100,100,.4)}100%{transform:translate(-50%,-50%) scale(2.5);opacity:0;background:rgba(80,80,80,.1)}}
    @keyframes frost-slow{0%{transform:translate(-50%,-50%) scale(.3);opacity:1;border-color:rgba(140,220,255,1)}100%{transform:translate(-50%,-50%) scale(1.4);opacity:0;border-color:rgba(200,240,255,.2)}}
    @keyframes dodge-pop{0%{opacity:1;transform:translateY(0) scale(1)}100%{opacity:0;transform:translateY(-20px) scale(1.5)}}
    @keyframes dodge-flash-anim{0%,100%{opacity:1}50%{opacity:.2;transform:translateX(6px)}}
    @keyframes squirrel-dodge{0%{transform:translateX(0)}20%{transform:translateX(8px) rotate(15deg)}40%{transform:translateX(-8px) rotate(-15deg)}60%{transform:translateX(5px) rotate(8deg)}100%{transform:translateX(0) rotate(0)}}
    @keyframes bear-grow-ring{0%{transform:translate(-50%,-50%) scale(.1);opacity:.9;border-color:#ff6600}100%{transform:translate(-50%,-50%) scale(1.8);opacity:0;border-color:#ff2200}}
    @keyframes contaminate-pulse{0%,100%{box-shadow:0 0 6px 2px rgba(180,220,80,.5)}50%{box-shadow:0 0 12px 4px rgba(180,220,80,.9)}}
    @keyframes contaminate-ring{0%{transform:translate(-50%,-50%) scaleX(.1) scaleY(.4);opacity:1;border-color:rgba(180,220,40,.9)}100%{transform:translate(-50%,-50%) scaleX(1.2) scaleY(1);opacity:0;border-color:rgba(140,180,30,.1)}}
    @keyframes infect-aura{0%,100%{box-shadow:0 0 8px 3px rgba(160,40,220,.5)}50%{box-shadow:0 0 18px 8px rgba(200,80,255,.8)}}
    @keyframes roar-ring-expand{0%{transform:translate(-50%,-50%) scale(.05);opacity:1;border-width:5px}40%{opacity:.8}100%{transform:translate(-50%,-50%) scale(2.8);opacity:0;border-width:1px}}
    @keyframes tiger-roar-glow{0%,100%{box-shadow:0 0 0 0 rgba(255,160,20,0)}30%{box-shadow:0 0 30px 20px rgba(255,160,20,.7)}60%{box-shadow:0 0 50px 30px rgba(255,200,40,.4)}}
    @keyframes silence-pulse{0%,100%{opacity:.55}50%{opacity:.85}}
    @keyframes kang-fade{0%{opacity:1}80%{opacity:.5}100%{opacity:0}}
    @keyframes gas-ground{0%{opacity:0;transform:translate(-50%,-50%) scale(.2) scaleY(.4)}15%{opacity:.8}75%{opacity:.65;transform:translate(-50%,-50%) scale(1.1) scaleY(.9)}100%{opacity:0;transform:translate(-50%,-70%) scale(1.3) scaleY(.7);filter:blur(5px)}}
    @keyframes gas-rise{0%{opacity:0;transform:translate(-50%,-50%) scale(.3) scaleY(.5)}20%{opacity:.55}70%{opacity:.4;transform:translate(-50%,-120%) scale(1.4) scaleY(.8)}100%{opacity:0;transform:translate(-50%,-200%) scale(1.7) scaleY(.5);filter:blur(8px)}}
    @keyframes target-lock{0%{transform:translate(-50%,-50%) scale(2);opacity:0}40%{opacity:1;transform:translate(-50%,-50%) scale(1.1)}80%{opacity:.8;transform:translate(-50%,-50%) scale(1)}100%{opacity:0;transform:translate(-50%,-50%) scale(.8)}}
    @keyframes saiyan-pulse{0%{box-shadow:0 0 8px 4px rgba(80,160,255,.5)}100%{box-shadow:0 0 16px 8px rgba(80,160,255,.9)}}
    @keyframes rage-glow{0%{box-shadow:0 0 8px 4px rgba(255,40,0,.6)}100%{box-shadow:0 0 20px 10px rgba(255,60,20,.95)}}
    @keyframes warlord-aura{0%{box-shadow:0 0 6px 3px rgba(200,168,60,.4)}100%{box-shadow:0 0 14px 7px rgba(200,168,60,.8)}}
    @keyframes ground-shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-3px)}40%{transform:translateX(3px)}60%{transform:translateX(-2px)}80%{transform:translateX(2px)}}
    @keyframes croc-spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
    @keyframes gorilla-jump{0%{transform:scaleX(1) translateY(0)}30%{transform:scaleX(.85) translateY(-18px) rotate(-5deg)}70%{transform:scaleX(1.1) translateY(-8px) rotate(3deg)}100%{transform:scaleX(1) translateY(0) rotate(0)}}
    @keyframes gorilla-rage{0%,100%{box-shadow:0 0 8px 4px rgba(255,80,20,.4)}50%{box-shadow:0 0 20px 10px rgba(255,40,0,.8)}}
    @keyframes axe-chop{0%{transform:rotate(-30deg) translateY(0)}40%{transform:rotate(60deg) translateY(4px)}70%{transform:rotate(-10deg) translateY(-2px)}100%{transform:rotate(0) translateY(0)}}
    @keyframes angel-bless{0%{transform:translate(-50%,-50%) scale(.2);opacity:1}60%{opacity:.8;transform:translate(-50%,-80%) scale(1.1)}100%{opacity:0;transform:translate(-50%,-130%) scale(1.5)}}
    @keyframes angel-double-glow{0%,100%{box-shadow:0 0 10px 5px rgba(200,180,255,.5)}50%{box-shadow:0 0 28px 14px rgba(220,200,255,.95)}}
    @keyframes shark-prey-lock{0%{transform:translate(-50%,-60%) scale(2);opacity:0}40%{opacity:1;transform:translate(-50%,-60%) scale(1)}80%{opacity:.8}100%{opacity:0;transform:translate(-50%,-80%) scale(.8)}}
    @keyframes shark-buff-pulse{0%{box-shadow:0 0 6px 3px rgba(80,255,100,.3),0 0 4px 2px rgba(255,80,40,.2)}50%{box-shadow:0 0 18px 8px rgba(80,255,100,.7),0 0 14px 6px rgba(255,80,40,.6)}100%{box-shadow:0 0 6px 3px rgba(80,255,100,.3),0 0 4px 2px rgba(255,80,40,.2)}}
    @keyframes mantis-wave{0%{transform:translate(-50%,-50%) scale(.1);opacity:1;border-width:5px;border-color:rgba(60,200,255,1)}50%{opacity:.8;border-color:rgba(80,220,180,.8)}100%{transform:translate(-50%,-50%) scale(2.2);opacity:0;border-width:1px}}
    @keyframes fog-appear{0%{opacity:0;transform:scale(.3);filter:blur(10px)}40%{opacity:.7;filter:blur(3px)}100%{opacity:0;transform:scale(1.8);filter:blur(12px)}}
    @keyframes coin-fall{0%{transform:translateY(-10px) rotate(0deg);opacity:1}80%{opacity:.8}100%{transform:translateY(70px) rotate(360deg);opacity:0}}
    @keyframes purple-aura-expand{0%{transform:translate(-50%,-50%) scale(.1);opacity:.9;border-color:rgba(180,40,255,1)}60%{opacity:.7}100%{transform:translate(-50%,-50%) scale(2.4);opacity:0;border-color:rgba(100,0,180,.1)}}
    @keyframes genie-icon-glow{0%,100%{box-shadow:0 0 6px 3px rgba(255,215,0,.3)}50%{box-shadow:0 0 22px 10px rgba(255,215,0,.8)}}
    @keyframes time-stop-ring{0%{transform:translate(-50%,-50%) scale(.05);opacity:1;border-color:rgba(80,180,255,1)}100%{transform:translate(-50%,-50%) scale(3.5);opacity:0;border-color:rgba(80,180,255,0)}}
    @keyframes frozen-pulse{0%,100%{filter:grayscale(.7) brightness(.7)}50%{filter:grayscale(.9) brightness(.5)}}
    @keyframes time-rewind-swirl{0%{transform:translate(-50%,-50%) rotate(0deg) scale(.2);opacity:1}60%{opacity:.8}100%{transform:translate(-50%,-50%) rotate(-360deg) scale(1.5);opacity:0}}
    @keyframes time-accel-streak{0%{transform:scaleX(0);opacity:1}100%{transform:scaleX(3);opacity:0}}
    @keyframes wizard-glow{0%,100%{box-shadow:0 0 6px 3px rgba(255,215,0,.3)}50%{box-shadow:0 0 24px 12px rgba(255,215,0,.9)}}
    @keyframes dialog-pop{0%{opacity:0;transform:scale(.88)}100%{opacity:1;transform:scale(1)}}
    .surrender-overlay{position:fixed;inset:0;background:rgba(0,0,0,.68);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)}
    .surrender-dialog{background:#1a1410;border:1px solid #5c1a1a;border-radius:12px;padding:24px 28px;max-width:320px;width:90%;text-align:center;box-shadow:0 0 40px rgba(0,0,0,.7);animation:dialog-pop .18s ease-out forwards}
    .surrender-title{font-family:Cinzel,serif;font-size:18px;color:#ff8080;margin-bottom:10px;letter-spacing:1px}
    .surrender-msg{font-size:13px;color:#d4c9a8;margin-bottom:18px;line-height:1.5}
    .surrender-btns{display:flex;gap:10px;justify-content:center}
    .surrender-btns button{padding:9px 22px;border-radius:7px;border:1px solid;cursor:pointer;font-family:Cinzel,serif;font-size:13px;letter-spacing:1px;transition:opacity .15s}
    .surrender-cancel{border-color:rgba(90,79,71,.8);background:transparent;color:#d4c9a8}.surrender-cancel:hover{opacity:.75}
    .surrender-confirm{border-color:#8a1a1a;background:#4a0d0d;color:#ff8080}.surrender-confirm:hover{opacity:.8}
    .wf-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:9px;background:rgba(80,140,255,.07);border:1px solid rgba(80,140,255,.28);cursor:pointer;font-size:17px;transition:all .15s;color:#80cfff;flex-shrink:0;padding:0;line-height:1}
    .wf-icon-btn:hover{background:rgba(80,200,255,.14);border-color:rgba(80,220,255,.65);box-shadow:0 0 14px rgba(80,200,255,.18)}
    .wf-rew-row{display:flex;align-items:center;gap:10px;padding:7px 12px;border-radius:8px;background:rgba(80,140,255,.04);border:1px solid rgba(80,140,255,.1);margin-bottom:4px}
    .wf-rew-budget{font-family:'Cinzel',serif;font-size:12px;color:rgba(180,200,255,.6);min-width:28px}
    .wf-rew-diff{flex:1;font-family:'Cinzel',serif;font-size:11px;color:#b8ccff;letter-spacing:.3px}
    .wf-rew-mult{font-size:12px;font-weight:700;color:#7fffb0}
    .wf-rew-lose{font-size:12px;font-weight:700;color:#ff7070}
    .wf-hist-row{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:8px;background:rgba(80,140,255,.04);border:1px solid rgba(80,140,255,.1);margin-bottom:4px}
    .wf-hist-time{font-family:monospace;font-size:11px;color:rgba(160,185,230,.5);min-width:66px}
    .wf-hist-bet{font-size:12px;color:rgba(160,185,230,.75)}
    .wf-hist-win{font-size:12px;font-weight:700;color:#7fffb0;min-width:32px}
    .wf-hist-loss{font-size:12px;font-weight:700;color:#ff7070;min-width:32px}
    .wf-hist-score{font-family:monospace;font-size:11px;color:rgba(160,185,230,.5);margin-left:auto}
    @keyframes wf-result-appear{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
    @keyframes wf-emoji-pop{0%{transform:scale(0.6)}65%{transform:scale(1.18)}100%{transform:scale(1)}}
    @keyframes wf-payout-pulse{0%,100%{text-shadow:0 0 18px rgba(80,255,160,.5),0 0 36px rgba(80,255,160,.22)}50%{text-shadow:0 0 28px rgba(80,255,160,.9),0 0 60px rgba(80,255,160,.4)}}
    @keyframes wf-scan{0%{top:-100%}100%{top:200%}}
    .wf-result{border-radius:20px;padding:32px 22px 24px;text-align:center;position:relative;overflow:hidden;animation:wf-result-appear .35s ease-out}
    .wf-result::before{content:'';position:absolute;top:0;left:0;width:52px;height:52px;border-top:2px solid;border-left:2px solid;border-radius:20px 0 0 0;pointer-events:none}
    .wf-result::after{content:'';position:absolute;bottom:0;right:0;width:38px;height:38px;border-bottom:2px solid;border-right:2px solid;border-radius:0 0 20px 0;pointer-events:none}
    .wf-result-scan{position:absolute;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.06),transparent);animation:wf-scan 4s linear infinite;pointer-events:none}
    .wf-result.win{background:linear-gradient(160deg,#030f08 0%,#061510 45%,#081c14 100%);border:1px solid rgba(80,255,160,.55);box-shadow:0 0 50px rgba(80,255,160,.14),inset 0 0 60px rgba(80,255,160,.04)}.wf-result.win::before,.wf-result.win::after{border-color:rgba(80,255,160,.55)}
    .wf-result.loss{background:linear-gradient(160deg,#0f0305 0%,#170407 45%,#1a060a 100%);border:1px solid rgba(255,60,80,.5);box-shadow:0 0 40px rgba(255,60,80,.12),inset 0 0 50px rgba(255,60,80,.04)}.wf-result.loss::before,.wf-result.loss::after{border-color:rgba(255,60,80,.5)}
    .wf-result.surrender{background:linear-gradient(160deg,#07090e 0%,#0a0d18 100%);border:1px solid rgba(140,150,200,.32)}.wf-result.surrender::before,.wf-result.surrender::after{border-color:rgba(140,150,200,.3)}
    .wf-result.resolving{background:linear-gradient(160deg,#06080e 0%,#090c18 100%);border:1px solid rgba(80,140,255,.3)}.wf-result.resolving::before,.wf-result.resolving::after{border-color:rgba(80,140,255,.3)}
    .wf-result-emoji{font-size:54px;line-height:1.1;display:block;margin-bottom:8px;animation:wf-emoji-pop .4s cubic-bezier(.25,.46,.45,.94)}
    .wf-result.win .wf-result-emoji{filter:drop-shadow(0 0 22px rgba(80,255,160,.65))}
    .wf-result.loss .wf-result-emoji{filter:drop-shadow(0 0 18px rgba(255,60,80,.55))}
    .wf-result-title{font-family:'Cinzel',serif;font-size:26px;font-weight:700;letter-spacing:4px;display:block;margin-bottom:6px;text-transform:uppercase}
    .wf-result.win .wf-result-title{color:#7fffb0;text-shadow:0 0 28px rgba(80,255,160,.55)}
    .wf-result.loss .wf-result-title{color:#ff5060;text-shadow:0 0 22px rgba(255,60,80,.5)}
    .wf-result.surrender .wf-result-title{color:rgba(180,190,220,.7);letter-spacing:3px}
    .wf-result.resolving .wf-result-title{color:rgba(120,160,230,.7);letter-spacing:3px}
    .wf-result-sub{font-size:11px;letter-spacing:1.5px;color:rgba(160,185,230,.35);margin-bottom:20px;text-transform:uppercase}
    .wf-diff-chip{display:inline-block;padding:4px 14px;border-radius:20px;font-size:11px;letter-spacing:1px;margin-bottom:18px;text-transform:uppercase;font-weight:600}
    .wf-diff-chip.Easy{border:1px solid rgba(80,255,160,.35);background:rgba(80,255,160,.08);color:#7fffb0}
    .wf-diff-chip.Normal{border:1px solid rgba(80,180,255,.35);background:rgba(80,180,255,.08);color:#80cfff}
    .wf-diff-chip.Hard{border:1px solid rgba(255,160,40,.35);background:rgba(255,160,40,.08);color:#ffb040}
    .wf-diff-chip.Brutal{border:1px solid rgba(255,80,40,.4);background:rgba(255,80,40,.1);color:#ff7050}
    .wf-diff-chip.Legendary{border:1px solid rgba(220,80,255,.45);background:rgba(220,80,255,.1);color:#e060ff}
    .wf-diff-chip.Impossible{border:1px solid rgba(255,40,40,.5);background:rgba(255,40,40,.12);color:#ff4040}
    .wf-scoreboard{display:grid;grid-template-columns:1fr 28px 1fr;align-items:center;gap:6px;margin:4px 0 18px}
    .wf-score-box{background:rgba(6,12,24,.7);border-radius:12px;padding:12px 8px 8px;position:relative}
    .wf-score-box.player{border:1px solid rgba(74,158,255,.35)}
    .wf-score-box.enemy{border:1px solid rgba(255,80,80,.35)}
    .wf-score-val{font-family:'Cinzel',serif;font-size:30px;font-weight:700;display:block;line-height:1}
    .wf-score-box.player .wf-score-val{color:#4a9eff;text-shadow:0 0 18px rgba(74,158,255,.55)}
    .wf-score-box.enemy .wf-score-val{color:#ff5060;text-shadow:0 0 18px rgba(255,80,80,.5)}
    .wf-score-lbl{font-size:9px;letter-spacing:1.2px;color:rgba(140,170,220,.4);margin-top:5px;display:block;text-transform:uppercase}
    .wf-score-vs{font-size:10px;color:rgba(140,160,210,.28);letter-spacing:2px;text-align:center}
    .wf-payout-banner{background:linear-gradient(100deg,rgba(80,255,160,.05) 0%,rgba(80,255,160,.14) 50%,rgba(80,255,160,.05) 100%);border:1px solid rgba(80,255,160,.28);border-radius:12px;padding:16px 18px 12px;margin:4px 0 0;position:relative;overflow:hidden}
    .wf-payout-banner::before{content:'';position:absolute;inset:0;background:repeating-linear-gradient(90deg,rgba(80,255,160,.025) 0,rgba(80,255,160,.025) 1px,transparent 1px,transparent 40px);pointer-events:none}
    .wf-payout-amount{font-family:'Cinzel',serif;font-size:30px;font-weight:700;color:#7fffb0;display:block;animation:wf-payout-pulse 2.2s ease-in-out infinite}
    .wf-payout-mult{font-size:12px;color:rgba(140,200,160,.55);margin-top:5px;display:block;letter-spacing:.5px}
    .wf-result-btns{display:flex;gap:10px;margin-top:22px}
    .wf-btn-ghost{flex:1;padding:14px 8px;font-family:'Cinzel',serif;font-size:11px;letter-spacing:1.2px;font-weight:700;background:rgba(80,140,255,.07);border:1px solid rgba(80,140,255,.3);border-radius:12px;color:#80cfff;cursor:pointer;transition:all .18s;text-transform:uppercase}
    .wf-btn-ghost:hover:not(:disabled){background:rgba(80,200,255,.15);border-color:rgba(80,220,255,.7);box-shadow:0 0 16px rgba(80,200,255,.18)}
    .wf-btn-accent{flex:1;padding:14px 8px;font-family:'Cinzel',serif;font-size:11px;letter-spacing:1.2px;font-weight:700;background:linear-gradient(135deg,rgba(80,255,160,.12),rgba(40,180,100,.08));border:1px solid rgba(80,255,160,.38);border-radius:12px;color:#7fffb0;cursor:pointer;transition:all .18s;box-shadow:0 0 12px rgba(80,255,160,.08);text-transform:uppercase}
    .wf-btn-accent:hover:not(:disabled){background:linear-gradient(135deg,rgba(80,255,160,.2),rgba(40,180,100,.14));box-shadow:0 0 22px rgba(80,255,160,.2)}
    .wf-btn-ghost:disabled,.wf-btn-accent:disabled{opacity:.28;cursor:not-allowed}
    .wf-col-btn{flex:1;padding:10px;border-radius:10px;border:1px solid rgba(80,140,255,.2);background:rgba(80,140,255,.04);cursor:pointer;font-family:'Cinzel',serif;font-size:13px;letter-spacing:.6px;transition:all .15s;text-align:center;color:rgba(160,185,230,.65)}
    .wf-col-btn:hover{border-color:rgba(80,200,255,.5);color:#80cfff;background:rgba(80,140,255,.1)}
    .wf-col-btn.active.fantasy{background:linear-gradient(135deg,#081520,#0d1f30);border-color:rgba(80,200,255,.65);color:#80cfff;box-shadow:0 0 14px rgba(80,200,255,.14)}
    .wf-col-btn.active.animals{background:linear-gradient(135deg,#0d1a0a,#142210);border-color:rgba(80,255,140,.55);color:#7fffb0;box-shadow:0 0 14px rgba(80,255,140,.12)}
    .wf-hud{display:inline-flex;align-items:stretch;background:linear-gradient(135deg,#03070e,#050d1a);border:1px solid rgba(80,180,255,.18);border-radius:10px;overflow:hidden;position:relative}
    .wf-hud::after{content:'';position:absolute;inset:0;background:repeating-linear-gradient(90deg,rgba(80,140,255,.018) 0px,rgba(80,140,255,.018) 1px,transparent 1px,transparent 44px),repeating-linear-gradient(0deg,rgba(80,140,255,.018) 0px,rgba(80,140,255,.018) 1px,transparent 1px,transparent 44px);pointer-events:none}
    .wf-hud-stat{flex:0 0 auto;min-width:130px;display:flex;align-items:center;justify-content:center;gap:10px;padding:10px 22px;position:relative;z-index:1}
    .wf-hud-stat:first-child{border-right:1px solid rgba(80,180,255,.14)}
    .wf-hud-icon{font-size:16px;opacity:.55;flex-shrink:0}
    .wf-hud-body{display:flex;flex-direction:row;align-items:baseline;gap:6px}
    .wf-hud-val{font-family:'Cinzel',serif;font-size:20px;font-weight:700;line-height:1}
    .wf-hud-val.gold{color:#c9a84c;text-shadow:0 0 10px rgba(200,168,76,.5)}
    .wf-hud-val.cyan{color:#7ecfff;text-shadow:0 0 10px rgba(80,200,255,.45)}
    .wf-hud-lbl{font-size:11px;color:rgba(140,170,220,.5);letter-spacing:.6px;text-transform:uppercase}
    .wf-hud-spacer{height:60px;flex-shrink:0}
  `;
  document.head.appendChild(style);
}

export function renderWarfrontRewardLadder(diffTable) {
  injectWarfrontStylesOnce();
  return h('div.payout-section.mt-1', {}, [
    h('h3', {}, ['Reward Table (based on enemy difficulty)']),
    h('table.ptable', {}, [
      h('thead', {}, [
        h('tr', {}, [
          h('th', {}, ['Enemy Budget']),
          h('th', {}, ['Difficulty']),
          h('th', {}, ['Win Reward']),
        ]),
      ]),
      h('tbody', {}, [
        ...diffTable.map((d) => h('tr', {}, [
          h('td', {}, [`${d.budget}g`]),
          h('td', {}, [d.name]),
          h('td', {}, [h('span.mb.mb-win', {}, [`${d.mult.toFixed(1)}×`])]),
        ])),
        h('tr', {}, [
          h('td', {}, ['Any']),
          h('td', {}, ['Defeat']),
          h('td', {}, [h('span.mb.mb-lose', {}, ['Lose bet'])]),
        ]),
      ]),
    ]),
  ]);
}

export function renderWarfrontUnitGrid({ qty, budget, units, maxSlots, onQtyChange }) {
  injectWarfrontStylesOnce();
  const spent = units.reduce((sum, u) => sum + (qty[u.id] || 0) * u.cost, 0);
  const slots = units.reduce((sum, u) => sum + (qty[u.id] || 0), 0);
  const hpMax = Math.max(...units.map((x) => x.hp), 1);
  const dmgMax = Math.max(...units.map((x) => x.dmg), 1);
  const spdMax = Math.max(...units.map((x) => x.spd), 1);

  return h('div', {}, [
    h('div.units-grid', {},
      units.map((u) => {
        const q = qty[u.id] || 0;
        const canAdd = spent - q * u.cost + (q + 1) * u.cost <= budget && slots < maxSlots;
        const canRemove = q > 0;
        const tagHtml = (u.tags || []).slice(0, 3).map((t) => h('span.tag', { class: `tag-${t}` }, [t]));
        const tip = u.tip || '';
        const aoeVal = typeof u.aoe === 'number' ? u.aoe : (u.aoe?.radius || 0);

        return h(
          'div.unit-card',
          { class: q > 0 ? 'selected' : !canAdd ? 'dimmed' : '' },
          [
            h('div.uc-top', {}, [
              h('span.uc-name', {}, [u.displayName || u.name]),
              h('span.uc-cost', {}, [`${u.cost}g`]),
            ]),
            h('span.uc-icon', {}, [u.icon]),
            h('div.uc-tags', {}, tagHtml),
            h('div.uc-bars', {}, [
              h('div.bar-row', {}, [
                h('span.bar-lbl', {}, ['HP']),
                h('div.bar-track', {}, [h('div.bar-fill', { style: { width: `${Math.round((u.hp / hpMax) * 100)}%`, background: 'linear-gradient(90deg,#2a7aff,#60b0ff)' } }, [])]),
              ]),
              h('div.bar-row', {}, [
                h('span.bar-lbl', {}, ['DMG']),
                h('div.bar-track', {}, [h('div.bar-fill', { style: { width: `${Math.round((u.dmg / dmgMax) * 100)}%`, background: 'linear-gradient(90deg,#ff2a2a,#ff7a60)' } }, [])]),
              ]),
              h('div.bar-row', {}, [
                h('span.bar-lbl', {}, ['SPD']),
                h('div.bar-track', {}, [h('div.bar-fill', { style: { width: `${Math.round((u.spd / spdMax) * 100)}%`, background: 'linear-gradient(90deg,#00c86e,#60ffa0)' } }, [])]),
              ]),
              aoeVal > 0 ? h('div.bar-row', {}, [
                h('span.bar-lbl', {}, ['AoE']),
                h('div.bar-track', {}, [h('div.bar-fill', { style: { width: `${Math.round(Math.min(100, (aoeVal / 62) * 100))}%`, background: 'linear-gradient(90deg,#c86000,#ffa030)' } }, [])]),
              ]) : null,
            ]),
            h('div.uc-tip', {}, [tip]),
            h('div.qty-ctrl', {}, [
              h('button.qty-btn', { disabled: !canRemove, onClick: () => onQtyChange(u.id, -1) }, ['−']),
              h('span.qty-num', {}, [String(q)]),
              h('button.qty-btn', { disabled: !canAdd, onClick: () => onQtyChange(u.id, 1) }, ['+']),
            ]),
          ]
        );
      })
    ),
  ]);
}

export function renderWarfrontHistoryWidget(historyRows) {
  injectWarfrontStylesOnce();
  if (!historyRows.length) return h('div', {}, []);
  return h('div.flex.flex-col.gap-2.mt-4', {}, [
    h('h3.text-sm.font-bold.text-white/80', {}, ['Recent Battles']),
    h(
      'div.flex.flex-col.gap-1',
      {},
      historyRows.slice(0, 6).map((r) => {
        const won = r.payout > 0;
        return h('div.flex.items-center.justify-between.text-xs.p-2.rounded.bg-white/5.border.border-white/10', {}, [
          h('span.text-white/70', {}, [new Date(r.created_at).toLocaleTimeString()]),
          h('span.text-white/70', {}, [`Bet ${r.bet}`]),
          h('span', {}, [won ? h('span.text-accent-lime', {}, ['WIN']) : h('span.text-accent-rose', {}, ['LOSS'])]),
          h('span.text-white/70', {}, [`${r.player_base_hp} - ${r.enemy_base_hp}`]),
        ]);
      })
    ),
  ]);
}

export function renderWarfrontBattleStage({ picks, result, getUnitById, onComplete, onSurrender }) {
  injectWarfrontStylesOnce();
  const container = h('div.flex.flex-col.gap-2', { style: { minWidth: '0', width: '100%' } }, []);
  const rawPlayerUnits = picks.map((id) => getUnitById(id)).filter(Boolean);
  const rawEnemyUnits = (result?.enemyArmy || []).map((id) => getUnitById(id)).filter(Boolean);
  const difficulty = result?.enemyDifficulty || 'Battle';

  const header = h('div.battle-header', {}, [
    h('div.battle-title', {}, [`Battle — ${difficulty}`]),
    h('div.wave-info#wave-info', {}, ['40s remaining']),
  ]);

  const scene = h('div.battle-scene', {}, [
    h('div.battle-inner', {}, [
      h('div.sky-zone', {}, [
        h('div.celestial.sun', { style: { left: '0px', top: '0px' } }, []),
        h('div.celestial.moon', { style: { left: '0px', top: '0px' } }, []),
        h('div.env-cloud', { style: { width: '90px', height: '28px', top: '12px', left: '-100px', animation: 'cloud-drift 28s linear infinite' } }, []),
        h('div.env-cloud', { style: { width: '60px', height: '18px', top: '28px', left: '-60px', animation: 'cloud-drift 42s linear infinite 14s', opacity: '0.7' } }, []),
        h('div.env-cloud', { style: { width: '120px', height: '22px', top: '8px', left: '-120px', animation: 'cloud-drift 55s linear infinite 7s', opacity: '0.5' } }, []),
        h('div.sky-label', {}, ['Sky Lane']),
      ]),
      h('div.ground-zone', {}, [
        h('svg.mountain-layer', {
          viewBox: '0 0 680 180',
          preserveAspectRatio: 'none',
          xmlns: 'http://www.w3.org/2000/svg',
        }, [
          h('path', { fill: '#253025', opacity: '0.4', d: 'M0,180 L0,150 Q40,118 82,138 T166,130 T250,142 T334,120 T418,138 T502,126 T586,141 T680,120 L680,180 Z' }, []),
          h('path', { fill: '#1a2218', opacity: '0.7', d: 'M0,180 L0,158 Q34,134 68,146 T138,136 T208,150 T278,130 T348,144 T418,126 T488,140 T558,132 T628,146 T680,128 L680,180 Z' }, []),
        ]),
        h('div.hill-l', {}, []),
        h('div.hill-r', {}, []),
        h('div.ground-grass', {}, []),
        h('div.torch-p', {}, []),
        h('div.torch-e', {}, []),
        h('div.ground-label', {}, ['Ground Lane']),
        h('div.base.base-p', {}, [
          h('div.base-name', {}, ['Your base']),
          h('div.base-hp-text', { style: { color: '#4a9eff' } }, ['100']),
          h('div.base-hp-bar', {}, [h('div.base-hp-fill-p', { style: { width: '100%' } }, [])]),
        ]),
        h('div.base.base-e', {}, [
          h('div.base-name', {}, ['Enemy base']),
          h('div.base-hp-text', { style: { color: '#ff5a4a' } }, ['100']),
          h('div.base-hp-bar', {}, [h('div.base-hp-fill-e', { style: { width: '100%' } }, [])]),
        ]),
      ]),
    ]),
  ]);

  const hpRow = h('div.hp-bars-row', {}, [
    h('span.hp-label-p', {}, ['100 HP']),
    h('div.hp-track', {}, [h('div.hp-fill-p', { style: { width: '100%' } }, [])]),
    h('div.hp-track', { style: { direction: 'rtl' } }, [h('div.hp-fill-e', { style: { width: '100%' } }, [])]),
    h('span.hp-label-e', {}, ['100 HP']),
  ]);

  const footer = h('div.log', {}, [
    h('div.ll.info', {}, [result?.enemyDifficulty ? `The battle begins — difficulty: ${result.enemyDifficulty}!` : 'The battle begins...']),
  ]);

  const controls = h('div.flex.justify-center', { style: { marginTop: '-2px' } }, [
    h('button.btn-surrender', {
      type: 'button',
      onClick: () => {
        if (finished) return;
        const ov = document.createElement('div'); ov.className = 'surrender-overlay';
        const dlg = document.createElement('div'); dlg.className = 'surrender-dialog';
        dlg.innerHTML = '<div class="surrender-title">⚑ Surrender?</div><div class="surrender-msg">You will lose your bet. This cannot be undone.</div><div class="surrender-btns"><button class="surrender-cancel">Cancel</button><button class="surrender-confirm">Surrender</button></div>';
        ov.appendChild(dlg); document.body.appendChild(ov);
        dlg.querySelector('.surrender-cancel').onclick = () => ov.remove();
        dlg.querySelector('.surrender-confirm').onclick = () => { ov.remove(); finishBattle({ surrendered: true }); };
      },
      style: {
        width: '100%',
        padding: '8px',
        borderRadius: '8px',
        border: '1px solid #5c1a1a',
        background: 'transparent',
        fontFamily: 'Cinzel, serif',
        fontSize: '12px',
        letterSpacing: '1px',
        color: '#ff8080',
        cursor: 'pointer',
        marginTop: '6px',
      },
    }, ['⚑ Surrender (lose bet)']),
  ]);

  container.appendChild(header);
  container.appendChild(scene);
  container.appendChild(hpRow);
  container.appendChild(footer);
  container.appendChild(controls);

  const skyZone = scene.querySelector('.sky-zone');
  const groundZone = scene.querySelector('.ground-zone');
  const sunEl = scene.querySelector('.celestial.sun');
  const moonEl = scene.querySelector('.celestial.moon');
  const playerHpText = scene.querySelector('.base-p .base-hp-text');
  const enemyHpText = scene.querySelector('.base-e .base-hp-text');
  const playerHpFill = scene.querySelector('.base-hp-fill-p');
  const enemyHpFill = scene.querySelector('.base-hp-fill-e');
  const hpFillRowP = hpRow.querySelector('.hp-fill-p');
  const hpFillRowE = hpRow.querySelector('.hp-fill-e');
  const hpLabelP = hpRow.querySelector('.hp-label-p');
  const hpLabelE = hpRow.querySelector('.hp-label-e');
  const battleInner = scene.querySelector('.battle-inner');
  const basePEl = scene.querySelector('.base-p');
  const baseEEl = scene.querySelector('.base-e');
  const waveInfoEl = header.querySelector('.wave-info');
  const battleLog = footer;


  // ── CONSTANTS ─────────────────────────────────────────────────────────────
  const LOGIC_HZ = 30, LOGIC_DT = 1 / LOGIC_HZ, BATTLE_LIMIT = 40;
  const ZW = 680;

  // ── STATE ──────────────────────────────────────────────────────────────────
  let finished = false, rafId = 0, lastTs = null, accumSec = 0, battleElapsed = 0;
  let scaleTimer = 0;
  let playerBaseHP = 100, enemyBaseHP = 100;
  let logLines = [];
  const fighters = [];

  // ── LOG ───────────────────────────────────────────────────────────────────
  function addLog(text, cls=''){
    logLines.push({text,cls}); if(logLines.length>5) logLines.shift();
    battleLog.innerHTML=logLines.map(l=>`<div class="ll ${l.cls}">${l.text}</div>`).join('');
  }

  // ── BASE UI ───────────────────────────────────────────────────────────────
  function updateBaseUI(){
    const p=Math.max(0,Math.round(playerBaseHP)), e=Math.max(0,Math.round(enemyBaseHP));
    if(playerHpText) playerHpText.textContent=p;
    if(enemyHpText) enemyHpText.textContent=e;
    if(playerHpFill) playerHpFill.style.width=p+'%';
    if(enemyHpFill) enemyHpFill.style.width=e+'%';
    if(hpFillRowP) hpFillRowP.style.width=p+'%';
    if(hpFillRowE) hpFillRowE.style.width=e+'%';
    if(hpLabelP) hpLabelP.textContent=p+' HP';
    if(hpLabelE) hpLabelE.textContent=e+' HP';
  }

  // ── SCALE ─────────────────────────────────────────────────────────────────
  let _scaleRo = null;
  function scaleScene(){
    if(!battleInner||!scene) return;
    // Clear overrides first so the browser can report natural dimensions
    scene.style.height = '';
    scene.style.minHeight = '';
    battleInner.style.transform = '';
    const sw = scene.offsetWidth;
    if(!sw || sw < 10) return;
    const scale = Math.min(2.0, sw / ZW);
    // Read natural (un-scaled) height, then apply transform
    const nh = battleInner.offsetHeight || 280;
    battleInner.style.transform = `scale(${scale})`;
    battleInner.style.transformOrigin = 'top left';
    // Collapse scene to exactly the scaled height so no empty gap appears below
    scene.style.height = Math.round(nh * scale) + 'px';
  }
  const resizeHandler=()=>{ clearTimeout(scaleTimer); scaleTimer=setTimeout(scaleScene,80); };

  // ── CELESTIAL ENV ────────────────────────────────────────────────────────
  const ENV_CYCLE=60000;
  let envStartTime=performance.now();
  function envUpdate(){
    if(!sunEl||!moonEl||!skyZone) return;
    const elapsed=(performance.now()-envStartTime)%ENV_CYCLE;
    const phase=elapsed/ENV_CYCLE;
    const theta=phase*Math.PI*2-Math.PI/2;
    const zh=skyZone.offsetHeight||120;
    const cx=ZW/2, cy=zh, r=zh*1.05;
    sunEl.style.left=Math.round(cx+r*Math.cos(theta)-12)+'px';
    sunEl.style.top=Math.round(cy-r*Math.sin(theta)-12)+'px';
    moonEl.style.left=Math.round(cx-r*Math.cos(theta)-12)+'px';
    moonEl.style.top=Math.round(cy+r*Math.sin(theta)-12)+'px';
  }

  // ── HELPERS ───────────────────────────────────────────────────────────────
  function getZone(lane){ return lane==='air'?skyZone:groundZone; }

  function spawnDmgNumber(x,y,zone,dmg,isCrit){
    const n=document.createElement('div');
    n.className='dmg-number'+(isCrit?' crit':'');
    n.textContent=(isCrit?'💥 ':'')+dmg;
    n.style.cssText=`left:${x+4}px;top:${y-4}px;`;
    zone.appendChild(n); setTimeout(()=>n.remove(),700);
  }

  function spawnShadeBurst(x,y,zone,isEnemy){
    const b=document.createElement('div');
    b.className=isEnemy?'enemy-shade-burst':'shade-burst';
    b.style.cssText=`left:${x+14}px;top:${y+14}px;`;
    zone.appendChild(b); setTimeout(()=>b.remove(),600);
  }

  function spawnSpeedLines(x,y,zone,dir){
    for(let i=0;i<3;i++){
      const l=document.createElement('div'); l.className='speed-line';
      const len=20+Math.random()*30;
      l.style.cssText=`left:${x+(dir>0?-len:14)}px;top:${y+8+i*6}px;width:${len}px;`;
      zone.appendChild(l); setTimeout(()=>l.remove(),320);
    }
  }

  function flashAoE(cx,cy,radius,zone,cls,isEnemy){
    let useCls=cls;
    if(isEnemy){
      if(cls==='aoe-ring') useCls='enemy-aoe-ring';
      else if(cls==='explode-ring') useCls='enemy-explode-ring';
      else if(cls==='frost-ring') useCls='enemy-frost-ring';
      else if(cls==='boom-ring') useCls='enemy-boom-ring';
    }
    const r=document.createElement('div'); r.className=useCls;
    r.style.cssText=`left:${cx}px;top:${cy+14}px;width:${radius*2}px;height:${radius*2}px;`;
    zone.appendChild(r); setTimeout(()=>r.remove(),500);
  }

  function flashHit(cx,cy,zone){
    const hEl=document.createElement('div'); hEl.className='hit-flash';
    hEl.style.cssText=`left:${cx+14}px;top:${cy+14}px;`; zone.appendChild(hEl);
    setTimeout(()=>hEl.remove(),280);
  }

  // ── mkFighterDef — normalize unit data + init all state ───────────────────
  function mkFighterDef(u,isEnemy,idx){
    // Normalize cross-collection property names
    const engR=u.engageRange||u.engageR||36;
    const baseEngR=u.baseEngageRange||u.baseEngR||engR;
    const canHit=!!(u.canHitFlying||u.canAir);
    const chainL=u.chainLightning||u.chain||0;
    const aoeNorm=!u.aoe?null:(typeof u.aoe==='number'?{radius:u.aoe}:u.aoe);
    return{...u,
      engageRange:engR, baseEngageRange:baseEngR,
      canHitFlying:canHit, chainLightning:chainL, aoe:aoeNorm,
      currentHp:u.hp, uid:u.id+(isEnemy?'e':'p')+idx, isEnemy,
      trampled:false, raging:false, _rezDone:false, _slowTimer:0, _slowActive:false,
      _originalSpd:u.spd, _healTimer:0,
      atkCooldown:Math.random()*(u.atkRate===999?1:u.atkRate),
      isShade:false,
      _teleTimer:Math.random()*2,
      _killStacks:0, _baseDmg:u.dmg,
      _voidTimer:Math.random()*(u.voidCycle||5), _voidActive:false,
      _bearRaged:false,
      _camoTimer:Math.random()*(u.camoCycle||7), _camoActive:false,
      _trumpetTimer:Math.random()*(u.trumpetCooldown||8),
      _stunned:false, _stunTimer:0,
      _grabbed:false, _grabbing:false, _grabTimer:0, _grabTarget:null,
      _eagleDived:false, _retreating:false, _retreatDist:0, _diveLanded:false, _diveLandTimer:0,
      _poisoned:false, _poisonDmg:0, _poisonRemaining:0, _poisonTimer:0,
      _punchCount:0, _axoTimer:0,
      _beeSwarm:false, _beeSwarmDmg:0, _beeSwarmRemain:0, _beeSwarmTimer:0, _beeSwarmEl:null,
      _knockbackRemain:0, _knockbackTarget:null, _knockbackSpeed:0,
      _contaminated:false, _contaminateTimer:0, _contaminateDmg:0, _baseDmgBackup:undefined,
      _stinkTimer:0, _stinkTimer2:0, _stinked:false, _stinkMult:0, _gasExposure:0,
      _activeGasClouds:null,
      _speedBoostTimer:0, _speedBoosted:false, _speedBoostRemain:0,
      _waveTimer:Math.random()*(u.waveCooldown||7),
      _jumpTimer:Math.random()*(u.jumpCooldown||4),
      _pounceCount:0, _gorillaRaged:false, _roarTimer:0, _roaring:false, _roarPhase:0,
      _silenced:false, _silenceTimer:0,
      _necroUses:0,
      isNecromancer:!!(u.isNecromancer||u.isNecro), isShaman:!!u.isShaman,
      isAssassin:!!u.isAss||!!u.isAssassin,
      isAngel:!!u.isAngel,
      isGenie:u.id==='genie'||!!u.isGenie,
      isTimeWizard:u.id==='timewizard'||!!u.isTimeWizard,
      phoenixRez:!!(u.phoenixRez||u.isPx),
      selfDestruct:!!(u.selfDestruct||u.isSelf),
      slowOnHit:u.slowOnHit||u.slowDur||null,
      attackType:u.attackType||(u.melee?'melee':u.ranged?'ranged':'melee'),
      _angelTimer:Math.random()*(u.angelCooldown||2), _angelBuff:0, _angelRoll:-1, _angelDmgReduce:0,
      _wishTimer:0, _wishing:false,
      _startUnits:rawPlayerUnits.length,
      _spellTimer:Math.random()*(u.spellCooldown||6), _casting:false,
      _hpHistory:[], _hpHistTimer:0, _accelerated:false, _accelTimer:0,
      _timeStopped:false, _timeStopTimer:0,
      _lumberjackBonus:0,
      _preyInitDone:false, _preyUid:null,
      _stinkDotTimer:0, _stinkDmgPerSec:0, _stinkAtkSlowed:false,
    };
  }

  // ── spawnFighter — create DOM element and fighter object ──────────────────
  function spawnFighter(def,isEnemy,idx,total,isShade){
    const zone=getZone(def.lane);
    const zH=zone.offsetHeight||(def.lane==='air'?120:160);
    const UNIT_H=34, PAD=4;
    const usableH=Math.max(UNIT_H,(zH-PAD*2-UNIT_H));
    const centreY=zH/2, halfSpan=usableH/2;
    const yFrac=total<=1?0.5:idx/(total-1);
    const rawY=centreY-halfSpan+yFrac*usableH;
    const yPos=Math.max(PAD,Math.min(zH-UNIT_H-PAD,rawY));
    const startX=isEnemy?(ZW-62):62;

    const el=document.createElement('div');
    el.className='fighter '+(isEnemy?'enemy':'player');
    const hpBar=document.createElement('div'); hpBar.className='unit-hp-bar';
    const hpFill=document.createElement('div'); hpFill.className='unit-hp-fill'; hpFill.style.width='100%';
    hpBar.appendChild(hpFill);
    const icon=document.createElement('div'); icon.className='fighter-icon';
    icon.textContent=isShade?'👻':def.icon;
    el.appendChild(hpBar); el.appendChild(icon);
    zone.appendChild(el);
    el.style.left=startX+'px'; el.style.top=Math.round(yPos)+'px';

    return{...def,
      currentHp:def.hp, maxHp:def.hp,
      dmg:def.dmg, spd:def.spd,
      atkRate:isShade?1.2:def.atkRate,
      el, hpFill, x:startX, y:Math.round(yPos), alive:true,
      trampled:false, raging:false, _rezDone:false, _slowTimer:0, _slowActive:false,
      _originalSpd:def.spd, _healTimer:0,
      atkCooldown:Math.random()*(def.atkRate===999?1:def.atkRate),
      isEnemy, isShade,
      isNecromancer:isShade?false:def.isNecromancer,
      isShaman:isShade?false:def.isShaman,
      selfDestruct:isShade?false:!!def.selfDestruct,
      phoenixRez:isShade?false:!!def.phoenixRez,
      slowOnHit:isShade?null:def.slowOnHit||null,
      regenPerSec:isShade?0:(def.regenPerSec||0),
      reflectPct:isShade?0:(def.reflectPct||0),
      isAssassin:isShade?false:def.isAssassin,
      chainLightning:isShade?0:(def.chainLightning||0),
      _killStacks:0, _baseDmg:def.dmg,
      _teleTimer:Math.random()*2,
      _voidTimer:Math.random()*(def.voidCycle||5), _voidActive:false,
    };
  }

  // ── kill ──────────────────────────────────────────────────────────────────
  function kill(f){
    if(!f.alive&&!f.phoenixRez) return;
    f.alive=false; f._finalDead=true;
    if(f._grabTarget){f._grabTarget._grabbed=false; f._grabTarget=null;}
    f.el.style.opacity='0'; f.el.style.transition='opacity .3s';
    setTimeout(()=>{if(f.el.parentNode)f.el.parentNode.removeChild(f.el);},400);
    if(!f.isShade) addLog((f.isEnemy?'Enemy ':'Your ')+f.name+' is slain!',f.isEnemy?'good':'bad');
  }

  // ── tryRaiseShade ─────────────────────────────────────────────────────────
  function tryRaiseShade(dead){
    if(!dead||dead.isShade) return;
    const allNecros=fighters.filter(f=>f.alive&&f.isNecromancer&&(f._necroUses||0)<3);
    if(!allNecros.length) return;
    const sorted=allNecros.slice().sort((a,b)=>{
      const da=Math.hypot(a.x-dead.x,a.y-dead.y), db=Math.hypot(b.x-dead.x,b.y-dead.y);
      if(Math.abs(da-db)<5){
        if(a.isEnemy===dead.isEnemy&&b.isEnemy!==dead.isEnemy) return -1;
        if(b.isEnemy===dead.isEnemy&&a.isEnemy!==dead.isEnemy) return 1;
      }
      return da-db;
    });
    const n=sorted[0]; n._necroUses=(n._necroUses||0)+1;
    const shadeIsEnemy=n.isEnemy;
    const shadeHp=Math.max(10,Math.round((dead.maxHp||dead.hp)*0.5));
    const shadeDmg=Math.max(4,Math.round((dead.dmg||10)*0.5));
    const shadeSpd=Math.max(30,Math.round((dead._originalSpd||dead.spd||50)*0.5));
    const shadeZone=getZone(dead.lane);
    const shadow=document.createElement('div'); shadow.className='shade-shadow';
    shadow.style.cssText='left:'+(dead.x+14)+'px;top:'+(dead.y+20)+'px;';
    shadeZone.appendChild(shadow); setTimeout(()=>shadow.remove(),600);
    const shadeEl=document.createElement('div');
    shadeEl.className='fighter '+(shadeIsEnemy?'enemy':'player')+' shade-high';
    shadeEl.style.opacity='0'; shadeEl.style.transform='translateY(20px)';
    const shHpBar=document.createElement('div'); shHpBar.className='unit-hp-bar';
    const shHpFill=document.createElement('div'); shHpFill.className='unit-hp-fill'; shHpFill.style.width='100%';
    shHpBar.appendChild(shHpFill);
    const shIcon=document.createElement('div'); shIcon.className='fighter-icon'; shIcon.textContent='👻';
    shadeEl.appendChild(shHpBar); shadeEl.appendChild(shIcon);
    shadeZone.appendChild(shadeEl);
    shadeEl.style.left=Math.round(dead.x)+'px'; shadeEl.style.top=Math.round(dead.y)+'px';
    setTimeout(()=>{
      shadeEl.style.transition='opacity .4s ease-out,transform .4s ease-out';
      shadeEl.style.opacity='1'; shadeEl.style.transform='translateY(0)';
    },150);
    const shade={
      id:'shade',name:'Shade',icon:'👻',cost:0,
      hp:shadeHp, maxHp:shadeHp, currentHp:shadeHp, dmg:shadeDmg, spd:shadeSpd, atkRate:1.2, aoe:null,
      lane:dead.lane, attackType:'melee', targeting:'fighter',
      canHitFlying:dead.lane==='air', prioritiseAir:dead.lane==='air',
      engageRange:36, baseEngageRange:36,
      el:shadeEl, hpFill:shHpFill, x:dead.x, y:dead.y, alive:true,
      trampled:false, raging:false, _rezDone:false, _slowTimer:0, _slowActive:false,
      _originalSpd:shadeSpd, _healTimer:0, _voidTimer:0, _voidActive:false, _teleTimer:999,
      uid:'shade'+(shadeIsEnemy?'e':'p')+Date.now()+Math.random(),
      atkCooldown:0.3, isEnemy:shadeIsEnemy, isShade:true,
      isNecromancer:false, _necroUses:0, isShaman:false,
      isGenie:false, isAngel:false, isTimeWizard:false, isAssassin:false,
      selfDestruct:false, phoenixRez:false,
      slowOnHit:null, regenPerSec:0, reflectPct:0, chainLightning:0, _baseDmg:shadeDmg,
      _stunned:false, _stunTimer:0, _grabbed:false, _grabbing:false, _grabTimer:0, _grabTarget:null,
      _poisoned:false, _poisonDmg:0, _poisonRemaining:0, _poisonTimer:0,
      _beeSwarm:false, _beeSwarmRemain:0, _beeSwarmTimer:0, _beeSwarmEl:null,
      _contaminated:false, _contaminateTimer:0, _baseDmgBackup:undefined,
      _stinked:false, _stinkMult:0, _stinkTimer2:0, _gasExposure:0, _activeGasClouds:null,
      _speedBoosted:false, _speedBoostRemain:0,
      _knockbackRemain:0, _knockbackSpeed:0,
      _silenced:false, _silenceTimer:0, _timeStopped:false, _timeStopTimer:0,
      _angelBuff:0, _angelRoll:-1, _angelDmgReduce:0,
      _gorillaRaged:false, _bearRaged:false, _camoActive:false, _eagleDived:false, _retreating:false,
      collection:'fantasy',
    };
    spawnShadeBurst(dead.x,dead.y,shadeZone,shadeIsEnemy);
    const usesLeft=3-(n._necroUses||0);
    fighters.push(shade);
    addLog((n.isEnemy?'Enemy ':'')+'Necromancer raises '+(dead.isEnemy!==n.isEnemy?'enemy ':'')+'Shade (50% stats, '+usesLeft+' raises left)!','special');
  }

  // ── dealDmg ───────────────────────────────────────────────────────────────
  function dealDmg(attacker,target,rawDmg){
    if(!target.alive) return 0;
    if(target._voidActive) return 0;
    if(attacker.id==='archer'&&target.lane==='air') rawDmg*=(attacker.airDmgMult||attacker.airMult||1);
    if(attacker.lumberjackAxe&&attacker._lumberjackBonus>0) rawDmg+=attacker._lumberjackBonus;
    if(target._angelDmgReduce>0) rawDmg=Math.max(1,rawDmg*(1-target._angelDmgReduce));
    const warlordUp=fighters.some(f=>f.alive&&!f.isEnemy&&f.id==='warlord');
    if(warlordUp&&!attacker.isEnemy&&attacker.lane==='ground'){rawDmg*=1.4;attacker.el.classList.add('warlord-buffed');}
    else if(!warlordUp) attacker.el.classList.remove('warlord-buffed');
    if(attacker.id==='archer'&&fighters.some(f=>f.alive&&!f.isEnemy&&f.id==='footman')) rawDmg*=1.15;
    if(target.shellBlock) rawDmg*=(1-target.shellBlock);
    // Squirrel dodge
    if(target.dodgeChance&&Math.random()<target.dodgeChance){
      target.el.classList.add('dodge-flash');
      if(target.id==='squirrel'||target.dodgeChance){
        target.el.classList.add('squirrel-dodging');
        setTimeout(()=>target.el.classList.remove('squirrel-dodging'),320);
      }
      setTimeout(()=>target.el.classList.remove('dodge-flash'),300);
      const dz=getZone(target.lane);
      const dn=document.createElement('div'); dn.className='dodge-text';
      dn.textContent='DODGE!'; dn.style.cssText='left:'+target.x+'px;top:'+target.y+'px;';
      dz.appendChild(dn); setTimeout(()=>dn.remove(),600);
      return 0;
    }
    const dmg=Math.max(1,Math.round(rawDmg));
    target.currentHp-=dmg;
    target.hpFill.style.width=Math.max(0,Math.round(target.currentHp/target.maxHp*100))+'%';
    target.el.classList.remove('damage-flash');
    void target.el.offsetWidth;
    target.el.classList.add('damage-flash');
    setTimeout(()=>target.el.classList.remove('damage-flash'),260);
    if(dmg>=10){
      spawnDmgNumber(target.x,target.y,getZone(target.lane),dmg,dmg>=(target.maxHp*0.25));
    }
    // Slow on hit (frost witch, scorpion)
    if(attacker.slowOnHit&&!target._slowActive){
      target._slowActive=true; target._slowTimer=attacker.slowOnHit;
      target._originalSpd=target._originalSpd||target.spd;
      const slowPct=(attacker.frostSlowPct)||0.5;
      target.spd=target._originalSpd*(1-slowPct); target.el.classList.add('slowed');
      const fr=document.createElement('div'); fr.className='frost-slow-ring';
      fr.style.left=Math.round(target.x+14)+'px'; fr.style.top=Math.round(target.y+14)+'px';
      getZone(target.lane).appendChild(fr); setTimeout(()=>fr.remove(),640);
    }
    // Rat contaminate
    if(attacker.ratContaminate&&!target.isShade){
      const affected=fighters.filter(o=>o.alive&&o.isEnemy===target.isEnemy&&o.lane==='ground'&&!o._contaminated);
      const cDmg=attacker.contaminateDmg||10, cDur=attacker.contaminateDur||5;
      affected.forEach(t=>{
        t._contaminated=true; t._contaminateTimer=cDur; t._contaminateDmg=cDmg;
        t._baseDmgBackup=t._baseDmgBackup||t.dmg; t.dmg=Math.max(1,t.dmg-cDmg);
      });
      if(affected.length){
        const cr=document.createElement('div'); cr.className='contaminate-ring';
        cr.style.cssText='left:50%;top:50%;width:180px;height:60px;';
        groundZone.appendChild(cr); setTimeout(()=>cr.remove(),800);
        addLog((attacker.isEnemy?'Enemy ':'')+'🐀 RAT contaminates all ground enemies! -10 atk for '+cDur+'s!','aoe');
      }
    }
    // Viper/scorpion poison
    if(attacker.poisonDmg&&!target.isShade){
      target._poisoned=true; target._poisonDmg=attacker.poisonDmg;
      target._poisonRemaining=attacker.poisonDur||5; target._poisonTimer=0;
    }
    // Giraffe target lock
    if(attacker.id==='giraffe'){
      const gt=document.createElement('div'); gt.className='giraffe-target'; gt.textContent='🎯';
      gt.style.left=(target.x+14)+'px'; gt.style.top=(target.y+4)+'px';
      getZone(target.lane).appendChild(gt); setTimeout(()=>gt.remove(),470);
    }
    // Bee swarm
    if(attacker.beeSwarm&&!target.isShade&&!target._beeSwarm){
      target._beeSwarm=true; target._beeSwarmDmg=attacker.swarmDmg||4;
      target._beeSwarmRemain=attacker.swarmDur||6; target._beeSwarmTimer=0;
      const bs=document.createElement('div'); bs.className='bee-swarm-aura';
      bs.style.cssText='left:'+target.x+'px;top:'+(target.y-5)+'px;';
      getZone(target.lane).appendChild(bs);
      target._beeSwarmEl=bs;
      setTimeout(()=>{bs.remove();if(target._beeSwarmEl===bs)delete target._beeSwarmEl;},6200);
      addLog((attacker.isEnemy?'Enemy ':'')+'Bee swarm launched on '+target.name+'!','special');
    }
    // Mirror Mage reflect
    if(target.reflectPct&&attacker.alive&&dmg>0){
      const reflect=Math.max(1,Math.round(dmg*target.reflectPct));
      attacker.currentHp-=reflect;
      attacker.hpFill.style.width=Math.max(0,Math.round(attacker.currentHp/attacker.maxHp*100))+'%';
      if(attacker.currentHp<=0){tryRaiseShade(attacker);kill(attacker);}
    }
    // Phoenix rez
    if(target.currentHp<=0){
      if(target.phoenixRez&&!target._rezDone){
        target._rezDone=true; target.alive=false;
        target.el.style.opacity='0'; target.el.style.transition='opacity .2s';
        const rT=target;
        setTimeout(()=>{
          if(!rT._finalDead){
            rT.alive=true; rT.currentHp=Math.round(rT.maxHp*0.4);
            rT.hpFill.style.width='40%';
            rT.el.style.transition='opacity .4s,transform .5s';
            rT.el.style.transform='scale(0.3)'; rT.el.style.opacity='0';
            setTimeout(()=>{
              rT.el.style.transform='scale(1.3)'; rT.el.style.opacity='1';
              setTimeout(()=>{rT.el.style.transform='scale(1)';rT.el.style.transition='';},300);
            },50);
            flashAoE(rT.x,rT.y,70,getZone(rT.lane),'respawn-flash');
            addLog('🐦‍🔥 Phoenix RISES from the ashes!','special');
          }
        },1000);
        return dmg;
      }
      tryRaiseShade(target); kill(target);
    }
    return dmg;
  }

  // ── logicTick — all game mechanics each fixed step ────────────────────────
  function logicTick(dt){
    const alive=fighters.filter(f=>f.alive);

    // Angel buff timers (tick even if angel dies)
    fighters.forEach(a=>{
      if(!a.alive||!(a._angelBuff>0)) return;
      a._angelBuff-=dt;
      if(a._angelBuff<=0){
        a._angelBuff=0;
        if(a._angelRoll===0&&a._angelAtkOrig!==undefined){a.atkRate=a._angelAtkOrig;delete a._angelAtkOrig;}
        if(a._angelRoll===1&&a._angelDmgOrig!==undefined){a.dmg=a._angelDmgOrig;delete a._angelDmgOrig;}
        if(a._angelRoll===2) a._angelDmgReduce=0;
        a.el.classList.remove('angel-double-buffed');
        delete a._angelRoll;
      }
    });

    // Skunk gas DoT zones
    fighters.filter(fw=>fw.alive&&fw.stinkCloud&&fw._activeGasClouds).forEach(fw=>{
      fw._activeGasClouds=fw._activeGasClouds.filter(gz=>{
        gz.groundTimer-=dt;
        if(gz.airDelay>0) gz.airDelay-=dt;
        else gz.airTimer=(gz.airTimer||0)+dt;
        const expired=gz.groundTimer<=0&&(gz.airTimer>=2.0||!gz.hitsFlying);
        if(expired) return false;
        alive.filter(o=>o.isEnemy!==gz.isEnemy&&o.lane==='ground'&&Math.abs(o.x-gz.x)<=gz.rad).forEach(t=>{
          if(!t._stinked){
            t._stinked=true; t._stinkTimer2=(gz.stinkDuration||5.0);
            t._stinkMult=gz.dmgReduction; t._stinkDmgPerSec=gz.baseDps;
            if(!t._stinkAtkSlowed){t._stinkAtkSlowed=true;t._originalAtkRate=t.atkRate;t.atkRate*=(1+gz.atkSlow);}
          }
          t._gasExposure=(t._gasExposure||0)+dt;
          const scaledDps=gz.baseDps*(1+Math.min(2,t._gasExposure*0.4));
          t._stinkDmgPerSec=Math.max(t._stinkDmgPerSec||0,scaledDps);
        });
        if(gz.hitsFlying&&gz.airDelay<=0&&gz.airTimer>0){
          alive.filter(o=>o.isEnemy!==gz.isEnemy&&o.lane==='air'&&Math.abs(o.x-gz.x)<=gz.airRad).forEach(t=>{
            if(!t._stinked){
              t._stinked=true; t._stinkTimer2=gz.airTimer+0.5;
              t._stinkMult=gz.dmgReduction*0.6; t._stinkDmgPerSec=gz.baseDps*0.5;
            }
            t._gasExposure=(t._gasExposure||0)+dt;
            t._stinkDmgPerSec=Math.max(t._stinkDmgPerSec||0,gz.baseDps*0.5*(1+Math.min(1.5,t._gasExposure*0.3)));
          });
        }
        return true;
      });
    });
    alive.forEach(t=>{
      const inAnyGas=fighters.some(fw=>fw._activeGasClouds&&fw._activeGasClouds.some(gz=>
        gz.isEnemy!==t.isEnemy&&(
          (t.lane==='ground'&&Math.abs(t.x-gz.x)<=gz.rad&&gz.groundTimer>0)||
          (t.lane==='air'&&gz.hitsFlying&&gz.airDelay<=0&&Math.abs(t.x-gz.x)<=gz.airRad)
        )
      ));
      if(!inAnyGas) t._gasExposure=0;
    });

    // Slow timers
    alive.forEach(f=>{
      if(f._slowActive){f._slowTimer-=dt;if(f._slowTimer<=0){f._slowActive=false;f.spd=f._originalSpd;f.el.classList.remove('slowed');}}
    });

    // Troll regen
    alive.filter(f=>f.regenPerSec>0).forEach(t=>{
      t.currentHp=Math.min(t.maxHp,t.currentHp+t.regenPerSec*dt);
      t.hpFill.style.width=Math.round(t.currentHp/t.maxHp*100)+'%';
    });

    // Shaman heal
    alive.filter(f=>f.isShaman).forEach(sh=>{
      sh._healTimer=(sh._healTimer||0)+dt;
      if(sh._healTimer>=1.5){
        sh._healTimer=0;
        const sideAlive=alive.filter(a=>a.isEnemy===sh.isEnemy);
        const cnt=sideAlive.filter(a=>a.isShaman).length;
        const range=sh.healRange||120;
        const inRange=sideAlive.filter(a=>!a.isShaman&&Math.abs(a.x-sh.x)<=range);
        const t=inRange.sort((a,b)=>(a.currentHp/a.maxHp)-(b.currentHp/b.maxHp))[0];
        if(t){
          t.currentHp=Math.min(t.maxHp,t.currentHp+8*cnt);
          t.hpFill.style.width=Math.round(t.currentHp/t.maxHp*100)+'%';
          addLog((sh.isEnemy?'Enemy ':'')+'Shaman heals '+t.name+' for '+(8*cnt),'info');
          const hc=document.createElement('div'); hc.className='heal-cross'; hc.textContent='+';
          hc.style.cssText='left:'+(t.x+10)+'px;top:'+t.y+'px;';
          getZone(t.lane).appendChild(hc); setTimeout(()=>hc.remove(),720);
        }
      }
    });

    function isValidTarget(f,o){
      if(o.isEnemy===f.isEnemy||!o.alive) return false;
      if(o._camoActive) return false;
      if(o.lane==='air'&&f.attackType==='melee'&&f.lane==='ground') return false;
      if(o.lane==='air'&&!f.canHitFlying) return false;
      return true;
    }
    function pickTarget(f,opp){
      if(f.sharkPrey&&f._preyUid){
        const prey=opp.find(o=>o.uid===f._preyUid);
        if(prey&&prey.alive) return prey;
      }
      if(!opp.length) return null;
      if(f.prioritiseAir){const air=opp.filter(o=>o.lane==='air');if(air.length)return air.sort((a,b)=>Math.abs(a.x-f.x)-Math.abs(b.x-f.x))[0];}
      return opp.sort((a,b)=>Math.abs(a.x-f.x)-Math.abs(b.x-f.x))[0];
    }

    alive.forEach(f=>{
      if(!f.alive) return;
      const zW=ZW;
      const zone=getZone(f.lane);
      const dir=f.isEnemy?-1:1;
      const oppBaseX=f.isEnemy?62:(zW-62);
      f.atkCooldown=Math.max(0,f.atkCooldown-dt);

      // Brute rage
      if(f.id==='brute'&&!f.raging&&f.currentHp/f.maxHp<0.3){
        f.raging=true; f.spd=(f._originalSpd||f.spd)*1.5;
        f.el.classList.add('brute-raging');
        addLog('Brute RAGES!','aoe');
      }

      // Bee swarm DoT (follow target)
      if(f._beeSwarmEl&&f.alive){
        f._beeSwarmEl.style.left=Math.round(f.x)+'px';
        f._beeSwarmEl.style.top=Math.round(f.y-5)+'px';
      }
      if(f._beeSwarm){
        f._beeSwarmTimer=(f._beeSwarmTimer||0)+dt;
        if(f._beeSwarmTimer>=0.5){
          f._beeSwarmTimer=0;
          f.currentHp=Math.max(0,f.currentHp-(f._beeSwarmDmg||4)*0.5);
          f.hpFill.style.width=Math.max(0,Math.round(f.currentHp/f.maxHp*100))+'%';
          const bp=document.createElement('div'); bp.className='bee-sting';
          bp.style.cssText='left:'+(f.x+10)+'px;top:'+f.y+'px;';
          zone.appendChild(bp); setTimeout(()=>bp.remove(),400);
          if(f.currentHp<=0){tryRaiseShade(f);kill(f);return;}
        }
        f._beeSwarmRemain=(f._beeSwarmRemain||0)-dt;
        if(f._beeSwarmRemain<=0) f._beeSwarm=false;
      }

      // Bat echolocation
      if(f.echolocation&&f.alive){
        alive.filter(o=>o.isEnemy!==f.isEnemy&&o._camoActive&&Math.abs(o.x-f.x)<=150).forEach(t=>{
          t._camoActive=false; t._camoTimer=0; t.el.classList.remove('camo-fighter');
          addLog((f.isEnemy?'Enemy ':'')+'Bat reveals '+t.name+'!','special');
        });
      }

      // Skunk stink cloud
      if(f.stinkCloud){
        f._stinkTimer=(f._stinkTimer||0)+dt;
        if(f._stinkTimer>=(f.stinkCooldown||6)){
          f._stinkTimer=0;
          const rad=f.stinkRadius||85;
          const GAS_DUR=2500, GAS_RISE=1500;
          for(let gi=0;gi<6;gi++){
            const gx=f.x+(Math.random()-0.5)*rad*1.6;
            const gsz=35+Math.random()*55, gdelay=gi*90;
            setTimeout(()=>{
              const c=document.createElement('div'); c.className='skunk-gas skunk-gas-ground';
              c.style.left=Math.round(gx)+'px'; c.style.top=Math.round(f.y+(Math.random()-0.5)*25)+'px';
              c.style.width=gsz+'px'; c.style.height=Math.round(gsz*0.5)+'px';
              groundZone.appendChild(c); setTimeout(()=>c.remove(),GAS_DUR);
            },gdelay);
            if(f.stinkHitsFlying){
              setTimeout(()=>{
                const ca=document.createElement('div'); ca.className='skunk-gas skunk-gas-air';
                ca.style.left=Math.round(gx+(Math.random()-0.5)*20)+'px';
                ca.style.top=Math.round(20+Math.random()*50)+'px';
                ca.style.width=Math.round(gsz*0.65)+'px'; ca.style.height=Math.round(gsz*0.3)+'px';
                skyZone.appendChild(ca); setTimeout(()=>ca.remove(),GAS_DUR-500);
              },gdelay+GAS_RISE);
            }
          }
          if(!f._activeGasClouds) f._activeGasClouds=[];
          f._activeGasClouds.push({
            x:f.x, rad, airRad:rad*0.7,
            groundTimer:3.5, airTimer:0, airDelay:1.5,
            dmgReduction:f.stinkDmgReduction||0.3,
            atkSlow:f.stinkAtkSlow||0.5,
            baseDps:f.stinkDmgPerSec||3,
            hitsFlying:f.stinkHitsFlying,
            stinkDuration:f.stinkDuration||5.0,
            isEnemy:f.isEnemy,
          });
        }
      }
      if(f._stinked){
        f._stinkTimer2=(f._stinkTimer2||0)-dt;
        if(f._stinkDmgPerSec&&f._stinkDmgPerSec>0){
          f._stinkDotTimer=(f._stinkDotTimer||0)+dt;
          if(f._stinkDotTimer>=0.5){
            f._stinkDotTimer=0;
            f.currentHp=Math.max(0,f.currentHp-f._stinkDmgPerSec*0.5);
            f.hpFill.style.width=Math.max(0,Math.round(f.currentHp/f.maxHp*100))+'%';
            if(f.currentHp<=0){tryRaiseShade(f);kill(f);return;}
          }
        }
        if(f._stinkTimer2<=0){
          f._stinked=false; delete f._stinkMult; delete f._stinkDmgPerSec;
          if(f._stinkAtkSlowed){f._stinkAtkSlowed=false;f.atkRate=f._originalAtkRate||f.atkRate;}
        }
      }

      // Zebra speed boost
      if(f.speedBoost){
        f._speedBoostTimer=(f._speedBoostTimer||0)+dt;
        if(f._speedBoostTimer>=(f.speedBoostCooldown||8)){
          f._speedBoostTimer=0;
          alive.filter(a=>a.isEnemy===f.isEnemy&&a!==f&&Math.abs(a.x-f.x)<=(f.speedBoostRadius||90)).forEach(a=>{
            if(!a._speedBoosted){a._speedBoosted=true;a._speedBoostRemain=f.speedBoostDur||5;
              a._originalSpd=a._originalSpd||a.spd;a.spd=a._originalSpd*(f.speedBoostAmt||1.3);
              a.el.classList.add('speed-boosted');}
          });
          addLog((f.isEnemy?'Enemy ':'')+'Zebra stampede boosts nearby allies!','special');
        }
      }
      if(f._speedBoosted){
        f._speedBoostRemain=(f._speedBoostRemain||0)-dt;
        if(f._speedBoostRemain<=0){f._speedBoosted=false;f.spd=f._originalSpd||f.spd;f.el.classList.remove('speed-boosted');}
      }

      // Kangaroo jump attack
      if(f.jumpAttack&&!f._retreating){
        f._jumpTimer=(f._jumpTimer||0)+dt;
        if(f._jumpTimer>=(f.jumpCooldown||4)){
          f._jumpTimer=0;
          const opp2=alive.filter(o=>isValidTarget(f,o)&&o.lane===f.lane);
          if(opp2.length){
            const bt=opp2.slice().sort((a,b)=>f.isEnemy?(a.x-b.x):(b.x-a.x))[0];
            if(bt&&Math.abs(bt.x-f.x)>60){
              const startX=f.x,startY=f.y;
              const endX=Math.max(62,Math.min(zW-62,bt.x+(f.isEnemy?-40:40)));
              const arc=document.createElement('div'); arc.className='kangaroo-arc';
              arc.textContent=f.icon||'🦘'; arc.style.left=startX+'px'; arc.style.top=startY+'px';
              zone.appendChild(arc);
              const dur=380,frames=12;
              for(let fr=1;fr<=frames;fr++){
                const frac=fr/frames;
                setTimeout(()=>{
                  arc.style.left=Math.round(startX+(endX-startX)*frac)+'px';
                  arc.style.top=Math.round(startY-Math.sin(frac*Math.PI)*55)+'px';
                  if(fr===frames) arc.remove();
                },dur*frac);
              }
              f.x=endX; f.atkCooldown=0;
              addLog((f.isEnemy?'Enemy ':'')+'Kangaroo LEAPS to '+bt.name+'!','special');
            }
          }
        }
      }

      // Tiger roar
      if(f.tigerRoar&&f.alive){
        f._roarTimer=(f._roarTimer||0)+dt;
        if(f._roarTimer>=(f.roarCooldown||8)){
          f._roarTimer=0; f._roaring=true; f._roarPhase=0.6;
          alive.filter(o=>o.isEnemy!==f.isEnemy&&o.id!=='tiger').forEach(t=>{
            t._silenced=true; t._silenceTimer=f.roarSilenceDur||3;
          });
          for(let i=0;i<5;i++){
            setTimeout(()=>{
              [groundZone,skyZone].forEach(z=>{
                if(!z) return;
                const ring=document.createElement('div'); ring.className='roar-ring';
                ring.style.cssText='left:'+(f.x+14)+'px;top:50%;';
                z.appendChild(ring); setTimeout(()=>ring.remove(),900);
              });
            },i*120);
          }
          [groundZone,skyZone].forEach(z=>{
            if(z){z.classList.add('shaking');setTimeout(()=>z.classList.remove('shaking'),550);}
          });
          f.el.classList.add('tiger-roaring'); setTimeout(()=>f.el.classList.remove('tiger-roaring'),750);
          addLog('🐅 Tiger ROARS! All enemies silenced for '+(f.roarSilenceDur||3)+'s!','aoe');
        }
        if(f._roaring){
          f._roarPhase=(f._roarPhase||0)-dt;
          if(f._roarPhase<=0) f._roaring=false;
          return;
        }
      }

      // Silence timer
      if(f._silenced){
        f._silenceTimer=(f._silenceTimer||0)-dt;
        f.el.classList.add('silenced-unit');
        if(f._silenceTimer<=0){f._silenced=false;f.el.classList.remove('silenced-unit');}
        return;
      }

      // Whale tidal wave
      if(f.tidalWave){
        f._waveTimer=(f._waveTimer||0)+dt;
        if(f._waveTimer>=(f.waveCooldown||7)){
          f._waveTimer=0;
          flashAoE(f.x,f.y,f.waveRadius||140,skyZone,'frost-ring');
          ['ground','air'].forEach(lane=>{
            const inLane=alive.filter(o=>o.isEnemy!==f.isEnemy&&o.lane===lane);
            if(!inLane.length) return;
            const fwd=inLane.slice().sort((a,b)=>f.isEnemy?(a.x-b.x):(b.x-a.x))[0];
            if(!fwd||!fwd.alive) return;
            dealDmg(f,fwd,f.waveDmg||30);
            const lz=getZone(lane);
            const pushDir=fwd.isEnemy?1:-1, pushDist=85;
            const startX=fwd.x, endX=Math.max(62,Math.min(zW-62,fwd.x+pushDir*pushDist));
            const steps=4;
            for(let s=0;s<steps;s++){
              const fraction=(s+1)/steps;
              const rippleX=startX+pushDir*pushDist*fraction, rippleY=fwd.y, delay=s*80;
              setTimeout(()=>{
                const wr=document.createElement('div'); wr.className='wave-ripple';
                wr.style.cssText='left:'+Math.round(rippleX+14)+'px;top:'+Math.round(rippleY+14)+'px;';
                lz.appendChild(wr); setTimeout(()=>wr.remove(),520);
                const wd=document.createElement('div'); wd.className='wave-drag';
                const w=28+fraction*24, hh=20-fraction*8;
                wd.style.cssText='left:'+Math.round(rippleX)+'px;top:'+Math.round(rippleY+4)+'px;width:'+w+'px;height:'+hh+'px;';
                lz.appendChild(wd); setTimeout(()=>wd.remove(),580);
              },delay);
            }
            fwd.el.classList.add('wave-knocked');
            fwd._knockbackTarget=endX;
            fwd._knockbackSpeed=(endX-startX)/0.35;
            fwd._knockbackRemain=0.35;
            setTimeout(()=>fwd.el.classList.remove('wave-knocked'),650);
          });
          addLog((f.isEnemy?'Enemy ':'')+'🌊 TIDAL WAVE crashes!','aoe');
        }
      }
      // Knockback slide
      if(f._knockbackRemain&&f._knockbackRemain>0){
        f._knockbackRemain-=dt;
        f.x=Math.max(62,Math.min(zW-62,f.x+f._knockbackSpeed*dt));
        f.el.style.left=Math.round(f.x)+'px';
        if(f._knockbackRemain<=0){f._knockbackRemain=0;delete f._knockbackTarget;delete f._knockbackSpeed;}
      }

      // Rat contamination timer
      if(f._contaminated){
        f._contaminateTimer=(f._contaminateTimer||0)-dt;
        if(f._contaminateTimer<=0){
          f._contaminated=false;
          if(f._baseDmgBackup!==undefined){f.dmg=f._baseDmgBackup;delete f._baseDmgBackup;}
          f.el.classList.remove('contaminated'); f.el.classList.remove('infected-aura');
        } else {
          f.el.classList.add('contaminated'); f.el.classList.add('infected-aura');
        }
      }

      // Axolotl aura heal
      if(f.axolotlAura&&f.alive){
        f._axoTimer=(f._axoTimer||0)+dt;
        if(f._axoTimer>=1.0){
          f._axoTimer=0;
          const range=f.axolotlAuraRange||80;
          const allies=alive.filter(a=>a.isEnemy===f.isEnemy&&a!==f&&Math.abs(a.x-f.x)<=range);
          const nearest=allies.sort((a,b)=>Math.abs(a.x-f.x)-Math.abs(b.x-f.x))[0];
          if(nearest){
            nearest.currentHp=Math.min(nearest.maxHp,nearest.currentHp+(f.axolotlAuraHeal||3));
            nearest.hpFill.style.width=Math.round(nearest.currentHp/nearest.maxHp*100)+'%';
          }
        }
      }

      // Shark prey system
      if(f.sharkPrey){
        if(!f._preyInitDone){
          f._preyInitDone=true;
          const enemies=alive.filter(o=>o.isEnemy!==f.isEnemy);
          if(enemies.length){
            const pick=enemies[Math.floor(Math.random()*enemies.length)];
            f._preyUid=pick.uid; pick._isSharkPrey=true;
            if(!pick.el.querySelector('.shark-prey-skull')){
              const sk=document.createElement('span'); sk.className='shark-prey-skull'; sk.textContent='💀';
              pick.el.querySelector('.unit-hp-bar').appendChild(sk);
            }
            const fog=document.createElement('div'); fog.className='shark-prey-fog';
            fog.style.left=(pick.x+14)+'px'; fog.style.top=(pick.y+4)+'px';
            getZone(pick.lane).appendChild(fog); setTimeout(()=>fog.remove(),850);
            addLog((f.isEnemy?'Enemy ':'')+'🦈 Shark marks '+pick.name+' as PREY!','special');
          }
        }
        if(f._preyUid){
          const prey=fighters.find(o=>o.uid===f._preyUid);
          if(!prey||!prey.alive){
            f._preyUid=null;
            f.currentHp=Math.min(f.maxHp,f.currentHp+7); f.maxHp+=7;
            f.dmg+=2; f.spd=Math.min(f.spd+7,250);
            f.hpFill.style.width=Math.round(f.currentHp/f.maxHp*100)+'%';
            f.el.classList.add('shark-buffed'); setTimeout(()=>f.el.classList.remove('shark-buffed'),1200);
            addLog((f.isEnemy?'Enemy ':'')+'🦈 Shark EVOLVES! +7 HP +2 dmg +7 spd!','aoe');
            const newEnemies=alive.filter(o=>o.isEnemy!==f.isEnemy);
            if(newEnemies.length){
              const pick2=newEnemies[Math.floor(Math.random()*newEnemies.length)];
              f._preyUid=pick2.uid; pick2._isSharkPrey=true;
              if(!pick2.el.querySelector('.shark-prey-skull')){
                const sk2=document.createElement('span'); sk2.className='shark-prey-skull'; sk2.textContent='💀';
                pick2.el.querySelector('.unit-hp-bar').appendChild(sk2);
              }
              const fog2=document.createElement('div'); fog2.className='shark-prey-fog';
              fog2.style.left=(pick2.x+14)+'px'; fog2.style.top=(pick2.y+4)+'px';
              getZone(pick2.lane).appendChild(fog2); setTimeout(()=>fog2.remove(),850);
            }
          }
        }
      }

      // Gorilla rage
      if(f.gorillaRage&&!f._gorillaRaged&&f.currentHp/f.maxHp<0.5){
        f._gorillaRaged=true;
        const gRetreat=f.isEnemy?50:-50;
        f.x=Math.max(62,Math.min(zW-62,f.x+gRetreat));
        f.el.classList.add('gorilla-jumping','gorilla-ranged');
        setTimeout(()=>f.el.classList.remove('gorilla-jumping'),480);
        f.el.style.transition='left .35s cubic-bezier(.3,-.5,.7,1.5)';
        f.el.style.left=Math.round(f.x)+'px';
        setTimeout(()=>{f.el.style.transition='';},380);
        f.attackType='ranged'; f.engageRange=150; f.baseEngageRange=150; f.canHitFlying=true;
        flashAoE(f.x,f.y,40,zone,'explode-ring',f.isEnemy);
        addLog((f.isEnemy?'Enemy ':'')+'🦍 Gorilla RAGES! Now ranged + hits flying!','aoe');
      }

      // Bear rage
      if(f.bearRage&&!f._bearRaged&&f.currentHp/f.maxHp<0.5){
        f._bearRaged=true; f.dmg+=10;
        f.el.classList.add('bear-raging');
        const bearIcon=f.el.querySelector('.fighter-icon');
        if(bearIcon){
          bearIcon.style.transition='transform .35s cubic-bezier(.68,-0.55,.27,1.55)';
          bearIcon.style.transform='scale(1.55)';
          setTimeout(()=>{bearIcon.style.transform='scale(1.2)';},380);
          setTimeout(()=>{bearIcon.style.transform='';bearIcon.style.transition='';},700);
        }
        flashAoE(f.x,f.y,55,zone,'explode-ring');
        addLog((f.isEnemy?'Enemy ':'')+'🐻 Bear RAGES! +10 permanent dmg!','aoe');
      }

      // Elephant trumpet stun
      if(f.trumpetCooldown){
        f._trumpetTimer=(f._trumpetTimer||0)+dt;
        if(f._trumpetTimer>=f.trumpetCooldown){
          f._trumpetTimer=0;
          const rad=f.trumpetRadius||90;
          flashAoE(f.x,f.y,rad,zone,'stun-ring',f.isEnemy);
          zone.classList.add('shaking'); setTimeout(()=>zone.classList.remove('shaking'),420);
          const tw=document.createElement('div'); tw.className='trumpet-wave';
          tw.style.cssText=`left:${f.x+14}px;top:${f.y+14}px;width:${rad*2}px;height:${rad*2}px;`;
          zone.appendChild(tw); setTimeout(()=>tw.remove(),750);
          alive.filter(o=>o.isEnemy!==f.isEnemy&&o.lane!=='air'&&Math.abs(o.x-f.x)<=rad).forEach(t=>{
            t._stunned=true; t._stunTimer=(f.stunDur||1.5);
          });
          addLog((f.isEnemy?'Enemy ':'')+'Elephant trumpets! Nearby enemies stunned!','aoe');
        }
      }

      // Grab lock (crocodile)
      if(f._grabbing){
        f._grabTimer=(f._grabTimer||0)-dt;
        if(f._grabTarget&&!f._grabTarget.alive){f._grabbing=false;delete f._grabTarget;}
        if(f._grabTimer<=0){f._grabbing=false;if(f._grabTarget){f._grabTarget._grabbed=false;delete f._grabTarget;}}
      }
      if(f._grabbed){f.x=Math.max(62,Math.min(zW-62,f.x));return;}
      if(f._grabbed&&!fighters.some(g=>g.alive&&g._grabTarget===f)) f._grabbed=false;

      // Stun timer
      if(f._stunned){
        f._stunTimer=(f._stunTimer||0)-dt;
        if(f._stunTimer<=0){f._stunned=false;delete f._stunTimer;}
      }
      if(f._stunned){f.x=Math.max(62,Math.min(zW-62,f.x));return;}

      // Time stop
      if(f._timeStopped){f.x=Math.max(62,Math.min(zW-62,f.x));return;}

      // Chameleon camo cycle
      if(f.camoCycle){
        f._camoTimer=(f._camoTimer||0)+dt;
        const phase=f._camoTimer%f.camoCycle;
        const wasCamo=f._camoActive;
        f._camoActive=phase<(f.camoDur||4);
        if(f._camoActive!==wasCamo){
          f.el.classList.toggle('camo-fighter',f._camoActive);
          if(f._camoActive) addLog((f.isEnemy?'Enemy ':'')+'Chameleon vanishes!','special');
        }
      }

      // Viper poison tick
      if(f._poisoned){
        f._poisonTimer=(f._poisonTimer||0)+dt;
        if(f._poisonTimer>=1.0){
          f._poisonTimer=0;
          const pdmg=f._poisonDmg||3;
          f.currentHp=Math.max(0,f.currentHp-pdmg);
          f.hpFill.style.width=Math.max(0,Math.round(f.currentHp/f.maxHp*100))+'%';
          if(f.currentHp<=0){tryRaiseShade(f);kill(f);return;}
          const pt=document.createElement('div'); pt.className='poison-cloud';
          pt.style.cssText=`left:${f.x+14}px;top:${f.y+14}px;`;
          zone.appendChild(pt); setTimeout(()=>pt.remove(),620);
        }
        f._poisonRemaining=(f._poisonRemaining||0)-dt;
        if(f._poisonRemaining<=0) f._poisoned=false;
      }

      // Voidwalker phase
      if(f.id==='voidwalker'){
        f._voidTimer=(f._voidTimer||0)+dt;
        const cycle=f.voidCycle||5.0, dur=f.voidDuration||1.5;
        if(!f._voidActive&&f._voidTimer>=cycle){
          f._voidActive=true; f._voidTimer=0;
          f.el.style.opacity='0.35';
          addLog((f.isEnemy?'Enemy ':'')+'Voidwalker phases out!','special');
        }
        if(f._voidActive&&f._voidTimer>=dur){f._voidActive=false;f._voidTimer=0;f.el.style.opacity='1';}
        if(f._voidActive){f.x=Math.max(62,Math.min(zW-62,f.x));return;}
      }

      // Bomb goblin self-destruct
      if(f.selfDestruct){
        const targets=alive.filter(o=>o.isEnemy!==f.isEnemy&&o.alive&&o.lane===f.lane);
        let explodeNow=false;
        if(targets.length){
          const cx=targets.reduce((s,o)=>s+o.x,0)/targets.length;
          if(Math.abs(f.x-cx)>f.engageRange) f.x+=dir*f.spd*dt;
          else explodeNow=true;
        } else {
          if(Math.abs(f.x-oppBaseX)>f.baseEngageRange) f.x+=dir*f.spd*dt;
          else explodeNow=true;
        }
        if(explodeNow){
          const gbRad=f.aoe?f.aoe.radius:54;
          const gboom=document.createElement('div'); gboom.className='goblin-boom';
          gboom.style.left=Math.round(f.x+14)+'px'; gboom.style.top=Math.round(f.y+14)+'px';
          gboom.style.width=(gbRad*2)+'px'; gboom.style.height=(gbRad*2)+'px';
          zone.appendChild(gboom); setTimeout(()=>gboom.remove(),720);
          flashAoE(f.x,f.y,gbRad,zone,'explode-ring',f.isEnemy);
          addLog((f.isEnemy?'Enemy ':'')+'💥 Bomb Goblin EXPLODES for '+f.dmg+' AoE!','aoe');
          targets.filter(t=>Math.hypot(t.x-f.x,t.y-f.y)<=(f.aoe?f.aoe.radius:54)).forEach(t=>{
            dealDmg(f,t,f.dmg*(0.85+Math.random()*.3));
          });
          if(!targets.length){
            const d=Math.round(f.dmg*0.7);
            if(f.isEnemy) playerBaseHP=Math.max(0,playerBaseHP-d);
            else enemyBaseHP=Math.max(0,enemyBaseHP-d);
            updateBaseUI();
          }
          kill(f); return;
        }
        f.x=Math.max(62,Math.min(zW-62,f.x)); return;
      }

      // Rusher targeting — matches units with targeting:'rusher' (legacy) OR rusher:true (fantasy units: cavalry, harpy)
      if(f.targeting==='rusher' || f.rusher){
        const opp=alive.filter(o=>isValidTarget(f,o));
        const airFoes=opp.filter(o=>o.lane==='air');
        const nearAir=airFoes.sort((a,b)=>Math.abs(a.x-f.x)-Math.abs(b.x-f.x))[0];
        if(nearAir&&Math.abs(nearAir.x-f.x)<=f.engageRange){
          if(f.atkCooldown<=0){
            f.atkCooldown=f.atkRate;
            const dmg=dealDmg(f,nearAir,f.dmg*(0.85+Math.random()*.3));
            flashHit(nearAir.x,nearAir.y,zone);
            addLog(f.name+' clashes with '+nearAir.name+' for '+dmg,f.isEnemy?'bad':'good');
          }
          const dx=nearAir.x-f.x; if(Math.abs(dx)>4) f.x+=Math.sign(dx)*f.spd*dt*0.5;
        } else {
          if(f.chargeThrough){
            const nextX=f.x+dir*f.spd*dt;
            alive.filter(o=>o.isEnemy!==f.isEnemy&&o.alive&&o.lane===f.lane).forEach(t=>{
              const between=dir>0?(t.x>f.x&&t.x<=nextX):(t.x<f.x&&t.x>=nextX);
              if(between){
                dealDmg(f,t,f.dmg*0.6);
                const kbDir=t.isEnemy?1:-1;
                t.x=Math.max(62,Math.min(zW-62,t.x+kbDir*(f.chargeKnockback||30)));
                t.el.style.left=Math.round(t.x)+'px';
                t.el.classList.add('damage-flash'); setTimeout(()=>t.el.classList.remove('damage-flash'),260);
              }
            });
          }
          if(Math.abs(f.x-oppBaseX)>f.baseEngageRange){
            f.x+=dir*f.spd*dt;
          } else {
            if(f.atkCooldown<=0){
              f.atkCooldown=f.atkRate;
              let rawDmg=f.dmg*(0.85+Math.random()*.3);
              if(f.id==='cavalry'&&!f.trampled){rawDmg*=2;f.trampled=true;}
              const dmg=Math.round(rawDmg);
              if(f.isEnemy) playerBaseHP=Math.max(0,playerBaseHP-dmg);
              else enemyBaseHP=Math.max(0,enemyBaseHP-dmg);
              addLog(f.name+' strikes the '+(f.isEnemy?'player':'enemy')+' base for '+dmg+'!',f.isEnemy?'bad':'good');
              updateBaseUI();
              const baseEl2=f.isEnemy?basePEl:baseEEl;
              if(baseEl2){baseEl2.classList.add('damage-flash');setTimeout(()=>baseEl2.classList.remove('damage-flash'),280);}
            }
          }
        }
        f.x=Math.max(62,Math.min(zW-62,f.x)); return;
      }

      // Shaman follow lowest-HP ally
      if(f.isShaman){
        const HEAL_RANGE=f.healRange||120;
        const sideAlive=alive.filter(a=>a.isEnemy===f.isEnemy&&!a.isShaman);
        let targetX;
        if(sideAlive.length){
          const neediest=sideAlive.slice().sort((a,b)=>(a.currentHp/a.maxHp)-(b.currentHp/b.maxHp))[0];
          const trailDir=f.isEnemy?1:-1;
          const rawTarget=neediest.x+trailDir*(HEAL_RANGE*0.4);
          const mid=zW*0.5;
          if(f.isEnemy) targetX=Math.max(mid,Math.min(zW-62,rawTarget));
          else targetX=Math.min(mid,Math.max(62,rawTarget));
        } else { targetX=oppBaseX; }
        if(Math.abs(f.x-targetX)>5) f.x+=Math.sign(targetX-f.x)*f.spd*dt;
        f.x=Math.max(62,Math.min(zW-62,f.x)); return;
      }

      // Assassin chain-teleport
      if(f.isAssassin){
        const HOP=85, HOP_CD=0.8;
        f._teleTimer=(f._teleTimer||0)+dt;
        if(f._teleTimer>=HOP_CD){
          f._teleTimer=0;
          const opp2=alive.filter(o=>isValidTarget(f,o));
          if(opp2.length){
            const backline=opp2.filter(o=>o.attackType==='ranged'||o.isShaman);
            const pool=backline.length?backline:opp2;
            const bt=pool.slice().sort((a,b)=>f.isEnemy?(a.x-b.x):(b.x-a.x))[0];
            if(bt){
              const distToTarget=Math.abs(f.x-bt.x);
              if(distToTarget>f.engageRange+8){
                const hop=Math.min(HOP,distToTarget-f.engageRange);
                const prevX=f.x;
                f.x+=Math.sign(bt.x-f.x)*hop;
                f.x=Math.max(62,Math.min(zW-62,f.x));
                const tf=document.createElement('div'); tf.className=f.isEnemy?'enemy-teleport-flash':'teleport-flash';
                tf.style.cssText=`left:${f.x+14}px;top:${f.y+14}px;`;
                zone.appendChild(tf); setTimeout(()=>tf.remove(),350);
                const shadow=document.createElement('div');
                shadow.className='tele-shadow fighter '+(f.isEnemy?'enemy':'player');
                const sIcon=document.createElement('div'); sIcon.className='fighter-icon'; sIcon.textContent=f.icon||'🗡';
                shadow.appendChild(sIcon);
                shadow.style.cssText=`left:${prevX}px;top:${f.y}px;`;
                zone.appendChild(shadow); setTimeout(()=>shadow.remove(),420);
                if(Math.ceil((Math.abs(bt.x-f.x)-f.engageRange)/HOP)<=0){
                  addLog((f.isEnemy?'Enemy ':'')+'Assassin reaches '+bt.name+'!','special');
                  f.atkCooldown=0;
                }
              }
            }
          }
        }
      }

      // Lumberjack bonus
      if(f.lumberjackAxe){
        f._lumberjackBonus=alive.filter(o=>o.isEnemy!==f.isEnemy).length;
      }

      // Angel bless
      if(f.isAngel){
        f._angelTimer=(f._angelTimer||0)+dt;
        if(f._angelTimer>=(f.angelCooldown||2)){
          f._angelTimer=0;
          const groundAllies=alive.filter(a=>a.isEnemy===f.isEnemy&&a.lane==='ground'&&!a.isAngel);
          if(groundAllies.length){
            const t2=groundAllies[Math.floor(Math.random()*groundAllies.length)];
            const hadBuff=t2._angelBuff>0;
            const isDouble=hadBuff;
            const mult=isDouble?2:1;
            if(hadBuff){
              if(t2._angelRoll===0&&t2._angelAtkOrig!==undefined){t2.atkRate=t2._angelAtkOrig;delete t2._angelAtkOrig;}
              if(t2._angelRoll===1&&t2._angelDmgOrig!==undefined){t2.dmg=t2._angelDmgOrig;delete t2._angelDmgOrig;}
              if(t2._angelRoll===2) t2._angelDmgReduce=0;
              t2.el.classList.remove('angel-double-buffed');
            }
            const roll3=Math.floor(Math.random()*3);
            t2._angelBuff=4.0; t2._angelRoll=roll3;
            if(roll3===0){t2._angelAtkOrig=t2.atkRate;t2.atkRate=Math.max(0.1,t2.atkRate-(0.3*mult));}
            else if(roll3===1){t2._angelDmgOrig=t2.dmg;t2.dmg=t2.dmg+9*mult;}
            else{t2._angelDmgReduce=Math.min(0.80,0.30*mult);}
            const az=getZone(t2.lane);
            const bp=document.createElement('div'); bp.className='angel-bless-particle';
            bp.textContent=roll3===0?'⚡':roll3===1?'💥':'🛡';
            bp.style.left=(t2.x+14)+'px'; bp.style.top=t2.y+'px';
            az.appendChild(bp); setTimeout(()=>bp.remove(),730);
            if(isDouble) t2.el.classList.add('angel-double-buffed');
            addLog((f.isEnemy?'Enemy ':'')+'🪽 Angel blesses '+t2.name+(isDouble?' ✦DOUBLED✦':'')+'!','special');
          }
        }
      }

      // Genie wish
      if(f.isGenie){
        f._wishTimer=(f._wishTimer||0)+dt;
        if(f._wishTimer>=(f.wishCooldown||12)&&!f._wishing){
          f._wishTimer=0; f._wishing=true;
          f.el.classList.add('genie-wishing');
          setTimeout(()=>{f._wishing=false;f.el.classList.remove('genie-wishing');},600);
          const startUnits=f._startUnits||3;
          const roll=Math.random();
          const zone2=getZone(f.lane);
          const flash=(cls)=>{const el=document.createElement('div');el.className=cls;el.style.left=(f.x+14)+'px';el.style.top=(f.y+14)+'px';zone2.appendChild(el);setTimeout(()=>el.remove(),900);};
          const friendlyCount=alive.filter(o=>o.isEnemy===f.isEnemy&&!o.isShade).length;
          if(roll<0.25){
            const revHp=Math.max(10,100-friendlyCount*10);
            const dead=fighters.filter(fd=>!fd.alive&&(fd.isEnemy===f.isEnemy)&&!fd.isShade&&fd.el&&fd.el.parentNode);
            if(dead.length){
              const target=dead[Math.floor(Math.random()*dead.length)];
              const aura=document.createElement('div'); aura.className='genie-aura';
              aura.style.left=(target.x+14)+'px'; aura.style.top=(target.y+14)+'px';
              zone2.appendChild(aura); setTimeout(()=>aura.remove(),850);
              setTimeout(()=>{
                target.alive=true; target.currentHp=Math.max(1,Math.round(target.maxHp*revHp/100));
                target.hpFill.style.width=revHp+'%'; target.el.style.opacity='1';
                zone2.appendChild(target.el);
                addLog((f.isEnemy?'Enemy ':'')+'🧞 Genie REVIVES '+target.name+' at '+revHp+'% HP!','special');
              },400);
            } else {f._wishTimer=0;}
          } else if(roll<0.5){
            const wishDmg=Math.max(5,50-2*friendlyCount);
            const lanes=[groundZone,skyZone];
            for(let ci=0;ci<18;ci++){
              setTimeout(()=>{
                const lz=lanes[ci%2]; if(!lz) return;
                const coin=document.createElement('div'); coin.className='genie-coin';
                coin.textContent='🟣'; coin.style.left=Math.round(Math.random()*640+14)+'px'; coin.style.top='0px';
                lz.appendChild(coin); setTimeout(()=>coin.remove(),750);
              },ci*35);
            }
            setTimeout(()=>{
              alive.filter(o=>o.isEnemy!==f.isEnemy).forEach(t=>dealDmg(f,t,wishDmg));
              addLog((f.isEnemy?'Enemy ':'')+'🧞 Genie rains DESTRUCTION! '+wishDmg+' dmg!','aoe');
            },350);
          } else if(roll<0.75){
            const opp2=alive.filter(o=>o.isEnemy!==f.isEnemy);
            if(opp2.length>1){
              const victim=opp2[Math.floor(Math.random()*opp2.length)];
              const aura2=document.createElement('div'); aura2.className='genie-aura';
              aura2.style.left=(victim.x+14)+'px'; aura2.style.top=(victim.y+14)+'px';
              zone2.appendChild(aura2); setTimeout(()=>aura2.remove(),850);
              setTimeout(()=>{dealDmg(f,victim,victim.currentHp*99);},300);
              addLog((f.isEnemy?'Enemy ':'')+'🧞 Genie BANISHES '+victim.name+'!','aoe');
            }
          }
          // wish 4 (summon) skipped — no unit table available in module context
        }
      }

      // Time wizard spells
      if(f.isTimeWizard){
        f._spellTimer=(f._spellTimer||0)+dt;
        if(f._spellTimer>=(f.spellCooldown||6)&&!f._casting){
          f._spellTimer=0; f._casting=true;
          f.el.classList.add('wizard-casting');
          setTimeout(()=>{f._casting=false;f.el.classList.remove('wizard-casting');},700);
          const roll2=Math.floor(Math.random()*3);
          if(roll2===0){
            fighters.forEach(u=>{if(u.uid!==f.uid&&u.alive){u._timeStopped=true;u._timeStopTimer=3.0;u.el.classList.add('time-frozen');}});
            [groundZone,skyZone].forEach(z=>{
              if(!z) return;
              const tr2=document.createElement('div'); tr2.className='time-stop-ring';
              tr2.style.left=(f.x+14)+'px'; tr2.style.top='40%';
              z.appendChild(tr2); setTimeout(()=>tr2.remove(),750);
            });
            addLog((f.isEnemy?'Enemy ':'')+'⏳ Time Wizard STOPS time! All units frozen 3s!','aoe');
          } else if(roll2===1){
            const savedHp=f._hpHistory&&f._hpHistory.length?f._hpHistory[0]:f.currentHp;
            const prev=f.currentHp;
            f.currentHp=Math.min(f.maxHp,Math.max(1,savedHp));
            f.hpFill.style.width=Math.round(f.currentHp/f.maxHp*100)+'%';
            const rr=document.createElement('div'); rr.className='time-rewind-ring';
            rr.style.left=(f.x+14)+'px'; rr.style.top=(f.y+14)+'px';
            groundZone.appendChild(rr); setTimeout(()=>rr.remove(),850);
            addLog((f.isEnemy?'Enemy ':'')+'⏳ Time Wizard REWINDS! HP '+Math.round(prev)+' → '+Math.round(f.currentHp)+'!','special');
          } else {
            if(!f._accelerated){
              f._accelerated=true; f._accelTimer=3.0;
              f._preAccelSpd=f.spd; f._preAccelAtk=f.atkRate;
              f.spd=Math.min(f.spd*3,600); f.atkRate=Math.max(0.1,f.atkRate/3);
              for(let si=0;si<4;si++){
                const si2=si,fx=f.x,fy=f.y;
                setTimeout(()=>{
                  const st=document.createElement('div'); st.className='time-accel-streak';
                  st.style.left=Math.round(fx+14)+'px'; st.style.top=Math.round(fy+8+si2*5)+'px';
                  st.style.width='60px';
                  groundZone.appendChild(st); setTimeout(()=>st.remove(),380);
                },si2*60);
              }
              addLog((f.isEnemy?'Enemy ':'')+'⏳ Time Wizard ACCELERATES! 3× speed for 3s!','special');
            }
          }
        }
        if(!f._hpHistory) f._hpHistory=[];
        f._hpHistTimer=(f._hpHistTimer||0)+dt;
        if(f._hpHistTimer>=3){f._hpHistTimer=0;f._hpHistory=[f.currentHp,...(f._hpHistory||[])].slice(0,2);}
        alive.filter(u=>u._timeStopped).forEach(u=>{
          u._timeStopTimer=(u._timeStopTimer||0)-dt;
          if(u._timeStopTimer<=0){u._timeStopped=false;u.el.classList.remove('time-frozen');}
        });
        if(f._accelerated){
          f._accelTimer=(f._accelTimer||0)-dt;
          if(f._accelTimer<=0){f._accelerated=false;f.spd=f._preAccelSpd;f.atkRate=f._preAccelAtk;}
        }
      }

      // Eagle dive land lag
      if(f._diveLanded){
        f._diveLandTimer=(f._diveLandTimer||0)-dt;
        if(f._diveLandTimer<=0){f._diveLanded=false;f._retreating=true;f._retreatDist=80;}
      }

      // Eagle retreat
      if(f._retreating){
        const retreatDir=-dir;
        const step=f.spd*dt;
        f.x=Math.max(62,Math.min(zW-62,f.x+retreatDir*step));
        f._retreatDist=(f._retreatDist||80)-step;
        if(f._retreatDist<=0){f._retreating=false;f._eagleDived=false;}
        f.el.style.left=Math.round(f.x)+'px';
        return;
      }

      // ── Main combat ──────────────────────────────────────────────────────
      const opp=alive.filter(o=>isValidTarget(f,o));
      const target=pickTarget(f,opp);
      if(target){
        const dist=Math.abs(target.x-f.x);
        if(dist>f.engageRange){
          // cap step so the unit glides smoothly and doesn't oscillate past the target
          const step=Math.min(f.spd*dt, dist-f.engageRange);
          f.x+=Math.sign(target.x-f.x)*step;
        } else {
          if(f.atkCooldown<=0&&!f._silenced){
            f.atkCooldown=f.atkRate;
            let rawDmg=f.dmg*(0.85+Math.random()*.3);
            // Eagle first-hit double damage
            if(f.eagleDive&&!f._eagleDived&&!f._retreating){
              f._eagleDived=true; rawDmg*=2;
              addLog((f.isEnemy?'Enemy ':'')+'Eagle dives for double damage!','special');
              spawnSpeedLines(f.x,f.y,zone,dir);
              if(!f.groundDiveLag||target.lane!=='ground'){f._retreating=true;f._retreatDist=80;}
            }
            // Stink debuff
            if(f._stinked) rawDmg*=(1-(f._stinkMult||0.3));
            // Lifesteal
            if(f.lifeSteal&&f.alive){
              f.currentHp=Math.min(f.maxHp,f.currentHp+(f.lifeSteal||5));
              f.hpFill.style.width=Math.round(f.currentHp/f.maxHp*100)+'%';
            }
            // Mantis shrimp power strike
            if(f.punchStun&&target){
              f._punchCount=(f._punchCount||0)+1;
              if(f._punchCount>=(f.punchStunEvery||3)){
                f._punchCount=0; rawDmg*=2;
                const kbDir2=target.isEnemy?1:-1;
                target.x=Math.max(62,Math.min(zW-62,target.x+kbDir2*50));
                target.el.style.left=Math.round(target.x)+'px';
                target._stunned=true; target._stunTimer=0.8;
                const pwave=document.createElement('div'); pwave.className='mantis-wave';
                pwave.style.left=(f.x+14)+'px'; pwave.style.top=(f.y+14)+'px';
                zone.appendChild(pwave); setTimeout(()=>pwave.remove(),520);
                addLog((f.isEnemy?'Enemy ':'')+'🦐 Mantis Shrimp POWER STRIKE! 2× dmg + stun!','aoe');
              }
            }
            // Crocodile grab
            if(f.grabLock&&!f._grabbing&&target&&!target._grabbed){
              f._grabbing=true; f._grabTimer=f.grabDur||3;
              f._grabTarget=target; target._grabbed=true; rawDmg*=2;
              addLog((f.isEnemy?'Enemy ':'')+'Crocodile grabs '+target.name+'!','special');
              f.el.classList.add('croc-spinning'); setTimeout(()=>f.el.classList.remove('croc-spinning'),650);
            }
            // AoE attack
            if(f.aoe){
              const rad=f.aoe.radius;
              const cls=f.id==='frostwitch'?'frost-ring':'aoe-ring';
              const aoeZone=target.lane==='air'?skyZone:zone;
              // Golem double-strike
              if(f.golemDoubleStrike){
                const gRef=f,gZone=zone,gRad=f.aoe.radius;
                setTimeout(()=>{
                  if(!gRef.alive) return;
                  const liveOpp=fighters.filter(o=>o.alive&&isValidTarget(gRef,o));
                  const gt2=pickTarget(gRef,liveOpp);
                  if(gt2){
                    liveOpp.filter(o=>Math.hypot(o.x-gt2.x,o.y-gt2.y)<=gRad).forEach(u=>{
                      dealDmg(gRef,u,gRef.dmg*(0.75+Math.random()*.15));
                    });
                    flashAoE(gt2.x,gt2.y,gRad,gZone,'aoe-ring',gRef.isEnemy);
                    addLog((gRef.isEnemy?'Enemy ':'Your ')+'Golem quick-stomps!','aoe');
                  }
                },300);
              }
              // Siege bomb projectile
              if(f.id==='siege'){
                const bomb=document.createElement('div'); bomb.className='siege-bomb'; bomb.textContent='💣';
                const bx=target.x-f.x;
                bomb.style.setProperty('--bx',Math.round(bx/2)+'px');
                bomb.style.setProperty('--by','0px');
                bomb.style.left=Math.round(f.x+14)+'px'; bomb.style.top=Math.round(f.y+6)+'px';
                zone.appendChild(bomb);
                const siegerRef=f, siegerZone=zone, siegerAoeZone=aoeZone;
                const impactTargets=opp.filter(o=>Math.hypot(o.x-target.x,o.y-target.y)<=rad&&(o.lane!=='air'||siegerRef.canHitFlying));
                const iTX=target.x, iTY=target.y;
                setTimeout(()=>{
                  bomb.remove();
                  const boom=document.createElement('div'); boom.className=siegerRef.isEnemy?'enemy-boom-ring':'boom-ring';
                  boom.style.left=Math.round(iTX+14)+'px'; boom.style.top=Math.round(iTY+14)+'px';
                  boom.style.width=(rad*2)+'px'; boom.style.height=(rad*2)+'px';
                  siegerAoeZone.appendChild(boom); setTimeout(()=>boom.remove(),520);
                  impactTargets.forEach(t=>{
                    const d2=Math.hypot(t.x-iTX,t.y-iTY);
                    dealDmg(siegerRef,t,rawDmg*(1-(d2/rad)*0.35));
                  });
                },420);
                return;
              }
              if(f.id!=='siege') flashAoE(target.x,target.y,rad,aoeZone,cls,f.isEnemy);
              let hit=opp.filter(o=>Math.hypot(o.x-target.x,o.y-target.y)<=rad&&(o.lane!=='air'||f.canHitFlying));
              // Jellyfish electric pulse (both lanes)
              if(f.electricPulse){
                const crossAlive=alive.filter(o=>o.isEnemy!==f.isEnemy&&Math.abs(o.x-target.x)<=rad);
                hit=[...new Map([...hit,...crossAlive].map(u=>[u.uid,u])).values()];
                const otherZone=f.lane==='air'?groundZone:skyZone;
                flashAoE(target.x,40,rad*0.7,otherZone,'frost-ring');
              }
              hit.forEach(t=>{
                const d2=Math.hypot(t.x-target.x,t.y-target.y);
                const resist=t.aoeResist||1.0;
                let hitDmg=rawDmg*(1-(d2/rad)*0.35)*resist;
                const shield=alive.filter(a=>a.aoeShield&&a.isEnemy===t.isEnemy&&a.alive&&Math.hypot(a.x-t.x,a.y-t.y)<=70)[0];
                if(shield&&!t.aoeShield){const absorbed=hitDmg*0.4;hitDmg*=0.6;dealDmg(f,shield,absorbed);}
                dealDmg(f,t,hitDmg);
              });
              addLog(f.name+' AoE hits '+hit.length+' unit'+(hit.length!==1?'s':''),'aoe');
            } else if(f.chainLightning&&f.chainLightning>1){
              // Storm drake chain lightning
              const dmg=dealDmg(f,target,rawDmg);
              if(dmg>0) flashHit(target.x,target.y,zone);
              let chainDmg=rawDmg*0.55, lastHit=target;
              const chained=new Set([target.uid]);
              for(let c=1;c<f.chainLightning;c++){
                const next=opp.filter(o=>!chained.has(o.uid)&&o.alive).sort((a,b)=>Math.hypot(a.x-lastHit.x,a.y-lastHit.y)-Math.hypot(b.x-lastHit.x,b.y-lastHit.y))[0];
                if(!next) break;
                chained.add(next.uid);
                dealDmg(f,next,chainDmg);
                flashHit(next.x,next.y,zone);
                const blt=document.createElement('div'); blt.className=f.isEnemy?'enemy-chain-bolt':'chain-bolt';
                const skyH=skyZone?skyZone.offsetHeight:120;
                const srcOffY=lastHit.lane==='air'?0:skyH;
                const tgtOffY=next.lane==='air'?0:skyH;
                const boltDx=next.x-lastHit.x, boltDy=(next.y+tgtOffY)-(lastHit.y+srcOffY);
                const boltLen=Math.hypot(boltDx,boltDy), boltAng=Math.atan2(boltDy,boltDx)*180/Math.PI;
                blt.style.cssText='position:absolute;left:'+(lastHit.x+14)+'px;top:'+(Math.round(lastHit.y+srcOffY+14))+'px;width:'+Math.round(boltLen)+'px;transform:rotate('+Math.round(boltAng)+'deg);z-index:35;';
                (battleInner||zone).appendChild(blt); setTimeout(()=>blt.remove(),350);
                chainDmg*=0.55; lastHit=next;
              }
              addLog((f.isEnemy?'Enemy ':'Your ')+f.name+' chains lightning through '+chained.size+' targets','aoe');
            } else {
              // Single target
              const dmg=dealDmg(f,target,rawDmg);
              if(dmg>0){
                const targetZone=target.lane==='air'?skyZone:zone;
                flashHit(target.x,target.y,targetZone);
              }
              if(f.lumberjackAxe){f.el.classList.add('lumberjack-chopping');setTimeout(()=>f.el.classList.remove('lumberjack-chopping'),280);}
              // Mirror mage
              if(f.mirrorAll&&target&&target.id){
                const mirrors=opp.filter(o=>o.uid!==target.uid&&o.id===target.id&&o.alive);
                mirrors.forEach(m=>{
                  const mDmg=dealDmg(f,m,rawDmg*0.85);
                  if(mDmg>0){
                    const mz=m.lane==='air'?skyZone:zone; flashHit(m.x,m.y,mz);
                    const arc=document.createElement('div'); arc.className='mirror-arc';
                    const dx=m.x-target.x, dy=m.y-target.y;
                    const len=Math.hypot(dx,dy), ang=Math.atan2(dy,dx)*180/Math.PI;
                    arc.style.cssText='left:'+(target.x+14)+'px;top:'+(target.y+14)+'px;width:'+Math.round(len)+'px;transform:rotate('+ang+'deg);';
                    zone.appendChild(arc); setTimeout(()=>arc.remove(),350);
                  }
                });
                if(mirrors.length) addLog((f.isEnemy?'Enemy ':'Your ')+f.name+' mirrors attack!','special');
              }
              addLog((f.isEnemy?'Enemy ':'Your ')+f.name+' hits '+(f.isEnemy?'your ':'enemy ')+target.name+' for '+dmg,f.isEnemy?'bad':'good');
            }
          }
        }
      } else {
        // No targets — march to base
        if(Math.abs(f.x-oppBaseX)>f.baseEngageRange){
          f.x+=dir*f.spd*dt;
        } else {
          if(f.atkCooldown<=0){
            f.atkCooldown=f.atkRate;
            const warlordUp=fighters.some(fw=>fw.alive&&!fw.isEnemy&&fw.id==='warlord');
            let rawDmg=f.dmg*(warlordUp&&!f.isEnemy&&f.lane==='ground'?1.4:1)*(0.85+Math.random()*.3);
            const dmg=Math.round(rawDmg);
            if(f.isEnemy) playerBaseHP=Math.max(0,playerBaseHP-dmg);
            else enemyBaseHP=Math.max(0,enemyBaseHP-dmg);
            addLog((f.isEnemy?'Enemy ':'Your ')+f.name+' attacks the base for '+dmg+'!',f.isEnemy?'bad':'good');
            updateBaseUI();
            const baseEl=f.isEnemy?basePEl:baseEEl;
            if(baseEl){baseEl.classList.add('damage-flash');setTimeout(()=>baseEl.classList.remove('damage-flash'),280);}
          }
        }
      }
      f.x=Math.max(62,Math.min(zW-62,f.x));
    });
  }

  // ── renderTick ────────────────────────────────────────────────────────────
  function renderTick(){
    fighters.forEach(f=>{
      if(!f.alive) return;
      f.el.style.left=Math.round(f.x)+'px';
      f.el.style.top=Math.round(f.y)+'px';
    });
  }

  // ── gameLoop ──────────────────────────────────────────────────────────────
  function gameLoop(ts){
    envUpdate();
    if(lastTs===null) lastTs=ts;
    const rawDt=Math.min((ts-lastTs)/1000,0.1);
    lastTs=ts; accumSec+=rawDt; battleElapsed+=rawDt;
    if(waveInfoEl) waveInfoEl.textContent=Math.max(0,Math.ceil(BATTLE_LIMIT-battleElapsed))+'s remaining';
    while(accumSec>=LOGIC_DT){
      logicTick(LOGIC_DT); accumSec-=LOGIC_DT;
      if(playerBaseHP<=0||enemyBaseHP<=0||battleElapsed>=BATTLE_LIMIT){
        cancelAnimationFrame(rafId); rafId=null;
        setTimeout(()=>finishBattle({playerBaseHp:playerBaseHP,enemyBaseHp:enemyBaseHP}),800);
        return;
      }
    }
    renderTick();
    rafId=requestAnimationFrame(gameLoop);
  }

  // ── finishBattle ──────────────────────────────────────────────────────────
  function finishBattle(extra=null){
    if(finished) return;
    finished=true;
    cancelAnimationFrame(rafId); rafId=null;
    window.removeEventListener('resize',resizeHandler);
    fighters.forEach(f=>{if(f.el&&f.el.parentNode)f.el.parentNode.removeChild(f.el);});
    if(extra?.surrendered){
      if(typeof onSurrender==='function') onSurrender({playerBaseHp:playerBaseHP,enemyBaseHp:enemyBaseHP});
      return;
    }
    if(onComplete) onComplete({playerBaseHp:playerBaseHP,enemyBaseHp:enemyBaseHP});
  }

  // ── spawn units with lane separation + twin support ──────────────────────
  const playerDefs=rawPlayerUnits.flatMap(u=>{
    if(u.twin){return [mkFighterDef(u,false,fighters.length),mkFighterDef(u,false,fighters.length+1)];}
    return [mkFighterDef(u,false,fighters.length)];
  });
  const enemyDefs=rawEnemyUnits.flatMap(u=>{
    if(u.twin){return [mkFighterDef(u,true,fighters.length),mkFighterDef(u,true,fighters.length+1)];}
    return [mkFighterDef(u,true,fighters.length)];
  });

  const byLane=arr=>({ground:arr.filter(u=>u.lane==='ground'||!u.lane),air:arr.filter(u=>u.lane==='air')});
  const pL=byLane(playerDefs), eL=byLane(enemyDefs);
  pL.ground.forEach((u,i)=>fighters.push(spawnFighter(u,false,i,pL.ground.length,false)));
  eL.ground.forEach((u,i)=>fighters.push(spawnFighter(u,true,i,eL.ground.length,false)));
  pL.air.forEach((u,i)=>fighters.push(spawnFighter(u,false,i,pL.air.length,false)));
  eL.air.forEach((u,i)=>fighters.push(spawnFighter(u,true,i,eL.air.length,false)));

  updateBaseUI();
  window.addEventListener('resize',resizeHandler);
  // ResizeObserver fires once the scene is actually in the DOM and has a width
  if(typeof ResizeObserver !== 'undefined'){
    _scaleRo = new ResizeObserver(entries => {
      if(entries[0] && entries[0].contentRect.width > 10) scaleScene();
    });
    _scaleRo.observe(scene);
  }
  // setTimeout fallbacks ensure scaling fires even if ResizeObserver is late
  setTimeout(scaleScene, 50);
  setTimeout(scaleScene, 200);
  addLog('The battle begins — difficulty: '+difficulty+'!','info');
  rafId=requestAnimationFrame(gameLoop);

  container._cleanup=()=>{
    finished=true;
    cancelAnimationFrame(rafId);
    window.removeEventListener('resize',resizeHandler);
    if(_scaleRo){ _scaleRo.disconnect(); _scaleRo=null; }
    fighters.forEach(f=>{if(f.el)f.el.remove();});
  };
  return container;
}
