/* 分镜工坊 - AI 短剧创作 Agent（前端逻辑） */
(function () {
  "use strict";

  /* ===== 状态 ===== */
  var state = {
    goal: "",
    outline: null,
    board: [],
    checks: null,
    reflection: null,
    plan: [],
    toolLogs: [],
    model: "未连接",
    running: false,
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
      return arr.length ? arr : DEFAULT_MEMORY.slice();
    } catch (e) { return DEFAULT_MEMORY.slice(); }
  }
  function saveMemory(list) {
    try { localStorage.setItem(MEMORY_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
  }
  var memoryList = loadMemory();

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
    boardSection.classList.remove("section-hidden");
  }

  function renderRow(row, idx) {
    var tr = document.createElement("tr");
    var cells = [
      { cls: "col-idx", text: String(idx + 1), editable: false },
      { cls: "col-scene", text: row.scene, editable: true },
      { cls: "col-scale", text: row.scale, editable: true },
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
          } else if (c.cls === "col-scale") {
            var ALLOWED = ["远景", "全景", "中景", "近景", "特写"];
            var sv = td.textContent.trim();
            if (ALLOWED.indexOf(sv) === -1) {
              td.textContent = row.scale;
              toast("景别需为：远景/全景/中景/近景/特写", true);
              return;
            }
            row.scale = sv;
          } else {
            row[c.cls === "col-scene" ? "scene" : c.cls === "col-action" ? "action" : c.cls === "col-dialogue" ? "dialogue" : "caption"] = td.textContent.trim();
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
    });
    delTd.appendChild(delBtn);
    tr.appendChild(delTd);
    return tr;
  }

  function updateTotalDuration() {
    var total = state.board.reduce(function (sum, r) { return sum + (Number(r.duration) || 0); }, 0);
    $("board-total-duration").textContent = String(total);
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
    state.checks = null;
    state.reflection = null;
    state.plan = [];
    state.toolLogs = [];
    state.running = true;

    // 清空旧结果
    outlineSection.classList.add("section-hidden");
    boardSection.classList.add("section-hidden");
    $("check-report").classList.add("section-hidden");
    $("agent-reflect").classList.add("section-hidden");
    $("agent-tool-log").innerHTML = "";
    $("agent-plan").innerHTML = "";
    agentPanel.classList.remove("section-hidden");
    btnRun.disabled = true;
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
      toast(state.reflection ? "Agent 已完成全部工作" : "Agent 执行完成（部分步骤失败）", !state.reflection);
    }).catch(function (e) {
      toast("Agent 执行失败：" + e.message, true);
      $("agent-mode-badge").textContent = "失败";
      $("agent-mode-badge").className = "badge badge-mock";
    }).finally(function () {
      state.running = false;
      btnRun.disabled = false;
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
        if (obj.step === "plan" && obj.plan) {
          state.plan = obj.plan;
          renderPlan();
          setStep(0);
          if (obj.adjusted) toast("Agent 修正了步骤顺序（大纲必须先于分镜）");
          if (obj.fallback) toast("规划器未返回，Agent 使用默认计划");
        } else if (obj.step === "observe") {
          if (obj.tool === "gen_outline" && obj.status === "done") setStep(1);
          if (obj.tool === "gen_board" && obj.status === "done") setStep(2);
        } else if (obj.step === "reflect" && obj.reflection) {
          state.reflection = obj.reflection;
        }
      } else if (event === "done") {
        state.plan = obj.plan || state.plan;
        state.outline = obj.outline || null;
        state.board = obj.board || [];
        state.checks = obj.checks || null;
        state.reflection = obj.reflection || null;
        state.toolLogs = obj.toolLogs || [];
        if (obj.model) state.model = obj.model;
        renderPlan();
        renderToolLog();
        renderOutline();
        renderBoard();
        renderCheckReport();
        renderReflect();
      } else if (event === "error") {
        state.toolLogs.push({ tool: "agent", status: "failed", summary: obj.message || "未知错误" });
        renderToolLog();
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
    lines.push("| # | 场景 | 景别 | 画面动作 | 台词 | 字幕建议 | 时长(s) |");
    lines.push("|---|------|------|----------|------|----------|--------|");
    state.board.forEach(function (r, i) {
      var esc = function (s) { return String(s).replace(/\|/g, "\\|").replace(/\n/g, " "); };
      lines.push("| " + (i + 1) + " | " + esc(r.scene) + " | " + esc(r.scale) + " | " + esc(r.action) + " | " + esc(r.dialogue) + " | " + esc(r.caption) + " | " + r.duration + " |");
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
  }

  /* ===== 模型信息 ===== */
  function updateModelInfo() {
    $("model-info").textContent = "模型：" + (state.model || "未连接");
  }

  /* ===== 事件绑定 ===== */
  btnRun.addEventListener("click", runAgent);
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
})();
