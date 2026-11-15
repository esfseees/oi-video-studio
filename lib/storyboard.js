// Prompt for the storyboard + parsing / sanitising of what the model returns.
const SYSTEM = `你是少儿信息学（信奥）课程的动画讲解编导。请根据题目和答案代码，写出一份“动画分镜 JSON”，程序会按它自动生成带配音的讲解动画。

【只输出一个 JSON 对象】不要 Markdown 代码块，不要注释，不要多余文字。

一、顶层结构
{"title":"题目名","algorithm":"核心算法（如 贪心、广度优先搜索）","theme":"night|day|ocean","scenes":[场景,...]}

二、场景
- {"kind":"intro","steps":[...]}：开场，必须是第一个场景，2 句：先打招呼，再说今天讲哪道题、用什么算法。
- {"kind":"stage","title":"短标题","widgets":[控件,...],"steps":[...]}：舞台场景。画面上是控件，旁白讲到哪里，控件就做对应动作。
- {"kind":"outro","title":"总结","points":["要点1","要点2","要点3"],"steps":[...]}：结尾，必须是最后一个场景，2~3 句，points 2~4 条、每条不超过 20 个字。

三、步骤 steps
每一步是一句旁白：{"say":"一句话","do":[动作,...],"tts":"可选，读法"}
- say：口语化、亲切、准确，面向指定年龄的学生，每句不超过 45 个字，只讲一个意思。
- do：这句话播放期间依次发生的动作，0~6 个。动作格式：{"w":"控件id","op":"动作名", ...参数}
- tts：只有当 say 里有容易读错的符号、缩写、大数字时才写，写成读法（如 "dp[i]" 读作 "d p i"，"16384" 读作 "一万六千三百八十四"）。

四、控件（每个 stage 场景 1~4 个，id 在场景内唯一；加 "hidden":true 表示先隐藏，之后用 show 动作显示）
1. 数组/队列/栈：{"id":"a","type":"array","label":"说明","values":[5,1,3],"base":1,"kind":"array|queue|stack","icons":["🧒","👧","🧑"]}
   base 是下标从 0 还是 1 开始（动作里的下标与它一致）；icons 可选，给每个元素配一个 emoji 小角色。
   动作：hl{index:[下标,...]或"all",color} 染色｜clear 取消染色｜swap{i,j} 交换｜reorder{values:[新顺序]} 重新排列（必须是当前值的重排）｜set{i,value} 改值｜push{value} 加到末尾｜pop{from:"front"|"back"} 取出（队列默认队头，栈默认栈顶）｜ptr{name:"i",index} 指针移动到某下标｜setAll{values:[...]}
2. 网格（迷宫、二维数组、DP 表）：{"id":"g","type":"grid","label":"说明","rows":["..#","...","#.."],"walls":"#","actors":[{"name":"me","icon":"🧙","at":[1,1]}]}
   rows 也可以是二维数组 [[1,2],[3,4]]，或用 "size":[行数,列数] 建空表。坐标一律 [行,列]，从 1 开始。
   动作：mark{cells:[[r,c],...],color} 染色｜num{cells:[[r,c,值],...],color} 填值｜actor{name,icon,at:[r,c]} 放一个角色｜move{name,path:[[r,c],...]} 角色沿路径走｜line{from:[r,c],to:[r,c],color} 画线｜clear{what:"all"}
3. 图/树：{"id":"t","type":"graph","label":"说明","nodes":[1,2,3],"edges":[[1,2],[1,3,5]],"directed":false,"layout":"tree|circle","root":1}  （边的第三项是边权，可省略）
   动作：hl{nodes:[...],edges:[[a,b],...],color}｜set{node,text} 在结点旁标数字｜clear
4. 变量：{"id":"v","type":"vars","items":[{"name":"sum","value":0}]}　动作：set{name,value}
5. 代码编辑器：{"id":"code","type":"code"}（显示用户给的答案代码，放在画面右侧）
   动作：type{lines:[起,止]} 逐字打出这些行｜focus{lines:[起,止]} 高亮这些行｜reveal{lines:[起,止]} 直接显示
6. 输入输出：{"id":"io","type":"io","input":"3\\n5 1 3","output":""}　动作：out{text} 打出输出｜hlin{line} 高亮输入的第几行
7. 文字：{"id":"n","type":"note","text":"一句短话","style":"pill|big|formula|warn|good"}　动作：text{text} 换文字
通用动作：show、hide。颜色：yellow green red blue purple orange gray。

五、必须遵守
1. 讲解顺序：开场 → 读题（用控件把题意演出来，不要念原文）→ 思路（用一个很小的例子演示为什么这样做）→ 用样例验证 → 代码讲解 → 易错点 → 总结。可按题目特点取舍。
2. 这是动画，不是幻灯片：重点内容必须靠数组、网格、图、变量的动作表现；note 每个场景最多 2 个；绝大多数句子都应该有动作。
3. 数据必须真实：演示数据用题目样例或自己设计的小数据（元素不超过 8 个，网格不超过 6×8）。每一个 set、num、push、pop、out 的值，都必须是按答案代码一步一步手算出来的真实结果，不许编造。
4. 代码讲解：答案代码会带行号给你，行号以它为准，不许改代码。用 type 按从上到下的顺序分段打出（每段 1~10 行，所有非空行最终都要打出来），讲到哪段打哪段；同一场景里放上数组、变量等控件，同步演示这段代码执行时数据的变化。代码多时分成几个场景，每个场景都放一个 {"id":"code","type":"code"}。
5. 每个场景 2~8 句。不同场景的控件互不相通，需要时重新定义并写上当时的值。
6. 总字数和句数按用户给的时长控制。
7. 题目来自图片时，先完整读出图片中的题意、输入输出格式和样例再设计。

六、片段示例（只示范格式）
{"kind":"stage","title":"代码：累加等待时间","widgets":[{"id":"code","type":"code"},{"id":"t","type":"array","label":"排好序的接水时间","values":[1,2,3,4],"base":1},{"id":"v","type":"vars","items":[{"name":"s","value":0},{"name":"sum","value":0}]}],
 "steps":[{"say":"接下来是核心循环。s 是当前这个人要等多久，sum 是总等待时间。","do":[{"w":"code","op":"type","lines":[23,29]}]},
  {"say":"第一个人：先把 s 加进 sum，再让 s 加上他的接水时间 1。","do":[{"w":"code","op":"focus","lines":[27,28]},{"w":"t","op":"ptr","name":"i","index":1},{"w":"v","op":"set","name":"sum","value":0},{"w":"v","op":"set","name":"s","value":1}]}]}`;

function buildUser({ problemText, hasImage, code, lang, age, minutes, characterName, sourceNote }) {
  const chars = Math.round(minutes * 270), sentences = Math.round(chars / 30);
  const numbered = String(code).replace(/\t/g, '    ').replace(/\s+$/, '').split('\n').map((l, i) => String(i + 1).padStart(3, ' ') + '| ' + l).join('\n');
  return [
    `【目标学生】${age} 周岁`,
    `【视频时长】约 ${minutes} 分钟：旁白总字数约 ${chars} 字，约 ${sentences} 句（上下浮动不超过 15%）`,
    `【编程语言】${lang === 'python' ? 'Python' : 'C++'}`,
    characterName ? `【讲解角色】${characterName}（开场第一句用它的口吻打招呼）` : '',
    `【题目】${hasImage ? '见附带的图片。' : ''}${sourceNote || ''}`,
    problemText ? problemText.trim() : '',
    '【答案代码（带行号）】',
    numbered,
    '',
    '请输出分镜 JSON。',
  ].filter(s => s !== '').join('\n');
}

function extractJson(text) {
  let s = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('模型返回的内容里没有 JSON');
  s = s.slice(a, b + 1);
  try { return JSON.parse(s); } catch (e) {
    try { return JSON.parse(s.replace(/,\s*([}\]])/g, '$1')); } catch (e2) { throw new Error('模型返回的 JSON 格式有误：' + e.message); }
  }
}

const TYPES = ['array', 'grid', 'graph', 'vars', 'code', 'io', 'note'];
// Make a storyboard safe to render: drop what the player cannot use, report what was dropped.
function normalize(raw, { lang, codeLines }) {
  const warn = [];
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.scenes)) throw new Error('分镜缺少 scenes 列表');
  const sb = { title: String(raw.title || '题目讲解').slice(0, 30), algorithm: raw.algorithm ? String(raw.algorithm).slice(0, 24) : '', lang: lang === 'python' ? 'python' : 'cpp',
    theme: ['night', 'day', 'ocean'].includes(raw.theme) ? raw.theme : 'night', scenes: [] };
  let total = 0;
  raw.scenes.forEach((sc, si) => {
    if (!sc || typeof sc !== 'object') return;
    const steps = (Array.isArray(sc.steps) ? sc.steps : []).filter(st => st && typeof st.say === 'string' && st.say.trim());
    if (!steps.length) { warn.push(`第 ${si + 1} 个场景没有旁白，已跳过`); return; }
    const out = { kind: ['intro', 'outro'].includes(sc.kind) ? sc.kind : 'stage', steps: [] };
    if (sc.title) out.title = String(sc.title).slice(0, 28);
    if (sc.layout === 'row' || sc.layout === 'column') out.layout = sc.layout;
    if (out.kind === 'outro') out.points = (Array.isArray(sc.points) ? sc.points : []).slice(0, 4).map(p => String(p).slice(0, 40));
    const ids = new Set();
    if (out.kind === 'stage') {
      out.widgets = [];
      for (const w of (Array.isArray(sc.widgets) ? sc.widgets : [])) {
        if (!w || !TYPES.includes(w.type) || w.id == null) { warn.push(`场景「${out.title || si + 1}」里有无法识别的控件，已跳过`); continue; }
        const id = String(w.id);
        if (ids.has(id) || (w.type === 'code' && out.widgets.some(x => x.type === 'code')) || out.widgets.length >= 6) continue;
        ids.add(id); out.widgets.push({ ...w, id });
      }
    }
    for (const st of steps) {
      if (total >= 140) { warn.push('旁白超过 140 句，后面的已截断'); break; }
      const o = { say: st.say.trim().replace(/\s*\n\s*/g, ' ') };
      if (typeof st.tts === 'string' && st.tts.trim()) o.tts = st.tts.trim();
      const acts = [];
      for (const a of (Array.isArray(st.do) ? st.do : [])) {
        if (!a || typeof a.op !== 'string' || !ids.has(String(a.w))) { if (a && out.kind === 'stage') warn.push(`动作指向不存在的控件「${a && a.w}」，已跳过`); continue; }
        const b = { ...a, w: String(a.w) };
        if (Array.isArray(b.lines) && codeLines) b.lines = b.lines.slice(0, 2).map(n => Math.max(1, Math.min(codeLines, Math.round(Number(n)) || 1)));
        if (acts.length < 8) acts.push(b);
      }
      if (acts.length) o.do = acts;
      out.steps.push(o); total++;
    }
    if (out.steps.length) sb.scenes.push(out);
  });
  sb.scenes.forEach((sc, i) => {                             // intro only first, outro only last
    if (sc.kind === 'intro' && i !== 0) { sc.kind = 'stage'; sc.widgets = sc.widgets || []; }
    if (sc.kind === 'outro' && i !== sb.scenes.length - 1) { sc.kind = 'stage'; sc.widgets = sc.widgets || []; }
  });
  if (total < 3) throw new Error('分镜内容太少（旁白不足 3 句）');
  return { sb, warnings: [...new Set(warn)].slice(0, 12), sentences: total, chars: sb.scenes.reduce((n, sc) => n + sc.steps.reduce((m, st) => m + st.say.length, 0), 0) };
}

module.exports = { SYSTEM, buildUser, extractJson, normalize };
