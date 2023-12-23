import typescript from "@rollup/plugin-typescript";

const isProd = process.env.production;

export default {
  input: "src/main.ts",
  output: {
    file: "dist/parseAudioMetadata.js",
    format: "es",
    sourcemap: isProd ? false: "inline"
  },
  plugins: [
    typescript({ sourceMap: !isProd, inlineSources: !isProd })
  ]
};
