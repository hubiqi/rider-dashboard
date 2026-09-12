/* 骑手超时绩效看板 v3 — 支持上传数据 / 全维度排序 / 占比 / 骑手明细折线 */
(function(){
  var D = window.DATA || null;   // 页面不再内置数据，仅当离线单文件版注入时才有值
  var $ = function(s){ return document.querySelector(s) };
  var tip = $('#tip');

  /* ================= 状态 ================= */
  var sel = { f1:'all', f2:'all' };      // 标签筛选
  var scope = { day:'__all__', st:'__all__', min:5, q:'' };
  var sortKey = 'o', sortDir = -1;       // 默认按超时单数降序
  var metric = 'rate';

  /* ================= 聚合 ================= */
  function matchB(b, s){
    var b1 = b>=2?1:0, b2 = b%2;
    if(s.f1!=='all' && (s.f1==='yes') !== (b1===1)) return false;
    if(s.f2!=='all' && (s.f2==='yes') !== (b2===1)) return false;
    return true;
  }
  function cellSum(cell, s){
    var t=0,o=0,m=0;
    for(var b=0;b<4;b++){ if(matchB(b,s)){ t+=cell[b*3]; o+=cell[b*3+1]; m+=cell[b*3+2]; } }
    return [t,o,m];
  }
  function fin(t,o,m){ return {t:t, o:o, s:m, r: t? o/t*100 : 0, c: t? m/t : 0}; }

  function dayList(){                     // 当前日期范围（单日 → [di]，全周期 → all）
    if(scope.day==='__all__'){ var a=[]; for(var i=0;i<D.grid.length;i++) a.push(i); return a; }
    var di = D.dates.indexOf(scope.day); return di<0? [] : [di];
  }
  function aggScope(s, dts){              // 汇总
    var t=0,o=0,m=0;
    (dts||dayList()).forEach(function(di){
      D.grid[di].forEach(function(e){
        var x = cellSum(e.slice(1), s); t+=x[0]; o+=x[1]; m+=x[2];
      });
    });
    return fin(t,o,m);
  }
  function byRider(s, dts){               // 逐骑手
    var acc = {};
    (dts||dayList()).forEach(function(di){
      D.grid[di].forEach(function(e){
        var ri = e[0], x = cellSum(e.slice(1), s);
        var a = acc[ri] || (acc[ri] = [0,0,0]);
        a[0]+=x[0]; a[1]+=x[1]; a[2]+=x[2];
      });
    });
    return Object.keys(acc).map(function(ri){
      var a = acc[ri], r = D.riders[ri], f = fin(a[0],a[1],a[2]);
      f.ri = +ri; f.n = r.n; f.st = r.st; return f;
    });
  }
  function byStation(s, dts){
    var acc = {};
    (dts||dayList()).forEach(function(di){
      D.grid[di].forEach(function(e){
        var st = D.riders[e[0]].st, x = cellSum(e.slice(1), s);
        var a = acc[st] || (acc[st] = [0,0,0]);
        a[0]+=x[0]; a[1]+=x[1]; a[2]+=x[2];
      });
    });
    return Object.keys(acc).map(function(st){
      var a = acc[st], f = fin(a[0],a[1],a[2]); f.st = st; return f;
    });
  }
  function riderDays(ri, s){              // 单个骑手的逐日序列
    var out = [];
    for(var i=0;i<D.grid.length;i++){
      var cell = null;
      D.grid[i].forEach(function(e){ if(e[0]===ri) cell = e.slice(1); });
      if(!cell) continue;
      var x = cellSum(cell, s);
      if(x[0]===0) continue;
      out.push({ dt:D.dates[i], t:x[0], o:x[1], s:x[2], r:x[1]/x[0]*100, c:x[2]/x[0] });
    }
    return out;
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
          f2:   findCol(hdr,['是否出餐慢报备'])
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
      // —— 口径：剔除「取消单 / 未妥投单」，不计入单量 ——
      var kept = true, kind = '';
      if(s.idx.status>=0){                        // 新格式：运单状态
        if(String(cells[s.idx.status]||'').trim() !== '配送成功'){
          kept = false;
          var rsp = s.idx.resp>=0 ? String(cells[s.idx.resp]||'').trim() : '';
          if(rsp==='用户责' || rsp==='商户责'){ s.skip.nofault++; kind='nofault'; }  // 无责取消
          else if(rsp.indexOf('物流责')>=0){   s.skip.fault++;   kind='fault'; }    // 物流责取消
          else {                               s.skip.undeliv++; kind='undeliv'; } // 在途未送达
        }
      }else if(s.idx.toudou>=0){                  // 旧格式：是否妥投单
        if(!truthy(cells[s.idx.toudou])){
          kept = false;
          if(s.idx.cancelFault>=0 && truthy(cells[s.idx.cancelFault])){ s.skip.fault++; kind='fault'; }
          else { s.skip.other++; kind='other'; }   // 旧格式只知道「未妥投」，非物流责的其他原因
        }
      }
      if(!kept){
        s.exclRows.push([ (s.idx.st>=0? (cells[s.idx.st]||'未知站点'):'未知站点'),
                          (s.idx.name>=0? (cells[s.idx.name]||'未知'):'未知'),
                          String(cells[s.idx.rid]||''), kind,
                          (s.idx.cancelT>=0? dateOf(cells[s.idx.cancelT]):'') ||
                          dateOf(cells[s.idx.deliverT]) || dateOf(cells[s.idx.expectT]) ||
                          (s.idx.date>=0? normDate(cells[s.idx.date]):'') ]);
        return;
      }
      // —— 日期：优先独立「日期」列；否则取「运单终态日」= 骑手送达时间 → 运单完成时间 → 平台期望时间 ——
      var dv = s.idx.date>=0 ? cells[s.idx.date] : '';
      if(dv==null || dv==='') dv = dateOf(cells[s.idx.deliverT]);
      if(dv==null || dv==='') dv = dateOf(cells[s.idx.finishT]);
      if(dv==null || dv==='') dv = dateOf(cells[s.idx.expectT]);
      if(dv==null || dv==='') return;
      var rid = cells[s.idx.rid]; if(rid==null || rid==='') return;
      var d = normDate(dv);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
      var ri = s.riders[rid];
      if(ri===undefined){
        ri = s.order.length;
        s.riders[rid] = ri;
        s.order.push({ n: s.idx.name>=0 ? (cells[s.idx.name]||'未知') : ('骑手'+rid),
                       st: s.idx.st>=0 ? (cells[s.idx.st]||'未知站点') : '未知站点', rid: rid });
      }
      // —— 标签：二呼单 / 出餐慢 ——
      var f1 = s.idx.f1>=0 && truthy(cells[s.idx.f1]);
      var f2 = s.idx.f2>=0 ? truthy(cells[s.idx.f2])
                           : (s.idx.report>=0 && slowReport(cells[s.idx.report]));
      var b = (f1?2:0) + (f2?1:0);
      var g = s.grid[d] || (s.grid[d] = {});
      var cell = g[ri] || (g[ri] = [0,0,0,0,0,0,0,0,0,0,0,0]);
      cell[b*3] += 1;
      // —— 超时 & 复合时长 ——
      var isTo, compV;
      if(s.useDur){                             // 含时长列 → 统一 ≥480s 口径
        var ov = isFinite(overS) ? overS : 0;   // 空值按 0 计（不视作超时）
        isTo = ov >= 480;
        compV = composite(ov);
      }else{                                    // 仅考核口径的文件
        isTo = s.idx.onTime>=0 && !truthy(cells[s.idx.onTime]);
        compV = s.idx.comp>=0 ? (parseFloat(cells[s.idx.comp])||0) : 0;
      }
      if(isTo) cell[b*3+1] += 1;
      cell[b*3+2] += compV;
      s.rows++;
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
    var to = 0, comp = 0;
    grid.forEach(function(g){ g.forEach(function(e){
      for(var b=0;b<4;b++){ to += e[1+b*3+1]; comp += e[1+b*3+2]; }
    })});
    return {
      dates: dstr, last: dstr[dstr.length-1], riders: s.order, grid: grid,
      excl: buildExcl(s.exclRows),
      flags: [{key:'f1',label:'是否二呼单'},{key:'f2',label:'是否出餐慢报备'}],
      avail: { f1: s.idx.f1>=0, f2: (s.idx.f2>=0 || s.idx.report>=0) },
      fmt: s.fmt,
      meta: { total: s.rows, to: to, comp: Math.round(comp), src: file.name, excl: s.skip }
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
    comp:{key:'c', lab:'单均复合', unit:'秒', color:'#7c3aed', dec:1},
    tot:{key:'t', lab:'单量', unit:'单', color:'#0ea5e9', dec:0}
  };
  var LASTBYD = null;
  function drawTrend(byD){
    var m = META[metric], k = m.key;
    var data = byD.map(function(x){
      var a = x.a; return { dt:x.dt, r:a.r, c:a.c, t:a.t, o:a.o };
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
        tip.innerHTML = x.dt+' ｜ 超时率 <b>'+pct(x.r)+'</b> ｜ 单均复合 <b>'+fmt(x.c,1)+'s</b> ｜ 单量 '+x.t;
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
    var allSt = byStation(sel, dts).sort(function(a,b){ return b.r-a.r });
    var lastMap = {}; byStation(sel, [D.dates.length-1]).forEach(function(x){ lastMap[x.st]=x });
    var avgRate = aggScope(sel, dts).r;
    $('#stationGrid').innerHTML = allSt.map(function(st){
      var lp = lastMap[st.st] || {t:0,r:0,c:0};
      var trend = dts.map(function(i){
        var t=0,o=0,m=0;
        D.grid[i].forEach(function(e){
          if(D.riders[e[0]].st!==st.st) return;
          var x = cellSum(e.slice(1), sel); t+=x[0]; o+=x[1]; m+=x[2];
        });
        return { r: t? o/t*100:0, c: t? m/t:0 };
      });
      var worst = st.r >= avgRate;
      return '<div class="card stcard">'+
        '<div class="h"><div><div class="stname">'+esc(st.st)+'</div>'+
        '<div class="muted" style="font-size:11.5px;margin-top:2px">'+st.t+' 单 · 超时 '+st.o+' 单 · 单均 '+fmt(st.c,1)+'s</div></div>'+
        '<div style="text-align:right"><div style="font-size:20px;font-weight:800;color:'+(worst?'#ef4444':'#10b981')+'">'+pct(st.r)+'</div>'+
        '<div class="muted" style="font-size:11px">超时率</div></div></div>'+
        '<div style="font-size:11.5px;color:#475467">最新 <b>'+lp.t+'</b> 单 / 超时率 <b>'+pct(lp.r)+'</b> / 单均 <b>'+fmt(lp.c,1)+'</b>s</div>'+
        sparkline(trend, worst?'#ef4444':'#10b981','r')+'</div>';
    }).join('');
  }

  /* ================= 骑手表（可排序 + 占比） ================= */
  var COLS = [
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
  function renderTable(){
    var dts = dayList();
    var base = byRider(sel, dts);
    var tot = aggScope(sel, dts);                 // 全部骑手合计 → 占比分母
    base.forEach(function(x){
      x.shareO = tot.o ? x.o/tot.o*100 : 0;
      x.shareS = tot.s ? x.s/tot.s*100 : 0;
    });
    var list = base.filter(function(x){
      return x.t>=scope.min && (scope.st==='__all__' || x.st===scope.st) &&
             (!scope.q || x.n.indexOf(scope.q)>=0);
    });
    var k = sortKey, dir = sortDir;
    list.sort(function(a,b){
      var va = a[k], vb = b[k];
      if(typeof va === 'string') return va.localeCompare(vb) * dir;
      if(va===vb) return (b.o-a.o) || (b.t-a.t);
      return (va-vb) * dir;
    });

    var thead = '<tr>' + COLS.map(function(c){
      var active = (c.k===k), arrow = active ? (dir>0?' ▲':' ▼') : '', cls = [];
      if(c.num) cls.push('num');
      if(c.sortable!==false) cls.push('sorth');
      if(active) cls.push('on');
      return '<th'+(cls.length?' class="'+cls.join(' ')+'"':'')+(c.sortable===false?'':' data-k="'+c.k+'"')+'>'+c.lab+'<span class="arrow">'+arrow+'</span></th>';
    }).join('') + '</tr>';
    $('#riderTable').querySelector('thead').innerHTML = thead;

    if(!list.length){
      $('#riderTable').querySelector('tbody').innerHTML =
        '<tr><td colspan="'+COLS.length+'" class="empty">无符合条件的数据（可放宽筛选或降低「最少单量」）</td></tr>';
    } else {
      $('#riderTable').querySelector('tbody').innerHTML = list.map(function(x,i){
        var rc = rateColor(x.r), rk = i<3?' t'+(i+1):'';
        return '<tr class="rrow" data-ri="'+x.ri+'">'+
          '<td><span class="rank'+rk+'">'+(i+1)+'</span></td>'+
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
    $('#tblNote').innerHTML = '<b style="color:#1d4ed8">👆 点任意一行骑手可查看逐日明细</b> · 当前：<b>'+(scope.day==='__all__'?'全周期':scope.day)+'</b> · 符合条件 <b>'+list.length+'</b> 名骑手 · '+
      '最少单量 ≥ '+scope.min+' · 排序：'+({idx:'排名',n:'骑手',st:'站点',t:'单量',o:'超时单',r:'超时率',shareO:'超时占比',s:'复合总时长',shareS:'复合占比',c:'单均复合'}[k])+(dir>0?' ↑':' ↓')+
      ' · 占比分母=当前范围全部骑手（超时 '+tot.o+' 单 / 复合合计 '+Math.round(tot.s)+' 秒）';
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
  function lineChart(days){
    if(!days.length) return '<div class="empty">该骑手在当前筛选下无数据</div>';
    var W=720,H=330, pl=54, pr=60, pt=38, pb=48;
    var iw=W-pl-pr, ih=H-pt-pb, n=days.length;
    var maxR = Math.max.apply(null, days.map(function(d){return d.r}).concat([1]))*1.3;
    var maxC = Math.max.apply(null, days.map(function(d){return d.c}).concat([1]))*1.3;
    function X(i){ return n===1 ? pl+iw/2 : pl + iw*i/(n-1) }
    function YR(v){ return pt + ih - v/maxR*ih }
    function YC(v){ return pt + ih - v/maxC*ih }
    var s = '<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="xMidYMid meet">';
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
    days.forEach(function(d,i){
      var x = X(i).toFixed(1);
      var yr = YR(d.r), yc = YC(d.c);
      s += '<circle cx="'+x+'" cy="'+yr.toFixed(1)+'" r="3.6" fill="#fff" stroke="'+C_RATE+'" stroke-width="2.2"/>';
      s += '<circle cx="'+x+'" cy="'+yc.toFixed(1)+'" r="3.2" fill="#fff" stroke="'+C_COMP+'" stroke-width="2"/>';
      // 数据标注：默认超时率在上、复合时长在下；贴边时互换，两者过近时再错开
      var ry = yr - 9;
      if(ry < pt + 9) ry = yr + 15;
      var cy = yc + 16;
      if(cy > PB - 5) cy = yc - 10;
      if(cy > PB - 5) cy = PB - 6;
      if(Math.abs(ry - cy) < 13){ ry = cy - 13; if(ry < pt + 9) ry = cy + 13; }
      s += '<text x="'+x+'" y="'+ry.toFixed(1)+'" text-anchor="middle" font-size="10.5" font-weight="700" '+
           'fill="'+C_RATE+'" filter="url(#halo)">'+d.r.toFixed(1)+'%</text>';
      s += '<text x="'+x+'" y="'+cy.toFixed(1)+'" text-anchor="middle" font-size="10.5" font-weight="700" '+
           'fill="'+C_COMP+'" filter="url(#halo)">'+Math.round(d.c)+'s</text>';
      s += '<text x="'+x+'" y="'+(H-pb+22)+'" text-anchor="middle" font-size="11" fill="#98a2b3">'+d.dt.slice(5)+'</text>';
    });
    s += '</svg>';
    return s;
  }
  function openRider(ri){
    var days = riderDays(ri, sel);            // 始终取该骑手全部日期的数据
    var r = D.riders[ri];
    var t=0,o=0,m=0;
    days.forEach(function(d){ t+=d.t; o+=d.o; m+=d.s });
    var tot = aggScope(sel, allDays());       // 占比分母同样用全量日期
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
      '<div class="mlegend"><span><i style="background:'+C_RATE+'"></i>超时率（左轴·实线）</span>'+
        '<span><i style="background:'+C_COMP+'"></i>单均复合（右轴·虚线）</span>'+
        '<span style="color:#98a2b3">点上/点下数字为每日实际值</span></div>'+
      lineChart(days)+
      '<div style="overflow-x:auto;margin-top:12px"><table><thead><tr><th>日期</th><th class="num">单量</th><th class="num">超时单</th><th class="num">超时率</th><th class="num">单均复合</th></tr></thead><tbody>'+
        days.map(function(d){
          return '<tr><td>'+d.dt+'</td><td class="num">'+d.t+'</td><td class="num">'+d.o+'</td>'+
            '<td class="num">'+pct(d.r)+'</td><td class="num">'+fmt(d.c,1)+'s</td></tr>';
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
    return idbOpen().then(function(db){
      return new Promise(function(res, rej){
        var tx = db.transaction('kv','readwrite');
        tx.objectStore('kv').put(payload, KV);
        tx.oncomplete = function(){ db.close(); res('IndexedDB') };
        tx.onerror = function(){ db.close(); rej(tx.error) };
      });
    }).catch(function(){
      try{ localStorage.setItem(KV, JSON.stringify(payload)); return 'localStorage' }
      catch(e){ throw new Error('本机存储不可用（隐私模式或空间不足）') }
    });
  }
  function loadLocal(){
    return idbOpen().then(function(db){
      return new Promise(function(res, rej){
        var tx = db.transaction('kv','readonly'), rq = tx.objectStore('kv').get(KV);
        rq.onsuccess = function(){ db.close(); res(rq.result || null) };
        rq.onerror = function(){ db.close(); rej(rq.error) };
      });
    }).catch(function(){
      try{ var s = localStorage.getItem(KV); return s ? JSON.parse(s) : null }
      catch(e){ return null }
    });
  }
  function clearLocal(){
    return idbOpen().then(function(db){
      return new Promise(function(res){
        var tx = db.transaction('kv','readwrite');
        tx.objectStore('kv').delete(KV);
        tx.oncomplete = function(){ db.close(); res(true) };
        tx.onerror = function(){ db.close(); res(false) };
      });
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
  }
  document.addEventListener('change', function(e){
    var t = e.target;
    if(t.id==='daySel'){ scope.day = t.value; renderAll(); }
    else if(t.id==='stSel'){ scope.st = t.value; renderAll(); }
    else if(t.id==='minSel'){ scope.min = +t.value; renderTable(); }
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
    scope.day = '__all__'; scope.st = '__all__'; scope.q = ''; scope.min = 5;
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
        D = dd; applyData(true);
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
  window.__build = 'v29';   // 版本标记（便于排查缓存）
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
    '<br><b>交互</b>：点击表头任一项排序；点击骑手行查看其<b>全量</b>逐日折线明细（不受上方日期筛选影响）；'+
    '每个板块右上角「导出图片」可把该板块保存为 PNG；顶部可上传新的运单明细 xlsx，数据在本地浏览器解析，不会上传到任何服务器。'+
    '<br><b>上传要求</b>：支持两种导出格式，自动识别 ——'+
    '① <b>新格式</b>（运单明细）：需含列 骑手id、超平台期望送达时长、运单状态；'+
    '「是否二呼单」直接取值，「异常报备项」含「商户出货慢」即判为出餐慢；'+
    '② <b>旧格式</b>：需含列 日期、骑手id、是否准时单（考核）、是否妥投单、是否出餐慢报备。'+
    '两种格式都可选 骑手姓名/名称、站点名称。'+
    '<br><b>上传时同样会剔除</b>取消单与未妥投单（新格式按「运单状态=配送成功」，旧格式按「是否妥投单=是」），'+
    '并按运单终态日归入日期，与内置数据口径完全一致。';
  window.__parseXlsx = parseXlsx;   // 供自动化测试

  /* 启动：优先用内置数据（离线单文件版）；否则读本机缓存；都没有则显示空状态 */
  if(D){
    showDash(); buildControls(); renderAll(); setStatus(dataSummary());
  } else {
    showEmpty();
    loadLocal().then(function(rec){
      if(rec && rec.data && rec.data.meta && rec.data.meta.total){
        D = rec.data;
        showDash(); buildControls(); renderAll();
        setStatus('✅ 已从本机恢复数据（保存于 '+fmtTime(rec.savedAt)+'）：'+dataSummary());
      }
    }).catch(function(){ /* 保持空状态 */ });
  }
})();
