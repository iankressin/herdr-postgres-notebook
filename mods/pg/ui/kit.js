// Small parts every drawing file uses: fonts, icons, tints, buttons.
import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { settings } from "herdr";

export const SERIF = "Source Serif 4";
export const CLEAR = "#00000000";

export const mono = () => settings().font_family ?? "JetBrains Mono";
export const icon = (name, size, color) => svg(`mods/pg/icons/${name}.svg`).size(size).flex_none().text_color(color);

export function alpha(color, a) {
  if (typeof color !== "string" || !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(color)) return color;
  return color.slice(0, 7) + Math.round(a * 255).toString(16).padStart(2, "0");
}

export const syntax = (t) => ({
  keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3,
  number: t.ansi6, constant: t.ansi6, boolean: t.ansi5, variable: t.foreground, operator: t.muted, punctuation: t.dim,
});

const KIND_STYLE = {
  number: ["ansi4", "t-number"], text: ["muted", "t-text"], time: ["ansi3", "t-time"], json: ["ansi5", "braces"],
  bool: ["ansi2", "t-bool"], uuid: ["dim", "t-uuid"], binary: ["dim", "t-uuid"], array: ["ansi6", "columns"],
};
export const kindIcon = (kind, t, size = 12) => icon(KIND_STYLE[kind]?.[1] ?? "t-text", size, t[KIND_STYLE[kind]?.[0] ?? "muted"]);

export const button = (id, t) => h_flex().id(id).h(28).px(10).gap(7).items_center().rounded(8).cursor_pointer().text_size(12.5).text_color(t.muted)
  .hover((st) => st.bg(t.hover).text_color(t.foreground));

export const iconButton = (id, name, t, size = 22) => div().id(id).size(size).flex_none().flex().items_center().justify_center().rounded(6).cursor_pointer()
  .hover((st) => st.bg(t.hover))
  .child(icon(name, Math.round(size * 0.55), t.muted));

// Clicks inside a field keep the keyboard there instead of letting the page take it.
export const keepFocus = (el) => el.on_mouse_down("left", (_e, cx) => cx.stop_propagation());
