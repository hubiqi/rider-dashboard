/* 骑手超时绩效看板 v3 — 支持上传数据 / 全维度排序 / 占比 / 骑手明细折线 */
(function(){
  var D = window.DATA || null;   // 页面不再内置数据，仅当离线单文件版注入时才有值
  var $ = function(s){ return document.querySelector(s) };
  var tip = $('#tip');

  /* ================= 状态 ================= */
  var sel = { f1:'all', f2:'all' };      // 标签筛选
  var scope = { day:'__all__', st:'__all__', min:5, q:'', rank:10 };   // rank=超时率前 N%（0=全部）
  var sortKey = 'r', sortDir = -1;       // 默认按「超时率」降序（与排名筛选口径一致）
  var metric = 'rate';
  var view = 'timeout';                  // timeout=超时视图 · quality=质量指标视图
  var scoreMode = 'tx';                  // tx=按占比（默认） · share=团队占比·原式 · rate=自身率值
  var SMODE_LAB = { tx:'按占比（默认）', share:'团队占比·原式', rate:'自身率值' };
  /* 层级放大系数（仅作用于「占比」类口径：tx / share）
     占比的分母是「团队全员合计」→ 同一层级的对象越多，单个对象的占比越小：
       站点层级 = 4 个对象 → 占比 16%~34%，量级正常，直接代入公式即可（amp = 1，站点评分保持不变）
       骑手层级 = 187 个对象 → 人均占比仅 ~0.53%，直接代入公式全场挤在 97~100，没有区分度
     ⇒ 骑手层级占比按 ×100 放大后再代入公式（0.53% → 53%），分数区间才拉得开。 */
  var LEVEL_AMP = { station: 1, rider: 100 };

  /* ================= 指标计算内核 =================
     每组 15 个字段（渲染端约定，见 F）：
       0 有效完单 · 1 T8超时单 · 2 复合超时秒数 · 3 接单量 · 4 完全妥投率分母附加
       5 提前点送达 · 6 高笔T8非准时 · 7 虚假报备出餐慢取消 · 8 虚假改派吸单/规避妥投
       9 虚假改派偷准达 · 10 有效投诉 · 11 有效差评 · 12 有效索赔 · 13 高笔单 · 14 星巴克单 */
  var F = { t:0, o:1, comp:2, acc:3, missAdd:4, early:5, t8hi:6, fakeCan:7,
            fakeGrab:8, fakeT8:9, cmpl:10, bad:11, claim:12, hi:13, star:14 };
  var NF = 15;
  function matchB(b, s){
    var b1 = b>=2?1:0, b2 = b%2;
    if(s.f1!=='all' && (s.f1==='yes') !== (b1===1)) return false;
    if(s.f2!=='all' && (s.f2==='yes') !== (b2===1)) return false;
    return true;
  }
  function newVec(){ var a = new Array(NF); for(var i=0;i<NF;i++) a[i]=0; return a; }
  function cellVec(cell, s, out){
    var stride = Math.round(cell.length/4);          // 兼容旧数据的每组 3 字段
    out = out || newVec();
    for(var b=0;b<4;b++){
      if(!matchB(b,s)) continue;
      for(var k=0;k<stride;k++) out[k] += (cell[b*stride+k] || 0);
    }
    return out;
  }
  function addVec(a, b){ for(var i=0;i<NF;i++) a[i] += b[i]; return a; }
  /* 由 15 字段累加值算出四个考核指标（口径见页面底部「指标口径」） */
  function metricsOf(v){
    var t = v[F.t] || 0, acc = v[F.acc] || 0;
    var missAdd = v[F.missAdd] || 0;
    var missDen = t + missAdd;                                   // 完全妥投率分母
    var t8hi = v[F.t8hi] || 0;
    var t8Den = t + t8hi;                                        // T8 分母（有效完单 + 高笔非准时加权）
    var t8Loss = (v[F.o]||0) + t8hi + (v[F.fakeCan]||0) + (v[F.fakeT8]||0) + (v[F.early]||0)*2;
    var t8Num = t8Den - t8Loss;
    var satW = (v[F.cmpl]||0)*5 + (v[F.bad]||0)*5 + (v[F.claim]||0) + (v[F.fakeCan]||0);
    var comp = v[F.comp] || 0;
    return {
      t:t, o:v[F.o]||0, s:comp, acc:acc, c: t? comp/t : 0, r: t? (v[F.o]||0)/t*100 : 0,
      missAdd:missAdd, missDen:missDen,
      missR: missDen? missAdd/missDen*100 : 0,                   // 不完全妥投率 %
      fullR: missDen? t/missDen*100 : 0,                         // 完全妥投率 %
      t8Loss:t8Loss, t8Den:t8Den, t8Num:t8Num, t8hi:t8hi,
      t8R: t8Den? t8Num/t8Den*100 : 0,                           // 预测T8准时率 %
      t8Late: t8Den? t8Loss/t8Den*100 : 0,                       // T8超时率 %
      satW:satW, satR: acc? satW/acc*100 : 0,                    // 非时效不满意度 %
      avgComp: t? comp/t : 0,
      cmpl:v[F.cmpl]||0, bad:v[F.bad]||0, claim:v[F.claim]||0, early:v[F.early]||0,
      fakeCan:v[F.fakeCan]||0, fakeGrab:v[F.fakeGrab]||0, fakeT8:v[F.fakeT8]||0, hi:v[F.hi]||0,
      _v:v
    };
  }
  /* 四个指标的「团队占比」= 加权分子 ÷ 团队加权分子（加权 = 平台公式系数，见口径说明） */
  function sharesOf(m, T){
    return {
      s1: T && T.missAdd ? m.missAdd/T.missAdd*100 : 0,          // 不完全妥投
      s2: T && T.t8Loss  ? m.t8Loss/T.t8Loss*100 : 0,            // T8超时（加权含高笔/虚假/提前点送达×2）
      s3: T && T.s       ? m.s/T.s*100 : 0,                      // 复合时长
      s4: T && T.satW    ? m.satW/T.satW*100 : 0                 // 非时效不满意（含×5加权）
    };
  }
  /* 综合评价分 = 100 −（0.2×① + 0.3×② + 0.15×③ + 0.2×④）×100
     ①②③④ = 四项指标的「占比（0~1）」，三档口径：
       tx   （默认，「按占比」）= 该对象各项扣分 ÷ 全体同类对象该项扣分之和
                                   （各扣分对所有对象求和后算占比；权重在同级求和时约掉）
       share                  = 该对象加权分子 ÷ 团队加权分子合计（原式占比）
       rate                   = 对象自身率值：不完全妥投率、T8超时率、单均复合÷团队均值、非时效不满意度
     ★ 已废弃的 norm（团队占比 ÷ 团队内最大占比）：分母是「谁的加权问题量最大」，
       而加权问题量 ≈ 单量 × 率值 —— 单量大的对象占比必然接近 1，会被一律打成最差。 */
  function ratioRaw(m, ctx, mode){
    m = m || {}; var T = ctx.T || {}; mode = mode || scoreMode;
    var amp = (ctx.amp == null) ? 1 : ctx.amp;                  // 层级放大系数（见 LEVEL_AMP）
    var cr = T.avgComp ? Math.min(m.avgComp/T.avgComp, 2) : 0;
    if(mode === 'rate') return [m.missR/100, m.t8Late/100, cr, m.satR/100];
    if(mode === 'share'){
      var sh = sharesOf(m, T);
      return [sh.s1/100*amp, sh.s2/100*amp, sh.s3/100*amp, sh.s4/100*amp];
    }
    var S = ctx.S || {};
    return [S.s1 ? (m.missR/100)/S.s1*amp : 0, S.s2 ? (m.t8Late/100)/S.s2*amp : 0,
            S.s3 ? cr/S.s3*amp : 0,            S.s4 ? (m.satR/100)/S.s4*amp : 0];
  }
  /* ★ 占比不可能超过 100%：放大后封顶，避免个别骑手在某项上出现 5286% 这种无意义的「占比」
     （站点占比只有 16%~40%，永远碰不到上限 → 站点评分与团队扣分汇总完全不受影响） */
  function ratioOf(m, ctx, mode){
    var r = ratioRaw(m, ctx, mode);
    if((mode || scoreMode) === 'rate') return r;
    return r.map(function(v){ return v > 1 ? 1 : v });
  }
  /* 四项占比 + 综合分（100 − 四项扣分之和） */
  function scoreOf(m, ctx, mode){
    var r = ratioOf(m, ctx, mode);
    return Math.max(0, Math.min(100, 100 - (0.2*r[0] + 0.3*r[1] + 0.15*r[2] + 0.2*r[3])*100));
  }
  /* 单项扣分（分）= 权重 × 占比 × 100，四项之和 = 100 − 综合分 */
  function deductOf(m, ctx, mode){
    var r = ratioOf(m, ctx, mode);
    return [0.2*r[0]*100, 0.3*r[1]*100, 0.15*r[2]*100, 0.2*r[3]*100];
  }
  /* 计分上下文：团队基准 T（占比分母）· S（各项率值合计）· D（各项扣分合计，供团队汇总）· amp（层级放大）
     ★ 站点与骑手必须各自建上下文：站点是几十人的聚合，率值量级与单个骑手不同 */
  function scoreCtx(s, dts, level){
    var lv = level || 'rider';
    var T = aggScope(s, dts);
    var src = (lv === 'station') ? byStation(s, dts) : byRider(s, dts);
    var S = { s1:0, s2:0, s3:0, s4:0 }, D = { d1:0, d2:0, d3:0, d4:0 }, n = 0;
    src.forEach(function(x){
      if(!(x.t > 0)) return;
      var cr = T.avgComp ? Math.min(x.avgComp/T.avgComp, 2) : 0;
      S.s1 += x.missR/100; S.s2 += x.t8Late/100; S.s3 += cr; S.s4 += x.satR/100;
      D.d1 += 0.2*x.missR/100; D.d2 += 0.3*x.t8Late/100;
      D.d3 += 0.15*cr;         D.d4 += 0.2*x.satR/100;
      n++;
    });
    return { T:T, S:S, D:D, n:n, level: lv, amp: (LEVEL_AMP[lv] || 1) };
  }

  function dayList(){                     // 当前日期范围（单日 → [di]，全周期 → all）
    if(scope.day==='__all__'){ var a=[]; for(var i=0;i<D.grid.length;i++) a.push(i); return a; }
    var di = D.dates.indexOf(scope.day); return di<0? [] : [di];
  }
  function sumVec(s, dts){                // 汇总向量（当前范围）
    var v = newVec();
    (dts||dayList()).forEach(function(di){
      (D.grid[di]||[]).forEach(function(e){ cellVec(e.slice(1), s, v); });
    });
    return v;
  }
  function aggScope(s, dts){              // 汇总（含四指标）
    var v = sumVec(s, dts);
    var m = metricsOf(v); m.vec = v; return m;
  }
  function byRider(s, dts){               // 逐骑手
    var acc = {};
    (dts||dayList()).forEach(function(di){
      (D.grid[di]||[]).forEach(function(e){
        var ri = e[0];
        var a = acc[ri] || (acc[ri] = newVec());
        cellVec(e.slice(1), s, a);
      });
    });
    return Object.keys(acc).map(function(ri){
      var m = metricsOf(acc[ri]), r = D.riders[ri];
      m.ri = +ri; m.n = r.n; m.st = r.st; return m;
    });
  }
  function byStation(s, dts){
    var acc = {};
    (dts||dayList()).forEach(function(di){
      (D.grid[di]||[]).forEach(function(e){
        var st = D.riders[e[0]].st;
        var a = acc[st] || (acc[st] = newVec());
        cellVec(e.slice(1), s, a);
      });
    });
    return Object.keys(acc).map(function(st){
      var m = metricsOf(acc[st]); m.st = st; return m;
    });
  }
  function riderDays(ri, s){              // 单个骑手的逐日序列
    var out = [];
    for(var i=0;i<D.grid.length;i++){
      var cell = null;
      (D.grid[i]||[]).forEach(function(e){ if(e[0]===ri) cell = e.slice(1); });
      if(!cell) continue;
      var m = metricsOf(cellVec(cell, s));
      if(m.t===0) continue;
      m.dt = D.dates[i];
      out.push(m);
    }
    return out;
  }
  function stationDays(st, s){            // 单个站点的逐日序列（整个周期）
    var out = [];
    for(var i=0;i<D.grid.length;i++){
      var v = newVec(), rd = 0;
      (D.grid[i]||[]).forEach(function(e){
        if(D.riders[e[0]].st !== st) return;
        var cell = e.slice(1);
        cellVec(cell, s, v);
        var stride = Math.round(cell.length/4), ct = 0;
        for(var b=0;b<4;b++){ if(matchB(b,s)) ct += (cell[b*stride]||0) }
        if(ct > 0) rd++;                   // 当天有单的骑手数
      });
      if(!v[F.t]) continue;
      var m = metricsOf(v); m.dt = D.dates[i]; m.rd = rd;
      out.push(m);
    }
    return out;
  }
  function stationRiders(st, s){          // 单个站点的骑手列表（整个周期）
    var acc = {};
    for(var i=0;i<D.grid.length;i++){
      (D.grid[i]||[]).forEach(function(e){
        if(D.riders[e[0]].st !== st) return;
        var ri = e[0], a = acc[ri] || (acc[ri] = newVec());
        cellVec(e.slice(1), s, a);
      });
    }
    return Object.keys(acc).map(function(ri){
      var m = metricsOf(acc[ri]), r = D.riders[ri];
      m.ri = +ri; m.n = r.n; m.st = r.st; return m;
    }).filter(function(x){ return x.t > 0 });
  }
  function extremes(days){                // 极值标注用的统计
    if(!days.length) return null;
    var mx = days[0], mn = days[0], tr = 0, to = 0, tt = 0;
    days.forEach(function(d){
      if(d.r > mx.r) mx = d;
      if(d.r < mn.r) mn = d;
      tr += d.r; to += d.o; tt += d.t;
    });
    return { max:mx, min:mn, avg: tr/days.length, totO:to, totT:tt, avgC: tt ? days.reduce(function(a,d){return a+d.s},0)/tt : 0 };
  }
  function statLine(days){                // 图表上方的「整个周期」极值/均值标注
    var e = extremes(days);
    if(!e) return '';
    return '<div class="mstat">整个周期：'+
      '最高 <b style="color:#dc2626">'+pct(e.max.r)+'</b>（'+e.max.dt.slice(5)+'）· '+
      '最低 <b style="color:#059669">'+pct(e.min.r)+'</b>（'+e.min.dt.slice(5)+'）· '+
      '平均 <b>'+pct(e.avg)+'</b> · '+
      '合计 '+e.totT+' 单 / 超时 '+e.totO+' 单 · 单均复合 '+fmt(e.avgC,1)+'s</div>';
  }

  /* ================= 小工具 ================= */
  function fmt(n,d){ return (Math.round(n*Math.pow(10,d||0))/Math.pow(10,d||0)).toFixed(d||0) }
  function pct(v,d){ return fmt(v, d===undefined?2:d)+'%' }
  function delta(cur,prev){ return prev ? (cur-prev)/prev*100 : null }
  function dPill(d, mode){
    if(d===null) return '<span class="pill b">—</span>';
    var up = d>0, cls;
    if(mode==='neutral') cls='muted';
    else if(mode==='down-good') cls = up?'up':'down';
    else cls = up?'down':'up';
    return '<span class="'+cls+'" style="font-weight:700">'+(up?'▲':'▼')+' '+Math.abs(d).toFixed(1)+'%</span>';
  }
  function card(lab, val, unit, foot){
    return '<div class="card"><div class="lab">'+lab+'</div>'+
      '<div class="val">'+val+'<small>'+unit+'</small></div>'+
      '<div class="foot">'+(foot||'')+'</div></div>';
  }
  function selText(av){
    av = av || D.avail || {f1:true, f2:true};
    var a = av.f1 ? (sel.f1==='all'?'二呼单不限':(sel.f1==='yes'?'二呼单=是':'二呼单=否')) : '无二呼单列';
    var b = av.f2 ? (sel.f2==='all'?'出餐慢报备不限':(sel.f2==='yes'?'出餐慢报备=是':'出餐慢报备=否')) : '无慢报备列';
    return a + ' · ' + b;
  }
  function rateColor(r){
    if(r>=10) return '#dc2626'; if(r>=6) return '#ef4444';
    if(r>=3) return '#f59e0b'; if(r>0) return '#10b981'; return '#94a3b8';
  }
  function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }
  function escA(s){ return esc(s).replace(/"/g,'&quot;').replace(/'/g,'&#39;') }

  /* ================= 筛选标签 ================= */
  function renderFilterBar(){
    var av = D.avail || {f1:true, f2:true};
    var f = function(k, lab, on){
      if(!on) return '<div class="tagrow"><span class="taglab">'+lab+'</span>'+
        '<span class="muted" style="font-size:12px">该数据源无此列</span></div>';
      return '<div class="tagrow"><span class="taglab">'+lab+'</span>'+
        [['all','全部'],['yes','是'],['no','否']].map(function(o){
          return '<button class="tag'+(sel[k]===o[0]?' on':'')+'" data-k="'+k+'" data-v="'+o[0]+'">'+o[1]+'</button>';
        }).join('')+'</div>';
    };
    $('#filterBar').innerHTML = f('f1','是否二呼单',av.f1) + f('f2','是否出餐慢',av.f2) +
      '<div class="tagsum">当前筛选：<b>'+selText(av)+'</b></div>';
  }
  $('#filterBar').addEventListener('click', function(e){
    var b = e.target.closest('button.tag'); if(!b) return;
    sel[b.getAttribute('data-k')] = b.getAttribute('data-v');
    renderAll();
  });
  /* ================= 浏览器端 xlsx 解析 ================= */
  function findEOCD(dv, len){
    var min = Math.max(0, len-22-65535);
    for(var i=len-22; i>=min; i--){ if(dv.getUint32(i,true)===0x06054b50) return i; }
    return -1;
  }
  function unzipIndex(buf){
    var dv = new DataView(buf), len = buf.byteLength;
    var e = findEOCD(dv,len);
    if(e<0) throw new Error('不是有效的 xlsx/ZIP 文件');
    var cnt = dv.getUint16(e+10,true), off = dv.getUint32(e+16,true);
    var td = new TextDecoder('utf-8'), files = {}, p = off;
    for(var i=0;i<cnt;i++){
      if(dv.getUint32(p,true)!==0x02014b50) break;
      var method = dv.getUint16(p+10,true);
      var csize  = dv.getUint32(p+20,true);
      var usize  = dv.getUint32(p+24,true);
      var nlen   = dv.getUint16(p+28,true);
      var elen   = dv.getUint16(p+30,true);
      var clen   = dv.getUint16(p+32,true);
      var lho    = dv.getUint32(p+42,true);
      var name   = td.decode(new Uint8Array(buf, p+46, nlen));
      files[name] = { method:method, csize:csize, usize:usize, lho:lho };
      p += 46 + nlen + elen + clen;
    }
    return { buf:buf, files:files };
  }
  function openEntry(z, name){
    var f = z.files[name]; if(!f) return null;
    var dv = new DataView(z.buf);
    if(dv.getUint32(f.lho,true)!==0x04034b50) throw new Error('ZIP 局部头损坏');
    var nlen = dv.getUint16(f.lho+26,true), elen = dv.getUint16(f.lho+28,true);
    var start = f.lho + 30 + nlen + elen;
    var slice = z.buf.slice(start, start + f.csize);
    if(f.method===0) return new Blob([slice]).stream();
    if(f.method===8){
      if(typeof DecompressionStream==='undefined')
        throw new Error('当前浏览器不支持原生解压，无法读取 xlsx');
      return new Blob([slice]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    }
    throw new Error('不支持的压缩方式: '+f.method);
  }
  async function readAll(stream){
    var rd = stream.getReader(), chunks = [], n = 0;
    for(;;){ var r = await rd.read(); if(r.done) break; chunks.push(r.value); n += r.value.length; }
    var out = new Uint8Array(n), o = 0;
    chunks.forEach(function(c){ out.set(c,o); o += c.length; });
    return out;
  }
  function dec(s){
    if(s.indexOf('&')<0) return s;
    return s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'")
      .replace(/&#x([0-9a-fA-F]+);/g,function(m,h){return String.fromCharCode(parseInt(h,16))})
      .replace(/&#(\d+);/g,function(m,d){return String.fromCharCode(+d)})
      .replace(/&amp;/g,'&');
  }
  function colIdx(ref){ var m=/^([A-Z]+)/.exec(ref); if(!m) return -1;
    var n=0; for(var i=0;i<m[1].length;i++) n = n*26 + (m[1].charCodeAt(i)-64); return n-1; }

  var RE_CELL = /<c\b([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g;
  function parseRow(rowXml, shared){
    var cells = {}, m;
    RE_CELL.lastIndex = 0;
    while((m = RE_CELL.exec(rowXml))){
      var attrs = m[1] || '', inner = m[3];
      var rm = /r="([A-Z]+\d+)"/.exec(attrs); if(!rm) continue;
      var ci = colIdx(rm[1]); if(ci<0) continue;
      var tm = /t="([^"]+)"/.exec(attrs), t = tm ? tm[1] : '';
      if(inner===undefined){ cells[ci]=''; continue; }
      if(t==='inlineStr'){
        var it = /<t\b[^>]*>([\s\S]*?)<\/t>/.exec(inner);
        cells[ci] = it ? dec(it[1]) : '';
      } else {
        var v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner);
        if(!v){ cells[ci]=''; continue; }
        var raw = dec(v[1]);
        if(t==='s'){ var si=+raw; cells[ci] = (shared && shared[si]!=null) ? shared[si] : ''; }
        else cells[ci] = raw;
      }
    }
    return cells;
  }
  function findCol(hdr, cands){
    for(var k=0;k<cands.length;k++){
      for(var j=0;j<hdr.length;j++) if(hdr[j]===cands[k]) return j;
      for(var j=0;j<hdr.length;j++) if(hdr[j] && hdr[j].indexOf(cands[k])>=0) return j;
    }
    return -1;
  }
  /* ---- 分层累加计费模型：超时秒数 -> 复合超时时长（秒）----
     ① ≤8min           豁免
     ② 8~15min         1倍   = (t-480)
     ③ 15~30min        1.5倍 = 420 + (t-900)*1.5
     ④ >30min          2倍   = 1770 + (t-1800)*2，总封顶 5400s(90min)
     （④的系数与封顶经 63502 单历史数据反推验证，命中率 100%）      */
  var TIER = { t1:480, t2:900, t3:1800, cap1:420, cap2:1770, capmax:5400 };
  function composite(over){
    if(!isFinite(over) || over <= TIER.t1) return 0;
    if(over <= TIER.t2) return (over - TIER.t1) * 1.0;
    if(over <= TIER.t3) return TIER.cap1 + (over - TIER.t2) * 1.5;
    return Math.min(TIER.cap2 + (over - TIER.t3) * 2.0, TIER.capmax);
  }
  // 'HH:MM:SS' / 'HH:MM' -> 秒
  function durToSec(v){
    if(v==null) return NaN;
    v = String(v).trim();
    if(!v || v==='-') return NaN;
    var m = /^(\d+):([0-5]\d):([0-5]\d)/.exec(v);
    if(m) return (+m[1])*3600 + (+m[2])*60 + (+m[3]);
    m = /^(\d+):([0-5]\d)$/.exec(v);
    if(m) return (+m[1])*60 + (+m[2]);
    var f = parseFloat(v); return isFinite(f) ? f : NaN;
  }
  // 从「2026-09-12 15:41:28」这类时间串里取日期
  function dateOf(v){
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v||'').trim());
    return m ? m[0] : '';
  }
  // 出餐慢报备：异常报备项里含「出货慢 / 出餐慢」
  function slowReport(v){
    v = String(v||'');
    return v.indexOf('出货慢')>=0 || v.indexOf('出餐慢')>=0;
  }
  function normDate(v){
    v = String(v).trim();
    if(/^\d{8}$/.test(v)) return v.slice(0,4)+'-'+v.slice(4,6)+'-'+v.slice(6);
    if(/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0,10);
    var d = new Date(v); if(!isNaN(d)) return d.toISOString().slice(0,10);
    return v;
  }
  function truthy(v){ v=String(v).trim().toLowerCase(); return v==='是'||v==='1'||v==='true'||v==='y'; }
  /* 有效差评判定：考核明细 =「是否差评单」；运单明细 =「用户评价等级」为吐槽/差评 */
  function badEval(v){
    v = String(v==null?'':v).trim();
    if(!v) return false;
    if(truthy(v)) return true;
    return v.indexOf('差评')>=0 || v.indexOf('吐槽')>=0 || v.indexOf('不满意')>=0;
  }

  async function parseXlsx(file, onProgress){
    var buf = await file.arrayBuffer();
    var z = unzipIndex(buf);
    // 选最大的 worksheet
    var sheets = Object.keys(z.files).filter(function(n){ return /^xl\/worksheets\/.*\.xml$/.test(n) });
    if(!sheets.length) throw new Error('压缩包内未找到工作表');
    sheets.sort(function(a,b){ return (z.files[b].usize||0)-(z.files[a].usize||0) });
    var sheetName = sheets[0];
    // sharedStrings（可选）
    var shared = null;
    if(z.files['xl/sharedStrings.xml']){
      var ssTxt = new TextDecoder('utf-8').decode(await readAll(openEntry(z,'xl/sharedStrings.xml')));
      shared = [];
      ssTxt.replace(/<si>([\s\S]*?)<\/si>/g, function(_,g){
        var parts = []; g.replace(/<t\b[^>]*>([\s\S]*?)<\/t>/g, function(_,x){ parts.push(dec(x)); return ''; });
        shared.push(parts.join('')); return '';
      });
    }
    // 流式读行
    var rd = openEntry(z, sheetName).getReader();
    var td = new TextDecoder('utf-8');
    var s = { buf:'', hdr:null, idx:null, rows:0, dates:{}, riders:{}, order:[], grid:{},
              skip:{ nofault:0, fault:0, undeliv:0, other:0 }, exclRows:[] };
    function handleRow(xml){
      var cells = parseRow(xml, shared);
      if(!s.hdr){
        var mx = -1; for(var k in cells) mx = Math.max(mx, +k);
        var hdr = []; for(var i=0;i<=mx;i++) hdr[i] = cells[i]!=null ? String(cells[i]).trim() : '';
        s.hdr = hdr;
        s.idx = {
          date: findCol(hdr,['日期']),
          rid:  findCol(hdr,['骑手id','骑手ID','骑手编号']),
          name: findCol(hdr,['骑手姓名','骑手名称']),
          st:   findCol(hdr,['站点名称']),
          // —— 超时判定：新格式优先（超平台期望送达时长>=480s）——
          overDur: findCol(hdr,['超平台期望送达时长']),
          overSec: findCol(hdr,['超时时长（秒）','超时时长(秒)','超时时长']),
          onTime:  findCol(hdr,['是否准时单（考核）','是否准时单(考核)']),
          comp:    findCol(hdr,['复合超时时长（秒）','复合超时时长']),
          expectT: findCol(hdr,['平台期望时间']),
          cancelT: findCol(hdr,['运单取消时间']),
          deliverT: findCol(hdr,['骑手送达时间']),
          finishT:  findCol(hdr,['运单完成时间']),
          status:  findCol(hdr,['运单状态']),
          toudou:  findCol(hdr,['是否妥投单']),
          resp:    findCol(hdr,['取消责任方']),
          cancelFault: findCol(hdr,['是否物流责取消单']),
          report:  findCol(hdr,['异常报备项']),
          f1:   findCol(hdr,['是否二呼单']),
          f2:   findCol(hdr,['是否出餐慢报备']),
          // —— 四指标相关列（两种格式自动识别）——
          hi:      findCol(hdr,['是否高笔单']),
          cmpl:    findCol(hdr,['是否投诉单','用户投诉是否成立']),
          bad:     findCol(hdr,['是否差评单','用户评价等级']),
          claim:   findCol(hdr,['是否索赔单','索赔是否成立']),
          early:   findCol(hdr,['是否提前点送达不满意单','违规送达是否成立']),
          fakeCan: findCol(hdr,['是否虚假报备出餐慢取消单']),
          fakeRep: findCol(hdr,['虚假报备是否成立']),
          fakeItem:findCol(hdr,['虚假报备项']),
          fakeGrab: findCol(hdr,['是否虚假改派吸单']),
          fakeGrab2:findCol(hdr,['是否虚假改派规避妥投单']),
          fakeGrab3:findCol(hdr,['是否虚假改派偷准达']),
          brand:   findCol(hdr,['平台商家名称','商家名称'])
        };
        var miss = [];
        if(s.idx.rid<0) miss.push('骑手id');
        if(s.idx.date<0 && s.idx.expectT<0) miss.push('日期 或 平台期望时间');
        if(s.idx.overDur<0 && s.idx.overSec<0 && s.idx.onTime<0)
          miss.push('超平台期望送达时长 / 超时时长（秒） / 是否准时单（考核）');
        if(s.idx.comp<0 && s.idx.overDur<0 && s.idx.overSec<0)
          miss.push('复合超时时长（秒） 或 超时秒数（用于分层计费）');
        if(miss.length) throw new Error('缺少必需列：'+miss.join('、'));
        if(s.idx.status<0 && s.idx.toudou<0)
          setStatus('⚠️ 未找到「运单状态」/「是否妥投单」列，<b>无法剔除取消与未送达单</b>，单量口径可能偏大', true);
        s.fmt = s.idx.overDur>=0 ? '超平台期望送达时长≥480s'
              : (s.idx.overSec>=0 ? '超时秒数≥480s' : '考核口径（是否准时单）');
        s.fmt += ' · 日期=运单终态日 · 已剔除取消/未妥投';
        // 文件级口径：只要含时长列，全表按 ≥480s 判定（空值按 0 计），不再逐行回退
        s.useDur = (s.idx.overDur>=0 || s.idx.overSec>=0);
        return;
      }
      // —— 取超时秒数：新格式直接从时长字段解析 ——
      var overS = NaN;
      if(s.idx.overDur>=0) overS = durToSec(cells[s.idx.overDur]);
      else if(s.idx.overSec>=0) overS = parseFloat(cells[s.idx.overSec]);
      var rid = cells[s.idx.rid]; if(rid==null || rid==='') return;
      // —— 日期：优先独立「日期」列；否则取「运单终态日」= 送达 → 完成 → 期望 → 取消 ——
      var dv = s.idx.date>=0 ? cells[s.idx.date] : '';
      if(dv==null || dv==='') dv = dateOf(cells[s.idx.deliverT]);
      if(dv==null || dv==='') dv = dateOf(cells[s.idx.finishT]);
      if(dv==null || dv==='') dv = dateOf(cells[s.idx.expectT]);
      if(dv==null || dv==='') dv = dateOf(cells[s.idx.cancelT]);
      if(dv==null || dv==='') return;
      var d = normDate(dv);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
      var ri = s.riders[rid];
      if(ri===undefined){
        ri = s.order.length;
        s.riders[rid] = ri;
        s.order.push({ n: s.idx.name>=0 ? (cells[s.idx.name]||'未知') : ('骑手'+rid),
                       st: s.idx.st>=0 ? (cells[s.idx.st]||'未知站点') : '未知站点', rid: rid });
      }
      // —— 标签：二呼单 / 出餐慢（影响分组桶）——
      var f1 = s.idx.f1>=0 && truthy(cells[s.idx.f1]);
      var f2 = s.idx.f2>=0 ? truthy(cells[s.idx.f2])
                           : (s.idx.report>=0 && slowReport(cells[s.idx.report]));
      var b = (f1?2:0) + (f2?1:0);
      // —— 四指标取值（缺失列一律按 0）——
      var hi = s.idx.hi>=0 && truthy(cells[s.idx.hi]);
      var star = s.idx.brand>=0 && String(cells[s.idx.brand]||'').indexOf('星巴克')>=0;
      var early = s.idx.early>=0 && truthy(cells[s.idx.early]);
      var cmpl = s.idx.cmpl>=0 && truthy(cells[s.idx.cmpl]);
      var bad = s.idx.bad>=0 && badEval(cells[s.idx.bad]);
      var claim = s.idx.claim>=0 && truthy(cells[s.idx.claim]);
      var fakeCan = false;
      if(s.idx.fakeCan>=0) fakeCan = truthy(cells[s.idx.fakeCan]);
      else if(s.idx.fakeRep>=0 && truthy(cells[s.idx.fakeRep]))
        fakeCan = s.idx.fakeItem<0 ? true : slowReport(cells[s.idx.fakeItem]);
      var fakeGrab = (s.idx.fakeGrab>=0 && truthy(cells[s.idx.fakeGrab])) ||
                     (s.idx.fakeGrab2>=0 && truthy(cells[s.idx.fakeGrab2]));
      var fakeT8 = s.idx.fakeGrab3>=0 && truthy(cells[s.idx.fakeGrab3]);
      // —— 口径：剔除「取消单 / 未妥投单」不计入单量（仍计入接单量与加权未完成）——
      var kept = true, kind = '', fault = false;
      if(s.idx.status>=0){                        // 新格式：运单状态
        if(String(cells[s.idx.status]||'').trim() !== '配送成功'){
          kept = false;
          var rsp = s.idx.resp>=0 ? String(cells[s.idx.resp]||'').trim() : '';
          if(rsp==='用户责' || rsp==='商户责'){ s.skip.nofault++; kind='nofault'; }  // 无责取消
          else if(rsp.indexOf('物流责')>=0){   s.skip.fault++;   kind='fault'; fault=true; }
          else {                               s.skip.undeliv++; kind='undeliv'; } // 在途未送达
        }
      }else if(s.idx.toudou>=0){                  // 旧格式：是否妥投单
        if(!truthy(cells[s.idx.toudou])){
          kept = false;
          fault = s.idx.cancelFault>=0 && truthy(cells[s.idx.cancelFault]);
          if(fault){ s.skip.fault++; kind='fault'; } else { s.skip.other++; kind='other'; }
        }
      }
      // —— 组装本行增量 ——
      var add = new Array(NF); for(var z=0;z<NF;z++) add[z]=0;
      add[F.acc] = 1;                             // 接单量（含未妥投）
      if(kept){
        add[F.t] = 1;
        var isTo, compV;
        if(s.useDur){                             // 含时长列 → 统一 ≥480s 口径
          var ov = isFinite(overS) ? overS : 0;   // 空值按 0 计（不视作超时）
          isTo = ov >= 480; compV = composite(ov);
        }else{                                    // 仅考核口径的文件
          isTo = s.idx.onTime>=0 && !truthy(cells[s.idx.onTime]);
          compV = s.idx.comp>=0 ? (parseFloat(cells[s.idx.comp])||0) : 0;
        }
        if(isTo){ add[F.o] = 1; if(hi) add[F.t8hi] = 1; }
        add[F.comp] = compV;
        if(hi) add[F.hi] = 1;
        if(star) add[F.star] = 1;
        add[F.missAdd] = early*2 + fakeCan + fakeGrab;   // 完全妥投率分母附加
      }else{
        add[F.missAdd] = (fault?1:0) + (fault&&hi?1:0) + (fault&&star?2:0) + fakeCan + fakeGrab;
        // 口径：物流责未完成单×1（含高笔/星巴克）＋高笔单物流责未完成单×1（合计 2）＋星巴克物流责未完成单×2（合计 3）
        s.exclRows.push([ (s.idx.st>=0? (cells[s.idx.st]||'未知站点'):'未知站点'),
                          (s.idx.name>=0? (cells[s.idx.name]||'未知'):'未知'),
                          rid, kind,
                          (s.idx.cancelT>=0? dateOf(cells[s.idx.cancelT]):'') || d ]);
      }
      if(early) add[F.early] = 1;
      if(fakeCan) add[F.fakeCan] = 1;
      if(fakeGrab) add[F.fakeGrab] = 1;
      if(fakeT8) add[F.fakeT8] = 1;
      if(cmpl) add[F.cmpl] = 1;
      if(bad) add[F.bad] = 1;
      if(claim) add[F.claim] = 1;
      var g = s.grid[d] || (s.grid[d] = {});
      var cell = g[ri];
      if(!cell){ cell = g[ri] = new Array(NF*4); for(var z2=0;z2<NF*4;z2++) cell[z2]=0; }
      var base = b*NF;
      for(var z3=0;z3<NF;z3++) cell[base+z3] += add[z3];
      if(kept) s.rows++;
      if(s.rows % 5000 === 0 && onProgress) onProgress(s.rows);
    }
    for(;;){
      var r = await rd.read();
      if(r.done) break;
      s.buf += td.decode(r.value, {stream:true});
      for(;;){
        var st = /<row\b[^>]*(\/?)>/.exec(s.buf);
        if(!st){ // 缓冲区里没有完整行标签：保留可能是半个标签的尾巴
          var lt = s.buf.lastIndexOf('<');
          s.buf = lt>=0 ? s.buf.slice(lt) : '';
          break;
        }
        if(st[1]==='/'){ s.buf = s.buf.slice(st.index+st[0].length); continue; }
        var end = s.buf.indexOf('</row>', st.index);
        if(end<0){ if(st.index>0) s.buf = s.buf.slice(st.index); break; }
        var xml = s.buf.slice(st.index, end+6);
        s.buf = s.buf.slice(end+6);
        handleRow(xml);
      }
    }
    if(s.buf){ var last = /<row\b[^>]*>[\s\S]*/.exec(s.buf); if(last) handleRow(last[0]); }
    // 组装
    var dates = Object.keys(s.grid).sort();
    var dstr = dates.map(normDate);
    var grid = dates.map(function(d){
      return Object.keys(s.grid[d]).map(function(ri){ return [+ri].concat(s.grid[d][ri]); });
    });
    var to = 0, comp = 0, accN = 0;
    grid.forEach(function(g){ g.forEach(function(e){
      for(var b=0;b<4;b++){ to += e[1+b*NF+F.o]; comp += e[1+b*NF+F.comp]; accN += e[1+b*NF+F.acc]; }
    })});
    return {
      v: 7, nf: NF,
      dates: dstr, last: dstr[dstr.length-1], riders: s.order, grid: grid,
      excl: buildExcl(s.exclRows),
      flags: [{key:'f1',label:'是否二呼单'},{key:'f2',label:'是否出餐慢报备'}],
      avail: { f1: s.idx.f1>=0, f2: (s.idx.f2>=0 || s.idx.report>=0),
               miss: true, t8: true, comp: true,
               sat: (s.idx.cmpl>=0 && s.idx.bad>=0 && s.idx.claim>=0),
               early: s.idx.early>=0, brand: s.idx.brand>=0 },
      fmt: s.fmt,
      meta: { total: s.rows, acc: accN, to: to, comp: Math.round(comp), src: file.name, excl: s.skip }
    };
  }
  /* ================= 概览 ================= */
  function renderKPI(){
    var dts = dayList();
    var O = aggScope(sel, dts);
    var lastDi = D.dates.length-1;
    var L = aggScope(sel, [lastDi]), P = aggScope(sel, [lastDi-1]);

    $('#heroBadge').textContent = '昨日超时率 '+pct(L.r)+' ｜ 单均复合 '+fmt(L.c,1)+' 秒';
    $('#lastTag').textContent = '（'+D.last+'）· '+selText();

    $('#kpiLast').innerHTML =
      card('昨日单量', L.t, '单', '较前一日 '+dPill(delta(L.t,P.t),'neutral')) +
      card('昨日超时率', pct(L.r), '', '较前一日 '+dPill(delta(L.r,P.r),'down-good')) +
      card('昨日超时单', L.o, '单', '占单量 '+pct(L.t? L.o/L.t*100:0)) +
      card('昨日单均复合', fmt(L.c,1), '秒', '较前一日 '+dPill(delta(L.c,P.c),'down-good'));

    var byD = dts.map(function(i){ return { dt:D.dates[i], a:aggScope(sel,[i]) } });
    var rs = byD.map(function(x){ return x.a.r });
    var mx = Math.max.apply(null, rs), mn = Math.min.apply(null, rs);
    var mxD = '', mnD = '';
    byD.forEach(function(x){ if(x.a.r===mx) mxD = x.dt; if(x.a.r===mn) mnD = x.dt });
    $('#kpiAll').innerHTML =
      card('累计单量', O.t, '单', '日均 '+Math.round(O.t/dts.length)+' 单') +
      card('整体超时率', pct(O.r), '', '超时单 '+O.o+' 单') +
      card('整体单均复合', fmt(O.c,1), '秒', '复合超时合计 '+Math.round(O.s)+' 秒') +
      card('波动区间', fmt(mn,2)+'~'+fmt(mx,2), '%', '最低 '+mnD.slice(5)+' ｜ 最高 '+mxD.slice(5));
    return byD;
  }

  /* ================= 趋势 ================= */
  var META = {
    rate:{key:'r', lab:'超时率', unit:'%', color:'#2563eb', dec:2},
    miss:{key:'missR', lab:'不完全妥投率', unit:'%', color:'#dc2626', dec:2},
    full:{key:'fullR', lab:'完全妥投率', unit:'%', color:'#059669', dec:2},
    t8:{key:'t8R', lab:'预测T8准时率', unit:'%', color:'#0891b2', dec:2},
    t8l:{key:'t8Late', lab:'T8超时率', unit:'%', color:'#be185d', dec:2},
    sat:{key:'satR', lab:'非时效不满意度', unit:'%', color:'#d97706', dec:2},
    comp:{key:'c', lab:'单均复合', unit:'秒', color:'#7c3aed', dec:1},
    tot:{key:'t', lab:'单量', unit:'单', color:'#0ea5e9', dec:0}
  };
  var LASTBYD = null;
  function drawTrend(byD){
    var m = META[metric], k = m.key;
    var data = byD.map(function(x){
      var a = x.a; return { dt:x.dt, r:a.r, c:a.c, t:a.t, o:a.o, missR:a.missR, fullR:a.fullR,
                            t8R:a.t8R, t8Late:a.t8Late, satR:a.satR };
    });
    var W=760,H=420, pl=48, pr=14, pt=34, pb=50;
    var iw=W-pl-pr, ih=H-pt-pb;
    var vals = data.map(function(x){ return x[k] });
    var mx = Math.max.apply(null, vals)*1.18 || 1;
    var n = data.length, bw = iw/n*0.56, gap = iw/n, color = m.color;
    var s = '<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="xMidYMid meet">';
    for(var g=0; g<=4; g++){
      var y = pt + ih*g/4, gv = mx*(4-g)/4;
      s += '<line x1="'+pl+'" y1="'+y+'" x2="'+(W-pr)+'" y2="'+y+'" stroke="#eef1f6" stroke-width="1"/>';
      s += '<text x="'+(pl-8)+'" y="'+(y+4)+'" text-anchor="end" font-size="12" fill="#98a2b3">'+gv.toFixed(m.dec>0?1:0)+'</text>';
    }
    var avg = vals.reduce(function(a,b){ return a+b },0)/n;
    s += '<line x1="'+pl+'" y1="'+(pt+ih-(avg/mx)*ih)+'" x2="'+(W-pr)+'" y2="'+(pt+ih-(avg/mx)*ih)+'" stroke="#f59e0b" stroke-width="1.4" stroke-dasharray="5 4"/>';
    data.forEach(function(x,i){
      var v = x[k], h = (v/mx)*ih, cx = pl + gap*i + gap/2, y = pt + ih - h;
      var isLast = x.dt===D.last;
      s += '<rect class="bar-r" data-i="'+i+'" x="'+(cx-bw/2)+'" y="'+y+'" width="'+bw+'" height="'+Math.max(h,1)+'" rx="5" fill="'+color+'" opacity="'+(isLast?1:0.42)+'"/>'+
        '<text x="'+cx+'" y="'+(y-8)+'" text-anchor="middle" font-size="13" font-weight="700" fill="'+(isLast?'#101828':'#475467')+'">'+v.toFixed(m.dec)+'</text>'+
        '<text x="'+cx+'" y="'+(H-pb+20)+'" text-anchor="middle" font-size="12" fill="'+(isLast?'#101828':'#98a2b3')+'" font-weight="'+(isLast?'700':'400')+'">'+x.dt.slice(5)+'</text>';
    });
    s += '<text x="'+(pl-8)+'" y="'+(pt-10)+'" text-anchor="end" font-size="12" fill="#98a2b3">'+m.unit+'</text></svg>';
    $('#trendChart').innerHTML = s;
    $('#trendLegend').innerHTML =
      '<span><i style="background:'+color+'"></i>'+m.lab+'</span>'+
      '<span><i style="background:#f59e0b"></i>周期均值 '+avg.toFixed(m.dec)+' '+m.unit+'</span>'+
      '<span>高亮柱 = 最新 '+D.last.slice(5)+'</span>';
    document.querySelectorAll('.bar-r').forEach(function(b){
      var i = +b.getAttribute('data-i'), x = data[i];
      function show(e){
        var p = e.touches? e.touches[0] : e;
        tip.innerHTML = x.dt+' ｜ '+m.lab+' <b>'+fmt(x[k],m.dec)+m.unit+'</b> ｜ 单量 '+x.t;
        tip.style.left = p.clientX+'px'; tip.style.top = p.clientY+'px'; tip.style.opacity = 1;
      }
      b.addEventListener('mouseenter', show); b.addEventListener('mousemove', show);
      b.addEventListener('mouseleave', function(){ tip.style.opacity=0 });
      b.addEventListener('touchstart', show, {passive:true});
      b.addEventListener('touchend', function(){ tip.style.opacity=0 });
    });
    var rows = data.map(function(x,i){
      var p = i>0 ? data[i-1] : null;
      var dR = p ? (x.r-p.r) : null, dC = p ? (x.c-p.c) : null;
      return '<tr'+(x.dt===D.last?' style="background:#f5f8ff"':'')+'>'+
        '<td style="font-weight:'+(x.dt===D.last?'700':'400')+'">'+x.dt+(x.dt===D.last?' <span class="pill b">最新</span>':'')+'</td>'+
        '<td class="num">'+x.t+'</td><td class="num">'+x.o+'</td>'+
        '<td class="num" style="font-weight:600">'+pct(x.r)+'</td>'+
        '<td class="num">'+(dR===null?'—':(dR>0?'<span class="up">+':'<span class="down">')+fmt(dR,2)+'</span>')+'</td>'+
        '<td class="num">'+fmt(x.c,1)+'</td>'+
        '<td class="num">'+(dC===null?'—':(dC>0?'<span class="up">+':'<span class="down">')+fmt(dC,1)+'</span>')+'</td></tr>';
    }).join('');
    $('#trendTable').innerHTML =
      '<div style="overflow-x:auto"><table><thead><tr><th>日期</th><th class="num">单量</th><th class="num">超时单</th>'+
      '<th class="num">超时率</th><th class="num">环比</th><th class="num">单均复合</th><th class="num">环比</th></tr></thead>'+
      '<tbody>'+rows+'</tbody></table></div>';
  }
  $('#metricSeg').addEventListener('click', function(e){
    var b = e.target.closest('button'); if(!b) return;
    metric = b.getAttribute('data-m');
    this.querySelectorAll('button').forEach(function(x){ x.classList.remove('on') });
    b.classList.add('on'); drawTrend(LASTBYD);
  });
  /* 表格视图切换：超时视图 / 质量指标视图 */
  function syncSortSeg(){
    var seg = $('#sortSeg'); if(!seg) return;
    seg.querySelectorAll('button').forEach(function(b){
      b.classList.toggle('on', b.getAttribute('data-s')===sortKey);
    });
  }
  if($('#viewSeg')) $('#viewSeg').addEventListener('click', function(e){
    var b = e.target.closest('button'); if(!b) return;
    view = b.getAttribute('data-v');
    this.querySelectorAll('button').forEach(function(x){ x.classList.remove('on') });
    b.classList.add('on');
    sortKey = view==='quality' ? 'score' : 'r'; sortDir = -1;
    syncSortSeg(); renderTable();
  });
  /* 综合评价分口径切换 */
  if($('#scoreSeg')) $('#scoreSeg').addEventListener('click', function(e){
    var b = e.target.closest('button'); if(!b) return;
    scoreMode = b.getAttribute('data-s');
    renderScore(); renderStations(); renderTable();
  });
  /* 综合评价分榜里的骑手行也能点开明细 */
  if($('#scoreRiders')) $('#scoreRiders').addEventListener('click', function(e){
    var tr = e.target.closest('tr.rrow'); if(!tr) return;
    openRider(+tr.getAttribute('data-ri'));
  });
  /* 四指标卡 / 综合评价分的口径切换按钮（若存在） */
  if($('#mViewSeg')) $('#mViewSeg').addEventListener('click', function(e){
    var b = e.target.closest('button'); if(!b) return;
    view = b.getAttribute('data-v');
    this.querySelectorAll('button').forEach(function(x){ x.classList.remove('on') });
    b.classList.add('on');
    sortKey = view==='quality' ? 'score' : 'r'; sortDir = -1;
    syncSortSeg(); renderTable();
    var el = document.getElementById('riderRank');
    if(el) el.scrollIntoView({behavior:'smooth', block:'start'});
  });

  /* ================= 质量四指标 + 综合评价分 ================= */
  function mcard(lab, val, unit, l1, l2, color){
    return '<div class="card"><div class="lab">'+lab+'</div>'+
      '<div class="val" style="color:'+color+'">'+val+'<small>'+unit+'</small></div>'+
      '<div class="foot">'+l1+'</div><div class="foot">'+l2+'</div></div>';
  }
  function renderMetrics(byD){
    var dts = dayList();
    var T = aggScope(sel, dts);
    var hh = function(s){ return s>=3600 ? (s/3600).toFixed(1)+' 小时' : Math.round(s)+' 秒' };
    var av = D.avail || {};
    var warn = '';
    if(D.legacy) warn = '<div class="note" style="color:#b45309">⚠️ 当前数据是本机缓存的<b>旧版数据</b>（不含四指标字段），下方四指标恒为 0 或不完整，'+
      '请点上方「⬆ 载入数据」重新上传 xlsx（考核明细或运单明细均可）。</div>';
    else if(av.sat === false) warn = '<div class="note" style="color:#b45309">⚠️ 该数据源缺少「投诉 / 差评 / 索赔」列，④ 非时效不满意度按 0 计（该指标不可用）。</div>';
    $('#mKpi').innerHTML =
      mcard('① 完全妥投率', pct(T.fullR), '', '加权未完成单 <b>'+Math.round(T.missAdd)+'</b>',
            '不完全妥投率 <b style="color:#dc2626">'+pct(T.missR)+'</b>', '#059669') +
      mcard('② 预测T8准时率', pct(T.t8R), '', '加权超时单 <b>'+Math.round(T.t8Loss)+'</b>'+
            '（含高笔 '+Math.round(T.t8hi)+' · 提前点送达 '+Math.round(T.early)+'）',
            'T8超时率 <b style="color:#be185d">'+pct(T.t8Late)+'</b>', '#0891b2') +
      mcard('③ 单均复合超时时长', fmt(T.avgComp,1), 's', '复合合计 <b>'+hh(T.s)+'</b>',
            '有效完单 <b>'+T.t+'</b> 单', '#7c3aed') +
      mcard('④ 非时效不满意度', pct(T.satR), '', '加权单 <b>'+Math.round(T.satW)+'</b>'+
            '（投诉 '+T.cmpl+' ×5 · 差评 '+T.bad+' ×5 · 索赔 '+T.claim+' · 虚假报备 '+T.fakeCan+'）',
            '接单 <b>'+T.acc+'</b> 单', '#d97706');
    if($('#mWarn')) $('#mWarn').innerHTML = warn;

    // 四指标逐日明细
    $('#mTrendTable').innerHTML = byD && byD.length ?
      '<div style="overflow-x:auto"><table><thead><tr><th>日期</th><th class="num">单量</th>'+
      '<th class="num">完全妥投率</th><th class="num">不完全妥投率</th><th class="num">加权未完成</th>'+
      '<th class="num">T8准时率</th><th class="num">T8超时率</th><th class="num">加权超时</th>'+
      '<th class="num">单均复合</th><th class="num">非时效不满意度</th><th class="num">加权单</th></tr></thead><tbody>'+
      byD.map(function(x){
        var a = x.a;
        return '<tr'+(x.dt===D.last?' style="background:#f5f8ff"':'')+'>'+
          '<td style="font-weight:'+(x.dt===D.last?'700':'400')+'">'+x.dt+'</td>'+
          '<td class="num">'+a.t+'</td>'+
          '<td class="num" style="color:#059669;font-weight:600">'+pct(a.fullR)+'</td>'+
          '<td class="num" style="color:#dc2626">'+pct(a.missR)+'</td><td class="num">'+Math.round(a.missAdd)+'</td>'+
          '<td class="num" style="color:#0891b2;font-weight:600">'+pct(a.t8R)+'</td>'+
          '<td class="num" style="color:#be185d">'+pct(a.t8Late)+'</td><td class="num">'+Math.round(a.t8Loss)+'</td>'+
          '<td class="num">'+fmt(a.avgComp,1)+'s</td>'+
          '<td class="num" style="color:#d97706;font-weight:600">'+pct(a.satR)+'</td>'+
          '<td class="num">'+Math.round(a.satW)+'</td></tr>';
      }).join('')+'</tbody></table></div>' : '<div class="empty">当前筛选下无数据</div>';
  }
  /* 四项占比（0~1，已含层级放大）与口径标签 —— 用于扣分拆解提示。
     raw1..raw4 = 放大前的原始占比（提示里两个都显示，便于核对） */
  function ampsOf(m, ctx, mode){
    var md = mode || scoreMode;
    var r = ratioOf(m, ctx, md);
    var raw = ratioRaw(m, ctx, md);
    var amp = (ctx && ctx.amp) ? ctx.amp : 1;
    var lab = md==='rate' ? ['不完全妥投率','T8超时率','单均复合÷团队均值','非时效不满意度']
            : md==='tx'   ? ['妥投扣分占比','T8扣分占比','复合扣分占比','非时效扣分占比']
            :               ['妥投团队占比','T8团队占比','复合团队占比','非时效团队占比'];
    return { r1:r[0], r2:r[1], r3:r[2], r4:r[3],
             raw1:raw[0]/amp, raw2:raw[1]/amp, raw3:raw[2]/amp, raw4:raw[3]/amp,
             pre1:raw[0], pre2:raw[1], pre3:raw[2], pre4:raw[3], amp:amp, lab:lab };
  }
  function scoreBar(x, ctx, i, showName){
    var sc = x._sc, col = sc>=90 ? '#059669' : (sc>=80 ? '#f59e0b' : '#dc2626');
    var a = ampsOf(x, ctx);
    var d = [0.2*a.r1, 0.3*a.r2, 0.15*a.r3, 0.2*a.r4];
    var amps = a.amp !== 1;
    var line = function(k, lab, raw, pre, cur, w){
      return k+' '+lab+' '+fmt(raw*100,2)+'%'+
        (amps ? ' → ×'+a.amp+' = '+fmt(pre*100,2)+'%'+(pre>1?' → 封顶 100%':'') : '')+
        ' × '+w+' = '+fmt(cur*w*100,2)+' 分\n';
    };
    var tip = '扣分拆解（'+SMODE_LAB[scoreMode]+' × 权重 × 100）'+(amps ? '　★ '+ctx.level+' 层级占比 ×'+a.amp : '')+'\n'+
      line('①', a.lab[0], a.raw1, a.pre1, a.r1, 0.2)+
      line('②', a.lab[1], a.raw2, a.pre2, a.r2, 0.3)+
      line('③', a.lab[2], a.raw3, a.pre3, a.r3, 0.15)+
      line('④', a.lab[3], a.raw4, a.pre4, a.r4, 0.2)+
      '合计扣 '+fmt((d[0]+d[1]+d[2]+d[3])*100,2)+' 分 → 综合分 '+fmt(sc,2)+
      (amps ? '\n（骑手层级占比被人数稀释，按面板口径 ×'+a.amp+' 放大后参与计分；占比封顶 100%）' : '');
    return '<tr title="'+escA(tip)+'"'+(x.ri!==undefined?' class="rrow" data-ri="'+x.ri+'"':'')+'>'+
      '<td><span class="rank'+(i<3?' t'+(i+1):'')+'">'+(i+1)+'</span></td>'+
      '<td style="font-weight:600">'+esc(showName)+'</td>'+
      (x.ri!==undefined?'<td class="muted">'+esc(x.st)+'</td>':'')+
      '<td class="num">'+x.t+'</td>'+
      '<td class="num" style="font-weight:800;color:'+col+'">'+fmt(sc,1)+'</td>'+
      '<td class="num">'+pct(x.s1)+'</td><td class="num">'+pct(x.s2)+'</td>'+
      '<td class="num">'+pct(x.s3)+'</td><td class="num">'+pct(x.s4)+'</td>'+
      '<td class="barcell"><span class="xb" style="width:'+Math.max(2,Math.min(100,100-sc))+'%;background:'+col+'55"></span>'+
      '<em>'+fmt(sc,1)+'</em></td></tr>';
  }
  /* 团队扣分汇总：各站四项扣分 → 按单量加权求和 = 团队扣分 → 各站占团队扣分的比重
     ★ 扣分用「率值口径」（与单量规模无关）；团队扣分 = Σ(各站扣分 × 单量占比)，
       数值上等于「用团队整体率值算出的扣分」，故 团队综合分 = 100 − 团队扣分。 */
  function teamBlock(ctx, stArr){
    var rows = stArr.map(function(x){
      var d = deductOf(x, ctx, scoreMode);
      return { st:x.st, t:x.t, d:d, sum:d[0]+d[1]+d[2]+d[3] };
    });
    var tt = rows.reduce(function(a,b){ return a+b.t }, 0) || 1;
    rows.forEach(function(r){ r.vp = r.t/tt*100; r.contrib = r.sum*r.t/tt });
    var DT = rows.reduce(function(a,b){ return a+b.contrib }, 0);
    var score = Math.max(0, Math.min(100, 100-DT));
    var col = score>=90 ? '#059669' : (score>=80 ? '#b45309' : '#dc2626');
    var cd = [0,1,2,3].map(function(i){ return rows.reduce(function(a,b){ return a+b.d[i]*b.t/tt }, 0) });
    var head = '<tr><th>站点</th><th class="num">单量</th><th class="num">单量占比</th>'+
      '<th class="num">①妥投扣分</th><th class="num">②T8扣分</th><th class="num">③复合扣分</th>'+
      '<th class="num">④非时效扣分</th><th class="num">扣分合计</th><th class="num">占团队扣分</th></tr>';
    var body = rows.slice().sort(function(a,b){ return b.sum-a.sum }).map(function(r){
      return '<tr><td style="font-weight:600">'+esc(r.st.replace('福州',''))+'</td>'+
        '<td class="num">'+r.t+'</td><td class="num">'+pct(r.vp)+'</td>'+
        '<td class="num">'+fmt(r.d[0],2)+'</td><td class="num">'+fmt(r.d[1],2)+'</td>'+
        '<td class="num">'+fmt(r.d[2],2)+'</td><td class="num">'+fmt(r.d[3],2)+'</td>'+
        '<td class="num" style="font-weight:700">'+fmt(r.sum,2)+'</td>'+
        '<td class="num">'+pct(DT ? r.contrib/DT*100 : 0)+'</td></tr>';
    }).join('');
    var foot = '<tr style="background:#f8fafc;font-weight:700"><td>团队 · 单量加权合计</td>'+
      '<td class="num">'+tt+'</td><td class="num">100.00%</td>'+
      '<td class="num">'+fmt(cd[0],2)+'</td><td class="num">'+fmt(cd[1],2)+'</td>'+
      '<td class="num">'+fmt(cd[2],2)+'</td><td class="num">'+fmt(cd[3],2)+'</td>'+
      '<td class="num">'+fmt(DT,2)+'</td><td class="num">100.00%</td></tr>';
    return '<div class="mtabcap">🧾 团队扣分汇总 <span style="font-weight:400;color:#98a2b3">'+
      '各站扣分按<b>单量占比</b>加权求和 = <b>团队扣分 '+fmt(DT,2)+' 分</b> → '+
      '<b>团队综合分 <span style="color:'+col+'">'+fmt(score,2)+'</span></b>；'+
      '「占团队扣分」= 该站对团队扣分的贡献比重（各站合计 100%）。口径随上方切换（当前 '+SMODE_LAB[scoreMode]+'）</span></div>'+
      '<div style="overflow-x:auto"><table class="xtab"><thead>'+head+'</thead><tbody>'+body+foot+'</tbody></table></div>';
  }
  function renderScore(){
    var dts = dayList();
    var ctxS = scoreCtx(sel, dts, 'station'), ctxR = scoreCtx(sel, dts), T = ctxR.T;
    var stArr = byStation(sel, dts).filter(function(x){ return x.t>0 });
    var rdArr = byRider(sel, dts).filter(function(x){ return x.t>=scope.min });
    stArr.forEach(function(x){ x._sc = scoreOf(x, ctxS) });
    rdArr.forEach(function(x){ x._sc = scoreOf(x, ctxR) });
    [stArr, rdArr].forEach(function(arr){
      arr.forEach(function(x){
        var sh = sharesOf(x, T);
        x.s1 = sh.s1; x.s2 = sh.s2; x.s3 = sh.s3; x.s4 = sh.s4;
      });
    });
    stArr.sort(function(a,b){ return a._sc-b._sc });
    rdArr.sort(function(a,b){ return b._sc-a._sc });

    var head = '<tr><th>名次</th><th>对象</th><th>站点</th><th class="num">单量</th>'+
      '<th class="num">综合分</th><th class="num">妥投占比</th><th class="num">T8占比</th>'+
      '<th class="num">复合占比</th><th class="num">非时效占比</th><th>得分</th></tr>';
    var headSt = '<tr><th>名次</th><th>站点</th><th class="num">单量</th><th class="num">综合分</th>'+
      '<th class="num">妥投占比</th><th class="num">T8占比</th><th class="num">复合占比</th>'+
      '<th class="num">非时效占比</th><th>得分</th></tr>';
    var best  = rdArr.slice(0, 8);                        // 分最高（rdArr 已按综合分降序）
    var worst = rdArr.slice(-8).reverse();                 // 分最低（转成由低到高，第 1 行 = 最差）
    var overlap = rdArr.length <= worst.length + best.length;   // 骑手太少时两端会重复 → 只列一次
    var rdBars = overlap
      ? '<tr><td colspan="10" style="background:#f5f8ff;font-weight:700;color:#334155;padding:6px 8px">'+
        '骑手共 '+rdArr.length+' 名（≤16，全部列出，按综合分降序）</td></tr>'+
        rdArr.map(function(x,i){ return scoreBar(x, ctxR, i, x.n) }).join('')
      : '<tr><td colspan="10" style="background:#fef2f2;font-weight:700;color:#b91c1c;padding:6px 8px">⚠️ 综合分最低 '+worst.length+' 名（相对团队贡献的问题最多）</td></tr>'+
        worst.map(function(x,i){ return scoreBar(x, ctxR, i, x.n) }).join('')+
        '<tr><td colspan="10" style="background:#ecfdf5;font-weight:700;color:#047857;padding:6px 8px">✅ 综合分最高 '+best.length+' 名</td></tr>'+
        best.map(function(x,i){ return scoreBar(x, ctxR, i, x.n) }).join('');
    $('#scoreSites').innerHTML = '<div style="overflow-x:auto"><table class="xtab"><thead>'+headSt+'</thead><tbody>'+
      stArr.map(function(x,i){ return scoreBar(x, ctxS, i, x.st.replace('福州','')) }).join('')+'</tbody></table></div>';
    if($('#scoreTeam')) $('#scoreTeam').innerHTML = teamBlock(ctxS, stArr);
    $('#scoreRiders').innerHTML = '<div style="overflow-x:auto"><table class="xtab"><thead>'+head+'</thead><tbody>'+
      rdBars+'</tbody></table></div>';
    $('#scoreNote').innerHTML = '当前口径：<b>'+SMODE_LAB[scoreMode]+'</b> · '+
      '筛选范围内 <b>'+rdArr.length+'</b> 名骑手（最少单量 ≥ '+scope.min+'）、<b>'+stArr.length+'</b> 个站点。'+
      (scoreMode==='rate'
        ? '各指标用对象<b>自身率值</b>代入：不完全妥投率、T8超时率、单均复合÷团队均值（封顶 2）、非时效不满意度。'+
          '★ <b>与单量规模无关</b> —— 单量大的站点问题量天然多，但不会再因此被判定为最差。'
        : scoreMode==='tx'
        ? '各指标用<b>该对象扣分 ÷ 全体同类对象该项扣分之和</b>代入（各项扣分先对全体求和、再算占比），'+
          '不受单量规模影响。'+
          '<br>★ <b>层级放大</b>：占比分母是团队全员合计，同一层级对象越多、单个占比越小 —— 站点层级只有 '+stArr.length+
          ' 个对象、占比量级正常，直接代入；骑手层级 '+ctxR.n+' 人，人均占比仅 ~'+fmt(100/Math.max(1,ctxR.n),2)+
          '%，按面板口径 <b>×'+LEVEL_AMP.rider+'</b> 放大后代入（占比封顶 100%），否则全场挤在 97~100 没有区分度。'+
          '该放大<b>只作用于骑手</b>，站点分与团队扣分汇总不受影响。'
        : '各指标用<b>团队占比原值</b>（该对象加权分子 ÷ 团队加权分子合计）直接代入 —— 这是原式。'+
          '⚠️ 占比随<b>单量</b>增长（加权分子 ≈ 单量 × 率值），所以订单多的站点/骑手占比自然高、分数被拉低；'+
          '骑手层级同样按 <b>×'+LEVEL_AMP.rider+'</b> 放大后代入。')+
      '<br>鼠标悬停任意一行可看<b>扣分拆解</b>（每项占比 × 权重 × 100 = 扣几分，四项之和 = 100 − 综合分）。'+
      '<br>点任一行骑手可查看其逐日明细。';
    var seg = $('#scoreSeg');
    if(seg) seg.querySelectorAll('button').forEach(function(b){
      b.classList.toggle('on', b.getAttribute('data-s')===scoreMode);
    });
  }

  /* ================= 站点 ================= */
  function sparkline(arr, color, key){
    var W=260,H=54,pl=2,pr=2,pt=6,pb=6;
    var vals = arr.map(function(x){ return x[key] });
    var mx = Math.max.apply(null, vals)||1, n = vals.length, iw=W-pl-pr, ih=H-pt-pb;
    var pts = vals.map(function(v,i){
      return [pl + (n===1?iw/2:iw*i/(n-1)), pt + ih - v/(mx||1)*ih];
    });
    var d = pts.map(function(p,i){ return (i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1) }).join(' ');
    return '<svg viewBox="0 0 '+W+' '+H+'">'+
      '<path d="'+d+' L'+pts[n-1][0].toFixed(1)+' '+(pt+ih)+' L'+pts[0][0].toFixed(1)+' '+(pt+ih)+' Z" fill="'+color+'" opacity="0.10"/>'+
      '<path d="'+d+'" fill="none" stroke="'+color+'" stroke-width="2" stroke-linejoin="round"/>'+
      pts.map(function(p,i){ return '<circle cx="'+p[0].toFixed(1)+'" cy="'+p[1].toFixed(1)+'" r="'+(i===n-1?3.4:2)+'" fill="'+(i===n-1?color:'#fff')+'" stroke="'+color+'" stroke-width="1.6"/>' }).join('')+'</svg>';
  }
  function renderStations(){
    var dts = dayList();
    var ctx = scoreCtx(sel, dts, 'station'), T = ctx.T;   // 站点层级基准
    var allSt = byStation(sel, dts).sort(function(a,b){ return scoreOf(a,ctx)-scoreOf(b,ctx) });
    allSt.forEach(function(x){ x._sc = scoreOf(x, ctx) });
    var lastMap = {}; byStation(sel, [D.dates.length-1]).forEach(function(x){ lastMap[x.st]=x });
    var avgRate = T.r;
    var rdCnt = {}; D.riders.forEach(function(r){ rdCnt[r.st] = (rdCnt[r.st]||0)+1 });
    $('#stationGrid').innerHTML = allSt.map(function(st){
      var lp = lastMap[st.st] || {t:0,r:0,c:0};
      var trend = dts.map(function(i){
        var v = newVec();
        (D.grid[i]||[]).forEach(function(e){
          if(D.riders[e[0]].st!==st.st) return;
          cellVec(e.slice(1), sel, v);
        });
        var m = metricsOf(v);
        return { r: m.r, c: m.c, sc: scoreOf(m, ctx) };
      });
      var worst = st.r >= avgRate;
      var scCol = st._sc>=90 ? '#059669' : (st._sc>=80 ? '#f59e0b' : '#dc2626');
      return '<div class="card stcard" data-st="'+escA(st.st)+'" role="button" tabindex="0" title="点击查看「'+escA(st.st)+'」整个周期的明细">'+
        '<div class="h"><div><div class="stname">'+esc(st.st)+'</div>'+
        '<div class="muted" style="font-size:11.5px;margin-top:2px">'+st.t+' 单 · 超时 '+st.o+' 单 · 单均 '+fmt(st.c,1)+'s · '+(rdCnt[st.st]||0)+' 名骑手</div></div>'+
        '<div style="text-align:right"><div style="font-size:20px;font-weight:800;color:'+scCol+'">'+fmt(st._sc,1)+'</div>'+
        '<div class="muted" style="font-size:11px">综合评价分</div></div></div>'+
        '<div class="mchips">'+
          '<span title="不完全妥投率">妥投 <b style="color:#dc2626">'+pct(st.missR)+'</b></span>'+
          '<span title="预测T8准时率">T8 <b style="color:#0891b2">'+pct(st.t8R)+'</b></span>'+
          '<span title="单均复合超时时长">复合 <b style="color:#7c3aed">'+fmt(st.avgComp,1)+'s</b></span>'+
          '<span title="非时效不满意度">非时效 <b style="color:#d97706">'+pct(st.satR)+'</b></span>'+
          '<span title="超时率">超时 <b style="color:'+(worst?'#ef4444':'#10b981')+'">'+pct(st.r)+'</b></span>'+
        '</div>'+
        '<div style="font-size:11.5px;color:#475467">最新 <b>'+lp.t+'</b> 单 / 超时率 <b>'+pct(lp.r)+'</b> / 单均 <b>'+fmt(lp.c,1)+'</b>s</div>'+
        sparkline(trend, worst?'#ef4444':'#10b981','r')+
        '<div class="stmore">查看整个周期明细 ›</div></div>';
    }).join('') +
    '<div class="note" style="grid-column:1/-1;margin:2px 4px 0">👆 点任意站点卡片 → 查看该站<b>整个周期</b>的逐日趋势（图表 + 每日数据标注）、每日明细表与该站骑手排行；站卡片按<b>综合评价分</b>升序（分低＝相对团队贡献的问题更多）</div>';
  }
  /* 站点卡片点击 → 站点详情 */
  $('#stationGrid').addEventListener('click', function(e){
    var c = e.target.closest('.stcard'); if(!c) return;
    openStation(c.getAttribute('data-st'));
  });
  $('#stationGrid').addEventListener('keydown', function(e){
    if(e.key !== 'Enter' && e.key !== ' ') return;
    var c = e.target.closest('.stcard'); if(!c) return;
    e.preventDefault(); openStation(c.getAttribute('data-st'));
  });

  /* ================= 骑手表（可排序 + 占比） ================= */
  var COLS_T = [
    { k:'idx',    lab:'排名',        num:false, sortable:false },
    { k:'n',      lab:'骑手',        num:false },
    { k:'st',     lab:'站点',        num:false },
    { k:'t',      lab:'单量',        num:true },
    { k:'o',      lab:'超时单',      num:true },
    { k:'r',      lab:'超时率',      num:true },
    { k:'shareO', lab:'超时占比',    num:true },
    { k:'s',      lab:'复合总时长',  num:true },
    { k:'shareS', lab:'复合占比',    num:true },
    { k:'c',      lab:'单均复合',num:true }
  ];
  /* 质量指标视图：四个考核指标 = 单数 / 团队占比 / 率值，另加综合评价分 */
  var COLS_Q = [
    { k:'idx',    lab:'综合排名',    num:false, sortable:false },
    { k:'n',      lab:'骑手',        num:false },
    { k:'st',     lab:'站点',        num:false },
    { k:'t',      lab:'单量',        num:true },
    { k:'score',  lab:'综合评价分',  num:true },
    { k:'missAdd',lab:'妥投·加权未完成', num:true },
    { k:'s1',     lab:'妥投占比',    num:true },
    { k:'missR',  lab:'不完全妥投率', num:true },
    { k:'t8W',    lab:'T8·加权超时', num:true },
    { k:'s2',     lab:'T8占比',      num:true },
    { k:'t8Late', lab:'T8超时率',    num:true },
    { k:'s',      lab:'复合总时长',  num:true },
    { k:'s3',     lab:'复合占比',    num:true },
    { k:'avgComp',lab:'单均复合',    num:true },
    { k:'satW',   lab:'非时效·加权单', num:true },
    { k:'s4',     lab:'非时效占比',  num:true },
    { k:'satR',   lab:'非时效不满意度', num:true }
  ];
  function COLS(){ return view==='quality' ? COLS_Q : COLS_T }
  function renderTable(){
    var cols = COLS();
    var dts = dayList();
    var ctx = scoreCtx(sel, dts), T = ctx.T;      // 团队基准（占比分母 / 率值合计）
    var base = byRider(sel, dts);
    base.forEach(function(x){
      x.shareO = T.o ? x.o/T.o*100 : 0;
      x.shareS = T.s ? x.s/T.s*100 : 0;
      // —— 四个指标的加权分子与团队占比（加权系数取自平台口径）——
      x.t8W  = x.t8Loss;
      x.score = scoreOf(x, ctx);
      var sh = sharesOf(x, T);
      x.s1 = sh.s1; x.s2 = sh.s2; x.s3 = sh.s3; x.s4 = sh.s4;
    });
    // ① 先按「最少单量 / 站点 / 搜索」筛出候选池
    var pool = base.filter(function(x){
      return x.t>=scope.min && (scope.st==='__all__' || x.st===scope.st) &&
             (!scope.q || x.n.indexOf(scope.q)>=0);
    });
    // ② 全池名次（仅用于悬停提示）：超时率名次 / 综合分名次
    pool.slice().sort(function(a,b){ return (b.r-a.r) || (b.o-a.o) || (b.t-a.t) })
        .forEach(function(x,i){ x.poolRk = i+1 });
    pool.slice().sort(function(a,b){ return (b.score-a.score) || (b.t-a.t) })
        .forEach(function(x,i){ x.poolSrk = i+1 });
    // ③ 排序比较器 = 当前排序维度（点表头 / 排序按钮可切换）
    var k = sortKey, dir = sortDir;
    var cmp = function(a,b){
      var va = a[k], vb = b[k];
      if(typeof va === 'string') return va.localeCompare(vb) * dir;
      if(va===vb) return (b.o-a.o) || (b.t-a.t);
      return (va-vb) * dir;
    };
    // ④ 排名筛选：按「当前排序维度」排序后取前 N%，
    //    并与临界名次排序值相同的（并列）一并纳入 —— 不写死任何维度
    var cut = 0, list = pool, cutWant = 0;
    if(scope.rank > 0 && pool.length){
      var sorted = pool.slice().sort(cmp);
      cutWant = Math.max(1, Math.ceil(sorted.length * scope.rank / 100));
      var last = sorted[cutWant-1][k];
      if(typeof last === 'number'){
        list = sorted.filter(function(x){
          return x[k] === last || (dir < 0 ? x[k] > last : x[k] < last);
        });
      } else {
        list = sorted.slice(0, cutWant);
      }
      if(!list.length) list = sorted.slice(0, cutWant);
      cut = list.length;
    }
    // ⑤ 排名列 = 「当前展示范围内」的名次（1..N 连续），与排序自洽
    list.slice().sort(function(a,b){ return (b.r-a.r) || (b.o-a.o) || (b.t-a.t) })
        .forEach(function(x,i){ x.rk = i+1 });
    /* ★ srk 的并列顺序必须与展示排序（cmp）一致，否则同分的骑手在行序与名次序里会错位，
       名次列会出现 1,2,3,5,4 这种跳号（占比封顶后同分变多，v37 实测踩到）。 */
    list.slice().sort(function(a,b){ return (b.score-a.score) || (b.o-a.o) || (b.t-a.t) })
        .forEach(function(x,i){ x.srk = i+1 });
    // ⑥ 按当前排序方式展示
    list.sort(cmp);

    var thead = '<tr>' + cols.map(function(c){
      var active = (c.k===k), arrow = active ? (dir>0?' ▲':' ▼') : '', cls = [];
      if(c.num) cls.push('num');
      if(c.sortable!==false) cls.push('sorth');
      if(active) cls.push('on');
      return '<th'+(cls.length?' class="'+cls.join(' ')+'"':'')+(c.sortable===false?'':' data-k="'+c.k+'"')+'>'+c.lab+'<span class="arrow">'+arrow+'</span></th>';
    }).join('') + '</tr>';
    $('#riderTable').querySelector('thead').innerHTML = thead;

    if(!list.length){
      $('#riderTable').querySelector('tbody').innerHTML =
        '<tr><td colspan="'+cols.length+'" class="empty">无符合条件的数据（可放宽筛选、降低「最少单量」或把排名筛选改为「全部」）</td></tr>';
    } else if(view === 'quality'){
      $('#riderTable').querySelector('tbody').innerHTML = list.map(function(x){
        var scCol = x.score>=90 ? '#059669' : (x.score>=80 ? '#b45309' : '#dc2626');
        return '<tr class="rrow" data-ri="'+x.ri+'" title="展示范围内第 '+x.srk+' 名（综合分）· 全池综合分第 '+x.poolSrk+' 名 / 超时率第 '+x.poolRk+' 名">'+
          '<td><span class="rank'+(x.srk<=3?' t'+x.srk:'')+'">'+x.srk+'</span></td>'+
          '<td style="font-weight:600">'+esc(x.n)+'</td>'+
          '<td class="muted">'+esc(x.st)+'</td>'+
          '<td class="num">'+x.t+'</td>'+
          '<td class="num" style="font-weight:800;color:'+scCol+'">'+fmt(x.score,1)+'</td>'+
          '<td class="num">'+Math.round(x.missAdd)+'</td>'+
          '<td class="num">'+pct(x.s1)+'</td>'+
          '<td class="num" style="color:#dc2626;font-weight:600">'+pct(x.missR)+'</td>'+
          '<td class="num">'+Math.round(x.t8W)+'</td>'+
          '<td class="num">'+pct(x.s2)+'</td>'+
          '<td class="num" style="color:#be185d;font-weight:600">'+pct(x.t8Late)+'</td>'+
          '<td class="num">'+Math.round(x.s)+'</td>'+
          '<td class="num">'+pct(x.s3)+'</td>'+
          '<td class="num">'+fmt(x.avgComp,1)+'<span class="muted"> s</span></td>'+
          '<td class="num">'+Math.round(x.satW)+'</td>'+
          '<td class="num">'+pct(x.s4)+'</td>'+
          '<td class="num" style="color:#d97706;font-weight:600">'+pct(x.satR)+'</td></tr>';
      }).join('');
    } else {
      $('#riderTable').querySelector('tbody').innerHTML = list.map(function(x){
        var rc = rateColor(x.r), rk = x.rk<=3 ? ' t'+x.rk : '';
        return '<tr class="rrow" data-ri="'+x.ri+'" title="展示范围内第 '+x.rk+' 名（超时率）· 全池超时率第 '+x.poolRk+' 名 / 综合分第 '+x.poolSrk+' 名">'+
          '<td><span class="rank'+rk+'">'+x.rk+'</span></td>'+
          '<td style="font-weight:600">'+esc(x.n)+'</td>'+
          '<td class="muted">'+esc(x.st)+'</td>'+
          '<td class="num">'+x.t+'</td>'+
          '<td class="num">'+x.o+'</td>'+
          '<td class="num" style="color:'+rc+';font-weight:700">'+pct(x.r)+'</td>'+
          '<td class="num">'+pct(x.shareO)+'</td>'+
          '<td class="num">'+Math.round(x.s)+'</td>'+
          '<td class="num">'+pct(x.shareS)+'</td>'+
          '<td class="num">'+fmt(x.c,1)+'<span class="muted"> s</span></td></tr>';
      }).join('');
    }
    var sortLab = view==='quality'
      ? { idx:'综合排名', n:'骑手', st:'站点', t:'单量', score:'综合评价分', missAdd:'妥投加权单', s1:'妥投占比', missR:'不完全妥投率',
          t8W:'T8加权超时单', s2:'T8占比', t8Late:'T8超时率', s:'复合总时长', s3:'复合占比', avgComp:'单均复合',
          satW:'非时效加权单', s4:'非时效占比', satR:'非时效不满意度' }
      : { idx:'排名', n:'骑手', st:'站点', t:'单量', o:'超时单', r:'超时率', shareO:'超时占比', s:'复合总时长', shareS:'复合占比', c:'单均复合' };
    // ★ rankTxt 必须写在 sortLab 之后：var 提升会让 sortLab[k] 在赋值前取到 undefined 而抛错，
    //   那样本函数后续（说明文案）会静默跳过，表现为「说明永远停在初始状态」
    var rankTxt = scope.rank>0
      ? '排名筛选 <b>按当前排序「'+(sortLab[k]||k)+'」'+(dir>0?'升序':'降序')+'前 '+scope.rank+'%</b>（候选 '+pool.length+' 名 → 取前 '+cut+' 名'+
        (cut>cutWant ? '，与临界名次并列的一并纳入 +'+(cut-cutWant) : '')+'）'
      : '排名筛选 <b>不限</b>（候选 '+pool.length+' 名）';
    $('#tblNote').innerHTML = '<b style="color:#1d4ed8">👆 点任意一行骑手可查看逐日明细</b> · 当前：<b>'+(scope.day==='__all__'?'全周期':scope.day)+'</b> · '+
      '「'+(view==='quality'?'综合排名':'排名')+'」列 = <b>'+(view==='quality'?'当前展示范围内按综合分的名次（1 = 分最高）':'当前展示范围内按超时率的名次（1 = 超时率最高）')+'</b>（悬停某行可看全池名次）<br>'+
      '筛选：最少单量 ≥ '+scope.min+' · '+rankTxt+' · 实际展示 <b>'+list.length+'</b> 名 · '+
      '排序：'+(sortLab[k]||k)+(dir>0?' ↑':' ↓')+
      ' · 占比分母=当前范围全部骑手（未完成加权 '+Math.round(T.missAdd)+' · T8加权超时 '+Math.round(T.t8Loss)+
      ' · 复合合计 '+Math.round(T.s)+'s · 非时效加权 '+Math.round(T.satW)+'）'+
      (view==='quality' ? '<br>综合评价分口径：<b>'+SMODE_LAB[scoreMode]+'</b> —— 100 −（0.2×① + 0.3×② + 0.15×③ + 0.2×④）×100；'+
        '「团队占比」列 = 该骑手加权分子 ÷ 团队加权分子合计（信息列；原式口径下参与计分，其余口径仅作参考）' : '');
  }
  var _tapStart = null, _tapTimer = null, _rowTouchUsed = 0;
  function rowAt(x, y){
    var el = document.elementFromPoint(x, y);
    return (el && el.closest) ? el.closest('tr.rrow') : null;
  }
  $('#riderTable').addEventListener('touchstart', function(e){
    if(e.touches.length !== 1) return;
    var t = e.touches[0];
    _tapStart = { x: t.clientX, y: t.clientY, t: Date.now(), scrollY: window.scrollY };
  }, {passive:true});
  $('#riderTable').addEventListener('touchend', function(e){
    if(!_tapStart) return;
    var start = _tapStart; _tapStart = null;
    var tg = e.changedTouches[0];
    var moved = Math.abs(tg.clientX - start.x) + Math.abs(tg.clientY - start.y);
    if(moved > 14 || Date.now() - start.t > 900) return;   // 滑动/长按不触发
    clearTimeout(_tapTimer);
    // 兜底：若 380ms 内 click 没来（被滚动手势吞掉），直接按坐标进入明细
    _tapTimer = setTimeout(function(){
      if(document.querySelector('#modal.show')) return;     // 已经打开就别重复弹
      var tr = rowAt(start.x, start.y);
      if(tr && Math.abs(window.scrollY - (start.scrollY||0)) < 400){
        _rowTouchUsed = Date.now();
        openRider(+tr.getAttribute('data-ri'));
      }
    }, 380);
  }, {passive:true});
  $('#riderTable').addEventListener('click', function(e){
    clearTimeout(_tapTimer);                                // click 正常到达，取消兜底
    var th = e.target.closest('th.sorth');
    if(th){
      var k = th.getAttribute('data-k');
      if(k===sortKey) sortDir = -sortDir;
      else { sortKey = k; sortDir = (k==='n'||k==='st') ? 1 : -1; }
      renderTable(); return;
    }
    var tr = e.target.closest('tr.rrow');
    if(tr){
      if(Date.now() - _rowTouchUsed < 800) return;          // 兜底已处理过
      openRider(+tr.getAttribute('data-ri'));
    }
  });

  /* ================= 骑手明细弹窗 ================= */
  var C_RATE = '#1d4ed8';     // 超时率（左轴）蓝
  var C_COMP = '#ea580c';     // 单均复合（右轴）橙
  function lineChart(days, opts){
    if(!days.length) return '<div class="empty">当前筛选下无数据</div>';
    opts = opts || {};
    var H=330, pl=54, pr=60, pt=38, pb=48, n=days.length;
    // 数据点多时按比例加宽画布（外层横向可滚动），保证每个点的数据标注互不重叠
    var per = opts.per || 56;
    var W = Math.max(opts.minW || 700, pl + pr + Math.max(1, n-1)*per);
    var iw=W-pl-pr, ih=H-pt-pb;
    var maxR = Math.max.apply(null, days.map(function(d){return d.r}).concat([1]))*1.3;
    var maxC = Math.max.apply(null, days.map(function(d){return d.c}).concat([1]))*1.3;
    function X(i){ return n===1 ? pl+iw/2 : pl + iw*i/(n-1) }
    function YR(v){ return pt + ih - v/maxR*ih }
    function YC(v){ return pt + ih - v/maxC*ih }
    var s = '<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="xMidYMid meet" style="min-width:'+Math.round(W)+'px">';
    s += '<defs><filter id="halo" x="-30%" y="-30%" width="160%" height="160%">'+
         '<feMorphology operator="dilate" radius="2" in="SourceAlpha" result="d"/>'+
         '<feFlood flood-color="#fff"/><feComposite in2="d" operator="in" result="o"/>'+
         '<feMerge><feMergeNode in="o"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>';
    for(var g=0; g<=4; g++){
      var y = pt + ih*g/4;
      s += '<line x1="'+pl+'" y1="'+y+'" x2="'+(W-pr)+'" y2="'+y+'" stroke="#eef1f6"/>';
      s += '<text x="'+(pl-8)+'" y="'+(y+4)+'" text-anchor="end" font-size="11" fill="'+C_RATE+'">'+(maxR*(4-g)/4).toFixed(1)+'%</text>';
      s += '<text x="'+(W-pr+8)+'" y="'+(y+4)+'" text-anchor="start" font-size="11" fill="'+C_COMP+'">'+(maxC*(4-g)/4).toFixed(0)+'s</text>';
    }
    var d1 = days.map(function(d,i){ return (i?'L':'M')+X(i).toFixed(1)+' '+YR(d.r).toFixed(1) }).join(' ');
    var d2 = days.map(function(d,i){ return (i?'L':'M')+X(i).toFixed(1)+' '+YC(d.c).toFixed(1) }).join(' ');
    s += '<path d="'+d2+'" fill="none" stroke="'+C_COMP+'" stroke-width="2.4" stroke-linejoin="round" stroke-dasharray="7 5"/>';
    s += '<path d="'+d1+'" fill="none" stroke="'+C_RATE+'" stroke-width="2.6" stroke-linejoin="round"/>';
    var PB = pt + ih;   // 绘图区底边
    var maxI = 0; days.forEach(function(d,i){ if(d.r > days[maxI].r) maxI = i });   // 峰值点
    days.forEach(function(d,i){
      var x = X(i).toFixed(1);
      var yr = YR(d.r), yc = YC(d.c);
      if(i === maxI)      // 峰值加一圈光环，便于一眼定位
        s += '<circle cx="'+x+'" cy="'+yr.toFixed(1)+'" r="8.5" fill="none" stroke="'+C_RATE+'" stroke-width="1.6" opacity="0.45"/>';
      s += '<circle cx="'+x+'" cy="'+yr.toFixed(1)+'" r="3.6" fill="#fff" stroke="'+C_RATE+'" stroke-width="2.2"/>';
      s += '<circle cx="'+x+'" cy="'+yc.toFixed(1)+'" r="3.2" fill="#fff" stroke="'+C_COMP+'" stroke-width="2"/>';
      // 数据标注：默认超时率在上、复合时长在下；贴边时互换，两者过近时再错开
      // 首/末点的文字改用 start/end 锚点，避免压到左右两侧的坐标轴刻度
      var anch = (n >= 3) ? (i === 0 ? 'start' : (i === n-1 ? 'end' : 'middle')) : 'middle';
      var ry = yr - 9;
      if(ry < pt + 9) ry = yr + 15;
      var cy = yc + 16;
      if(cy > PB - 5) cy = yc - 10;
      if(cy > PB - 5) cy = PB - 6;
      if(Math.abs(ry - cy) < 13){ ry = cy - 13; if(ry < pt + 9) ry = cy + 13; }
      s += '<text x="'+x+'" y="'+ry.toFixed(1)+'" text-anchor="'+anch+'" font-size="10.5" font-weight="700" '+
           'fill="'+C_RATE+'" filter="url(#halo)">'+d.r.toFixed(1)+'%</text>';
      s += '<text x="'+x+'" y="'+cy.toFixed(1)+'" text-anchor="'+anch+'" font-size="10.5" font-weight="700" '+
           'fill="'+C_COMP+'" filter="url(#halo)">'+Math.round(d.c)+'s</text>';
      s += '<text x="'+x+'" y="'+(H-pb+22)+'" text-anchor="'+anch+'" font-size="11" fill="#98a2b3">'+d.dt.slice(5)+'</text>';
    });
    s += '</svg>';
    return '<div class="chartwrap">'+s+'</div>';
  }
  /* ================= 四项考核指标区块（骑手/站点弹窗共用） ================= */
  function metricBlock(m, ctx){
    var T = ctx.T, sh = sharesOf(m, T), sc = scoreOf(m, ctx);
    var col = sc>=90 ? '#059669' : (sc>=80 ? '#b45309' : '#dc2626');
    var mc = function(lab,val){ return '<div class="mcell"><div class="kl">'+lab+'</div><div class="kv">'+val+'</div></div>' };
    return '<div class="mtabcap">🧮 四项考核指标 <span style="font-weight:400;color:#98a2b3">'+
      '加权未完成 '+Math.round(m.missAdd)+' 单 · 加权超时 '+Math.round(m.t8Loss)+' 单 · 复合合计 '+Math.round(m.s)+
      's · 非时效加权 '+Math.round(m.satW)+' 单</span></div>'+
      '<div class="mgrid">'+
        mc('综合评价分', '<span style="color:'+col+'">'+fmt(sc,1)+'</span>') +
        mc('① 完全妥投率', pct(m.fullR)) +
        mc('① 不完全妥投率 <em>团队占比 '+pct(sh.s1)+'</em>', pct(m.missR)) +
        mc('① 加权未完成单', Math.round(m.missAdd)) +
        mc('② 预测T8准时率', pct(m.t8R)) +
        mc('② T8超时率 <em>团队占比 '+pct(sh.s2)+'</em>', pct(m.t8Late)) +
        mc('② 加权超时单', Math.round(m.t8Loss)) +
        mc('③ 单均复合时长', fmt(m.avgComp,1)+'s') +
        mc('③ 复合时长 <em>团队占比 '+pct(sh.s3)+'</em>', Math.round(m.s)+'s') +
        mc('④ 非时效不满意度', pct(m.satR)) +
        mc('④ 非时效加权单 <em>团队占比 '+pct(sh.s4)+'</em>', Math.round(m.satW)) +
        mc('接单量 / 有效完单', m.acc+' / '+m.t) +
      '</div>';
  }
  function openRider(ri){
    var days = riderDays(ri, sel);            // 始终取该骑手全部日期的数据
    var r = D.riders[ri];
    var t=0,o=0,m=0;
    days.forEach(function(d){ t+=d.t; o+=d.o; m+=d.s });
    var ctxAll = scoreCtx(sel, allDays());   // 占比分母 / 率值合计同样用全量日期
    var tot = ctxAll.T;
    var rv = newVec(); days.forEach(function(d){ addVec(rv, d._v) });
    var mcell = function(lab,val){ return '<div class="mcell"><div class="kl">'+lab+'</div><div class="kv">'+val+'</div></div>' };
    var html = '<div class="modal-card">'+
      '<div class="mhead"><div><div class="mtitle">'+esc(r.n)+'</div>'+
      '<div class="muted" style="font-size:12px">'+esc(r.st)+' · '+selText()+' · <b>全量数据（不随上方日期筛选变化）</b></div></div>'+
      '<div style="display:flex;gap:8px;align-items:center;flex:0 0 auto">'+
      '<button class="expbtn" id="mexp" style="margin-left:0">🖼 导出图片</button>'+
      '<button class="mclose" id="mclose">✕</button></div></div>'+
      '<div class="mgrid">'+
        mcell('单量', t) + mcell('超时单', o) +
        mcell('超时率', pct(t? o/t*100:0)) + mcell('单均复合', fmt(t? m/t:0,1)+'s') +
        mcell('超时占比', pct(tot.o? o/tot.o*100:0)) + mcell('复合时长占比', pct(tot.s? m/tot.s*100:0)) +
        mcell('复合总时长', Math.round(m)+'s') + mcell('活跃天数', days.length) +
      '</div>'+
      metricBlock(metricsOf(rv), ctxAll)+
      statLine(days)+
      '<div class="mlegend"><span><i style="background:'+C_RATE+'"></i>超时率（左轴·实线）</span>'+
        '<span><i style="background:'+C_COMP+'"></i>单均复合（右轴·虚线）</span>'+
        '<span style="color:#98a2b3">点上/点下数字为每日实际值</span></div>'+
      lineChart(days)+
      '<div class="mtabcap">📅 每日明细（整个周期）</div>'+
      '<div style="overflow-x:auto"><table><thead><tr><th>日期</th><th class="num">单量</th><th class="num">超时单</th>'+
      '<th class="num">超时率</th><th class="num">完全妥投率</th><th class="num">T8准时率</th>'+
      '<th class="num">单均复合</th><th class="num">非时效不满意</th></tr></thead><tbody>'+
        days.map(function(d){
          return '<tr><td>'+d.dt+'</td><td class="num">'+d.t+'</td><td class="num">'+d.o+'</td>'+
            '<td class="num">'+pct(d.r)+'</td>'+
            '<td class="num" style="color:#059669">'+pct(d.fullR)+'</td>'+
            '<td class="num" style="color:#0891b2">'+pct(d.t8R)+'</td>'+
            '<td class="num">'+fmt(d.c,1)+'s</td>'+
            '<td class="num" style="color:#d97706">'+pct(d.satR)+'</td></tr>';
        }).join('')+'</tbody></table></div></div>';
    var mo = $('#modal');
    mo.className = 'modal';
    mo.innerHTML = html; mo.classList.add('show');
    _modalOpenedAt = Date.now();
    $('#mclose').onclick = function(){ mo.classList.remove('show') };
    $('#mexp').onclick = function(e){
      e.stopPropagation();
      doExport(mo.querySelector('.modal-card'), r.n+' 全量逐日明细',
        { backLabel:'返回明细', back:function(){ openRider(ri) } });
    };
  }
  var _modalOpenedAt = 0;
  $('#modal').addEventListener('click', function(e){
    if(e.target !== this) return;
    if(Date.now() - _modalOpenedAt < 450) return;   // 防「幽灵点击」刚打开就被关掉
    this.classList.remove('show');
  });

  /* ================= 站点明细弹窗（整个周期） ================= */
  /* 站点层级的计分上下文（整个周期、当前筛选下的所有站点的率值合计） */
  function scoreStCtx(st, s){
    var ctx = scoreCtx(s, allDays(), 'station');
    return ctx;
  }
  function openStation(st){
    var days = stationDays(st, sel);          // 整个周期，不随上方日期筛选变化
    var allRd = stationRiders(st, sel);
    var rd = allRd.filter(function(x){ return x.t>=scope.min && x.t>0 });
    var t=0,o=0,m=0;
    days.forEach(function(d){ t+=d.t; o+=d.o; m+=d.s });
    var ctxAll = scoreCtx(sel, allDays());            // 骑手层级（弹窗里的骑手排行）
    var ctxSt = scoreStCtx(st, sel);                  // 站点层级（本弹窗的综合分）
    var tot = ctxAll.T;
    rd.sort(function(a,b){ return (scoreOf(b,ctxAll)-scoreOf(a,ctxAll)) || (b.t-a.t) });
    var mcell = function(lab,val){ return '<div class="mcell"><div class="kl">'+lab+'</div><div class="kv">'+val+'</div></div>' };
    var dayTab = '<div style="overflow-x:auto"><table><thead><tr>'+
      '<th>日期</th><th class="num">单量</th><th class="num">超时单</th><th class="num">超时率</th>'+
      '<th class="num">完全妥投率</th><th class="num">T8准时率</th><th class="num">单均复合</th>'+
      '<th class="num">非时效不满意</th><th class="num">出勤骑手</th></tr></thead><tbody>'+
      days.map(function(d){
        return '<tr><td>'+d.dt+'</td><td class="num">'+d.t+'</td><td class="num">'+d.o+'</td>'+
          '<td class="num" style="color:'+rateColor(d.r)+';font-weight:700">'+pct(d.r)+'</td>'+
          '<td class="num" style="color:#059669">'+pct(d.fullR)+'</td>'+
          '<td class="num" style="color:#0891b2">'+pct(d.t8R)+'</td>'+
          '<td class="num">'+fmt(d.c,1)+'s</td>'+
          '<td class="num" style="color:#d97706">'+pct(d.satR)+'</td>'+
          '<td class="num">'+d.rd+'</td></tr>';
      }).join('')+'</tbody></table></div>';
    var rTab = '<div style="overflow-x:auto"><table><thead><tr>'+
      '<th>排名</th><th>骑手</th><th class="num">单量</th><th class="num">综合分</th><th class="num">超时单</th>'+
      '<th class="num">超时率</th><th class="num">完全妥投率</th><th class="num">T8准时率</th>'+
      '<th class="num">单均复合</th><th class="num">非时效不满意</th><th class="num">超时占比</th></tr></thead><tbody>'+
      (rd.length ? rd.map(function(x,i){
        var sc = scoreOf(x, ctxAll);
        var col = sc>=90 ? '#059669' : (sc>=80 ? '#b45309' : '#dc2626');
        return '<tr class="rrow mrrow" data-ri="'+x.ri+'" title="点击查看 '+escA(x.n)+' 的逐日明细">'+
          '<td><span class="rank'+(i<3?' t'+(i+1):'')+'">'+(i+1)+'</span></td>'+
          '<td style="font-weight:600">'+esc(x.n)+'</td>'+
          '<td class="num">'+x.t+'</td>'+
          '<td class="num" style="font-weight:800;color:'+col+'">'+fmt(sc,1)+'</td>'+
          '<td class="num">'+x.o+'</td>'+
          '<td class="num" style="color:'+rateColor(x.r)+';font-weight:700">'+pct(x.r)+'</td>'+
          '<td class="num" style="color:#059669">'+pct(x.fullR)+'</td>'+
          '<td class="num" style="color:#0891b2">'+pct(x.t8R)+'</td>'+
          '<td class="num">'+fmt(x.c,1)+'s</td>'+
          '<td class="num" style="color:#d97706">'+pct(x.satR)+'</td>'+
          '<td class="num">'+pct(t? x.o/t*100:0)+'</td></tr>';
      }).join('') : '<tr><td colspan="11" class="empty">该站点在当前筛选下无骑手数据</td></tr>')+
      '</tbody></table></div>';
    var html = '<div class="modal-card">'+
      '<div class="mhead"><div><div class="mtitle">'+esc(st)+'</div>'+
      '<div class="muted" style="font-size:12px">'+selText()+' · '+allRd.length+' 名骑手 · '+
      '<b>整个周期 '+days.length+' 天（不随上方日期筛选变化）</b></div></div>'+
      '<div style="display:flex;gap:8px;align-items:center;flex:0 0 auto">'+
      '<button class="expbtn" id="mexp" style="margin-left:0">🖼 导出图片</button>'+
      '<button class="mclose" id="mclose">✕</button></div></div>'+
      '<div class="mgrid">'+
        mcell('单量', t) + mcell('超时单', o) +
        mcell('超时率', pct(t? o/t*100:0)) + mcell('单均复合', fmt(t? m/t:0,1)+'s') +
        mcell('超时占比', pct(tot.o? o/tot.o*100:0)) + mcell('复合时长占比', pct(tot.s? m/tot.s*100:0)) +
        mcell('复合总时长', Math.round(m)+'s') + mcell('出勤骑手', allRd.length) +
      '</div>'+
      metricBlock(metricsOf((function(){ var v=newVec(); days.forEach(function(d){ addVec(v, d._v) }); return v })()), ctxSt)+
      statLine(days)+
      '<div class="mlegend"><span><i style="background:'+C_RATE+'"></i>超时率（左轴·实线）</span>'+
        '<span><i style="background:'+C_COMP+'"></i>单均复合（右轴·虚线）</span>'+
        '<span style="color:#98a2b3">点上/点下数字为每日实际值，峰值带光环</span></div>'+
      lineChart(days)+
      '<div class="mtabcap">📅 每日明细（整个周期）</div>'+ dayTab +
      '<div class="mtabcap">👥 该站骑手排行 <span style="font-weight:400;color:#98a2b3">共 '+allRd.length+' 名出勤，'+
        '按最少单量 ≥ '+scope.min+' 显示 '+rd.length+' 名（<b>按综合评价分降序</b>）；点任一行看逐日明细</span></div>'+ rTab +
      '</div>';
    var mo = $('#modal');
    mo.className = 'modal';
    mo.innerHTML = html; mo.classList.add('show');
    _modalOpenedAt = Date.now();
    $('#mclose').onclick = function(){ mo.classList.remove('show') };
    $('#mexp').onclick = function(e){
      e.stopPropagation();
      doExport(mo.querySelector('.modal-card'), st+' 全周期明细',
        { backLabel:'返回站点明细', back:function(){ openStation(st) } });
    };
    mo.querySelectorAll('tr.mrrow').forEach(function(tr){
      tr.onclick = function(){ openRider(+tr.getAttribute('data-ri')) };
    });
  }

  /* ================= 上传 ================= */
  function setStatus(msg, isErr){
    var el = $('#upStatus'); if(!el) return;
    el.innerHTML = msg; el.style.color = isErr ? '#dc2626' : '#475467';
  }
  /* 由剔除行构建与内置数据同构的明细结构 */
  function buildExcl(rows){
    var EK = ['nofault','other','fault','undeliv'];
    var bySt = {}, byRd = {}, byDt = {}, stT = {}, rdT = {};
    function blank(){ return {nofault:0,other:0,fault:0,undeliv:0} }
    rows.forEach(function(r){
      var st = r[0], nm = r[1], rid = r[2], k = r[3], dt = r[4] || '';
      if(EK.indexOf(k) < 0) return;
      var o = bySt[st] || (bySt[st] = blank()); o[k]++;
      stT[st] = (stT[st]||0) + 1;
      var rk = nm + '\u0001' + st + '\u0001' + rid;
      var o2 = byRd[rk] || (byRd[rk] = blank()); o2[k]++;
      rdT[rk] = (rdT[rk]||0) + 1;
      if(/^\d{4}-\d{2}-\d{2}$/.test(dt)){
        var o3 = byDt[dt] || (byDt[dt] = blank()); o3[k]++;
      }
    });
    function arr(map, keyFn, totals){
      return Object.keys(map).sort(function(a,b){ return totals[b]-totals[a] })
        .map(function(kk){ return keyFn(kk, map[kk]).concat([totals[kk]]); });
    }
    var st_arr = arr(bySt, function(n, v){ return [n, v.nofault, v.other, v.fault, v.undeliv] }, stT);
    var rd_arr = arr(byRd, function(kk, v){
      var p = kk.split('\u0001');
      return [p[0], p[1], p[2], v.nofault, v.other, v.fault, v.undeliv];
    }, rdT);
    var top = {};
    EK.forEach(function(k){
      top[k] = st_arr.filter(function(r){ return r[EK.indexOf(k)+1] > 0 })
        .map(function(r){ return [r[EK.indexOf(k)+1], r[0]] })
        .sort(function(a,b){ return b[0]-a[0] }).slice(0,5);
    });
    return { byDate: byDt, st: st_arr, rd: rd_arr, top: top,
             total: rows.length, dates: Object.keys(byDt).sort() };
  }

  /* ================= 本机数据持久化 =================
     数据只存本地（IndexedDB，回退 localStorage），不随页面分发、不上传服务器 */
  var DB_NAME = 'riderDashDB', KV = 'dataset';
  /* IndexedDB 在个别环境（无头浏览器 / 隐私模式 / 存储受限）可能既不成功也不报错，
     这里统一加超时，避免界面卡在「正在解析…」或永远不恢复数据 */
  function withTimeout(p, ms, tag){
    return new Promise(function(res, rej){
      var done = false;
      var t = setTimeout(function(){ if(!done){ done = true; rej(new Error(tag)) } }, ms);
      p.then(function(v){ if(!done){ done = true; clearTimeout(t); res(v) } },
             function(e){ if(!done){ done = true; clearTimeout(t); rej(e) } });
    });
  }
  function idbOpen(){
    return new Promise(function(res, rej){
      if(!window.indexedDB) return rej(new Error('no-idb'));
      var rq = indexedDB.open(DB_NAME, 1);
      rq.onupgradeneeded = function(){ try{ rq.result.createObjectStore('kv') }catch(e){} };
      rq.onsuccess = function(){ res(rq.result) };
      rq.onerror = function(){ rej(rq.error || new Error('idb-open')) };
    });
  }
  function saveLocal(data){
    var payload = { v: 1, savedAt: Date.now(), data: data };
    return withTimeout(idbOpen(), 4000, 'idb-open-timeout').then(function(db){
      return withTimeout(new Promise(function(res, rej){
        var tx = db.transaction('kv','readwrite');
        tx.objectStore('kv').put(payload, KV);
        tx.oncomplete = function(){ db.close(); res('IndexedDB') };
        tx.onerror = function(){ db.close(); rej(tx.error) };
      }), 4000, 'idb-put-timeout');
    }).catch(function(){
      try{ localStorage.setItem(KV, JSON.stringify(payload)); return 'localStorage' }
      catch(e){ throw new Error('本机存储不可用（隐私模式或空间不足）') }
    });
  }
  function loadLocal(){
    return withTimeout(idbOpen(), 4000, 'idb-open-timeout').then(function(db){
      return withTimeout(new Promise(function(res, rej){
        var tx = db.transaction('kv','readonly'), rq = tx.objectStore('kv').get(KV);
        rq.onsuccess = function(){ db.close(); res(rq.result || null) };
        rq.onerror = function(){ db.close(); rej(rq.error) };
      }), 4000, 'idb-get-timeout');
    }).catch(function(){
      try{ var s = localStorage.getItem(KV); return s ? JSON.parse(s) : null }
      catch(e){ return null }
    });
  }
  function clearLocal(){
    return withTimeout(idbOpen(), 4000, 'idb-open-timeout').then(function(db){
      return withTimeout(new Promise(function(res){
        var tx = db.transaction('kv','readwrite');
        tx.objectStore('kv').delete(KV);
        tx.oncomplete = function(){ db.close(); res(true) };
        tx.onerror = function(){ db.close(); res(false) };
      }), 4000, 'idb-del-timeout');
    }).catch(function(){
      try{ localStorage.removeItem(KV); return true }catch(e){ return false }
    });
  }
  function fmtTime(ms){
    var d = new Date(ms), p = function(n){ return (n<10?'0':'')+n };
    return (d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes());
  }

  /* 有数据 ↔ 空状态 切换 */
  function showDash(){
    $('#dashBody').style.display = '';
    $('#emptyState').style.display = 'none';
  }
  function showEmpty(){
    D = null;
    $('#dashBody').style.display = 'none';
    $('#emptyState').style.display = '';
    setStatus('尚无数据 · 请点「⬆ 载入数据」选择运单明细 xlsx');
  }

  /* 旧版数据（每组 3 字段）升级为 15 字段布局：新字段一律 0，并标记 legacy 以提示重新上传 */
  function normalizeData(dat){
    if(!dat || !dat.grid) return dat;
    var stride = dat.nf || 0;
    if(!stride){
      var c = null;
      for(var i=0;i<dat.grid.length && !c;i++){ var g = dat.grid[i]; if(g && g.length) c = g[0]; }
      stride = c ? Math.round((c.length-1)/4) : 3;
    }
    if(stride === NF){ dat.nf = NF; if(!dat.v) dat.v = 7; return dat }
    dat.legacy = true;
    dat.grid = dat.grid.map(function(day){
      return (day||[]).map(function(e){
        var out = [e[0]];
        for(var b=0;b<4;b++)
          for(var k=0;k<NF;k++) out.push(k<stride ? (e[1+b*stride+k]||0) : 0);
        return out;
      });
    });
    dat.nf = NF;
    return dat;
  }
  function dataSummary(){
    var ex = D.meta.excl, exTxt = '';
    if(ex){
      var parts = [];
      if(ex.nofault) parts.push('无责取消 '+ex.nofault);
      if(ex.other)   parts.push('其他未妥投 '+ex.other);
      if(ex.fault)   parts.push('物流责取消 '+ex.fault);
      if(ex.undeliv) parts.push('在途未送达 '+ex.undeliv);
      var en = (ex.nofault||0)+(ex.other||0)+(ex.fault||0)+(ex.undeliv||0);
      if(en) exTxt = ' · <b>已剔除 '+en+' 单</b>（'+parts.join(' / ')+'）不计入单量';
    }
    return '当前数据：'+D.meta.total+' 单 · '+D.dates.length+' 天（'+D.dates[0]+'~'+D.last+'）· '+D.riders.length+' 骑手 · '+
      '整体超时率 '+pct(D.meta.to/D.meta.total*100)+
      (D.meta.acc ? ' · 接单 '+D.meta.acc+' 单（含未妥投）' : '')+
      (D.meta.fmt ? ' · 口径 '+D.meta.fmt : '') + exTxt;
  }
  function buildControls(){
    $('#daySel').innerHTML = '<option value="__all__">全周期（'+D.dates[0].slice(5)+'~'+D.last.slice(5)+'）</option>' +
      D.dates.slice().reverse().map(function(d){
        return '<option value="'+d+'"'+(d===scope.day?' selected':'')+'>'+d+(d===D.last?'（最新）':'')+'</option>';
      }).join('');
    $('#stSel').innerHTML = '<option value="__all__">全部站点</option>' +
      byStation({f1:'all',f2:'all'}, null).sort(function(a,b){ return a.st.localeCompare(b.st) })
        .map(function(s){ return '<option value="'+esc(s.st)+'">'+esc(s.st)+'</option>' }).join('');
    $('#minSel').value = String(scope.min);
    if($('#rankSel')) $('#rankSel').value = String(scope.rank);
  }
  document.addEventListener('change', function(e){
    var t = e.target;
    if(t.id==='daySel'){ scope.day = t.value; renderAll(); }
    else if(t.id==='stSel'){ scope.st = t.value; renderAll(); }
    else if(t.id==='minSel'){ scope.min = +t.value; renderTable(); }
    else if(t.id==='rankSel'){ scope.rank = +t.value; renderTable(); }
  });
  document.addEventListener('input', function(e){
    if(e.target.id==='q'){ scope.q = e.target.value; renderTable(); }
  });
  $('#sortSeg').addEventListener('click', function(e){
    var b = e.target.closest('button'); if(!b) return;
    sortKey = b.getAttribute('data-s'); sortDir = -1;
    this.querySelectorAll('button').forEach(function(x){ x.classList.remove('on') });
    b.classList.add('on'); renderTable();
  });
  function applyData(src){
    showDash();
    scope.day = '__all__'; scope.st = '__all__'; scope.q = ''; scope.min = 5; scope.rank = 10;
    if($('#q')) $('#q').value = '';
    buildControls(); renderAll();
  }

  $('#fileInput').addEventListener('change', async function(e){
    var f = e.target.files && e.target.files[0]; if(!f) return;
    try{
      // .json = 本机导出的数据文件，直接载入
      if(/\.json$/i.test(f.name)){
        var rec = JSON.parse(await f.text());
        var dd = rec && rec.data ? rec.data : rec;
        if(!dd || !dd.meta || !dd.meta.total) throw new Error('不是本看板导出的数据文件');
        D = normalizeData(dd); applyData(true);
        var where = await saveLocal(D);
        setStatus('✅ 已载入数据文件 <b>'+esc(f.name)+'</b>：'+dataSummary());
        renderAll();
        return;
      }
      setStatus('⏳ 正在解析 '+esc(f.name)+' …（大文件可能需 10~60 秒）');
      var nd = await parseXlsx(f, function(rows){ setStatus('⏳ 正在解析 '+esc(f.name)+' … 已读 '+rows+' 行'); });
      if(!nd.meta.total) throw new Error('未解析到有效数据行');
      D = nd;
      applyData(true);
      var store = await saveLocal(D).catch(function(err){ return 'ERR:'+err.message });
      if(String(store).indexOf('ERR:') === 0)
        setStatus('⚠️ 已载入 <b>'+esc(f.name)+'</b>：'+dataSummary()+' · <span style="color:#b45309">本机保存失败：'+esc(String(store).slice(4))+'</span>');
      else
        setStatus('✅ 已载入 <b>'+esc(f.name)+'</b>：'+dataSummary()+' · <b>已存本机</b>，下次打开自动恢复');
    } catch(err){
      setStatus('❌ 载入失败：'+esc(err.message), true);
    }
    e.target.value = '';
  });
  $('#upBtn').addEventListener('click', function(){ $('#fileInput').click() });

  // 导出本机数据为 .json（可在其它设备导入，无需重传 11MB xlsx）
  $('#expDataBtn').addEventListener('click', function(){
    if(!D){ setStatus('⚠️ 当前没有数据可导出', true); return; }
    var payload = JSON.stringify({ v: 1, savedAt: Date.now(), data: D });
    var url = URL.createObjectURL(new Blob([payload], {type:'application/json'}));
    var a = document.createElement('a');
    a.href = url;
    a.download = 'dashboard_data_' + D.last + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url) }, 60000);
    setStatus('✅ 已导出数据文件（'+(payload.length/1024).toFixed(0)+' KB），可在其它设备用「⬆ 载入数据」导入');
  });

  // 清空本机数据
  $('#clrBtn').addEventListener('click', async function(){
    if(!D){ setStatus('当前没有数据'); return; }
    if(!confirm('确定清除本机保存的数据吗？\n（仅清本机缓存，可随时重新载入 xlsx）')) return;
    await clearLocal();
    showEmpty();
  });

  /* ================= 导出图片 ================= */
  var EXP_MAX_H = 8000;     // 导出高度上限（CSS px），超出则截断并提示
  var EXP_MAX_PX = 6e6;     // 成图解码内存预算：6M 像素 ≈ 24MB 位图，手机 WebView 才解得动
  var PREV_MAX_PX = 4e6;    // 弹窗预览缩略图的像素预算（≈16MB 位图，兼顾清晰度与手机内存）
  var blobUrls = [];        // 待释放的 object URL
  function freeBlobs(){
    blobUrls.forEach(function(u){ try{ URL.revokeObjectURL(u) }catch(e){} });
    blobUrls = [];
  }
  function makeUrl(blob){ var u = URL.createObjectURL(blob); blobUrls.push(u); return u; }
  function toBlob(cv){
    return new Promise(function(res){
      if(cv.toBlob) cv.toBlob(function(b){ res(b) }, 'image/png');
      else res(null);
    });
  }
  function downScale(cv, maxW, budget){
    var s = Math.min(1, maxW/cv.width, Math.sqrt(budget/(cv.width*cv.height)));
    var pv = document.createElement('canvas');
    pv.width = Math.max(1, Math.round(cv.width*s));
    pv.height = Math.max(1, Math.round(cv.height*s));
    var c2 = pv.getContext('2d');
    if('imageSmoothingQuality' in c2) c2.imageSmoothingQuality = 'high';
    c2.drawImage(cv, 0, 0, pv.width, pv.height);
    return pv;
  }
  function allDays(){ var a=[]; for(var i=0;i<D.grid.length;i++) a.push(i); return a }

  // 找出需要横向展开的容器，返回「额外需要增加的宽度」
  function extraWidth(el){
    var extra = 0, list = el.querySelectorAll('*');
    for(var i=0;i<list.length;i++){
      var st = getComputedStyle(list[i]);
      if((st.overflowX==='auto'||st.overflowX==='scroll') &&
         list[i].scrollWidth > list[i].clientWidth + 1){
        extra = Math.max(extra, list[i].scrollWidth - list[i].clientWidth);
      }
    }
    return Math.ceil(extra);
  }
  function exportClone(el, innerW){
    var clone = el.cloneNode(true);
    clone.querySelectorAll('.expbtn').forEach(function(b){ b.remove() });
    clone.querySelectorAll('.mclose').forEach(function(b){ b.remove() });
    clone.style.width = innerW+'px';
    clone.style.maxWidth = 'none';
    clone.style.maxHeight = 'none';
    clone.style.overflow = 'visible';
    var clipped = false, capped = [];
    // 纵向：还原被 max-height 截断的滚动区（高度需从原节点读取，克隆体未入文档时 scrollHeight=0）
    var origs = el.querySelectorAll('.scroll');
    clone.querySelectorAll('.scroll').forEach(function(s, i){
      var need = origs[i] ? origs[i].scrollHeight : 0;
      s.style.maxHeight = 'none';
      if(need > EXP_MAX_H){ s.style.maxHeight = EXP_MAX_H+'px'; clipped = true; capped.push(s); }
    });
    // 横向：一律展开，宽度已按内容加宽，不会再被裁掉
    clone.querySelectorAll('*').forEach(function(e){
      var attr = (e.getAttribute('style')||'') + ' ' + (typeof e.className==='string'? e.className : '');
      if(attr.indexOf('overflow')>=0 || attr.indexOf('scroll')>=0){
        e.style.overflowX = 'visible';
        e.style.maxWidth = 'none';
        if(capped.indexOf(e)<0) e.style.overflowY = 'visible';
      }
    });
    if(capped.length){ capped.forEach(function(s){ s.style.overflowX='visible'; s.style.overflowY='hidden' }) }
    return { node: clone, clipped: clipped };
  }
  async function modToPng(el, scale){
    scale = scale || 2;
    var extra = extraWidth(el);
    var innerW = (el.offsetWidth || 380) + extra;
    var c = exportClone(el, innerW), clone = c.node;
    var holder = document.createElement('div');
    holder.style.cssText = 'position:absolute;left:-99999px;top:0;width:'+(innerW+32)+'px;box-sizing:border-box;'+
      'padding:16px;background:#f4f6fa;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif';
    holder.appendChild(clone);
    document.body.appendChild(holder);
    clone.style.width = '';                     // 交给 holder 决定（减去内边距）
    var w = innerW + 32, h = holder.offsetHeight;
    var css = document.querySelector('style').textContent;
    var xml = new XMLSerializer().serializeToString(clone);
    document.body.removeChild(holder);
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'">'+
      '<foreignObject x="0" y="0" width="'+w+'" height="'+h+'">'+
      '<div xmlns="http://www.w3.org/1999/xhtml" style="width:'+w+'px;height:'+h+'px;padding:16px;box-sizing:border-box;background:#f4f6fa">'+
      '<style>'+css+'</style>'+xml+'</div></foreignObject></svg>';
    var img = new Image();
    var ok = await new Promise(function(res){
      img.onload = function(){ res(true) }; img.onerror = function(){ res(false) };
      img.src = 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
      setTimeout(function(){ res(false) }, 8000);
    });
    if(!ok) throw new Error('图片渲染失败');
    var cv = document.createElement('canvas');
    var sc = Math.max(1, Math.min(scale, Math.sqrt(EXP_MAX_PX/(w*h))));
    sc = Math.round(sc*100)/100;
    cv.width = Math.round(w*sc); cv.height = Math.round(h*sc);
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#f4f6fa'; ctx.fillRect(0,0,cv.width,cv.height);
    ctx.scale(sc,sc);
    ctx.drawImage(img,0,0);
    var full = { w: cv.width, h: cv.height };
    var pv = downScale(cv, 1000, PREV_MAX_PX);
    var prev = { w: pv.width, h: pv.height };
    var prevBlob = await toBlob(pv);
    var fullBlob = await toBlob(cv);
    cv.width = cv.height = 0; pv.width = pv.height = 0;   // 立即释放位图内存
    if(!prevBlob || !fullBlob) throw new Error('图片编码失败（内容过大）');
    return {
      url: makeUrl(prevBlob), dl: makeUrl(fullBlob),
      w: Math.round(w), h: Math.round(h),
      outW: full.w, outH: full.h, prevW: prev.w, prevH: prev.h,
      scale: sc, clipped: c.clipped
    };
  }
  function toast(msg, ms){
    var t = $('#toast');
    t.innerHTML = msg; t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function(){ t.classList.remove('show') }, ms||2200);
  }
  function showExport(name, res){
    var fn = name.replace(/[\\/:*?"<>|]/g,'_') + '_' + D.last + '.png';
    var mo = $('#modal');
    mo.className = 'modal full';
    freeBlobsLater(res);
    mo.innerHTML = '<div class="modal-card">'+
      '<div class="exp-head"><div style="min-width:0">'+
        '<div class="mtitle" style="font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(name)+' · 导出图片</div>'+
        '<div class="muted" style="font-size:11.5px;margin-top:2px">成图 '+res.outW+' × '+res.outH+' px'+
          (res.outW > res.prevW ? ' · 预览缩略图 '+res.prevW+'×'+res.prevH : '')+
          (res.clipped ? ' · <span style="color:#b45309">内容过长已截断</span>' : '')+' · 长按图片可保存</div></div>'+
        '<button class="mclose" id="mclose">✕</button></div>'+
      '<div class="exp-body fitw" id="expBody">'+
        '<img id="prevImg" style="display:none">'+
        '<div id="prevFail" class="muted" style="display:none;margin:20px auto;padding:18px;text-align:center;'+
          'max-width:300px;border:1px dashed #d0d5dd;border-radius:10px;font-size:12.5px">'+
          '当前设备内存不足以预览这张长图，请直接点「下载 PNG」保存原图</div>'+
      '</div>'+
      '<div class="exp-foot">'+
        '<button class="btn ghost" id="modeBtn">整图</button>'+
        '<a class="btn" download="'+fn+'" id="dlBtn" href="'+res.dl+'" style="text-decoration:none;display:inline-block;text-align:center">下载 PNG</a>'+
        (res.back ? '<button class="btn ghost" id="mback">'+esc(res.backLabel||'返回')+'</button>' : '')+
        '<button class="btn ghost" id="mclose2">关闭</button>'+
      '</div></div>';
    mo.classList.add('show');
    _modalOpenedAt = Date.now();
    var pi = $('#prevImg'), body = $('#expBody'), mode = 'fitw';
    function applyMode(){
      if(!pi.naturalWidth) return;
      var aw = body.clientWidth - 20, ah = body.clientHeight - 20;
      if(mode === 'fitw'){
        pi.style.width = Math.min(aw, pi.naturalWidth || aw)+'px'; pi.style.height = 'auto';
        $('#modeBtn').textContent = '整图';
      }else{
        var s = Math.min(aw/pi.naturalWidth, ah/pi.naturalHeight);
        pi.style.width = Math.max(40, Math.round(pi.naturalWidth*s))+'px';
        pi.style.height = 'auto';
        $('#modeBtn').textContent = '适应宽度';
      }
      body.scrollTop = 0;
    }
    pi.onload = function(){ pi.style.display='block'; applyMode() };
    pi.onerror = function(){ pi.style.display='none'; $('#prevFail').style.display='block' };
    pi.src = res.url;
    window.addEventListener('resize', applyMode);
    setTimeout(function(){
      if(!pi.naturalWidth && pi.style.display !== 'none' && pi.src){
        pi.style.display='none'; $('#prevFail').style.display='block';
      }
    }, 6000);
    $('#modeBtn').onclick = function(){ mode = (mode==='fitw'?'fith':'fitw'); applyMode() };
    var close = function(){ mo.classList.remove('show'); window.removeEventListener('resize', applyMode) };
    $('#mclose').onclick = close; $('#mclose2').onclick = close;
    if(res.back && $('#mback')) $('#mback').onclick = function(){ res.back() };
  }
  // 关闭弹窗后再释放 blob（立即释放会让正在显示的图片变成空白）
  function freeBlobsLater(res){
    var urls = [res.url, res.dl];
    setTimeout(function(){
      urls.forEach(function(u){ try{ URL.revokeObjectURL(u) }catch(e){} });
    }, 60000);
  }
  async function doExport(el, name, opt){
    opt = opt || {};
    name = name || el.getAttribute('data-name') || '导出';
    toast('🖼 正在生成「'+name+'」…', 6000);
    try{
      var res = await modToPng(el, 2);
      toast('✅ 已生成', 900);
      res.backLabel = opt.backLabel; res.back = opt.back;
      showExport(name, res);
    }catch(e){
      toast('❌ 导出失败：'+esc(e.message), 3000);
    }
  }
  function initExport(){
    document.querySelectorAll('.mod').forEach(function(mod){
      var title = mod.querySelector('.sec-title');
      if(!title || title.querySelector('.expbtn')) return;
      var b = document.createElement('button');
      b.className = 'expbtn'; b.type = 'button'; b.innerHTML = '🖼 导出图片';
      b.onclick = function(e){ e.stopPropagation(); doExport(mod) };
      title.appendChild(b);
    });
  }

  /* ================= 初始化 ================= */
  window.__build = 'v30';   // 版本标记（便于排查缓存）
  /* ================= 剔除明细 ================= */
  var EKIND = [
    { k:'nofault', lab:'无责取消', s:'无责', col:'#0ea5e9', hint:'用户/商户取消' },
    { k:'other',   lab:'其他未妥投', s:'其他', col:'#94a3b8', hint:'旧格式未标原因' },
    { k:'fault',   lab:'物流责取消', s:'物流责', col:'#f59e0b', hint:'判定物流责任' },
    { k:'undeliv', lab:'在途未送达', s:'在途', col:'#f43f5e', hint:'导出时仍在途' }
  ];
  var EK = EKIND.map(function(x){ return x.k });
  var exclView = 'st';

  function exclTot(v){ return EK.reduce(function(a,k){ return a + (v[k]||0) }, 0); }

  function renderExcl(){
    var E = D.excl;
    if(!E || !E.total){ $('#exclSummary').innerHTML = ''; $('#exclTableWrap').innerHTML = ''; $('#exclTag').textContent = ''; return; }
    var tot = E.total;
    // 顶部四类汇总
    var sums = {}; EK.forEach(function(k){ sums[k] = (D.meta.excl && D.meta.excl[k]) || 0 });
    $('#exclSummary').innerHTML = EKIND.map(function(x){
      var n = sums[x.k] || 0;
      return '<div class="ecard" style="border-left-color:'+x.col+'">'+
        '<div class="elab">'+x.lab+' <em>'+(tot? (n/tot*100).toFixed(0):0)+'%</em></div>'+
        '<div class="eval" style="color:'+x.col+'">'+n+'</div>'+
        '<div class="ehint">'+x.hint+'</div>'+
        '<div class="ebar"><i style="width:'+(tot? n/tot*100:0)+'%;background:'+x.col+'"></i></div>'+
        '</div>';
    }).join('') +
      '<div class="ecard" style="border-left-color:#334155">'+
      '<div class="elab">合计</div><div class="eval">'+tot+'</div>'+
      '<div class="ehint">不计入单量</div>'+
      '<div class="ehint">占总量 '+
      (D.meta.total? (tot/(D.meta.total+tot)*100).toFixed(2):'0')+'%</div></div>';

    renderExclTable();
  }

  function renderExclTable(){
    var E = D.excl;
    var html = '';
    if(exclView === 'st'){
      var head = ['站点','无责取消','其他未妥投','物流责取消','在途未送达','合计',''];
      var mx = Math.max.apply(null, E.st.map(function(r){ return r[5] }));
      html = '<table class="xtab"><thead><tr>'+
        head.map(function(h,i){ return '<th'+(i?' class="num"':'')+'>'+h+'</th>' }).join('')+'</tr></thead><tbody>'+
        E.st.map(function(r){
          return '<tr><td class="sname">'+esc(r[0])+'</td>'+
            EK.map(function(k,i){ return '<td class="num">'+(r[i+1]||'<span class="mut">–</span>')+'</td>' }).join('')+
            '<td class="num"><b>'+r[5]+'</b></td>'+
            '<td class="barcell"><span class="xb" style="width:'+(r[5]/mx*100)+'%"></span>'+
            '<em>'+r[5]+'</em></td></tr>';
        }).join('')+'</tbody></table>';
    } else if(exclView === 'rd'){
      html = '<table class="xtab"><thead><tr><th>骑手</th><th>站点</th>'+
        EKIND.map(function(x){ return '<th class="num">'+x.s+'</th>' }).join('')+
        '<th class="num">合计</th></tr></thead><tbody>'+
        E.rd.slice(0,60).map(function(r){
          return '<tr><td class="sname">'+esc(r[0])+'</td><td class="mut">'+esc(r[1].replace('福州',''))+'</td>'+
            EK.map(function(k,i){ var n=r[i+3]; return '<td class="num">'+(n||'<span class="mut">–</span>')+'</td>' }).join('')+
            '<td class="num"><b>'+r[7]+'</b></td></tr>';
        }).join('')+'</tbody></table>';
      if(E.rd.length > 60)
        html += '<div class="muted" style="padding:8px 2px;font-size:12px">仅显示前 60 名（共 '+E.rd.length+' 名骑手涉及剔除单）</div>';
    } else {
      html = '<table class="xtab"><thead><tr><th>日期</th>'+
        EKIND.map(function(x){ return '<th class="num">'+x.lab+'</th>' }).join('')+
        '<th class="num">合计</th></tr></thead><tbody>'+
        E.dates.map(function(d){
          var v = E.byDate[d] || {}, t = exclTot(v);
          return '<tr><td class="sname">'+d+'</td>'+
            EK.map(function(k){ var n=v[k]||0; return '<td class="num">'+(n||'<span class="mut">–</span>')+'</td>' }).join('')+
            '<td class="num"><b>'+t+'</b></td></tr>';
        }).join('')+'</tbody></table>';
    }
    $('#exclTableWrap').innerHTML = html;

    // 洞察注释
    var top = E.top || {}, notes = [];
    EKIND.forEach(function(x){
      var t = top[x.k];
      if(t && t.length && t[0][0] > 0) notes.push(x.lab+'最多：<b>'+esc(t[0][1].replace('福州',''))+'</b>（'+t[0][0]+' 单）');
    });
    $('#exclNote').innerHTML = '说明：'+notes.join(' · ')+
      '<br>这些运单的超时判定恒为 0（平台对未送达单不判超时），因此<b>剔除只影响分母单量、不影响超时单数与复合时长</b>；'+
      '不计入单量可避免单量虚高、超时率被稀释。';
    $('#exclTag').textContent = E.total+' 单（占导出总量 '+
      (D.meta.total+E.total ? (E.total/(D.meta.total+E.total)*100).toFixed(2) : 0)+'%）';
  }

  function bindExcl(){
    $('#exclSeg').addEventListener('click', function(ev){
      var b = ev.target.closest('button'); if(!b) return;
      Array.prototype.forEach.call(this.children, function(x){ x.classList.remove('on') });
      b.classList.add('on'); exclView = b.getAttribute('data-v'); renderExclTable();
    });
  }

  function renderAll(){
    if(!D) return;
    renderFilterBar();
    LASTBYD = renderKPI();
    drawTrend(LASTBYD);
    renderMetrics(LASTBYD);
    renderScore();
    renderStations();
    renderTable();
    renderExcl();
    var dts = dayList();
    $('#range').textContent = '数据范围 '+D.dates[0]+' ~ '+D.last+' · 共 '+D.dates.length+' 天 · '+
      D.riders.length+' 名骑手 · 站点 '+byStation(sel,dts).length+' 个'+
      (D.meta.src ? ' · 来源 '+D.meta.src : '');
  }
  bindExcl();
  initExport();
  $('#method').innerHTML =
    '<b>指标口径</b>：① <b>超时单</b>=「超平台期望送达时长」≥ 8 分钟（480 秒）的运单；'+
    '② <b>超时率</b>=超时单量 ÷ 总单量；<b>单量仅统计「配送成功」运单</b>，已剔除取消单（无责取消 / 物流责取消）与在途未送达单；'+
    '③ <b>日期基准</b>=运单终态日（即送达日期），跨零点的夜间单归入实际送达当天；'+
    '④ <b>复合时长</b>=按分段累加计费模型折算的超时时长；'+
    '⑤ <b>超时占比</b>=该骑手超时单 ÷ 当前范围全部骑手超时单；'+
    '⑥ <b>复合占比</b>=该骑手复合时长合计 ÷ 当前范围全部骑手合计。'+
    '<br><b>分段累加计费模型</b>（每档隐含上一档封顶值）——'+
    '<b>≤8 分钟</b>：豁免；'+
    '<b>8~15 分钟</b>：1 倍，= (t − 480)；'+
    '<b>15~30 分钟</b>：1.5 倍，= 420 + (t − 900) × 1.5；'+
    '<b>&gt;30 分钟</b>：2 倍，= 1770 + (t − 1800) × 2，且总封顶 <b>5400 秒（90 分钟）</b>。'+
    '<br><b>排名筛选</b>：骑手明细的「排名」列 = <b>超时率排名</b>（在「最少单量 / 站点 / 搜索」筛选出的候选池内，1 = 超时率最高，并列时超时单多者在前）；'+
    '右侧「超时率前 5%/10%/15%/20%」按该排名只保留前 N%（默认 <b>10%</b>），选「全部」则不过滤。'+
    '<br><b>交互</b>：点击表头任一项排序；点击骑手行查看其<b>全量</b>逐日折线明细；'+
    '<b>点击站点卡片</b> → 查看该站<b>整个周期</b>的逐日趋势折线（带每日数据标注与峰值光环）、每日明细表、以及该站骑手排行（可再点进单个骑手）；'+
    '以上明细均不受上方日期筛选影响；'+
    '每个板块右上角「导出图片」可把该板块保存为 PNG；顶部可上传新的运单明细 xlsx，数据在本地浏览器解析，不会上传到任何服务器。'+
    '<br><br><b style="font-size:13px">四项考核指标（平台公式）</b>'+
    '<br>① <b>完全妥投率</b> = 有效完单 ÷（有效完单 + 物流责未完成单 + 高笔单物流责未完成单×1 + 星巴克物流责未完成单×2 + 虚假报备出餐慢取消单 + 虚假改派吸单 + 虚假改派规避妥投单 + 提前点送达单×2）；页面展示其补数「<b>不完全妥投率</b>」。'+
    '<br>② <b>预测T8准时率</b> =（T8准时单 − 虚假报备出餐慢取消单 − 虚假改派偷准达 − 提前点送达单×2）÷（有效完单 + 高笔单T8非准时单×1 + 星巴克非准时单×2）；T8 超时 = 超平台期望送达时长 ≥ 480 秒（8 分钟）。'+
    '<br>③ <b>单均复合超时时长</b> = 复合超时时长合计 ÷ 剔除前有效完单（轻度 8~15 分钟 1 倍 / 普通 15~30 分钟 1.5 倍 / 严重 &gt;30 分钟 2 倍，封顶 90 分钟）。'+
    '<br>④ <b>非时效不满意度</b> =（有效投诉单×5 + 有效差评单×5 + 有效索赔单 + 虚假报备出餐慢取消单）÷ 接单量。'+
    '<br><b>团队占比</b>（骑手表「质量指标视图」、骑手/站点弹窗、综合评价分榜）= 该对象的<b>加权分子</b> ÷ 当前范围全部骑手的加权分子合计；'+
    '加权系数即平台公式里的 ×2 / ×5 —— 例如有效差评按 5 单计、提前点送达按 2 单计、高笔非准时按 2 单计入 T8 分母。'+
    '<br><b>综合评价分 = 100 −（0.2×① + 0.3×② + 0.15×③ + 0.2×④）×100</b>（①不完全妥投 ②T8超时 ③单均复合时长 ④非时效不满意）；'+
    '默认口径 <b>「按占比」</b>= 该对象各项扣分 ÷ 全体同类对象该项扣分之和（各项扣分先对全体求和、再算占比）—— '+
    '不受单量规模影响，订单多的站点不会因为「问题量天然多」被拉低。悬停榜单任意一行可看<b>扣分拆解</b>（每项「占比 × 权重 × 100 = 扣分」）。'+
    '<br>★ <b>层级放大</b>：占比的分母是团队全员合计，同一层级对象越多、单个占比越小 —— '+
    '站点层级只有几个对象（占比 16%~34%，量级正常）→ 原始占比直接代入；'+
    '骑手层级有一两百人（人均占比仅 ~0.5%）→ <b>×'+LEVEL_AMP.rider+'</b> 放大后代入，否则全场挤在 97~100 没有区分度。'+
    '该放大<b>只作用于骑手</b>，站点分与团队扣分汇总不受影响。'+
    '另两档口径：「<b>团队占比·原式</b>」= 该对象加权分子 ÷ 团队加权分子合计（占比 ≈ 单量 × 率值，大站必然偏高，仅作对照）；'+
    '「<b>自身率值</b>」= ①不完全妥投率 ②T8超时率 ③单均复合÷团队均值（封顶 2）④非时效不满意度，完全与单量无关。'+
    '<br><b>团队综合分</b>（综合评价分板块的「团队扣分汇总」）= 各站点「扣分合计」按<b>单量占比</b>加权求和得到团队扣分，再取 100 − 团队扣分；'+
    '数值上等于「用团队整体率值算出的综合分」，所以团队分不会被站点数量多少影响。表内「占团队扣分」= 该站对团队扣分的贡献比重（各站合计 100%）。'+
    '<br><b>上传要求</b>：支持两种导出格式，自动识别 ——'+
    '① <b>运单明细</b>（73 列）：需含 骑手id、运单状态、超平台期望送达时长；'+
    '投诉取「用户投诉是否成立」、差评取「用户评价等级」（吐槽/差评/不满意）、索赔取「索赔是否成立」、'+
    '提前点送达取「违规送达是否成立」、虚假报备出餐慢取「虚假报备是否成立」+「虚假报备项」含出餐慢、品牌取「平台商家名称」（星巴克）；'+
    '② <b>考核明细</b>（63 列）：需含 日期、骑手id、是否妥投单、是否准时单（考核）；'+
    '四指标取「是否投诉单 / 是否差评单 / 是否索赔单 / 是否提前点送达不满意单 / 是否虚假报备出餐慢取消单 / 是否虚假改派吸单 / 是否虚假改派规避妥投单 / 是否虚假改派偷准达 / 是否高笔单」。'+
    '两种格式都可选 骑手姓名/名称、站点名称；数据源缺少的列一律按 0 计，页面顶部会给出提示。'+
    '<br><b>上传时同样会剔除</b>取消单与未妥投单（运单明细按「运单状态=配送成功」，考核明细按「是否妥投单=是」）不计入单量，但<b>仍计入接单量</b>（④的分母）与<b>加权未完成单</b>（①的分母）；并按运单终态日归入日期，与内置数据口径完全一致。'+
    '<br><b>T8 口径提示</b>：本看板 T8 超时统一按「超平台期望送达时长 ≥ 480 秒」判定，两种格式一致；与平台「是否准时单（考核）」列会有少量差异（平台另有卡餐剔除、兜底等规则）。';
  window.__parseXlsx = parseXlsx;   // 供自动化测试

  /* 启动：优先用内置数据（离线单文件版）；否则读本机缓存；都没有则显示空状态 */
  if(D){
    D = normalizeData(D);
    showDash(); buildControls(); renderAll(); setStatus(dataSummary());
  } else {
    showEmpty();
    loadLocal().then(function(rec){
      if(rec && rec.data && rec.data.meta && rec.data.meta.total){
        D = normalizeData(rec.data);
        showDash(); buildControls(); renderAll();
        setStatus('✅ 已从本机恢复数据（保存于 '+fmtTime(rec.savedAt)+'）：'+dataSummary());
      }
    }).catch(function(){ /* 保持空状态 */ });
  }
})();
