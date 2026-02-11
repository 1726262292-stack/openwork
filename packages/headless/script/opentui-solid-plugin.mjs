import { transformAsync } from "@babel/core";
import ts from "@babel/preset-typescript";
import solid from "babel-preset-solid";

const openTuiSolidPlugin = {
  name: "openwrk-opentui-solid",
  setup(build) {
    build.onLoad({ filter: /\/node_modules\/solid-js\/dist\/server\.js$/ }, async (args) => {
      const path = args.path.replace("server.js", "solid.js");
      const file = Bun.file(path);
      const code = await file.text();
      return { contents: code, loader: "js" };
    });

    build.onLoad({ filter: /\/node_modules\/solid-js\/store\/dist\/server\.js$/ }, async (args) => {
      const path = args.path.replace("server.js", "store.js");
      const file = Bun.file(path);
      const code = await file.text();
      return { contents: code, loader: "js" };
    });

    build.onLoad({ filter: /\.(js|ts)x$/ }, async (args) => {
      const file = Bun.file(args.path);
      const code = await file.text();
      const transformed = await transformAsync(code, {
        filename: args.path,
        presets: [
          [
            solid,
            {
              moduleName: "@opentui/solid",
              generate: "universal",
            },
          ],
          [ts],
        ],
      });
      return {
        contents: transformed?.code ?? "",
        loader: "js",
      };
    });
  },
};

export default openTuiSolidPlugin;
