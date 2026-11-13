import * as fs from "fs/promises";
import { appHome, exec, home, notify, readTextFile, shared, writeTextFile } from "herdr";
import { SERVER_KEY, serverText } from "../postgres/connection.js";
import { createPostgresClient } from "../postgres/client.js";
import { createResultFiles } from "../results/files.js";

export const currentServer = () => serverText(shared(SERVER_KEY));

export function createServices() {
  const resultFiles = createResultFiles({ fs, exec, directory: `${appHome()}/data/pg`, downloads: `${home()}/Downloads` });
  return {
    resultFiles,
    postgres: createPostgresClient({ exec, currentServer, resultFiles }),
    notebookStorage: { home: appHome(), fs, notify, readTextFile, writeTextFile },
    notify,
  };
}
