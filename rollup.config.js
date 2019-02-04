import resolve from "rollup-plugin-node-resolve";
import commonjs from "rollup-plugin-commonjs";
import babel from "rollup-plugin-babel";

export default {
  input: "src/main.js",
  output: {
    file: "dist/parseAudioMetadata.js",
    format: "es"
  },
  plugins: [
    resolve({
      jsnext: true,
      main: true,
      browser: true
    }),
    commonjs(),
    babel({
      exclude: "node_modules/**",
      babelrc: false,
      presets: [["@babel/preset-env", {
        modules: false,
        loose: true,
        useBuiltIns: "usage"
      }]]
    })
  ]
};
