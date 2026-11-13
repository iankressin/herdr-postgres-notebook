// The command for a click on a database in the panel: go to its browser tab in the shown space, or make one.
export function openCommand(spaces, database) {
  const name = `pg: ${database}`;
  const tab = spaces.find((space) => space.active)?.tabs.find((t) => t.name === name);
  return tab ? ["tab.select", { id: tab.id }] : ["tab.new", { mod: "pg", name, props: { database } }];
}
