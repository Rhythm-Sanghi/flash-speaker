import { build } from "esbuild";
import { mkdir, copyFile, cp, rm, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const out = new URL("../dist/", import.meta.url);
if (resolve(fileURLToPath(out)) !== resolve(root, "dist"))
  throw new Error("Unexpected build directory.");
await rm(out, { recursive: true, force: true });
await mkdir(new URL("src/", out), { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ["src/app.js"],
  outdir: "dist/src",
  bundle: true,
  splitting: true,
  format: "esm",
  target: ["es2022"],
  minify: true,
  legalComments: "linked",
});
for (const name of ["index.html", "config.js", ".nojekyll", "src/styles.css"])
  await copyFile(new URL("../" + name, import.meta.url), new URL(name, out));
await cp(new URL("../assets/", import.meta.url), new URL("assets/", out), {
  recursive: true,
});
const licenses = [];
for (const [name, file] of Object.entries({
  peerjs: "LICENSE",
  "@msgpack/msgpack": "LICENSE",
  "peerjs-js-binarypack": "LICENSE",
  eventemitter3: "LICENSE",
  "webrtc-adapter": "LICENSE.md",
  sdp: "LICENSE",
  "html5-qrcode": "LICENSE",
})) {
  licenses.push(
    name +
      "\n" +
      (await readFile(
        new URL("../node_modules/" + name + "/" + file, import.meta.url),
        "utf8",
      )),
  );
}
const mit = await readFile(
  new URL("../node_modules/peerjs/LICENSE", import.meta.url),
  "utf8",
);
licenses.push(
  "qrcode-generator\nCopyright (c) 2009 Kazuhiko Arase\n\n" +
    mit.slice(mit.indexOf("Permission is hereby granted")),
);
await writeFile(
  new URL("third-party-licenses.txt", out),
  licenses.join("\n\n--------------------\n\n"),
);
console.log("Built website in dist/.");
