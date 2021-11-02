import { babel } from "@rollup/plugin-babel";

export default {
  input: "src/main.js",
  output: {
    file: "dist/parseAudioMetadata.js",
    format: "es"
  },
  plugins: [
    babel({
      exclude: "node_modules/**",
      babelHelpers: "bundled",
      presets: [["@babel/preset-env", {
        modules: false,
        bugfixes: true,
        loose: true,
        useBuiltIns: "usage",
        corejs: 3
      }]]
    })
  ]
};
