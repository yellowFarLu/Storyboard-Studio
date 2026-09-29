/* 分镜工坊 - AI 短剧创作 Agent（前端逻辑） */
(function () {
  "use strict";

  /* ===== 状态 ===== */
  var state = {
    goal: "",
    outline: null,
    board: [],
    originalBoard: [],
    optimizedBoard: [],
    checks: null,
    reflection: null,
    optimization: null,
    reactLogs: {},
    plan: [],
    toolLogs: [],
    model: "未连接",
    running: false,
    view: "optimized",
  };

  /* ===== DOM ===== */
  var $ = function (id) { return document.getElementById(id); };
  var ideaInput = $("idea-input");
  var btnRun = $("btn-run-agent");
  var agentPanel = $("agent-panel");
  var outlineSection = $("outline-section");
  var boardSection = $("board-section");
  var toastEl = $("toast");

  /* ===== 示例目标 ===== */
  var EXAMPLES = [
    "帮我做一个程序员继承影视公司做爆款短剧的第一集，要强反转、快节奏",
    "菜市场卖鱼的姑娘其实是隐退的顶级大厨，前东家来踢馆，做第一集",
    "两个写字楼加班陌生人靠电梯便利贴互相打气，便利贴突然断了，做第一集",
    "AI 秘书发现老板的公司正被上司掏空，帮老板扳回一局，做第一集",
  ];
  var chipsEl = $("idea-chips");
  EXAMPLES.forEach(function (idea) {
    var chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.title = idea;
    chip.textContent = idea;
    chip.addEventListener("click", function () { ideaInput.value = idea; });
    chipsEl.appendChild(chip);
  });

  /* ===== Toast ===== */
  var toastTimer = null;
  function toast(msg, isError) {
    toastEl.textContent = msg;
    toastEl.className = "toast show" + (isError ? " error" : "");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.className = "toast"; }, 3500);
  }

  /* ===== 记忆（localStorage 本地模拟长期记忆） ===== */
  var MEMORY_KEY = "storyboard_memory_v1";
  var DEFAULT_MEMORY = ["喜欢强反转结局", "偏好竖屏短剧（9:16）"];
  function loadMemory() {
    try {
      var raw = localStorage.getItem(MEMORY_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(arr)) throw new Error("bad");
      return arr.length ? arr : DEFAULT_MEMORY.slice();
    } catch (e) {
      saveMemory(DEFAULT_MEMORY); // 清理损坏数据并恢复默认
      return DEFAULT_MEMORY.slice();
    }
  }
  function saveMemory(list) {
    try { localStorage.setItem(MEMORY_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
  }
  var memoryList = loadMemory();

  /* ===== 任务历史（localStorage 本地持久化，刷新可恢复） ===== */
  var TASKS_KEY = "storyboard_tasks_v1";
  var MAX_TASKS = 10;
  var tasks = [];
  var currentTaskId = null;
  function loadTasks() {
    try {
      var raw = localStorage.getItem(TASKS_KEY);
      tasks = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(tasks)) throw new Error("bad");
    } catch (e) {
      tasks = [];
      saveTasks(); // 清理损坏数据，避免反复解析失败
    }
  }
  function saveTasks() {
    try { localStorage.setItem(TASKS_KEY, JSON.stringify(tasks.slice(0, MAX_TASKS))); } catch (e) { /* ignore */ }
  }
  function createTask(goal, memory) {
    var t = {
      id: String(Date.now()),
      createdAt: new Date().toLocaleString("zh-CN", { hour12: false }),
      goal: goal,
      memory: memory.slice(),
      status: "running", // running / done / failed / interrupted
      plan: [],
      toolLogs: [],
      outline: null,
      board: [],
      checks: null,
      reflection: null,
      model: "未连接",
    };
    tasks.unshift(t);
    saveTasks();
    return t;
  }
  function snapshotTask() {
    if (!currentTaskId) return;
    for (var i = 0; i < tasks.length; i++) {
      if (tasks[i].id !== currentTaskId) continue;
      var t = tasks[i];
      t.plan = state.plan;
      t.toolLogs = state.toolLogs;
      t.reactLogs = state.reactLogs;
      t.outline = state.outline;
      t.board = state.board;
      t.originalBoard = state.originalBoard;
      t.optimizedBoard = state.optimizedBoard;
      t.checks = state.checks;
      t.reflection = state.reflection;
      t.optimization = state.optimization;
      t.model = state.model;
      saveTasks();
      return;
    }
  }

  function renderMemory() {
    var box = $("memory-tags");
    box.innerHTML = "";
    memoryList.forEach(function (m, i) {
      var tag = document.createElement("span");
      tag.className = "memory-tag";
      tag.textContent = m;
      var del = document.createElement("span");
      del.className = "memory-del";
      del.textContent = "✕";
      del.title = "删除这条记忆";
      del.addEventListener("click", function () {
        memoryList.splice(i, 1);
        saveMemory(memoryList);
        renderMemory();
        toast("已删除创作记忆");
      });
      tag.appendChild(del);
      box.appendChild(tag);
    });
  }
  $("btn-memory-add").addEventListener("click", addMemory);
  $("memory-input").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); addMemory(); }
  });
  function addMemory() {
    var v = $("memory-input").value.trim();
    if (!v) { toast("请输入记忆内容", true); return; }
    if (memoryList.indexOf(v) !== -1) { toast("该记忆已存在"); return; }
    memoryList.push(v);
    saveMemory(memoryList);
    $("memory-input").value = "";
    renderMemory();
    toast("已添加创作记忆");
  }

  /* ===== 任务历史：渲染与操作 ===== */
  function taskStatusBadge(t) {
    if (t.status === "done") return { cls: "badge-ok", text: "已完成" };
    if (t.status === "failed") return { cls: "badge-mock", text: "失败" };
    if (t.status === "interrupted") return { cls: "badge-warn", text: "已中断" };
    return { cls: "badge-ai", text: "运行中" };
  }
  function mkBtn(label, cls, fn) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.textContent = label;
    b.addEventListener("click", fn);
    return b;
  }
  function renderTaskList() {
    var box = $("task-history-box");
    if (!tasks.length) { box.style.display = "none"; return; }
    box.style.display = "";
    var listEl = $("task-list");
    listEl.innerHTML = "";
    tasks.forEach(function (t) {
      var item = document.createElement("div");
      item.className = "task-item";
      var main = document.createElement("div");
      main.className = "task-main";
      var b = taskStatusBadge(t);
      var badge = document.createElement("span");
      badge.className = "badge " + b.cls;
      badge.textContent = b.text;
      var goal = document.createElement("span");
      goal.className = "task-goal";
      goal.title = t.goal;
      goal.textContent = t.goal.length > 34 ? t.goal.slice(0, 34) + "…" : t.goal;
      main.appendChild(badge);
      main.appendChild(goal);
      var meta = document.createElement("div");
      meta.className = "task-meta";
      var metaParts = [t.createdAt];
      if (t.board && t.board.length) metaParts.push(t.board.length + " 镜头");
      if (t.reflection && t.reflection.score) metaParts.push("评审 " + t.reflection.score + "/100");
      if (t.optimization && !t.optimization.failed) metaParts.push("已优化");
      meta.textContent = metaParts.join(" · ");
      var actions = document.createElement("div");
      actions.className = "task-actions";
      var btnView = mkBtn("查看", "btn btn-ghost btn-sm", function () { restoreTask(t.id); });
      var btnRegen = mkBtn("重新生成", "btn btn-ghost btn-sm", function () {
        ideaInput.value = t.goal;
        runAgent();
      });
      var btnDel = mkBtn("删除", "btn btn-ghost btn-sm", function () {
        tasks = tasks.filter(function (x) { return x.id !== t.id; });
        saveTasks();
        renderTaskList();
        toast("已删除任务");
      });
      actions.appendChild(btnView);
      actions.appendChild(btnRegen);
      actions.appendChild(btnDel);
      item.appendChild(main);
      item.appendChild(meta);
      item.appendChild(actions);
      listEl.appendChild(item);
    });
  }
  function restoreTask(id) {
    showView("workspace");
    var t = null;
    for (var i = 0; i < tasks.length; i++) {
      if (tasks[i].id === id) { t = tasks[i]; break; }
    }
    if (!t) return;
    state.goal = t.goal || "";
    state.outline = t.outline || null;
    state.board = t.board || [];
    state.originalBoard = t.originalBoard || [];
    state.optimizedBoard = t.optimizedBoard || [];
    state.checks = t.checks || null;
    state.reflection = t.reflection || null;
    state.optimization = t.optimization || null;
    state.reactLogs = t.reactLogs || {};
    state.plan = t.plan || [];
    state.toolLogs = t.toolLogs || [];
    state.model = t.model || "未连接";
    ideaInput.value = state.goal;
    agentPanel.classList.remove("section-hidden");
    $("agent-empty").classList.add("section-hidden");
    if (state.plan.length) renderPlan();
    if (state.toolLogs.length) renderToolLog();
    if (state.reactLogs && Object.keys(state.reactLogs).length) renderReactLog();
    if (state.outline) renderOutline();
    if (state.board.length) { renderBoard(); renderCheckReport(); }
    if (state.reflection) renderReflect();
    renderOptimize();
    if (state.board.length || state.outline) {
      var bd = taskStatusBadge(t);
      $("agent-mode-badge").textContent = "已恢复·" + bd.text;
      $("agent-mode-badge").className = "badge " + bd.cls;
    } else {
      $("agent-mode-badge").textContent = "已恢复（任务未完成）";
      $("agent-mode-badge").className = "badge badge-warn";
    }
    toast("已恢复任务：" + (t.goal.length > 24 ? t.goal.slice(0, 24) + "…" : t.goal));
  }
  function restoreLatestOnLoad() {
    loadTasks();
    renderTaskList();
    if (!tasks.length) return;
    var latest = tasks[0];
    if (latest.status === "running") {
      latest.status = "interrupted";
      saveTasks();
      renderTaskList();
      toast("检测到上次运行中断，已恢复已生成内容；如需继续可点「重新生成」", true);
    }
    restoreTask(latest.id);
  }

  /* ===== Agent 步骤条 ===== */
  function setStep(activeIdx) {
    var steps = document.querySelectorAll(".steps .step");
    steps.forEach(function (el, i) {
      el.classList.toggle("active", i === activeIdx);
      el.classList.toggle("done", i < activeIdx);
    });
  }

  /* ===== 渲染：计划 ===== */
  var TOOL_NAMES = {
    lookup_trend: "题材热度查询",
    search_materials: "素材搜索",
    gen_outline: "生成三幕大纲",
    gen_board: "生成分镜脚本",
    check_structure: "结构检查",
  };
  function renderPlan() {
    var box = $("agent-plan");
    box.innerHTML = '<div class="agent-sub-title">📋 规划（Plan）</div>';
    var list = document.createElement("ul");
    list.className = "plan-list";
    (state.plan || []).forEach(function (s) {
      var li = document.createElement("li");
      li.className = "plan-item " + (s.status || "pending");
      var dot = document.createElement("span");
      dot.className = "plan-dot";
      var label = document.createElement("span");
      label.className = "plan-label";
      label.textContent = "步骤" + s.id + " · " + (TOOL_NAMES[s.action] || s.action) + (s.note ? "（" + s.note + "）" : "");
      li.appendChild(dot);
      li.appendChild(label);
      list.appendChild(li);
    });
    box.appendChild(list);
  }

  /* ===== 渲染：工具日志（Observe） ===== */
  function renderToolLog() {
    var box = $("agent-tool-log");
    if (!state.toolLogs.length) return;
    box.innerHTML = '<div class="agent-sub-title">🔧 工具调用与观察（Execute / Observe）</div>';
    var list = document.createElement("ul");
    list.className = "tool-log-list";
    state.toolLogs.forEach(function (l) {
      var li = document.createElement("li");
      li.className = "tool-log-item";
      var name = document.createElement("span");
      name.className = "tool-name";
      name.textContent = TOOL_NAMES[l.tool] || l.tool;
      if (l.mock) {
        var badge = document.createElement("span");
        badge.className = "badge badge-mock tool-mock";
        badge.textContent = "Mock";
        name.appendChild(badge);
      }
      var summary = document.createElement("span");
      summary.className = "tool-summary";
      summary.textContent = l.summary || "";
      li.appendChild(name);
      li.appendChild(summary);
      list.appendChild(li);
    });
    box.appendChild(list);
  }

  /* ===== 渲染：反思（Reflect） ===== */
  function renderReflect() {
    if (!state.reflection) return;
    var r = state.reflection;
    $("agent-reflect").classList.remove("section-hidden");
    var scoreEl = $("reflect-score");
    var score = Math.max(0, Math.min(100, Number(r.score) || 0));
    scoreEl.innerHTML = "质量评审：" + score + " / 100" + (r.fallback ? "（模型评审失败，已用兜底结论）" : "");
    scoreEl.className = "reflect-score" + (score >= 75 ? " high" : score >= 50 ? " mid" : " low");
    fillList("reflect-strengths", r.strengths, "暂无");
    fillList("reflect-issues", r.issues, "无");
    fillList("reflect-suggestions", r.suggestions, "暂无");
    $("agent-mode-badge").textContent = "已完成";
    $("agent-mode-badge").className = "badge badge-ai";
  }
  function fillList(id, arr, emptyText) {
    var el = $(id);
    el.innerHTML = "";
    var list = (arr && arr.length) ? arr : [emptyText];
    list.forEach(function (t) {
      var li = document.createElement("li");
      li.textContent = t;
      el.appendChild(li);
    });
  }

  /* ===== 渲染：ReAct 循环轨迹（Execute 内部） ===== */
  function renderReactLog() {
    var box = $("agent-react-log");
    box.innerHTML = "";
    var keys = Object.keys(state.reactLogs || {});
    if (!keys.length) return;
    box.innerHTML = '<div class="agent-sub-title">🔄 ReAct 循环（Reason → Act → Observe）</div>';
    keys.forEach(function (k) {
      var steps = state.reactLogs[k];
      if (!steps || !steps.length) return;
      var node = document.createElement("div");
      node.className = "react-node";
      var head = document.createElement("div");
      head.className = "react-node-title";
      head.textContent = TOOL_NAMES[k] || k;
      node.appendChild(head);
      var rounds = {};
      steps.forEach(function (st) { (rounds[st.round] = rounds[st.round] || []).push(st); });
      Object.keys(rounds).forEach(function (r) {
        if (Number(r) > 0) {
          var fix = document.createElement("div");
          fix.className = "react-fix";
          fix.textContent = "第 " + (Number(r) + 1) + " 轮（自纠）";
          node.appendChild(fix);
        }
        rounds[r].forEach(function (st) {
          var row = document.createElement("div");
          row.className = "react-row " + st.phase;
          var icon = st.phase === "reason" ? "🤔 思考" : st.phase === "act" ? "⚡ 行动" : "👁 观察";
          row.textContent = icon + " " + (st.text || "");
          node.appendChild(row);
        });
      });
      box.appendChild(node);
    });
  }

  /* ===== 渲染：优化条（Optimize） ===== */
  function renderOptimize() {
    var bar = $("optimize-bar");
    if (!state.optimization) return;
    bar.classList.remove("section-hidden");
    var info = $("optimize-info");
    var opt = state.optimization;
    var html;
    if (opt.failed) {
      html = "⚠️ <strong>优化未完成</strong>：" + (opt.summary || "已保留原版分镜");
    } else {
      html = "✅ <strong>Agent 已基于反思优化</strong>：" + (opt.summary || "");
      html += " ｜ 总时长 " + (opt.originalDuration || "--") + "s→" + (opt.optimizedDuration || "--") + "s";
      html += " ｜ 结构问题 " + (opt.originalIssues || 0) + "→" + (opt.optimizedIssues || 0);
    }
    info.innerHTML = html;
  }

  /* ===== 分镜原版/优化版切换 ===== */
  function switchView(view) {
    state.view = view;
    if (view === "original" && state.originalBoard.length) {
      state.board = state.originalBoard;
      $("tab-original").classList.add("active");
      $("tab-optimized").classList.remove("active");
    } else {
      state.board = state.optimizedBoard.length ? state.optimizedBoard : state.board;
      $("tab-optimized").classList.add("active");
      $("tab-original").classList.remove("active");
    }
    renderBoard();
    syncBoardView();
    refreshChecksLocal();
  }

  /* ===== 渲染：大纲 ===== */
  function renderOutline() {
    var o = state.outline;
    if (!o) return;
    outlineSection.classList.remove("section-hidden");
    $("outline-logline").textContent = o.logline || "（未生成梗概）";
    $("outline-worldview").textContent = o.worldview || "—";
    $("outline-protagonist").textContent = (o.protagonist.name || "—") + (o.protagonist.desc ? "，" + o.protagonist.desc : "");
    $("outline-conflict").textContent = o.conflict || "—";
    var actsEl = $("outline-acts");
    actsEl.innerHTML = "";
    (o.acts || []).forEach(function (act) {
      var card = document.createElement("div");
      card.className = "act-card";
      var title = document.createElement("div");
      title.className = "act-title";
      title.textContent = act.title || "幕";
      card.appendChild(title);
      var ul = document.createElement("ul");
      ul.className = "act-beats";
      (act.beats || []).forEach(function (beat) {
        var li = document.createElement("li");
        li.textContent = beat;
        ul.appendChild(li);
      });
      card.appendChild(ul);
      actsEl.appendChild(card);
    });
  }

  /* ===== 渲染：分镜 ===== */
  function renderBoard() {
    var tbody = $("board-tbody");
    tbody.innerHTML = "";
    state.board.forEach(function (row, i) {
      tbody.appendChild(renderRow(row, i));
    });
    updateTotalDuration();
    renderSceneStats();
    boardSection.classList.remove("section-hidden");
    syncBoardView();
  }

  function renderRow(row, idx) {
    var tr = document.createElement("tr");
    var cells = [
      { cls: "col-idx", text: String(idx + 1), editable: false },
      { cls: "col-scene", text: row.scene, editable: true },
      { cls: "col-scale", text: row.scale, editable: true },
      { cls: "col-camera", text: row.camera || "固定", editable: true },
      { cls: "col-action", text: row.action, editable: true },
      { cls: "col-dialogue", text: row.dialogue, editable: true },
      { cls: "col-caption", text: row.caption, editable: true },
      { cls: "col-duration", text: String(row.duration), editable: true },
    ];
    cells.forEach(function (c) {
      var td = document.createElement("td");
      td.className = c.cls;
      td.textContent = c.text;
      if (c.editable) {
        td.contentEditable = "true";
        td.spellcheck = false;
        td.addEventListener("blur", function () {
          if (c.cls === "col-duration") {
            var v = parseInt(td.textContent, 10);
            if (isNaN(v) || v < 1 || v > 10) {
              td.textContent = String(row.duration);
              toast("时长需为 1-10 秒的整数", true);
              return;
            }
            row.duration = v;
            updateTotalDuration();
            refreshChecksLocal();
          } else if (c.cls === "col-scale") {
            var ALLOWED = ["远景", "全景", "中景", "近景", "特写"];
            var sv = td.textContent.trim();
            if (ALLOWED.indexOf(sv) === -1) {
              td.textContent = row.scale;
              toast("景别需为：远景/全景/中景/近景/特写", true);
              return;
            }
            row.scale = sv;
            refreshChecksLocal();
          } else if (c.cls === "col-camera") {
            var CAMS = ["固定", "推", "拉", "摇", "移", "跟", "升", "降", "环绕", "手持"];
            var cv = td.textContent.trim();
            if (CAMS.indexOf(cv) === -1) {
              td.textContent = row.camera || "固定";
              toast("运镜需为：固定/推/拉/摇/移/跟/升/降/环绕/手持", true);
              return;
            }
            row.camera = cv;
            refreshChecksLocal();
          } else {
            row[c.cls === "col-scene" ? "scene" : c.cls === "col-action" ? "action" : c.cls === "col-dialogue" ? "dialogue" : "caption"] = td.textContent.trim();
            refreshChecksLocal();
          }
        });
      }
      tr.appendChild(td);
    });

    var delTd = document.createElement("td");
    delTd.className = "col-del";
    var delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "del-btn";
    delBtn.title = "删除该镜头";
    delBtn.innerHTML = "✕";
    delBtn.addEventListener("click", function () {
      state.board.splice(idx, 1);
      renderBoard();
      refreshChecksLocal();
    });
    delTd.appendChild(delBtn);
    tr.appendChild(delTd);
    return tr;
  }

  function updateTotalDuration() {
    var total = state.board.reduce(function (sum, r) { return sum + (Number(r.duration) || 0); }, 0);
    $("board-total-duration").textContent = String(total);
  }

  /* ===== 本地结构检查（与后端 check_structure 同规则，编辑后实时刷新） ===== */
  function checkStructureLocal(board) {
    var issues = [];
    var arr = board || [];
    var total = arr.reduce(function (sum, r) { return sum + (Number(r.duration) || 0); }, 0);
    var count = arr.length;
    var validScales = ["远景", "全景", "中景", "近景", "特写"];
    if (count < 8) issues.push("镜头数偏少（" + count + " 个），建议 8-12 个以保证节奏");
    if (count > 12) issues.push("镜头数偏多（" + count + " 个），单集建议控制在 12 个以内");
    if (total < 60) issues.push("总时长 " + total + "s 低于单集目标下限 60s，建议补充镜头");
    if (total > 90) issues.push("总时长 " + total + "s 超过单集目标上限 90s，建议精简");
    var noD = arr.filter(function (r) { return !(r.dialogue || "").trim(); }).length;
    if (count > 0 && noD / count > 0.7) issues.push("纯画面镜头占比 " + Math.round((noD / count) * 100) + "%，注意叙事信息密度");
    var bad = arr.filter(function (r) { return validScales.indexOf(r.scale) === -1; });
    if (bad.length) issues.push("存在非法景别：" + bad.map(function (r) { return r.scale; }).join("、"));
    var CAMS = ["固定", "推", "拉", "摇", "移", "跟", "升", "降", "环绕", "手持"];
    var badCam = arr.filter(function (r) { return r.camera && CAMS.indexOf(r.camera) === -1; });
    if (badCam.length) issues.push("存在非法运镜：" + badCam.map(function (r) { return r.camera; }).join("、"));
    var first = arr[0];
    if (!first || (!first.action && !first.dialogue)) issues.push("第一镜缺少强钩子（建议以冲突动作或反常画面开场）");
    return { passed: issues.length === 0, totalDuration: total, shotCount: count, issues: issues };
  }

  function refreshChecksLocal() {
    if (!state.board.length) return;
    state.checks = checkStructureLocal(state.board);
    renderCheckReport();
  }

  /* ===== 渲染：脚本预览（可读剧本视图） ===== */
  var boardViewMode = "table";

  /* ===== 分镜卡片视图（对标 Boords Grid view / LTX Shot 卡片：一镜一卡，竖屏拍摄板） ===== */
  function renderBoardCards() {
    var box = $("board-cards");
    if (!state.board.length) { box.innerHTML = ""; return; }
    var html = '<div class="board-cards-head">分镜卡片 · 一镜一卡（竖屏拍摄板，只读；编辑请切回「表格」）</div><div class="card-grid">';
    state.board.forEach(function (r, i) {
      html += '<div class="shot-card">';
      html += '<div class="shot-card-top"><span class="shot-no">镜头 ' + (i + 1) + '</span><span class="shot-meta">' + r.scene + ' · ' + r.scale + ' · ' + (r.camera || "固定") + ' · ' + r.duration + 's</span></div>';
      if (r.action) html += '<div class="shot-action">' + r.action + '</div>';
      if (r.dialogue) html += '<div class="shot-dialogue">「' + r.dialogue + '」</div>';
      if (r.caption) html += '<div class="shot-caption">字幕：' + r.caption + '</div>';
      html += '</div>';
    });
    html += '</div>';
    box.innerHTML = html;
  }

  /* ===== 分镜视图切换：表格 / 卡片 / 脚本预览 ===== */
  function syncBoardView() {
    var t = $("table-wrap") || document.querySelector(".table-wrap"), c = $("board-cards"), p = $("script-preview");
    if (t) t.classList.toggle("section-hidden", boardViewMode !== "table");
    if (c) c.classList.toggle("section-hidden", boardViewMode !== "cards");
    if (p) p.classList.toggle("section-hidden", boardViewMode !== "preview");
    document.querySelectorAll(".vw-btn").forEach(function (b) {
      b.classList.toggle("active", b.id === "btn-view-" + boardViewMode);
    });
    if (boardViewMode === "cards") renderBoardCards();
    if (boardViewMode === "preview") renderScriptPreview();
  }
  function setBoardView(mode) { boardViewMode = mode; syncBoardView(); }

  function renderScriptPreview() {
    var box = $("script-preview");
    if (!state.board.length) return;
    var html = '<div class="script-preview-head">按镜头顺序的可读剧本（与表格实时联动）</div>';
    state.board.forEach(function (r, i) {
      html += '<div class="script-shot">';
      html += '<div class="script-shot-head"><span class="script-shot-no">镜头 ' + (i + 1) + '</span><span class="script-shot-meta">' + r.scene + ' · ' + r.scale + ' · ' + (r.camera || "固定") + ' · ' + r.duration + 's</span></div>';
      if (r.action) html += '<div class="script-shot-action">' + r.action + '</div>';
      if (r.dialogue) html += '<div class="script-shot-dialogue">「' + r.dialogue + '」</div>';
      if (r.caption) html += '<div class="script-shot-caption">字幕：' + r.caption + '</div>';
      html += '</div>';
    });
    box.innerHTML = html;
  }
  /* 页面视图切换（创作 / 工作台 / 历史） */
  function showView(v) {
    ["create", "workspace", "history"].forEach(function (k) {
      var el = $("view-" + k);
      if (el) el.classList.toggle("section-hidden", k !== v);
    });
    document.querySelectorAll(".nav-btn").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-view") === v);
    });
    window.scrollTo(0, 0);
  }

  /* ===== 导出 JSON（供后续拍摄/制作工具接入） ===== */
  function exportJson() {
    if (!state.board.length) { toast("还没有可导出的分镜", true); return; }
    var payload = {
      app: "分镜工坊",
      version: "2.1.0",
      exportedAt: new Date().toISOString(),
      goal: state.goal,
      memory: memoryList,
      outline: state.outline,
      board: state.board,
      view: state.view,
      checks: state.checks,
      reflection: state.reflection,
      optimization: state.optimization,
      model: state.model,
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "storyboard-" + Date.now() + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    toast("已导出 JSON（含大纲/分镜/校验/评审/优化）");
  }

  /* ===== 渲染：结构检查报告 ===== */
  function renderCheckReport() {
    if (!state.checks) return;
    var box = $("check-report");
    box.classList.remove("section-hidden");
    var cls = state.checks.passed ? "check-pass" : "check-fail";
    var head = state.checks.passed ? "✅ 结构检查通过" : "⚠️ 结构检查发现 " + state.checks.issues.length + " 项问题";
    var html = '<div class="' + cls + '"><strong>' + head + "</strong>（" + state.checks.shotCount + " 个镜头 · 总时长 " + state.checks.totalDuration + "s）";
    if (state.checks.issues.length) {
      html += "<ul>";
      state.checks.issues.forEach(function (i) { html += "<li>" + i + "</li>"; });
      html += "</ul>";
    }
    html += "</div>";
    box.innerHTML = html;
  }

  /* ===== 导出 CSV（对标业界 shot list / spreadsheet export，Excel 可直接打开） ===== */
  function exportCsv() {
    if (!state.board.length) { toast("还没有可导出的分镜", true); return; }
    var esc = function (v) { return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"'; };
    var rows = [["#", "场景", "景别", "运镜", "画面动作", "台词", "字幕建议", "时长(s)"]];
    state.board.forEach(function (r, i) {
      rows.push([i + 1, r.scene, r.scale, r.camera || "固定", r.action, r.dialogue, r.caption, r.duration]);
    });
    rows.push([]);
    rows.push(["合计", "", "", "", "", "", "", state.board.reduce(function (s2, r) { return s2 + (Number(r.duration) || 0); }, 0)]);
    var csv = rows.map(function (row) { return row.map(esc).join(","); }).join("\r\n");
    var blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "storyboard-" + Date.now() + ".csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    toast("已导出 CSV（Excel 可直接打开）");
  }

  /* ===== 渲染：场景分组统计（对标 shot list 场景聚合 / 场次统计） ===== */
  function renderSceneStats() {
    if (!state.board.length) return;
    var box = $("scene-stats");
    var groups = {};
    state.board.forEach(function (r) {
      var key = r.scene || "未指定";
      groups[key] = groups[key] || { count: 0, duration: 0 };
      groups[key].count += 1;
      groups[key].duration += Number(r.duration) || 0;
    });
    var html = '<div class="scene-stats-title">🎬 场景分组统计（拍摄计划参考）</div>';
    Object.keys(groups).forEach(function (k) {
      html += '<span class="scene-chip">' + k + ' · ' + groups[k].count + " 镜 · " + groups[k].duration + "s</span>";
    });
    box.innerHTML = html;
    box.classList.remove("section-hidden");
  }

  /* ===== SSE 解析与 Agent 主流程 ===== */
  function runAgent() {
    if (state.running) return;
    var goal = ideaInput.value.trim();
    if (goal.length < 4) {
      toast("请输入至少 4 个字的创作目标", true);
      ideaInput.focus();
      return;
    }

    state.goal = goal;
    state.outline = null;
    state.board = [];
    state.originalBoard = [];
    state.optimizedBoard = [];
    state.checks = null;
    state.reflection = null;
    state.optimization = null;
    state.reactLogs = {};
    state.plan = [];
    state.toolLogs = [];
    state.running = true;
    state.view = "optimized";

    // 创建任务记录（刷新可恢复）
    var task = createTask(goal, memoryList);
    currentTaskId = task.id;
    renderTaskList();

    // 清空旧结果
    outlineSection.classList.add("section-hidden");
    boardSection.classList.add("section-hidden");
    $("check-report").classList.add("section-hidden");
    $("agent-reflect").classList.add("section-hidden");
    $("optimize-bar").classList.add("section-hidden");
    $("agent-tool-log").innerHTML = "";
    $("agent-react-log").innerHTML = "";
    $("agent-plan").innerHTML = "";
    agentPanel.classList.remove("section-hidden");
    $("agent-empty").classList.add("section-hidden");
    btnRun.disabled = true;
    showView("workspace");
    $("agent-mode-badge").textContent = "运行中";
    $("agent-mode-badge").className = "badge badge-ai";
    setStep(0);

    var payload = { goal: goal, memory: memoryList };

    fetch("/api/agent/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(function (resp) {
      if (!resp.ok || !resp.body) {
        throw new Error("Agent 服务返回异常（HTTP " + resp.status + "）");
      }
      return parseSSE(resp.body.getReader());
    }).then(function () {
      if (state.outline) renderOutline();
      if (state.board.length) { renderBoard(); renderCheckReport(); }
      if (state.reflection) renderReflect();
      setStep(3);
      toast(state.reflection ? "Agent 已完成：规划→执行→反思→优化" : "Agent 执行完成（部分步骤失败）", !state.reflection);
    }).catch(function (e) {
      toast("Agent 执行失败：" + e.message, true);
      $("agent-mode-badge").textContent = "失败";
      $("agent-mode-badge").className = "badge badge-mock";
    }).finally(function () {
      state.running = false;
      btnRun.disabled = false;
      // 若未收到 done/error（连接中断等），标记为已中断
      for (var i = 0; i < tasks.length; i++) {
        if (tasks[i].id === currentTaskId && tasks[i].status === "running") {
          tasks[i].status = "interrupted";
        }
      }
      snapshotTask();
      renderTaskList();
      updateModelInfo();
    });
  }

  /* 解析 SSE 流：event: xxx\ndata: {...}\n\n */
  function parseSSE(reader) {
    var decoder = new TextDecoder("utf-8");
    var buffer = "";
    function handleFrame(frame) {
      var lines = frame.split("\n");
      var event = "";
      var data = "";
      lines.forEach(function (line) {
        if (line.indexOf("event:") === 0) event = line.slice(6).trim();
        else if (line.indexOf("data:") === 0) data += line.slice(5).trim();
      });
      if (!event || !data) return;
      var obj;
      try { obj = JSON.parse(data); } catch (e) { return; }

      if (event === "stage") {
        if (obj.step === "react") {
          if (!state.reactLogs[obj.tool]) state.reactLogs[obj.tool] = [];
          var rl = state.reactLogs[obj.tool];
          var lastR = rl[rl.length - 1];
          if (!lastR || lastR.round !== obj.round || lastR.phase !== obj.phase) {
            rl.push({ round: obj.round, phase: obj.phase, text: obj.text });
          }
          renderReactLog();
        } else if (obj.step === "optimize") {
          if (obj.status === "running") { toast("Agent 正在基于反思优化分镜…"); }
          else if (obj.status === "failed") { toast(obj.message, true); }
        } else if (obj.step === "plan" && obj.plan) {
          state.plan = obj.plan;
          renderPlan();
          setStep(0);
          if (obj.adjusted) toast("Agent 修正了步骤顺序（大纲必须先于分镜）");
          if (obj.fallback) toast("规划器未返回，Agent 使用默认计划");
          snapshotTask();
        } else if (obj.step === "observe") {
          if (obj.tool === "gen_outline" && obj.status === "done") setStep(1);
          if (obj.tool === "gen_board" && obj.status === "done") setStep(2);
          if (obj.status === "done") snapshotTask();
        } else if (obj.step === "reflect" && obj.reflection) {
          state.reflection = obj.reflection;
          snapshotTask();
        }
      } else if (event === "done") {
        state.plan = obj.plan || state.plan;
        state.outline = obj.outline || null;
        state.board = obj.board || [];
        state.originalBoard = obj.originalBoard || [];
        state.optimizedBoard = obj.board || [];
        state.checks = obj.checks || null;
        state.reflection = obj.reflection || null;
        state.optimization = obj.optimization || null;
        // 后端 done 携带的是简版 reactLogs（仅轮次数），保留前端 SSE 过程收集的详细轨迹（含 phase/text）
        var serverLogs = obj.reactLogs || {};
        var hasDetail = Object.keys(serverLogs).some(function (k) {
          return (serverLogs[k] || []).some(function (x) { return x && x.phase; });
        });
        if (hasDetail) state.reactLogs = serverLogs;
        state.toolLogs = obj.toolLogs || [];
        if (obj.model) state.model = obj.model;
        renderPlan();
        renderToolLog();
        renderReactLog();
        renderOutline();
        renderBoard();
        renderCheckReport();
        renderReflect();
        renderOptimize();
        for (var i = 0; i < tasks.length; i++) {
          if (tasks[i].id === currentTaskId) tasks[i].status = "done";
        }
        snapshotTask();
        renderTaskList();
      } else if (event === "error") {
        state.toolLogs.push({ tool: "agent", status: "failed", summary: obj.message || "未知错误" });
        renderToolLog();
        for (var j = 0; j < tasks.length; j++) {
          if (tasks[j].id === currentTaskId) tasks[j].status = "failed";
        }
        snapshotTask();
        renderTaskList();
        throw new Error(obj.message || "Agent 执行失败");
      }
    }
    function pump() {
      return reader.read().then(function (res) {
        if (res.done) return;
        buffer += decoder.decode(res.value, { stream: true });
        var idx;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          var frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          handleFrame(frame);
        }
        return pump();
      });
    }
    return pump();
  }

  /* ===== 导出 ===== */
  function boardMarkdown() {
    var lines = ["# 第一幕分镜脚本", ""];
    if (state.outline && state.outline.logline) lines.push("> " + state.outline.logline + "\n");
    lines.push("| # | 场景 | 景别 | 运镜 | 画面动作 | 台词 | 字幕建议 | 时长(s) |");
    lines.push("|---|------|------|------|----------|------|----------|--------|");
    state.board.forEach(function (r, i) {
      var esc = function (s) { return String(s).replace(/\|/g, "\\|").replace(/\n/g, " "); };
      lines.push("| " + (i + 1) + " | " + esc(r.scene) + " | " + esc(r.scale) + " | " + esc(r.camera || "固定") + " | " + esc(r.action) + " | " + esc(r.dialogue) + " | " + esc(r.caption) + " | " + r.duration + " |");
    });
    lines.push("");
    lines.push("> 由「分镜工坊」Agent 生成 · 共 " + state.board.length + " 个镜头 · 总时长 " + $("board-total-duration").textContent + " 秒");
    if (state.reflection) {
      lines.push("> Agent 质量评审：" + state.reflection.score + "/100");
    }
    return lines.join("\n");
  }

  function copyBoard() {
    if (!state.board.length) { toast("请先让 Agent 生成内容", true); return; }
    var md = boardMarkdown();
    function done(ok) { toast(ok ? "已复制到剪贴板" : "复制失败，请手动复制", !ok); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(md).then(function () { done(true); }, function () { done(false); });
    } else {
      done(false);
    }
  }

  function exportBoard() {
    if (!state.board.length) { toast("请先让 Agent 生成内容", true); return; }
    var blob = new Blob([boardMarkdown()], { type: "text/markdown;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "分镜脚本-第一幕.md";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 300);
    toast("已导出 Markdown 文件");
  }

  function addRow() {
    if (!state.board.length) { toast("请先让 Agent 生成内容", true); return; }
    state.board.push({ id: state.board.length + 1, scene: "新场景", scale: "中景", action: "输入画面动作…", dialogue: "", caption: "", duration: 5 });
    renderBoard();
    refreshChecksLocal();
    syncBoardView();
  }

  /* ===== 模型信息 ===== */
  function updateModelInfo() {
    $("model-info").textContent = "模型：" + (state.model || "未连接");
  }

  /* ===== 事件绑定 ===== */
  btnRun.addEventListener("click", runAgent);
  $("tab-original").addEventListener("click", function () { switchView("original"); });
  $("tab-optimized").addEventListener("click", function () { switchView("optimized"); });
  document.querySelectorAll(".nav-btn").forEach(function (b) {
    b.addEventListener("click", function () { showView(b.getAttribute("data-view")); });
  });
  $("btn-view-table").addEventListener("click", function () { setBoardView("table"); });
  $("btn-view-cards").addEventListener("click", function () { setBoardView("cards"); });
  $("btn-view-preview").addEventListener("click", function () { setBoardView("preview"); });
  $("btn-export-json").addEventListener("click", exportJson);
  $("btn-export-csv").addEventListener("click", exportCsv);
  $("btn-regen-outline").addEventListener("click", function () {
    if (!state.goal) { toast("请先运行 Agent"); return; }
    toast("已基于原目标重新执行 Agent 全流程");
    ideaInput.value = state.goal;
    runAgent();
  });
  $("btn-copy").addEventListener("click", copyBoard);
  $("btn-export").addEventListener("click", exportBoard);
  $("btn-add-row").addEventListener("click", addRow);
  ideaInput.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      runAgent();
    }
  });
  ideaInput.addEventListener("input", function () {
    ideaInput.style.height = "auto";
    ideaInput.style.height = Math.min(160, Math.max(84, ideaInput.scrollHeight)) + "px";
  });

  // 初始化
  renderMemory();
  restoreLatestOnLoad();
})();
