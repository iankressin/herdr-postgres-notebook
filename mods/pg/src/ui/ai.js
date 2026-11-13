// The AI parts of the notebook page: the buttons that ask an agent, the box that takes the
// request, the agent picker, and the line that follows the agent until its answer lands.
import { div, image, svg } from "gpui-kit";
import { h_flex, v_flex, Input, Popup } from "gpui-base";
import { VERBS } from "../ai/protocol.js";
import { alpha, button, icon, keepFocus } from "./kit.js";

const AGENT_MENU = "pg-agent";

export const sparkle = (size, color) => icon("sparkle", size, color);

function agentIcon(agent, t, size = 14) {
  if (!agent.icon) return sparkle(size, t.muted);
  return agent.tint ? svg(agent.icon).size(size).flex_none().text_color(t.foreground) : image(agent.icon).size(size).flex_none();
}

// To the right of Run: opens the box for an edit request under the query's header.
export function editButton(view, query, t) {
  const on = view.asking === query.id;
  return h_flex().id(`pg-ai-edit-${query.id}`).flex_none().h(30).px(12).gap(7).items_center().rounded_full().cursor_pointer()
    .text_size(12.5).font_medium()
    .bg(on ? alpha(t.accent, 0.16) : alpha(t.foreground, 0.06)).text_color(on ? t.foreground : t.muted)
    .hover((st) => st.bg(alpha(t.accent, 0.16)).text_color(t.foreground))
    .on_click((_e, cx) => view.openAsk(query.id, cx))
    .child(sparkle(13, t.accent)).child("Edit with AI");
}

export const askButton = (view, t) => button("pg-ask-new", t)
  .on_click((_e, cx) => view.openAsk("new", cx))
  .child(sparkle(12, t.accent)).child("Ask AI for a query");

export const fixButton = (view, query, t) => button(`pg-ai-fix-${query.id}`, t).bg(alpha(t.accent, 0.12)).text_color(t.foreground)
  .on_click((_e, cx) => view.ai.start("fix", query.id, null, cx))
  .child(sparkle(13, t.accent)).child("Fix with AI");

// The request box. `target` is "new" for a query to write, else the id of the query to edit.
export function composer(view, target, t) {
  const fresh = target === "new";
  return v_flex().id(`pg-ask-${target}`).flex_none().gap(10).px(14).pt(12).pb(10).rounded(12).bg(t.canvas)
    .border_1().border_color(alpha(t.accent, 0.55))
    .child(h_flex().gap(10).items_center()
      .child(sparkle(15, t.accent))
      .child(keepFocus(div().id(`pg-ask-field-${target}`).flex_1().min_w(0).h(28).cursor_text()
        .child(Input.new(view.askInput(target)).h_full().text_size(14)))))
    .child(h_flex().gap(8).items_center()
      .child(agentPicker(view, t))
      .child(div().flex_1())
      .child(div().text_size(12).text_color(t.dim).child("Esc to cancel"))
      .child(h_flex().id(`pg-ask-go-${target}`).h(28).px(12).gap(7).items_center().rounded_full().cursor_pointer()
        .bg(t.solid).text_color(t.solid_foreground).text_size(12.5).font_semibold()
        .on_click((_e, cx) => view.submitAsk(cx))
        .child(fresh ? "Write it" : "Edit it")
        .child(div().text_size(11.5).font_weight(400).opacity(0.55).child("↵"))));
}

function agentPicker(view, t) {
  const agent = view.ai.agent();
  const agents = view.ai.agents ?? [];
  const open = view.ui.menu === AGENT_MENU;
  const trigger = h_flex().id("pg-agent").h(26).pl(8).pr(6).gap(6).items_center().rounded(7).cursor_pointer()
    .text_size(12.5).text_color(t.muted).hover((st) => st.bg(t.hover).text_color(t.foreground))
    .on_click((_e, cx) => (open ? view.closeMenus(cx) : view.openMenu(AGENT_MENU, cx)))
    .when(Boolean(agent), (e) => e.child(agentIcon(agent, t)).child(agent.name))
    .when(!agent, (e) => e.child(view.ai.agents === null ? "Checking agents…" : "No agent installed"))
    .when(agents.length > 1, (e) => e.child(icon("chevron-down", 11, t.dim)));
  return Popup.new("pg-agent-popup", trigger).anchor("top_left")
    .when(open && agents.length > 1, (p) => p.content(v_flex().id("pg-agent-menu").w(220).mt(4).p(4).gap(1).rounded(10)
      .bg(t.popover).border_1().border_color(t.border).shadow_lg()
      .on_mouse_down_out((_e, cx) => view.closeMenus(cx))
      .child(div().px(8).pt(4).pb(4).text_size(11.5).text_color(t.dim).child("Ask with"))
      .children(agents.map((a) => h_flex().id(`pg-agent-${a.key}`).h(30).px(8).gap(10).items_center().rounded(7).cursor_pointer()
        .text_size(13).text_color(t.foreground).hover((st) => st.bg(t.hover))
        .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); view.ai.choose(a.key); view.closeMenus(cx); })
        .child(agentIcon(a, t)).child(div().flex_1().child(a.name))
        .when(a.key === agent?.key, (e) => e.child(icon("check", 12, t.accent)))))));
}

// While the agent works, or when it failed: what it is doing, and Watch (or Open) and Stop.
export function jobStrip(view, query, job, t) {
  const phase = view.ai.phase(job);
  const name = job.agent.name;
  const failed = phase === "failed";
  const silent = phase === "starting" && job.slow;
  const waiting = phase === "blocked" || phase === "stopped" || silent;
  const color = failed ? t.ansi1 : waiting ? t.ansi3 : t.accent;
  const headline = failed ? job.failed
    : phase === "blocked" ? `${name} needs you`
      : phase === "stopped" ? `${name} stopped without an answer`
        : silent ? `${name} has not started`
        : phase === "starting" ? `Starting ${name}…`
          : `${name} is ${VERBS[job.kind].doing}`;
  const detail = failed ? null : silent ? "Open it: it may be asking something first." : waiting ? "Open it to see what it asks." : job.request ? `“${job.request}”` : null;
  const action = (key, label, fn) => button(`pg-ai-${key}-${query.id}`, t).flex_none().on_click((_e, cx) => fn(cx)).child(label);
  return h_flex().id(`pg-ai-${query.id}`).flex_none().gap(12).items_center().px(14).py(10).rounded(12).bg(alpha(color, 0.09))
    .child(failed || waiting ? div().size(7).flex_none().rounded_full().bg(color) : icon("spinner", 13, color).spin(800))
    .child(v_flex().flex_1().min_w(0).gap(2)
      .child(div().text_size(13.5).font_medium().text_color(failed ? t.ansi1 : t.foreground).child(headline))
      .when(Boolean(detail), (e) => e.child(div().truncate().text_size(12.5).text_color(t.muted).child(detail))))
    .when(Boolean(job.terminal), (e) => e.child(action("open", waiting ? "Open" : "Watch", () => view.ai.watch(job))))
    .child(failed
      ? action("dismiss", "Dismiss", (cx) => view.ai.dismiss(query.id, cx))
      : action("stop", "Stop", (cx) => view.ai.cancel(query.id, cx)));
}

// Once the answer is in: who wrote it, Undo for an edit or a fix, and a button to hide the line.
export function doneLine(view, query, job, t) {
  const undo = job.kind !== "write" && Boolean(job.before);
  const what = `${VERBS[job.kind].done} by ${job.agent.name}${job.kind === "edit" ? `: “${job.request}”` : ""}`;
  return h_flex().id(`pg-ai-done-${query.id}`).flex_none().gap(6).items_center().text_size(12.5).text_color(t.dim)
    .child(sparkle(12, t.accent))
    .child(div().min_w(0).truncate().child(what))
    .when(undo, (e) => e.child(div().child("·")).child(div().id(`pg-ai-undo-${query.id}`).cursor_pointer().text_color(t.muted)
      .hover((st) => st.text_color(t.foreground))
      .on_click((_e, cx) => view.ai.undo(query.id, cx))
      .child("Undo")))
    .child(div().id(`pg-ai-hide-${query.id}`).size(18).flex_none().flex().items_center().justify_center().rounded(5).cursor_pointer()
      .hover((st) => st.bg(t.hover)).tooltip("Hide")
      .on_click((_e, cx) => view.ai.dismiss(query.id, cx))
      .child(icon("close", 10, t.dim)));
}
