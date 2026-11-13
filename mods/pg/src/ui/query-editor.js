import { EditorState } from "gpui-base";
import { theme } from "herdr";
import { mono, syntax } from "./kit.js";

export const createSqlEditor = (sql) => EditorState.new({
  language: "sql", value: sql, font_family: mono(), font_size: 13.5,
  line_numbers: false, folding: false, soft_wrap: true, syntax: syntax(theme()),
});
